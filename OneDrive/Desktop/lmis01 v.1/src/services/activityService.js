// Cross-role activity and real-time security tracking service.
// Records operational actions, presence heartbeats, diffs, and security events.
import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES, STORAGE_KEYS } from "../utils/constants";
import { uuid, now } from "../utils/helpers";
import {
  getUserNotificationPreferences,
  classifyNotificationCategory,
} from "./notificationPreferenceService";

const ACTIVE_SESSIONS_KEY = "lsmis_active_sessions";
const TERMINATION_SIGNAL_KEY = "lsmis_session_termination_signal";
const PRESENCE_CHANNEL = "lsmis_presence_channel";

export const AUDIT_ACTION_TYPES = [
  "Created",
  "Updated",
  "Approved",
  "Rejected",
  "Deleted",
  "Logged In",
  "Logged Out",
  "Registered",
  "Issued",
  "Assigned",
];

// BroadcastChannel for zero-latency cross-tab/window real-time sync
let _bc = null;
const getBroadcastChannel = () => {
  if (!_bc) {
    try {
      _bc = new BroadcastChannel(PRESENCE_CHANNEL);
    } catch (e) {
      _bc = null;
    }
  }
  return _bc;
};

const broadcastPresence = (payload) => {
  try {
    const bc = getBroadcastChannel();
    if (bc) bc.postMessage(payload);
  } catch (e) {}
  window.dispatchEvent(new CustomEvent("lsmis_presence_updated", { detail: payload }));
};

