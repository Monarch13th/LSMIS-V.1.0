// Single global auth store with clean React state subscription
import { useState, useEffect } from "react";
import { supabase } from "../services/supabaseClient";
import { TABLES, STORAGE_KEYS } from "../utils/constants";
import { uuid } from "../utils/helpers";
import { isInstalledApp as isCapacitorNativeApp } from "../utils/capacitor";

export const normalizeRole = (r) => {
  if (!r) return null;
  const s = String(r).toLowerCase().trim();
  if (s === "administrator" || s === "admin" || s.includes("admin")) return "admin";
  if (s === "veterinarian" || s === "vet" || s.includes("vet") || s.includes("doctor")) return "vet";
  if (s === "staff" || s.includes("staff") || s.includes("operator")) return "staff";
  if (s === "owner" || s.includes("owner")) return "owner";
  return s;
};

const createStore = (initial) => {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => {
        try { l(); } catch (e) { }
      });
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
};

export const getSessionStorageItem = (key) => {
  if (typeof window === "undefined") return null;
  try {
    const isNative = isCapacitorNativeApp();
    const val = sessionStorage.getItem(key);
    if (val) return val;
    if (isNative) {
      return localStorage.getItem(key);
    }
    return null;
  } catch (_) {
    return null;
  }
};

export const setSessionStorageItem = (key, value) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
    if (isCapacitorNativeApp()) {
      localStorage.setItem(key, value);
    }
  } catch (_) {}
};

export const removeSessionStorageItem = (key) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
    if (isCapacitorNativeApp()) {
      localStorage.removeItem(key);
    }
  } catch (_) {}
};

const getInitialSession = () => {
  try {
    // In Capacitor native app, support localStorage so session persists on close & reopen
    // In standard web browsers, strictly use tab-isolated sessionStorage
    const stored = getSessionStorageItem(STORAGE_KEYS.SESSION);
    if (stored) return JSON.parse(stored);
    return null;
  } catch (e) {
    return null;
  }
};

const initialCached = getInitialSession();

export const authStore = createStore({
  session: initialCached,
  loading: !initialCached,
  isInitialized: false,
});

const isGoogleOAuthHandshakeInProgress = () => {
  if (typeof window === "undefined") return false;
  try {
    const pathname = window.location.pathname || "";
    const search = window.location.search || "";
    const hash = window.location.hash || "";
    if (sessionStorage.getItem("lsmis_google_reg_pending")) return true;

    // If already on an authenticated route, the OAuth handshake is done; never block session resolution
    if (
      pathname.startsWith("/owner") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/vet") ||
      pathname.startsWith("/staff")
    ) {
      return false;
    }

    const inFlightTs = sessionStorage.getItem("lsmis_google_oauth_in_flight");
    if (inFlightTs && Date.now() - Number(inFlightTs) > 5 * 60 * 1000) {
      sessionStorage.removeItem("lsmis_google_oauth_intent");
      sessionStorage.removeItem("lsmis_google_oauth_in_flight");
      return false;
    }

    const hasOAuthTokens =
      hash.includes("access_token=") ||
      search.includes("code=") ||
      search.includes("oauth_intent=") ||
      hash.includes("error=") ||
      search.includes("error=");

    // Only considered in progress if currently on /login or URL has OAuth parameters or in-flight markers
    if (hasOAuthTokens || ((pathname === "/login" || pathname === "/") && Boolean(inFlightTs))) {
      return true;
    }
  } catch (_) { }
  return false;
};

/**
 * Resolves full user profile & role from Supabase to construct standard application session
 */
async function resolveUserSession(supabaseUser, existingCached = null) {
  if (!supabaseUser) return null;
  if (isGoogleOAuthHandshakeInProgress()) return null;

  const email = (supabaseUser.email || "").toLowerCase().trim();
  const identities = Array.isArray(supabaseUser.identities) ? supabaseUser.identities : [];
  const googleIdentity = identities.find((id) => id?.provider === "google") || null;
  const isGoogleUser =
    supabaseUser.app_metadata?.provider === "google" ||
    Boolean(googleIdentity) ||
    supabaseUser.user_metadata?.auth_provider === "google" ||
    supabaseUser.user_metadata?.google_connected === true;

  let avatarUrl =
    googleIdentity?.identity_data?.avatar_url ||
    googleIdentity?.identity_data?.picture ||
    supabaseUser.user_metadata?.avatar_url ||
    supabaseUser.user_metadata?.picture ||
    existingCached?.avatar_url ||
    null;

  const googleId =
    googleIdentity?.id ||
    googleIdentity?.identity_data?.sub ||
    supabaseUser.user_metadata?.google_id ||
    supabaseUser.user_metadata?.provider_id ||
    existingCached?.google_id ||
    null;

  // If existing cached session matches the user and already has a verified role and session_id, preserve it
  const currentInitial = getInitialSession();
  const cachedToUse = existingCached || currentInitial;
  if (
    cachedToUse &&
    (cachedToUse.id === supabaseUser.id || cachedToUse.user_id === supabaseUser.id || cachedToUse.email?.toLowerCase() === email) &&
    cachedToUse.role &&
    cachedToUse.session_id
  ) {
    // If the user authenticated via Google OAuth, cached session MUST be for an authorized role
    const validRoles = ["admin", "vet", "staff", "owner"];
    if (isGoogleUser && !validRoles.includes(normalizeRole(cachedToUse.role))) {
      return null;
    }
    return {
      ...cachedToUse,
      user_id: supabaseUser.id,
      email,
      avatar_url: cachedToUse.avatar_url || avatarUrl,
      google_id: googleId || cachedToUse.google_id,
    };
  }

  let role = supabaseUser.user_metadata?.role || null;
  let name = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || "";
  let username = supabaseUser.user_metadata?.username || "";
  let ownerId = supabaseUser.user_metadata?.owner_id || null;
  let dbActiveSessionId = null;
  let dbActiveSessionUpdatedAt = null;
  let userStatus = null;

  try {
    const { data: userRow } = await supabase
      .from(TABLES.USERS)
      .select("id, role, full_name, username, status, owner_id, active_session_id, active_session_updated_at, avatar_url")
      .or(`id.eq.${supabaseUser.id},email.ilike.${email}`)
      .limit(1)
      .maybeSingle();

    if (userRow) {
      if (userRow.role) role = normalizeRole(userRow.role) || userRow.role;
      if (userRow.full_name) name = userRow.full_name;
      if (userRow.username) username = userRow.username;
      if (userRow.status) userStatus = userRow.status;
      if (userRow.owner_id) ownerId = userRow.owner_id;
      if (userRow.avatar_url) avatarUrl = userRow.avatar_url;
      if (userRow.active_session_id) dbActiveSessionId = userRow.active_session_id;
      if (userRow.active_session_updated_at) dbActiveSessionUpdatedAt = userRow.active_session_updated_at;
    }
  } catch (e) {
    console.warn("Could not query public.users during auth restoration:", e);
  }

  // Check if role is definitively confirmed as personnel (Admin, Vet, Staff)
  const isPersonnel = role === "admin" || role === "vet" || role === "staff";

  // Google OAuth is supported for both Personnel (Admin, Vet, Staff) and approved Owners
  if (isGoogleUser) {
    if (isPersonnel) {
      // Validate personnel account status (must not be deactivated, inactive, or terminated)
      const stLower = String(userStatus || "").toLowerCase().trim();
      if (
        stLower === "inactive" ||
        stLower === "deactivated" ||
        stLower.includes("terminated") ||
        stLower.includes("suspend")
      ) {
        return null;
      }
    } else {
      // Must be a verified approved owner in public.owners
      try {
        let ownerQ = supabase
          .from(TABLES.OWNERS)
          .select("id, name, username, status, avatar_url");

        if (supabaseUser.id && email) {
          ownerQ = ownerQ.or(`auth_user_id.eq.${supabaseUser.id},email.ilike.${email}`);
        } else if (supabaseUser.id) {
          ownerQ = ownerQ.eq("auth_user_id", supabaseUser.id);
        } else {
          ownerQ = ownerQ.ilike("email", email);
        }

        const { data: ownerRow } = await ownerQ.limit(1).maybeSingle();
        if (!ownerRow) {
          return null;
        }

        const stLower = String(ownerRow.status || "").toLowerCase().trim();
        const isApproved =
          (stLower === "approved" || stLower === "active") &&
          !String(ownerRow.id || "").startsWith("REG");

        if (!isApproved) {
          return null;
        }

        role = "owner";
        if (ownerRow.name) name = ownerRow.name;
        if (ownerRow.username) username = ownerRow.username;
        if (ownerRow.avatar_url) avatarUrl = ownerRow.avatar_url;
        ownerId = ownerRow.id;
      } catch (_) {
        return null;
      }

      if (role !== "owner") {
        return null;
      }
    }
  } else {
    // Non-Google user (standard Email & Password authentication for Admin, Vet, Staff, and manual Owners)
    if (!isPersonnel && (!role || role === "owner")) {
      try {
        let ownerQ = supabase
          .from(TABLES.OWNERS)
          .select("id, name, username, status, avatar_url");

        if (supabaseUser.id && email) {
          ownerQ = ownerQ.or(`auth_user_id.eq.${supabaseUser.id},email.ilike.${email}`);
        } else if (supabaseUser.id) {
          ownerQ = ownerQ.eq("auth_user_id", supabaseUser.id);
        } else {
          ownerQ = ownerQ.ilike("email", email);
        }

        const { data: ownerRow } = await ownerQ.limit(1).maybeSingle();
        if (ownerRow) {
          const stLower = String(ownerRow.status || "").toLowerCase().trim();
          const isApproved =
            (stLower === "approved" || stLower === "active") &&
            !String(ownerRow.id || "").startsWith("REG");
          if (!isApproved) {
            return null;
          }
          role = "owner";
          if (ownerRow.name) name = ownerRow.name;
          if (ownerRow.username) username = ownerRow.username;
          if (ownerRow.avatar_url) avatarUrl = ownerRow.avatar_url;
          ownerId = ownerRow.id;
        }
      } catch (_) {}
    }
  }

  role = normalizeRole(role);
  if (!role) {
    return null;
  }

  // Retain existing session_id if already cached in this tab or initiated by client login; otherwise generate a fresh unique session UUID.
  let clientStoredSessionId = null;
  try {
    clientStoredSessionId =
      sessionStorage.getItem("lsmis_pending_session_id") ||
      sessionStorage.getItem("lsmis_active_session_id") ||
      localStorage.getItem("lsmis_client_session_id");
  } catch (_) { }

  const effectiveSessionId =
    cachedToUse?.session_id ||
    clientStoredSessionId ||
    dbActiveSessionId ||
    uuid();
  const effectiveLoginTime =
    cachedToUse?.login_time ||
    dbActiveSessionUpdatedAt ||
    new Date().toISOString();

  return {
    id: supabaseUser.id,
    user_id: supabaseUser.id,
    role,
    name: name || email.split("@")[0],
    email,
    username: username || email.split("@")[0],
    owner_id: ownerId,
    avatar_url: avatarUrl,
    google_id: googleId,
    auth_provider: isGoogleUser ? "google" : "email",
    session_id: effectiveSessionId,
    ts: Date.now(),
    login_time: effectiveLoginTime,
  };
}