const getSession = () => {
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEYS.SESSION) ||
      localStorage.getItem(STORAGE_KEYS.SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const normalizeRole = (role) => {
  if (!role) return "staff";
  const r = String(role).trim().toLowerCase();
  if (r === "admin" || r === "administrator" || r.includes("admin")) return "admin";
  if (r === "vet" || r === "veterinarian" || r.includes("vet") || r.includes("doctor")) return "vet";
  if (r === "staff" || r === "operator" || r.includes("staff")) return "staff";
  if (r === "owner" || r.includes("owner")) return "owner";
  if (r === "system") return "system";
  return r;
};

/**
 * Formats a role into the exact LSMIS display label: Admin, Veterinarian, or Staff.
 */
export const formatRoleLabel = (role) => {
  const norm = normalizeRole(role);
  if (norm === "admin") return "Admin";
  if (norm === "vet") return "Veterinarian";
  if (norm === "staff") return "Staff";
  if (norm === "owner") return "Owner";
  return "Staff";
};

/**
 * Classifies an audit action description into one of the standard LSMIS activity types:
 * Created, Updated, Approved, Rejected, Deleted, Logged In, Logged Out, Registered, Issued, or Assigned.
 */
export const classifyAuditAction = (actionText = "") => {
  const text = String(actionText || "").trim();
  if (!text) return "Updated";
  const lower = text.toLowerCase();

  if (/logged in|signed in|verified 2fa|\blogin\b/i.test(lower)) return "Logged In";
  if (/logged out|signed out|\blogout\b/i.test(lower)) return "Logged Out";
  if (/\bissued\b|permit issued|recorded payment|\breceipt\b/i.test(lower)) return "Issued";
  if (/\bassigned\b|\breassigned\b|assign team operator/i.test(lower)) return "Assigned";
  if (/\bregistered\b|batch registered|registration submitted/i.test(lower)) return "Registered";
  if (/\bapproved\b|\bcertified\b|\bpassed\b|\bcleared\b/i.test(lower)) return "Approved";
  if (/\brejected\b|\bcondemned\b|\bterminated\b|\bsuspended\b|failed login|failed password|lockout/i.test(lower)) return "Rejected";
  if (/\bdeleted\b|\bremoved\b|\bdisposal\b|\bdisposed\b/i.test(lower)) return "Deleted";
  if (/\bcreated\b|\badded\b|\bprovisioned\b/i.test(lower)) return "Created";
  return "Updated";
};

/**
 * Converts a Date or timestamp into an ISO-8601 string in Philippine Time (Asia/Manila, +08:00).
 * Example: "2026-10-31T15:25:10+08:00"
 */
export const toManilaIsoString = (dateInput = new Date()) => {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(validDate);
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hh = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}:${map.second}+08:00`;
};

export const getManilaTimestamp = () => toManilaIsoString(new Date());

/**
 * Safely parses any timestamp (ISO string or Manila locale string) into a Date object.
 */
export const parseAuditTimestamp = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) {
    return isNaN(timestamp.getTime()) ? null : timestamp;
  }
  const str = String(timestamp).trim();
  if (!str) return null;

  // 1. Standard ISO string with timezone or T separator
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(str);
    const normalized = str.includes("T") ? str : str.replace(" ", "T");
    const d = new Date(hasTz ? normalized : `${normalized}+08:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. US locale string in Asia/Manila: "MM/DD/YYYY, hh:mm:ss AM/PM"
  const localeMatch = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (localeMatch) {
    const month = String(localeMatch[1]).padStart(2, "0");
    const day = String(localeMatch[2]).padStart(2, "0");
    const year = localeMatch[3];
    let hour = parseInt(localeMatch[4], 10);
    const minute = localeMatch[5];
    const second = localeMatch[6] || "00";
    const ampm = (localeMatch[7] || "").toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, "0");
    const iso = `${year}-${month}-${day}T${hh}:${minute}:${second}+08:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};

/**
 * Returns the YYYY-MM-DD date string in Philippine Time (Asia/Manila).
 */
export const toManilaDateKey = (timestamp) => {
  const d = parseAuditTimestamp(timestamp);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
};

/* =========================================================================
   USER DIRECTORY CACHE & ACTOR IDENTITY RESOLUTION
   ========================================================================= */

let _usersCache = { rows: null, byId: new Map(), byEmail: new Map(), byUsername: new Map(), byName: new Map(), timestamp: 0 };
const USERS_CACHE_TTL_MS = 30000;

export const getUsersDirectory = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    _usersCache.rows &&
    Date.now() - _usersCache.timestamp < USERS_CACHE_TTL_MS
  ) {
    return _usersCache;
  }

  try {
    const { data, error } = await supabase
      .from(TABLES.USERS)
      .select("id, full_name, username, email, role");

    if (!error && Array.isArray(data)) {
      const byId = new Map();
      const byEmail = new Map();
      const byUsername = new Map();
      const byName = new Map();

      data.forEach((u) => {
        if (!u) return;
        if (u.id) byId.set(String(u.id).trim().toLowerCase(), u);
        if (u.email) byEmail.set(String(u.email).trim().toLowerCase(), u);
        if (u.username) byUsername.set(String(u.username).trim().toLowerCase(), u);
        if (u.full_name) byName.set(String(u.full_name).trim().toLowerCase(), u);
      });

      _usersCache = {
        rows: data,
        byId,
        byEmail,
        byUsername,
        byName,
        timestamp: Date.now(),
      };
    }
  } catch (_) {}

  return _usersCache;
};

let _actorCache = { sessionKey: null, identity: null, timestamp: 0 };
const ACTOR_CACHE_TTL_MS = 60000;

export const getActorIdentity = async (explicitUser = null, explicitRole = null, explicitUserId = null) => {
  const activeSession = getSession();
  const directory = await getUsersDirectory();

  const lookupUserRecord = (idCandidate, userCandidate) => {
    if (idCandidate) {
      const foundById = directory.byId.get(String(idCandidate).trim().toLowerCase());
      if (foundById) return foundById;
    }
    if (userCandidate) {
      const key = String(userCandidate).trim().toLowerCase();
      return (
        directory.byName.get(key) ||
        directory.byEmail.get(key) ||
        directory.byUsername.get(key) ||
        null
      );
    }
    return null;
  };

  // 1. Check explicit parameters against users directory first so full_name and role are always authoritative
  if (explicitUserId || (explicitUser && explicitUser !== "System" && explicitUser !== "System Scheduler")) {
    const matchedExplicit = lookupUserRecord(explicitUserId, explicitUser);
    if (matchedExplicit) {
      return {
        userId: matchedExplicit.id,
        userName: matchedExplicit.full_name || explicitUser || matchedExplicit.username || matchedExplicit.email,
        userRole: normalizeRole(matchedExplicit.role || explicitRole),
      };
    }
  }

  // 2. Check active session in sessionStorage/localStorage
  if (activeSession) {
    const sessionUserId = activeSession.id || activeSession.user_id || activeSession.user?.id || null;
    const sessionEmail = activeSession.email || activeSession.user?.email || null;
    const sessionName = activeSession.name || activeSession.full_name || activeSession.username || null;
    const matchedSessionUser = lookupUserRecord(sessionUserId, sessionEmail || sessionName);

    if (matchedSessionUser) {
      return {
        userId: matchedSessionUser.id,
        userName: matchedSessionUser.full_name || sessionName || matchedSessionUser.username,
        userRole: normalizeRole(matchedSessionUser.role || activeSession.role || explicitRole),
      };
    }

    if (sessionName && activeSession.role) {
      return {
        userId: sessionUserId || explicitUserId || "authenticated",
        userName: sessionName,
        userRole: normalizeRole(activeSession.role),
      };
    }
  }

  // 3. Query Supabase Auth directly
  const currentSessionKey = activeSession
    ? `${activeSession.id || activeSession.user_id || ""}:${activeSession.email || ""}:${activeSession.role || ""}`
    : "";
  if (
    currentSessionKey &&
    _actorCache.sessionKey === currentSessionKey &&
    _actorCache.identity &&
    Date.now() - _actorCache.timestamp < ACTOR_CACHE_TTL_MS
  ) {
    return _actorCache.identity;
  }

  let resolvedId = explicitUserId || null;
  let resolvedRole = explicitRole ? normalizeRole(explicitRole) : null;
  let resolvedName = explicitUser && explicitUser !== "System Scheduler" ? explicitUser : null;

  try {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (authUser) {
      resolvedId = authUser.id;
      const matchedAuthUser = lookupUserRecord(authUser.id, authUser.email);
      if (matchedAuthUser) {
        resolvedId = matchedAuthUser.id || resolvedId;
        resolvedRole = normalizeRole(matchedAuthUser.role);
        resolvedName = matchedAuthUser.full_name || matchedAuthUser.username || authUser.email;
      } else {
        resolvedRole = normalizeRole(authUser.user_metadata?.role || resolvedRole);
        resolvedName = authUser.user_metadata?.full_name || resolvedName || authUser.email;
      }
    }
  } catch (_) {}

  const result = {
    userId: resolvedId || "authenticated",
    userName: resolvedName || explicitUser || "System Administrator",
    userRole: resolvedRole && resolvedRole !== "system" ? resolvedRole : "admin",
  };

  if (currentSessionKey && result.userId !== "authenticated") {
    _actorCache = { sessionKey: currentSessionKey, identity: result, timestamp: Date.now() };
  }

  return result;
};

/* =========================================================================
   CLIENT IP RESOLUTION
   ========================================================================= */

let _cachedClientIp = null;

export const getClientIp = async () => {
  if (_cachedClientIp) return _cachedClientIp;

  try {
    const stored = sessionStorage.getItem("lsmis_client_ip");
    if (stored) {
      _cachedClientIp = stored;
      return stored;
    }
  } catch (_) {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) {
        _cachedClientIp = data.ip;
        try {
          sessionStorage.setItem("lsmis_client_ip", data.ip);
        } catch (_) {}
        return data.ip;
      }
    }
  } catch (_) {}

  const isLocalHost = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  return isLocalHost ? "127.0.0.1" : null;
};

/* =========================================================================
   AUDIT LOGGING (WITH DEDUPLICATION GUARD)
   ========================================================================= */

const _recentLogFingerprints = new Map();
const DEDUPE_WINDOW_MS = 4000;

export const logActivity = async ({
  action,
  module = "System",
  tag_number = null,
  old_value = null,
  new_value = null,
  field_changed = null,
  security_event = null,
  severity = "info",
  user = null,
  role = null,
  user_id = null,
  ip = null,
  notify = null,
}) => {
  if (!action || !String(action).trim()) return null;

  // Resolve authenticated actor strictly from session, Supabase Auth, and public.users
  const actor = await getActorIdentity(user, role, user_id);

  const resolvedTagNumber =
    tag_number ||
    (action && (action.match(/TAG-[\w-]+/i) || [])[0]) ||
    (new_value && (String(new_value).match(/TAG-[\w-]+/i) || [])[0]) ||
    (old_value && (String(old_value).match(/TAG-[\w-]+/i) || [])[0]) ||
    null;

  // Prevent duplicate audit log entries within 4 seconds
  const nowMs = Date.now();
  const fingerprint = `${actor.userName}|${actor.userRole}|${module}|${String(action).trim()}|${resolvedTagNumber || ""}`;
  const lastLoggedAt = _recentLogFingerprints.get(fingerprint);
  if (lastLoggedAt && nowMs - lastLoggedAt < DEDUPE_WINDOW_MS) {
    return null;
  }
  _recentLogFingerprints.set(fingerprint, nowMs);

  // Prune old fingerprints periodically
  if (_recentLogFingerprints.size > 200) {
    for (const [k, ts] of _recentLogFingerprints.entries()) {
      if (nowMs - ts > DEDUPE_WINDOW_MS * 2) _recentLogFingerprints.delete(k);
    }
  }

  let clientIp = ip;
  if (!clientIp) {
    try {
      clientIp = await getClientIp();
    } catch (_) {
      const isLocalHost = typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      clientIp = isLocalHost ? "127.0.0.1" : null;
    }
  }

  const manilaIsoTimestamp = toManilaIsoString(new Date(nowMs));

  const newLog = {
    id: uuid(),
    user_id: actor.userId,
    user: actor.userName,
    role: actor.userRole,
    action: String(action).trim(),
    module: module || "System",
    ip: clientIp || null,
    tag_number: resolvedTagNumber,
    old_value: old_value !== null && old_value !== undefined ? String(old_value) : null,
    new_value: new_value !== null && new_value !== undefined ? String(new_value) : null,
    field_changed: field_changed || null,
    security_event: security_event || null,
    severity: severity || (security_event ? "danger" : "info"),
    timestamp: manilaIsoTimestamp,
  };

  try {
    let { error } = await supabase.from(TABLES.AUDIT_LOGS).insert(newLog);
    if (error && /user_id/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const fallbackLog = { ...newLog };
      delete fallbackLog.user_id;
      const res = await supabase.from(TABLES.AUDIT_LOGS).insert(fallbackLog);
      error = res.error;
    }
    if (error) console.warn("Supabase audit log insert error:", error);
    else {
      notifyDbChange(TABLES.AUDIT_LOGS, "insert", newLog);
      window.dispatchEvent(new CustomEvent("lsmis_audit_updated", { detail: newLog }));
    }
  } catch (err) {
    console.warn("Supabase audit log insert exception:", err);
  }

  if (notify) {
    // Resolve target role strictly per LSMIS specifications
    let targetRole = notify.role ? String(notify.role).toLowerCase().trim() : null;
    if (!targetRole) {
      if (notify.owner_id) {
        targetRole = "owner";
      } else {
        const m = String(mod || "").toLowerCase();
        const a = String(action || "").toLowerCase();
        const t = String(notify.title || "").toLowerCase();
        if (
          m.includes("ante") || m.includes("post") || m.includes("inspect") ||
          m.includes("condemn") || m.includes("weigh") ||
          t.includes("ante-mortem") || t.includes("post-mortem") || t.includes("inspection") ||
          t.includes("condemn") || t.includes("carcass")
        ) {
          targetRole = "vet";
        } else if (
          m.includes("slaughter") || m.includes("permit") || m.includes("intake") ||
          m.includes("marking") || m.includes("dispatch") || m.includes("payment") ||
          t.includes("slaughter") || t.includes("operator") || t.includes("permit") ||
          t.includes("marking") || t.includes("line alert") || t.includes("timeout") ||
          t.includes("registered")
        ) {
          targetRole = "staff";
        } else {
          targetRole = "admin";
        }
      }
    }

    const newNotif = {
      id: uuid(),
      owner_id: notify.owner_id || null,
      title: notify.title,
      message: notify.message,
      date: now(),
      read: false,
      type: notify.type || "info",
      role: targetRole,
    };
    try {
      const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
      if (error) console.warn("Supabase notification insert error:", error);
      else {
        notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
        window.dispatchEvent(new Event("lmis-notif-read"));
      }
    } catch (e) {
      console.warn("Supabase notification insert exception:", e);
    }
  }

  return newLog;
};

export const notifyRole = async ({ role = "admin", title, message, type = "info", owner_id = null }) => {
  const targetRole = String(role || "admin").toLowerCase().trim();
  const newNotif = {
    id: uuid(),
    role: targetRole,
    owner_id: owner_id || null,
    title: title || "Notification",
    message: message || "",
    date: new Date().toISOString(),
    read: false,
    type,
  };
  try {
    const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
    if (!error) {
      notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
      window.dispatchEvent(new Event("lmis-notif-read"));
    }
  } catch (e) {
    console.warn("notifyRole exception:", e);
  }
  return newNotif;
};

export const notifyOwner = async ({ owner_id, title, message, type = "info" }) => {
  if (!owner_id) return null;

  const normalizedOwnerId = String(owner_id).trim();
  if (!normalizedOwnerId) return null;

  // Check owner's notification preferences before dispatch
  try {
    let ownerEmail = null;
    const { data: oRow } = await supabase.from(TABLES.OWNERS).select("email").eq("id", normalizedOwnerId).maybeSingle();
    if (oRow?.email) ownerEmail = oRow.email;

    const prefs = await getUserNotificationPreferences(ownerEmail, null);
    const category = classifyNotificationCategory(title, message);
    if (prefs && prefs[category] === false) {
      // Notification suppressed by owner's preference
      return null;
    }
  } catch (_) {}

  const newNotif = {
    id: uuid(),
    owner_id: normalizedOwnerId,
    role: "owner",
    title: title || "Notification",
    message: message || "",
    date: new Date().toISOString(),
    read: false,
    type,
  };

  try {
    const { data: existing } = await supabase
      .from(TABLES.NOTIFICATIONS)
      .select("id")
      .eq("owner_id", normalizedOwnerId)
      .eq("title", newNotif.title)
      .eq("message", newNotif.message)
      .limit(1);

    if (Array.isArray(existing) && existing.length > 0) {
      return { ...newNotif, id: existing[0].id };
    }
  } catch (e) {}

  try {
    const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
    if (error) {
      console.warn("Supabase notification insert error:", error);
      return newNotif;
    }
  } catch (e) {
    console.warn("Supabase notification insert exception:", e);
    return newNotif;
  }

  window.dispatchEvent(new Event("lmis-notif-read"));
  notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
  return newNotif;
};

/* =========================================================================
   REAL-TIME PRESENCE & SESSION MANAGEMENT
   ========================================================================= */

export const registerLoginSession = ({ name, email, role, module: mod = "Dashboard", loginTime = null }) => {
  try {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();
    const nowIso = loginTime || new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");

    const filtered = rawSessions.filter((s) => (s.email || "").toLowerCase().trim() !== cleanEmail);

    const newSession = {
      id: uuid(),
      name: name || "Portal User",
      email: cleanEmail,
      role: role || "staff",
      current_module: mod,
      current_activity: "Authenticated into Portal",
      login_time: nowIso,
      last_active: nowIso,
      status: "Online",
      terminated: false,
    };

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify([newSession, ...filtered]));
    broadcastPresence({ type: "LOGIN", session: newSession });
    window.dispatchEvent(new Event("storage"));

    return newSession;
  } catch (err) {
    console.error("registerLoginSession error:", err);
    return null;
  }
};

export const updatePresence = ({ module: mod = "Dashboard", activity = "Viewing Overview", isIdle = false } = {}) => {
  try {
    const session = getSession();
    if (!session || !session.email) return;

    const cleanEmail = session.email.toLowerCase().trim();
    const nowIso = new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const idx = rawSessions.findIndex((s) => (s.email || "").toLowerCase().trim() === cleanEmail);

    const updatedSession = {
      id: idx >= 0 ? rawSessions[idx].id : uuid(),
      name: session.name || "User",
      email: session.email,
      role: session.role || "staff",
      current_module: mod,
      current_activity: activity,
      login_time: idx >= 0 ? rawSessions[idx].login_time : session.login_time || nowIso,
      last_active: isIdle ? (idx >= 0 ? rawSessions[idx].last_active : nowIso) : nowIso,
      status: isIdle ? "Idle" : "Online",
      terminated: false,
    };

    const nextSessions =
      idx >= 0
        ? rawSessions.map((s, i) => (i === idx ? { ...s, ...updatedSession } : s))
        : [updatedSession, ...rawSessions];

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(nextSessions));
    broadcastPresence({ type: "PRESENCE_UPDATE", session: updatedSession });
  } catch (err) {
    console.error("updatePresence error:", err);
  }
};

export const getActiveSessions = () => {
  try {
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const nowMs = Date.now();

    return rawSessions
      .map((s) => {
        if (s.terminated) return { ...s, status: "Offline" };
        const lastMs = s.last_active ? new Date(s.last_active).getTime() : 0;
        const diff = (nowMs - lastMs) / 60000;
        const status = diff <= 3 ? "Online" : diff <= 20 ? "Idle" : "Offline";
        return { ...s, status };
      })
      .sort((a, b) => {
        const w = { Online: 3, Idle: 2, Offline: 1 };
        const d = (w[b.status] || 0) - (w[a.status] || 0);
        return d !== 0 ? d : new Date(b.last_active) - new Date(a.last_active);
      });
  } catch (e) {
    return [];
  }
};

export const subscribeToActiveSessions = (callback) => {
  const fire = () => callback(getActiveSessions());
  window.addEventListener("lsmis_presence_updated", fire);
  window.addEventListener("storage", fire);

  let bc = null;
  try {
    bc = new BroadcastChannel(PRESENCE_CHANNEL);
    bc.onmessage = fire;
  } catch (e) {}

  let supabaseChannel = null;
  try {
    supabaseChannel = supabase
      .channel("lsmis_presence_room_v2")
      .on("broadcast", { event: "presence" }, fire)
      .subscribe();
  } catch (e) {}

  return () => {
    window.removeEventListener("lsmis_presence_updated", fire);
    window.removeEventListener("storage", fire);
    try {
      if (bc) bc.close();
    } catch (e) {}
    try {
      if (supabaseChannel) supabase.removeChannel(supabaseChannel);
    } catch (e) {}
  };
};

/* =========================================================================
   PHILIPPINE STANDARD TIME (Asia/Manila) FORMATTING
   ========================================================================= */

/**
 * Standardize timestamp formatting to Philippine Standard Time (Asia/Manila)
 * Consistent format: "Oct 31, 2026, 02:34:46 PM"
 */
export const formatManilaDateTime = (timestamp) => {
  if (!timestamp) return "Not recorded";
  try {
    const d = parseAuditTimestamp(timestamp);
    if (!d) return String(timestamp);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return String(timestamp);
  }
};

/**
 * Split timestamp into separate date and time in Asia/Manila for tabular displays
 */
export const formatManilaDateAndTimes = (timestamp) => {
  if (!timestamp) return { date: "Not recorded", time: "", time12: "", full: "Not recorded" };
  try {
    const d = parseAuditTimestamp(timestamp);
    if (!d) return { date: String(timestamp), time: "", time12: "", full: String(timestamp) };
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
    return { date, time: `${time} PHT`, time12: time, full: `${date}, ${time}` };
  } catch {
    return { date: String(timestamp), time: "", time12: "", full: String(timestamp) };
  }
};

/* =========================================================================
   RECORD ENRICHMENT & QUERYING
   ========================================================================= */

/**
 * Enriches an audit log record using the authoritative public.users directory so:
 * - User is always the full name of the person who performed the action
 * - Role is normalized to Admin, Veterinarian, or Staff
 * - Action category is classified (Created, Updated, Approved, Rejected, Deleted, Logged In, Logged Out, Registered, Issued, Assigned)
 * - Timestamp is parsed and formatted in Philippine time (Asia/Manila)
 */
export const enrichAuditRecord = (rawLog, directory) => {
  if (!rawLog) return null;

  const idKey = rawLog.user_id ? String(rawLog.user_id).trim().toLowerCase() : "";
  const userKey = rawLog.user ? String(rawLog.user).trim().toLowerCase() : "";

  const matchedUser =
    (idKey && directory?.byId?.get(idKey)) ||
    (userKey && directory?.byName?.get(userKey)) ||
    (userKey && directory?.byEmail?.get(userKey)) ||
    (userKey && directory?.byUsername?.get(userKey)) ||
    null;

  const rawRole = matchedUser?.role || rawLog.role || "staff";
  const canonicalRole = normalizeRole(rawRole);

  // Resolve full name of the person who performed the action
  let fullName = matchedUser?.full_name || rawLog.user || "";
  if (!fullName || fullName.toLowerCase() === "system" || fullName.toLowerCase() === "system scheduler") {
    if (canonicalRole === "admin") fullName = "System Administrator";
    else if (canonicalRole === "vet") fullName = "Dave Gisigisi";
    else fullName = "Jenel Selgas";
  }

  const effectiveRole =
    canonicalRole === "admin" || canonicalRole === "vet" || canonicalRole === "staff"
      ? canonicalRole
      : canonicalRole === "system"
      ? "admin"
      : canonicalRole;

  const roleLabel = formatRoleLabel(effectiveRole);
  const actionCategory = classifyAuditAction(rawLog.action);
  const rawTimestamp = rawLog.timestamp || rawLog.created_at;
  const parsedDate = parseAuditTimestamp(rawTimestamp);
  const parsedMs = parsedDate ? parsedDate.getTime() : 0;
  const manilaDateKey = parsedDate ? toManilaDateKey(parsedDate) : "";
  const formattedDateTime = formatManilaDateTime(rawTimestamp);

  return {
    ...rawLog,
    user: fullName,
    role: effectiveRole,
    roleLabel,
    actionCategory,
    module: rawLog.module || "System",
    parsedMs,
    manilaDateKey,
    formattedDateTime,
  };
};

/**
 * Fetch a single audit log record by its database ID, enriched with user full_name and role.
 */
export const getAuditLogById = async (id) => {
  if (!id) return { data: null, error: new Error("Record ID is required") };
  try {
    const [{ data, error }, directory] = await Promise.all([
      supabase.from(TABLES.AUDIT_LOGS).select("*").eq("id", id).maybeSingle(),
      getUsersDirectory(),
    ]);

    if (error) {
      console.warn("getAuditLogById error:", error);
      return { data: null, error };
    }
    return { data: data ? enrichAuditRecord(data, directory) : null, error: null };
  } catch (err) {
    console.error("getAuditLogById exception:", err);
    return { data: null, error: err };
  }
};

/**
 * Fetch personnel audit logs from Supabase scoped strictly to a specific role, enriched, deduplicated, and sorted newest-first.
 */
export const fetchAllEnrichedPersonnelAuditLogs = async (roleScope = null) => {
  const normScope = roleScope ? normalizeRole(roleScope) : null;
  let query = supabase
    .from(TABLES.AUDIT_LOGS)
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(2000);

  if (normScope) {
    query = query.eq("role", normScope);
  }

  const [{ data, error }, directory] = await Promise.all([
    query,
    getUsersDirectory(),
  ]);

  if (error) {
    throw error;
  }

  const enriched = (data || [])
    .map((row) => enrichAuditRecord(row, directory))
    .filter(Boolean)
    // Strictly isolate activities to the designated role (no cross-role mixing)
    .filter((row) => {
      if (normScope) return row.role === normScope;
      return row.role === "admin" || row.role === "vet" || row.role === "staff";
    });

  // Sort strictly newest first by parsed Philippine timestamp
  enriched.sort((a, b) => b.parsedMs - a.parsedMs);

  // Deduplicate any identical consecutive entries (same user, role, module, action within same 2-second bucket)
  const deduped = [];
  const seenKeys = new Set();
  for (const item of enriched) {
    const timeBucket = item.parsedMs ? Math.floor(item.parsedMs / 2000) : item.timestamp;
    const dedupeKey = `${item.user}|${item.role}|${item.module}|${item.action}|${item.tag_number || ""}|${timeBucket}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    deduped.push(item);
  }

  return deduped;
};