let isAuthInitialized = false;

/**
 * Initializes authentication state from Supabase Auth as the single source of truth.
 * Restores session on application startup and listens to auth state changes.
 */
export const initializeAuth = async () => {
  if (isAuthInitialized || typeof window === "undefined") return;
  isAuthInitialized = true;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("Supabase getSession notice:", error);
    }

    if (isGoogleOAuthHandshakeInProgress()) {
      authStore.set({ session: null, loading: false, isInitialized: true });
      return;
    }

    const sbSession = data?.session;
    if (sbSession?.user) {
      const cached = getInitialSession();
      // If cached session exists and is valid, use it immediately to avoid unnecessary reinitialization
      if (
        cached &&
        cached.role &&
        cached.session_id &&
        (cached.user_id === sbSession.user.id || cached.email?.toLowerCase() === (sbSession.user.email || "").toLowerCase().trim())
      ) {
        authStore.set({ session: cached, loading: false, isInitialized: true });
      } else {
        const resolved = await resolveUserSession(sbSession.user, cached);
        if (resolved) {
          try {
            setSessionStorageItem(STORAGE_KEYS.SESSION, JSON.stringify(resolved));
          } catch (_) { }
          authStore.set({ session: resolved, loading: false, isInitialized: true });
        } else if (cached && cached.role) {
          authStore.set({ session: cached, loading: false, isInitialized: true });
        } else {
          authStore.set({ session: null, loading: false, isInitialized: true });
        }
      }
    } else {
      // No active session in Supabase Auth
      const cached = getInitialSession();
      if (cached && cached.role) {
        authStore.set({ session: cached, loading: false, isInitialized: true });
      } else {
        try {
          removeSessionStorageItem(STORAGE_KEYS.SESSION);
        } catch (_) { }
        authStore.set({ session: null, loading: false, isInitialized: true });
      }
    }
  } catch (err) {
    console.warn("Auth initialization error:", err);
    const cached = getInitialSession();
    authStore.set({ session: cached || null, loading: false, isInitialized: true });
  }

  // Subscribe to Supabase auth state transitions
  try {
    supabase.auth.onAuthStateChange(async (event, sbSession) => {
      if (event === "SIGNED_OUT") {
        try {
          removeSessionStorageItem(STORAGE_KEYS.SESSION);
        } catch (_) { }
        authStore.set({ session: null, loading: false, isInitialized: true });
        return;
      }

      if (isGoogleOAuthHandshakeInProgress()) {
        return;
      }

      // During background token refresh or user updates, preserve and refresh the active session
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        const current = authStore.get()?.session || getInitialSession();
        if (current && current.role && current.session_id) {
          const updated = {
            ...current,
            ts: Date.now(),
          };
          try {
            setSessionStorageItem(STORAGE_KEYS.SESSION, JSON.stringify(updated));
          } catch (_) {}
          authStore.set({ session: updated, loading: false, isInitialized: true });
          return;
        }
      }

      if (sbSession?.user) {
        // If an active session is already loaded in authStore with a session_id and matches the user, don't overwrite it
        const currentStoreSession = authStore.get()?.session;
        const userEmail = (sbSession.user.email || "").toLowerCase().trim();
        if (
          currentStoreSession &&
          currentStoreSession.session_id &&
          (currentStoreSession.user_id === sbSession.user.id || currentStoreSession.email?.toLowerCase() === userEmail)
        ) {
          return;
        }

        const cached = getInitialSession();
        const resolved = await resolveUserSession(sbSession.user, cached);
        if (resolved) {
          try {
            setSessionStorageItem(STORAGE_KEYS.SESSION, JSON.stringify(resolved));
          } catch (_) { }
          authStore.set({ session: resolved, loading: false, isInitialized: true });
        }
      } else if (!sbSession && event !== "USER_UPDATED" && event !== "TOKEN_REFRESHED") {
        const cached = getInitialSession();
        if (!cached) {
          authStore.set({ session: null, loading: false, isInitialized: true });
        }
      }
    });
  } catch (e) {
    console.warn("onAuthStateChange subscription notice:", e);
  }
};

// Auto-run once safely on client side
if (typeof window !== "undefined") {
  initializeAuth();
}

/**
 * Subscribe to a single key of the auth store.
 */
export const useAuthStore = (selector) => {
  const [slice, setSlice] = useState(() => (selector ? selector(authStore.get()) : authStore.get()));

  useEffect(() => {
    const update = () => {
      const next = selector ? selector(authStore.get()) : authStore.get();
      setSlice((prev) => (prev !== next ? next : prev));
    };
    return authStore.subscribe(update);
  }, []);

  return slice;
};