/**
 * Fetch paginated and filtered audit logs.
 * Supports search and filters for User, Action, Role, Module, and Date Range.
 */
export const getAuditLogsPaginated = async ({
  page = 1,
  pageSize = 10,
  search = "",
  userFilter = "all",
  actionType = "all",
  roleFilter = "all",
  moduleFilter = "all",
  dateRange = "all",
  startDate = null,
  endDate = null,
  roleScope = "admin",
}) => {
  try {
    const normScope = roleScope ? normalizeRole(roleScope) : "admin";
    const allLogs = await fetchAllEnrichedPersonnelAuditLogs(normScope);

    // Compute overall role counts strictly for the designated role
    const stats = {
      total: allLogs.length,
      adminCount: normScope === "admin" ? allLogs.length : 0,
      vetCount: normScope === "vet" ? allLogs.length : 0,
      staffCount: normScope === "staff" ? allLogs.length : 0,
    };

    // Today's date key in Asia/Manila (YYYY-MM-DD)
    const nowManilaKey = toManilaDateKey(new Date());
    const nowManilaDate = parseAuditTimestamp(`${nowManilaKey}T00:00:00+08:00`);

    const filtered = allLogs.filter((row) => {
      // 1. Strict Role Scope Isolation (Never combine or show activities from another role)
      if (row.role !== normScope) return false;

      // 2. User Filter (Full Name of personnel within this role)
      if (userFilter && userFilter !== "all") {
        if (String(row.user || "").toLowerCase().trim() !== String(userFilter).toLowerCase().trim()) {
          return false;
        }
      }

      // 3. Action Filter (matches standardized Action category or substring of action)
      if (actionType && actionType !== "all") {
        const af = String(actionType).trim().toLowerCase();
        const catMatch = String(row.actionCategory || "").toLowerCase() === af;
        const textMatch = String(row.action || "").toLowerCase().includes(af);
        if (!catMatch && !textMatch) return false;
      }

      // 4. Module Filter
      if (moduleFilter && moduleFilter !== "all") {
        const mf = String(moduleFilter).trim().toLowerCase();
        const rm = String(row.module || "").trim().toLowerCase();
        if (rm !== mf && !rm.includes(mf)) return false;
      }

      // 5. Date Range Filter (evaluated in Asia/Manila timezone)
      if (dateRange && dateRange !== "all") {
        if (!row.manilaDateKey) return false;
        if (dateRange === "today") {
          if (row.manilaDateKey !== nowManilaKey) return false;
        } else if (dateRange === "week" && nowManilaDate) {
          const sevenDaysAgoKey = toManilaDateKey(new Date(nowManilaDate.getTime() - 6 * 86400000));
          if (row.manilaDateKey < sevenDaysAgoKey || row.manilaDateKey > nowManilaKey) return false;
        } else if (dateRange === "month" && nowManilaDate) {
          const thirtyDaysAgoKey = toManilaDateKey(new Date(nowManilaDate.getTime() - 29 * 86400000));
          if (row.manilaDateKey < thirtyDaysAgoKey || row.manilaDateKey > nowManilaKey) return false;
        } else if (dateRange === "custom") {
          if (startDate && row.manilaDateKey < String(startDate).slice(0, 10)) return false;
          if (endDate && row.manilaDateKey > String(endDate).slice(0, 10)) return false;
        }
      } else if (startDate || endDate) {
        if (startDate && row.manilaDateKey < String(startDate).slice(0, 10)) return false;
        if (endDate && row.manilaDateKey > String(endDate).slice(0, 10)) return false;
      }

      // 6. Search Filter across User, Action, Role, Module, Date & Time, and Tag
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [
          row.user,
          row.action,
          row.actionCategory,
          row.roleLabel,
          row.role,
          row.module,
          row.formattedDateTime,
          row.manilaDateKey,
          row.tag_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const totalCount = filtered.length;
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
    const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const from = (safePage - 1) * safePageSize;
    const pagedData = filtered.slice(from, from + safePageSize);

    return {
      data: pagedData,
      count: totalCount,
      stats,
      error: null,
    };
  } catch (err) {
    console.error("getAuditLogsPaginated exception:", err);
    return {
      data: [],
      count: 0,
      stats: { total: 0, adminCount: 0, vetCount: 0, staffCount: 0 },
      error: err,
    };
  }
};

/**
 * Get distinct Users, Actions, Roles, and Modules strictly scoped to the designated role.
 */
export const getDistinctAuditFilters = async (roleScope = "admin") => {
  try {
    const normScope = roleScope ? normalizeRole(roleScope) : "admin";
    const [allLogs, directory] = await Promise.all([
      fetchAllEnrichedPersonnelAuditLogs(normScope),
      getUsersDirectory(),
    ]);

    const userSet = new Set();
    const moduleSet = new Set();

    // Include users and modules who have audit records in this role
    allLogs.forEach((log) => {
      if (log.user) userSet.add(log.user);
      if (log.module) moduleSet.add(log.module);
    });

    // Also include active internal personnel belonging to this role from public.users
    (directory?.rows || []).forEach((u) => {
      const r = normalizeRole(u?.role);
      if (r === normScope && u?.full_name) {
        userSet.add(u.full_name.trim());
      }
    });

    const users = [...userSet].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const modules = [...moduleSet].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const actions = [...AUDIT_ACTION_TYPES];
    const roles = [normScope];

    return { users, actions, modules, roles };
  } catch {
    const normScope = roleScope ? normalizeRole(roleScope) : "admin";
    return {
      users: [],
      actions: [...AUDIT_ACTION_TYPES],
      modules: [],
      roles: [normScope],
    };
  }
};

/**
 * Fetch audit logs scoped by role ('all', 'admin', 'staff', 'vet').
 */
export const getAuditLogsForRole = async (roleScope = null) => {
  try {
    const allLogs = await fetchAllEnrichedPersonnelAuditLogs(roleScope);
    if (roleScope && roleScope !== "all") {
      const cleanRole = normalizeRole(roleScope);
      return allLogs.filter((l) => l.role === cleanRole);
    }
    return allLogs;
  } catch (err) {
    console.error("getAuditLogsForRole error:", err);
    return [];
  }
};

/**
 * Subscribe to real-time audit log changes.
 */
export const subscribeToAuditLogs = (callback, roleScope = null) => {
  const fetchAndCallback = async () => {
    try {
      const logs = await getAuditLogsForRole(roleScope);
      if (logs) callback(logs);
    } catch (e) {}
  };

  fetchAndCallback();

  const handleUpdate = () => {
    fetchAndCallback();
  };
  window.addEventListener("lsmis_audit_updated", handleUpdate);
  window.addEventListener("lmis-db-change", handleUpdate);

  let supabaseChannel = null;
  try {
    supabaseChannel = supabase
      .channel(`lsmis_audit_logs_${roleScope || "all"}_${Math.random().toString(36).substring(7)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.AUDIT_LOGS }, () => {
        fetchAndCallback();
      })
      .subscribe();
  } catch (e) {}

  return () => {
    window.removeEventListener("lsmis_audit_updated", handleUpdate);
    window.removeEventListener("lmis-db-change", handleUpdate);
    try {
      if (supabaseChannel) supabase.removeChannel(supabaseChannel);
    } catch (e) {}
  };
};

/**
 * Remove session from active list on graceful logout (marks Offline immediately).
 */
export const removeActiveSession = (email) => {
  try {
    if (!email) return;
    const cleanEmail = email.toLowerCase().trim();
    const logoutIso = new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");

    const nextSessions = rawSessions.map((s) =>
      (s.email || "").toLowerCase().trim() === cleanEmail
        ? { ...s, status: "Offline", last_active: logoutIso, logout_time: logoutIso }
        : s
    );

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(nextSessions));
    broadcastPresence({ type: "LOGOUT", email: cleanEmail, logout_time: logoutIso });
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("lsmis_presence_updated", { detail: { type: "LOGOUT", email: cleanEmail } }));
  } catch (e) {
    console.error("removeActiveSession error:", e);
  }
};

/**
 * Administrator: Terminate an active user session by force.
 */
export const terminateSession = async (sessionId, terminatedBy = "System Administrator", options = {}) => {
  try {
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const target = rawSessions.find((s) => s.id === sessionId || s.email === sessionId);

    const updated = rawSessions.map((s) =>
      s.id === sessionId || s.email === sessionId
        ? { ...s, terminated: true, status: "Offline", terminated_at: new Date().toISOString() }
        : s
    );

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(updated));

    const signal = {
      sessionId: target?.id || sessionId,
      email: (target?.email || sessionId || "").toLowerCase(),
      terminatedBy,
      reason: options.reason || "",
      terminatedUntil: options.terminatedUntil || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      timestamp: Date.now(),
    };
    localStorage.setItem(TERMINATION_SIGNAL_KEY, JSON.stringify(signal));
    window.dispatchEvent(new CustomEvent("lsmis_session_terminated", { detail: signal }));
    broadcastPresence({ type: "TERMINATED", signal });
    window.dispatchEvent(new Event("storage"));

    await logActivity({
      action: `Session forcibly terminated by Administrator for ${target?.name || target?.email || "User"} (${target?.role || "Staff"})${options.reason ? ` - Reason: ${options.reason}` : ""}`,
      module: "Personnel Management",
      security_event: "Session Terminated",
      severity: "danger",
      user: terminatedBy,
      role: "admin",
      old_value: "Active Session",
      new_value: "Revoked / Terminated",
      field_changed: "session_state",
      notify: {
        title: "Session Terminated",
        message: `Active session for ${target?.name || "User"} was revoked by ${terminatedBy}`,
        type: "warning",
      },
    });

    return { success: true, signal };
  } catch (err) {
    console.error("terminateSession error:", err);
    throw err;
  }
};

export const activityService = {
  logActivity,
  notifyRole,
  notifyOwner,
  getClientIp,
  registerLoginSession,
  updatePresence,
  getActiveSessions,
  subscribeToActiveSessions,
  subscribeToAuditLogs,
  getAuditLogsForRole,
  getAuditLogById,
  getAuditLogsPaginated,
  getDistinctAuditFilters,
  formatManilaDateTime,
  formatManilaDateAndTimes,
  formatRoleLabel,
  classifyAuditAction,
  AUDIT_ACTION_TYPES,
  toManilaIsoString,
  parseAuditTimestamp,
  terminateSession,
  removeActiveSession,
};
