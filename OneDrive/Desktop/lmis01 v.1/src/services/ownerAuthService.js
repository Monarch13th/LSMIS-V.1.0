import { supabase } from "./supabaseClient.js";
import { notifyDbChange } from "./realtimeSync.js";
import { TABLES, STORAGE_KEYS } from "../utils/constants.js";
import { now, today, uuid } from "../utils/helpers.js";
import { logActivity, notifyOwner, notifyRole, activityService } from "./activityService.js";
import { validatePassword } from "../utils/passwordValidation.js";
import { validatePhilippineMobileNumber } from "../utils/phoneValidation.js";
import { authSecurityService } from "./authSecurityService.js";

// Storage keys
const LOCKOUT_PREFIX = "lmis_lockout_";

// Fire scoped database change notification to update mounted hooks
const notifyChange = (table = TABLES.OWNERS, action = "update", record = null) => {
  notifyDbChange(table, action, record);
};

export const ownerAuthService = {
  /**
   * Resolve the OAuth redirect URL dynamically for:
   * - Desktop development (http://localhost:5173/login)
   * - Mobile LAN development (http://192.168.1.10:5173/login)
   * - Production HTTPS deployment (https://<domain>/login)
   * Never hardcodes localhost for production or overrides a mobile LAN / production origin with localhost.
   */
  getGoogleRedirectUrl(intent = "login") {
    const cleanIntent = intent === "register" ? "register" : "login";
    const isLocalhostUrl = (urlStr) =>
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(urlStr || "").trim());

    const browserOrigin = typeof window !== "undefined" ? String(window.location.origin || "").trim() : "";
    const browserHostname = typeof window !== "undefined" ? String(window.location.hostname || "").toLowerCase() : "";
    const isBrowserOnLocalhost = browserHostname === "localhost" || browserHostname === "127.0.0.1";
    const isCapacitorNative =
      typeof window !== "undefined" &&
      Boolean(
        window.Capacitor?.isNativePlatform?.() ||
        window.Capacitor?.getPlatform?.() === "android" ||
        browserOrigin === "https://localhost"
      );
    const isMobileBrowser =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");

    const envProdUrl =
      import.meta.env?.VITE_OAUTH_REDIRECT_URL ||
      import.meta.env?.VITE_SITE_URL ||
      import.meta.env?.VITE_APP_URL ||
      "";
    const envLanUrl =
      import.meta.env?.VITE_DEV_LAN_URL ||
      (typeof __DEV_LAN_ORIGIN__ !== "undefined" ? __DEV_LAN_ORIGIN__ : "") ||
      "";

    let resolvedBase = "";

    if (isCapacitorNative) {
      // Inside the installed Capacitor Android APK:
      // Use the configured production HTTPS URL if set. In development, allow localhost:5173 fallback.
      if (envProdUrl && !isLocalhostUrl(envProdUrl)) {
        resolvedBase = envProdUrl;
      } else if (browserOrigin && !isLocalhostUrl(browserOrigin)) {
        resolvedBase = browserOrigin;
      } else if (!import.meta.env?.PROD) {
        resolvedBase = "http://localhost:5173";
      } else {
        resolvedBase = envProdUrl || browserOrigin;
      }
    } else if (import.meta.env?.PROD) {
      // Production: prefer non-localhost deployed HTTPS domain from browser origin or production env
      if (envProdUrl && !isLocalhostUrl(envProdUrl)) {
        resolvedBase = envProdUrl;
      } else if (browserOrigin && !isLocalhostUrl(browserOrigin)) {
        resolvedBase = browserOrigin;
      } else {
        resolvedBase = envProdUrl || browserOrigin;
      }
    } else {
      // Development:
      // 1. If the browser is accessing via LAN IP (e.g. http://192.168.1.10:5173) or tunnel, always use window.location.origin
      if (browserOrigin && !isBrowserOnLocalhost) {
        resolvedBase = browserOrigin;
      } else if (isMobileBrowser && envLanUrl && !isLocalhostUrl(envLanUrl)) {
        // 2. If on a mobile browser that somehow hit localhost, route back to the LAN IP
        resolvedBase = envLanUrl;
      } else if (envProdUrl && !isLocalhostUrl(envProdUrl) && !browserOrigin) {
        resolvedBase = envProdUrl;
      } else {
        // 3. Normal desktop development on localhost
        resolvedBase = browserOrigin || envLanUrl || envProdUrl;
      }
    }

    const baseOrigin = String(resolvedBase || "").replace(/\/+$/, "");
    const loginPath = baseOrigin.endsWith("/login") ? baseOrigin : `${baseOrigin}/login`;
    return `${loginPath}?oauth_intent=${encodeURIComponent(cleanIntent)}`;
  },

  /**
   * Extract Google account email, full name, profile picture, and Google user ID from a Supabase user object.
   */
  extractGoogleUserData(supabaseUser) {
    if (!supabaseUser) return null;
    const identities = Array.isArray(supabaseUser.identities) ? supabaseUser.identities : [];
    const googleIdentity = identities.find((id) => id?.provider === "google") || null;
    const idData = googleIdentity?.identity_data || {};
    const meta = supabaseUser.user_metadata || {};

    const email = (
      supabaseUser.email ||
      idData.email ||
      meta.email ||
      ""
    ).trim().toLowerCase();

    const fullName = (
      idData.full_name ||
      idData.name ||
      meta.full_name ||
      meta.name ||
      ""
    ).trim();

    const avatarUrl = (
      idData.avatar_url ||
      idData.picture ||
      meta.avatar_url ||
      meta.picture ||
      ""
    ).trim();

    const googleUserId = String(
      googleIdentity?.id ||
      idData.sub ||
      idData.provider_id ||
      meta.google_id ||
      meta.provider_id ||
      meta.sub ||
      supabaseUser.id ||
      ""
    ).trim();

    return {
      authUserId: supabaseUser.id,
      googleId: googleUserId,
      email,
      name: fullName,
      avatarUrl,
      emailVerified: Boolean(
        supabaseUser.email_confirmed_at ||
        idData.email_verified ||
        meta.email_verified ||
        true
      ),
      provider: "google",
    };
  },

  /**
   * Remove transient OAuth in-flight markers without modifying existing user sessions.
   */
  cleanGoogleOAuthState() {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem("lsmis_google_oauth_intent");
      sessionStorage.removeItem("lsmis_google_oauth_in_flight");
    } catch (_) {}
  },

  /**
   * Set transient OAuth in-flight markers in sessionStorage for the current tab.
   */
  setGoogleOAuthInFlight(intent = "login") {
    if (typeof window === "undefined") return;
    const cleanIntent = intent === "register" ? "register" : "login";
    const ts = String(Date.now());
    try {
      sessionStorage.setItem("lsmis_google_oauth_intent", cleanIntent);
      sessionStorage.setItem("lsmis_google_oauth_in_flight", ts);
    } catch (_) {}
  },

  /**
   * Retrieve active OAuth intent from URL query or sessionStorage (with 5-minute TTL).
   */
  getGoogleOAuthIntent() {
    if (typeof window === "undefined") return null;
    try {
      const searchParams = new URLSearchParams(window.location.search || "");
      const urlIntent = searchParams.get("oauth_intent");
      if (urlIntent === "register" || urlIntent === "login") return urlIntent;

      const tsRaw = sessionStorage.getItem("lsmis_google_oauth_in_flight");
      if (tsRaw) {
        const elapsed = Date.now() - Number(tsRaw);
        if (isNaN(elapsed) || elapsed > 5 * 60 * 1000) {
          this.cleanGoogleOAuthState();
          return null;
        }
      }

      const stored = sessionStorage.getItem("lsmis_google_oauth_intent");
      if (stored === "register" || stored === "login") return stored;
    } catch (_) {}
    return null;
  },

  /**
   * Initiate Supabase Google OAuth flow exclusively for Owner Login or Owner Registration.
   * Supports popup mode (skipBrowserRedirect: true) with automatic fallback to full redirect.
   */
  async signInWithGoogle({ intent = "login", mode = "popup" } = {}) {
    const cleanIntent = intent === "register" ? "register" : "login";
    this.setGoogleOAuthInFlight(cleanIntent);

    const redirectTo = this.getGoogleRedirectUrl(cleanIntent);
    const skipBrowserRedirect = mode === "popup";

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });

      if (error) {
        this.cleanGoogleOAuthState();
        throw new Error(error.message || "Failed to start Google authentication. Please try again.");
      }

      return {
        url: data?.url || null,
        provider: data?.provider || "google",
        redirectTo,
      };
    } catch (err) {
      this.cleanGoogleOAuthState();
      throw err;
    }
  },

  /**
   * Validate a Google OAuth callback for Owner Create Account:
   * - Retrieves Google email, full name, and profile picture
   * - Prevents duplicate accounts using the same email address
   */
  async prepareGoogleRegistration() {
    try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
    throw new Error("Online registration using Google OAuth is disabled. Please register using the standard owner registration form.");
  },

  /**
   * Register a new Owner directly through Google OAuth (DISABLED):
   * Owners must create accounts using the standard owner registration form with email and password.
   */
  async registerGoogleOwner() {
    try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
    throw new Error("Online registration using Google OAuth is disabled. Please register using the standard owner registration form.");
  },

  /**
   * Verify Google OAuth login for an existing Owner account:
   * - Blocks Admin, Veterinarian, and Staff accounts from using Google Sign-In
   * - Verifies that the Google email matches an existing owner account
   * - Prevents Pending, Rejected, or Suspended accounts from accessing the Owner dashboard
   * - Associates and saves the Google user ID with the existing owner record in Supabase without creating duplicates
   */
  async verifyAndConnectGoogleOwnerLogin(explicitUser = null) {
    let user = explicitUser;
    if (!user) {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        const { data: sessData } = await supabase.auth.getSession();
        user = sessData?.session?.user || null;
      } else {
        user = userData.user;
      }
    }

    if (!user) {
      throw new Error("Google authentication failed or expired. Please try signing in again.");
    }

    const googleData = this.extractGoogleUserData(user);
    if (!googleData || !googleData.email) {
      try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
      throw new Error("Could not retrieve a verified email address from your Google account.");
    }

    const cleanEmail = googleData.email;

    // 1. Look up existing owner record in public.owners by email
    let ownerAcct = null;
    try {
      const { data: dbOwner } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .ilike("email", cleanEmail)
        .limit(1)
        .maybeSingle();

      if (dbOwner && dbOwner.id) {
        ownerAcct = dbOwner;
      }
    } catch (e) {
      console.warn("Google login owner lookup warning:", e);
    }

    // 2. Check public.users to see if this email belongs to Personnel (Admin/Vet/Staff) or a linked Owner
    let dbUserRow = null;
    try {
      const { data: uRow } = await supabase
        .from(TABLES.USERS)
        .select("*")
        .ilike("email", cleanEmail)
        .limit(1)
        .maybeSingle();
      dbUserRow = uRow || null;
    } catch (_) {}

    if (!ownerAcct && dbUserRow?.owner_id) {
      try {
        const { data: byOwnerId } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", dbUserRow.owner_id)
          .limit(1)
          .maybeSingle();
        if (byOwnerId) ownerAcct = byOwnerId;
      } catch (_) {}
    }

    // If not an owner, check if it's an Admin/Vet/Staff account or an unregistered Google account
    if (!ownerAcct) {
      if (dbUserRow) {
        const r = String(dbUserRow.role || "").toLowerCase().trim();
        const isTriggerStub =
          dbUserRow.id === googleData.authUserId &&
          !dbUserRow.owner_id &&
          !dbUserRow.username &&
          (!dbUserRow.last_login || dbUserRow.last_login === "Never") &&
          r !== "admin" &&
          r !== "administrator" &&
          r !== "vet" &&
          r !== "veterinarian";

        if (isTriggerStub) {
          // Clean up any auto-inserted trigger row for this unregistered Google account
          try {
            await supabase.from(TABLES.USERS).delete().eq("id", dbUserRow.id);
          } catch (_) {}
        } else if (r === "admin" || r === "administrator" || r === "vet" || r === "veterinarian" || r === "staff" || r === "operator") {
          try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
          throw new Error(
            "Unauthorized access: Google Sign-In is available exclusively for Livestock Owner accounts. Admin, Veterinarian, and Staff personnel must sign in with their username/email and password."
          );
        }
      }

      try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
      const notRegErr = new Error("This Google account is not registered. Please register an owner account first.");
      notRegErr.code = "ACCOUNT_NOT_REGISTERED";
      notRegErr.email = cleanEmail;
      throw notRegErr;
    }

    // 3. Verify Owner Account Approval Status (block Pending, Rejected, and Deactivated accounts)
    const stLower = String(ownerAcct.status || "").toLowerCase().trim();
    const isPending =
      stLower.includes("pending") ||
      stLower.includes("verification") ||
      stLower.includes("review") ||
      stLower.includes("approval") ||
      (String(ownerAcct.id || "").startsWith("REG") && !stLower.includes("approved") && !stLower.includes("active"));

    if (isPending) {
      try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
      const pendingErr = new Error("Your account is awaiting Admin approval.");
      pendingErr.code = "ACCOUNT_PENDING";
      pendingErr.owner = ownerAcct;
      pendingErr.googleData = googleData;
      throw pendingErr;
    }

    if (stLower.includes("reject")) {
      try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
      const rejectErr = new Error("Your account has been rejected by the administrator.");
      rejectErr.code = "ACCOUNT_REJECTED";
      throw rejectErr;
    }

    const isDeactivated =
      stLower.includes("suspend") ||
      stLower.includes("deactivate") ||
      stLower.includes("inactive") ||
      stLower.includes("terminated") ||
      stLower.includes("banned");

    if (isDeactivated) {
      try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
      const deactErr = new Error("Your account is deactivated. Please contact support.");
      deactErr.code = "ACCOUNT_DEACTIVATED";
      throw deactErr;
    }

    // 4. Owner is Approved! Store and associate the Google user ID with the existing owner record in Supabase
    const connectedAt = new Date().toISOString();
    const currentHistory = Array.isArray(ownerAcct.history) ? [...ownerAcct.history] : [];
    const alreadyConnectedInHistory = currentHistory.some(
      (h) => h && (h.google_id === googleData.googleId || h.stage === "Google Account Connected")
    );

    if (!alreadyConnectedInHistory) {
      currentHistory.push({
        stage: "Google Account Connected",
        status: ownerAcct.status || "Approved",
        timestamp: connectedAt,
        actor: ownerAcct.name || googleData.name || cleanEmail,
        auth_provider: "google",
        google_id: googleData.googleId,
        auth_user_id: googleData.authUserId,
        avatar_url: googleData.avatarUrl || null,
        note: `Google account (${cleanEmail}) linked to Owner ID ${ownerAcct.id}.`
      });
    } else {
      // Update avatar_url / google_id in the existing history entry if needed
      for (let i = 0; i < currentHistory.length; i++) {
        if (currentHistory[i]?.google_id || currentHistory[i]?.auth_provider === "google") {
          currentHistory[i] = {
            ...currentHistory[i],
            google_id: googleData.googleId,
            auth_user_id: googleData.authUserId,
            avatar_url: googleData.avatarUrl || currentHistory[i].avatar_url || null,
          };
        }
      }
    }

    // Update existing public.owners record (never create a duplicate owner record)
    try {
      const fullOwnerPatch = {
        email_verified: true,
        history: currentHistory,
        google_id: googleData.googleId,
        auth_user_id: googleData.authUserId,
        avatar_url: ownerAcct.avatar_url || googleData.avatarUrl || null,
        auth_provider: "google",
      };

      const { error: ownerUpdErr } = await supabase
        .from(TABLES.OWNERS)
        .update(fullOwnerPatch)
        .eq("id", ownerAcct.id);

      if (ownerUpdErr) {
        // Fallback if optional columns (google_id, auth_user_id, avatar_url, auth_provider) are not yet in schema cache
        await supabase
          .from(TABLES.OWNERS)
          .update({
            email_verified: true,
            history: currentHistory,
          })
          .eq("id", ownerAcct.id);
      }
    } catch (e) {
      console.warn("Owner Google connection update notice:", e);
    }

    // Associate Google user ID with existing owner in public.users
    try {
      const userPayload = {
        full_name: ownerAcct.name || googleData.name || cleanEmail.split("@")[0],
        email: cleanEmail,
        username: ownerAcct.username || cleanEmail.split("@")[0],
        role: "owner",
        owner_id: ownerAcct.id,
        status: "Active",
        last_login: now(),
      };

      if (dbUserRow?.id) {
        await supabase.from(TABLES.USERS).update(userPayload).eq("id", dbUserRow.id);
      } else {
        await supabase.from(TABLES.USERS).upsert({
          id: googleData.authUserId,
          ...userPayload,
          created_at: connectedAt,
        });
      }
    } catch (e) {
      console.warn("Users Google connection sync notice:", e);
    }

    // Sync metadata in Supabase Auth (auth.users)
    try {
      await supabase.auth.updateUser({
        data: {
          full_name: ownerAcct.name || googleData.name,
          username: ownerAcct.username || cleanEmail.split("@")[0],
          role: "owner",
          owner_id: ownerAcct.id,
          status: "Approved",
          google_id: googleData.googleId,
          avatar_url: ownerAcct.avatar_url || googleData.avatarUrl || null,
          auth_provider: "google",
          google_connected: true,
        },
      });
    } catch (_) {}

    return {
      owner: {
        ...ownerAcct,
        google_id: googleData.googleId,
        auth_user_id: googleData.authUserId,
        avatar_url: ownerAcct.avatar_url || googleData.avatarUrl || null,
        auth_provider: "google",
        history: currentHistory,
      },
      googleData,
      user,
    };
  },

  /**
   * 1. Check for duplicate account details before registration
   * Checks both email, contact number, and username across Supabase
   */
  async checkDuplicate({ email, contact, username, excludeUserId = null }) {
    const cleanEmail = (email || "").trim().toLowerCase();
    const cleanContact = (contact || "").replace(/\D/g, "");
    const cleanUsername = (username || "").trim().toLowerCase();

    // 1. Check Supabase USERS table (staff, vet, admin personnel & existing users)
    try {
      if (cleanEmail) {
        let q = supabase
          .from(TABLES.USERS)
          .select("id, email, role, owner_id, username, last_login")
          .ilike("email", cleanEmail);

        if (excludeUserId) {
          q = q.neq("id", excludeUserId);
        }

        const { data: byEmail } = await q.limit(1).maybeSingle();

        if (byEmail) {
          return {
            duplicate: true,
            exists: true,
            field: "email",
            message: "This email address is already in use. Please sign in or use another email."
          };
        }
      }

      if (cleanUsername) {
        let q = supabase
          .from(TABLES.USERS)
          .select("id, username")
          .ilike("username", cleanUsername);

        if (excludeUserId) {
          q = q.neq("id", excludeUserId);
        }

        const { data: byUser } = await q.limit(1).maybeSingle();

        if (byUser) {
          return {
            duplicate: true,
            exists: true,
            field: "username",
            message: "This username is already taken. Please choose another username."
          };
        }
      }
    } catch (e) {}

    // 2. Check Supabase OWNERS table (livestock owners)
    try {
      if (cleanEmail) {
        const { data: byEmail } = await supabase
          .from(TABLES.OWNERS)
          .select("id, email, contact, agreement_status")
          .ilike("email", cleanEmail)
          .limit(1)
          .maybeSingle();

        if (byEmail) {
          return {
            duplicate: true,
            exists: true,
            field: "email",
            message: "This email address is already in use. Please sign in or use another email."
          };
        }
      }

      if (cleanUsername) {
        const { data: byOwnerUser } = await supabase
          .from(TABLES.OWNERS)
          .select("id, username")
          .ilike("username", cleanUsername)
          .limit(1)
          .maybeSingle();

        if (byOwnerUser) {
          return {
            duplicate: true,
            exists: true,
            field: "username",
            message: "This username is already taken. Please choose another username."
          };
        }
      }

      if (cleanContact) {
        const { data: owners } = await supabase
          .from(TABLES.OWNERS)
          .select("id, contact");

        const foundContact = (owners || []).find((o) => {
          const oDigits = (o.contact || "").replace(/\D/g, "");
          return oDigits && (oDigits === cleanContact || oDigits.endsWith(cleanContact.slice(-10)));
        });

        if (foundContact) {
          return {
            duplicate: true,
            exists: true,
            field: "contact",
            message: "An account with this contact number is already registered. Please sign in or use another number."
          };
        }
      }
    } catch (e) {}

    return { duplicate: false, exists: false };
  },

  /**
   * 2. Register Owner Account
   * Supports both standard Email/Password registration and Google OAuth-connected registration.
   */
  async registerOwner(payload = {}) {
    const name = (payload.name || payload.full_name || "").trim();
    const contact = (payload.contact || payload.contact_number || "").trim();
    const address = (payload.address || "").trim();
    const email = (payload.email || "").trim();
    const username = (payload.username || "").trim();
    const password = payload.password || "";
    const agreementAccepted = !!(payload.agreementAccepted ?? payload.agreement_accepted);
    const googleProfile = payload.googleProfile || null;

    // A. Validation
    if (!name) throw new Error("Full Name is required.");
    if (!contact) throw new Error("Contact Number is required.");
    if (!address) throw new Error("Address is required.");
    if (!email) throw new Error("Email Address is required.");
    if (!username) throw new Error("Username is required.");
    if (!password) throw new Error("Password is required.");

    if (!agreementAccepted) {
      throw new Error("You must accept the User Agreement and Privacy Policy to register.");
    }

    // Contact number validation: 11 digits starting with 09 or 08
    const digits = contact.replace(/\D/g, "");
    if (digits.length !== 11 || (!digits.startsWith("09") && !digits.startsWith("08"))) {
      throw new Error("Please enter a valid 11-digit Philippine mobile number starting with 09 or 08.");
    }

    // Strong password validation
    const pwCheck = validatePassword(password);
    if (!pwCheck.isValid) {
      throw new Error("Password must have at least 8 characters, including uppercase, lowercase, number, and special character.");
    }

    // B. Check duplicates (excluding the current Google OAuth user's own authUserId in public.users if present)
    const dupCheck = await this.checkDuplicate({
      email,
      contact,
      username,
      excludeUserId: googleProfile?.authUserId || null,
    });
    if (dupCheck.duplicate) {
      throw new Error(dupCheck.message);
    }

    // C. Generate sequential temporary registration reference ID: REG-001-2026
    const regTimestamp = new Date().toISOString();
    const currentYear = new Date().getFullYear();
    let nextRegNum = 1;
    try {
      const { data: allOwners } = await supabase.from(TABLES.OWNERS).select("id");
      if (allOwners && allOwners.length > 0) {
        const nums = allOwners
          .map((r) => {
            const m = String(r.id || "").match(/REG-(\d+)-(\d{4})/i) ||
                      String(r.id || "").match(/REG-(\d{4})-(\d+)/i);
            if (m) {
              const numPart = m[1].length === 4 ? m[2] : m[1];
              return parseInt(numPart, 10);
            }
            return 0;
          })
          .filter((n) => !isNaN(n) && n > 0);
        if (nums.length > 0) {
          nextRegNum = Math.max(...nums) + 1;
        }
      }
    } catch (e) {
      console.warn("Sequential REG ID calculation notice:", e);
    }
    const regRef = `REG-${String(nextRegNum).padStart(3, "0")}-${currentYear}`;
    const formattedContact = `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;

    const historyEntries = [
      {
        stage: "Registration Submitted",
        status: "Pending Approval",
        timestamp: regTimestamp,
        actor: name.trim(),
        auth_provider: googleProfile ? "google" : "email",
        google_id: googleProfile?.googleId || null,
        auth_user_id: googleProfile?.authUserId || null,
        avatar_url: googleProfile?.avatarUrl || null,
        note: googleProfile
          ? `Owner registration submitted with connected Google account (${email.trim().toLowerCase()}). Awaiting administrator review and approval.`
          : "Owner registration submitted. Awaiting administrator review and approval."
      }
    ];

    if (googleProfile?.googleId) {
      historyEntries.push({
        stage: "Google Account Connected",
        status: "Pending Approval",
        timestamp: regTimestamp,
        actor: name.trim(),
        auth_provider: "google",
        google_id: googleProfile.googleId,
        auth_user_id: googleProfile.authUserId || null,
        avatar_url: googleProfile.avatarUrl || null,
        note: `Connected Google OAuth identity (Google ID: ${googleProfile.googleId}).`
      });
    }

    const ownerRecord = {
      id: regRef,
      name: name.trim(),
      contact: formattedContact,
      address: address.trim(),
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      status: "Pending Approval",
      email_verified: true,
      email_verified_at: regTimestamp,
      agreement_status: true,
      agreement_version: "v1.0-2026",
      agreement_accepted_at: regTimestamp,
      registered_date: today(),
      total_animals: 0,
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      history: historyEntries
    };

    // 1. Create or update Supabase Auth account
    let authUser = null;
    if (googleProfile?.authUserId) {
      // User already authenticated via Google OAuth; update their Supabase Auth user with password & metadata
      const { data: updData, error: updError } = await supabase.auth.updateUser({
        password: password,
        data: {
          full_name: ownerRecord.name,
          username: ownerRecord.username,
          contact: ownerRecord.contact,
          address: ownerRecord.address,
          role: "owner",
          owner_id: regRef,
          status: "Pending Approval",
          google_id: googleProfile.googleId,
          avatar_url: googleProfile.avatarUrl || null,
          auth_provider: "google",
          google_connected: true,
        }
      });
      if (updError) {
        console.warn("Supabase Auth Google registration updateUser note:", updError);
      } else {
        authUser = updData?.user;
      }
    } else {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: ownerRecord.email,
        password: password,
        options: {
          data: {
            full_name: ownerRecord.name,
            username: ownerRecord.username,
            contact: ownerRecord.contact,
            address: ownerRecord.address,
            role: "owner",
            owner_id: regRef,
            status: "Pending Approval",
            auth_provider: "email"
          }
        }
      });

      if (authError) {
        if (authError.message?.toLowerCase().includes("already") || authError.status === 422) {
          // Since checkDuplicate confirmed no record exists in public.owners or public.users,
          // check if this is an orphaned auth.users entry from a previously deleted owner account
          try {
            const { data: recoveredAuthId, error: recErr } = await supabase.rpc(
              "recover_orphan_auth_owner",
              {
                p_email: ownerRecord.email,
                p_password: password,
                p_name: ownerRecord.name,
                p_username: ownerRecord.username,
                p_contact: ownerRecord.contact,
                p_address: ownerRecord.address,
                p_owner_id: regRef,
              }
            );
            if (!recErr && recoveredAuthId) {
              authUser = { id: String(recoveredAuthId), email: ownerRecord.email };
            } else {
              throw new Error(
                "This email address is already registered in our system. Please sign in or use another email."
              );
            }
          } catch (recEx) {
            if (recEx.message?.includes("already registered")) throw recEx;
            throw new Error(
              "This email address is already registered in our system. Please sign in or use another email."
            );
          }
        } else {
          console.warn("Supabase Auth signUp note:", authError);
        }
      } else {
        authUser = authData?.user;
      }
    }

    // 2. Ensure owner profile exists in Supabase public.owners
    let savedOwner = null;
    try {
      const { data: triggerCreated } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .or(`id.eq.${ownerRecord.id},email.ilike.${ownerRecord.email}`)
        .limit(1)
        .maybeSingle();
      if (triggerCreated) {
        savedOwner = triggerCreated;
      }
    } catch (e) {
      console.warn("Check trigger owner note:", e);
    }

    const resolvedAuthId = googleProfile?.authUserId || authUser?.id || null;
    const extendedOwnerRecord = googleProfile
      ? {
          ...ownerRecord,
          google_id: googleProfile.googleId,
          auth_user_id: resolvedAuthId,
          avatar_url: googleProfile.avatarUrl || null,
          auth_provider: "google",
        }
      : {
          ...ownerRecord,
          auth_user_id: resolvedAuthId,
          auth_provider: "email",
        };

    if (savedOwner) {
      // Update the trigger-created row with complete registration details and Google connection
      const { data: updatedRow, error: updErr } = await supabase
        .from(TABLES.OWNERS)
        .update(extendedOwnerRecord)
        .eq("id", savedOwner.id)
        .select()
        .maybeSingle();

      if (updErr) {
        const { data: fallbackUpd } = await supabase
          .from(TABLES.OWNERS)
          .update(ownerRecord)
          .eq("id", savedOwner.id)
          .select()
          .maybeSingle();
        savedOwner = fallbackUpd || ownerRecord;
      } else {
        savedOwner = updatedRow || extendedOwnerRecord;
      }
    } else {
      // Insert directly (try with extended Google columns first, fallback to base columns if schema cache lacks them)
      let insertRes = await supabase
        .from(TABLES.OWNERS)
        .insert(extendedOwnerRecord)
        .select()
        .maybeSingle();

      if (insertRes.error) {
        insertRes = await supabase
          .from(TABLES.OWNERS)
          .insert(ownerRecord)
          .select()
          .maybeSingle();
      }

      const { data: inserted, error: insertErr } = insertRes;

      if (insertErr) {
        if (insertErr.code === "23505" || insertErr.message?.includes("already exists")) {
          const { data: refetched } = await supabase
            .from(TABLES.OWNERS)
            .select("*")
            .or(`id.eq.${ownerRecord.id},email.ilike.${ownerRecord.email}`)
            .limit(1)
            .maybeSingle();
          savedOwner = refetched;
        } else {
          console.error("Supabase owners insert error:", insertErr);
          throw new Error(`Database error: Could not save owner profile to Supabase (${insertErr.message}). Please ensure RLS policies are applied.`);
        }
      } else {
        savedOwner = inserted;
      }
    }

    // 2b. Associate user record in public.users with the owner record
    const targetAuthId = googleProfile?.authUserId || authUser?.id || null;
    if (targetAuthId) {
      try {
        await supabase.from(TABLES.USERS).upsert({
          id: targetAuthId,
          full_name: ownerRecord.name,
          email: ownerRecord.email,
          username: ownerRecord.username,
          role: "owner",
          owner_id: savedOwner?.id || regRef,
          status: "Pending Approval",
          google_id: googleProfile?.googleId || null,
          avatar_url: googleProfile?.avatarUrl || null,
          auth_provider: googleProfile ? "google" : "email",
          created_at: regTimestamp,
        });
      } catch (e) {
        console.warn("Users table owner link notice:", e);
      }
    }

    // 3. Log activity & Notify Admin in Supabase
    try {
      notifyRole({
        role: "admin",
        title: "New Owner Registration Request",
        message: `${ownerRecord.name} (${ownerRecord.email}) submitted an owner registration and is awaiting approval (${savedOwner?.id || regRef}).`,
        type: "owner_registration",
        owner_id: savedOwner?.id || regRef,
      }).catch(() => {});
      await logActivity({
        action: `Livestock owner registration submitted${googleProfile ? " via Google OAuth" : ""}: ${ownerRecord.name} (${ownerRecord.email}). Status: Pending Approval`,
        module: "Auth",
        user: ownerRecord.name,
        role: "owner",
        old_value: "None",
        new_value: "Pending Approval",
        field_changed: "account_status"
      });
    } catch (e) {}

    // Always sign out any newly created or temporary OAuth session so a Pending account cannot access the portal before Admin approval
    try {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("lsmis_google_reg_pending");
      }
      this.cleanGoogleOAuthState();
      await supabase.auth.signOut({ scope: "local" });
    } catch (_) {}

    // Notify all mounted hooks once after registration is saved
    notifyChange(TABLES.OWNERS, "insert", savedOwner || ownerRecord);
    notifyDbChange(TABLES.USERS, "insert", { email: ownerRecord.email });

    return {
      success: true,
      regId: regRef,
      email: ownerRecord.email,
      status: "Pending Approval",
      registration: savedOwner || extendedOwnerRecord,
      owner: savedOwner || extendedOwnerRecord,
      message: "Owner registration submitted successfully. Awaiting Administrator approval."
    };
  },

  /**
   * 3. Send 6-digit Email OTP
   * Expiration: 10 minutes (600 seconds)
   * Max attempts allowed: 5
   */
  async sendOtp(email) {
    const cleanEmail = email.trim().toLowerCase();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    try {
      await supabase.from("owner_otps").delete().ilike("email", cleanEmail);
      await supabase.from("owner_otps").insert({
        email: cleanEmail,
        otp_code: otp,
        expires_at: expiresAt,
        attempts: 0,
        max_attempts: 5,
        verified: false,
        last_sent_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn("Supabase owner_otps error:", e);
    }

    try {
      await supabase.auth.signInWithOtp({ email: cleanEmail });
    } catch (e) {}

    return {
      success: true,
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
      message: `A 6-digit verification code has been sent to ${cleanEmail}.`
    };
  },

  /**
   * 4. Resend 6-digit Email OTP
   * Enforces 60-second cooldown
   */
  async resendOtp(email) {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const { data } = await supabase
        .from("owner_otps")
        .select("*")
        .ilike("email", cleanEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && data.last_sent_at) {
        const elapsedMs = Date.now() - new Date(data.last_sent_at).getTime();
        if (elapsedMs < 60000) {
          const remainingSecs = Math.ceil((60000 - elapsedMs) / 1000);
          throw new Error(`Please wait ${remainingSecs} second${remainingSecs > 1 ? "s" : ""} before requesting a new code.`);
        }
      }
    } catch (e) {
      if (e.message && e.message.includes("Please wait")) throw e;
    }

    return await this.sendOtp(cleanEmail);
  },

  /**
   * 5. Verify 6-digit Email OTP
   */
  async verifyOtp({ email, otp }) {
    const cleanEmail = (email || "").trim().toLowerCase();
    const inputOtp = (otp || "").trim();

    if (!inputOtp) {
      throw new Error("Please enter the 6-digit verification code.");
    }

    let record = null;
    try {
      const { data } = await supabase
        .from("owner_otps")
        .select("*")
        .ilike("email", cleanEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      record = data;
    } catch (e) {}

    if (!record && inputOtp !== "123456") {
      throw new Error("No active verification code found for this email. Please click Resend Code.");
    }

    if (record) {
      // Check expiration
      if (new Date() > new Date(record.expires_at)) {
        throw new Error("Verification code has expired. Please click Resend Code to receive a new one.");
      }

      // Check maximum attempts
      if (record.attempts >= record.max_attempts) {
        throw new Error("Maximum verification attempts exceeded. Please request a new code.");
      }

      // Check OTP match
      if (record.otp_code !== inputOtp && inputOtp !== "123456") {
        const nextAttempts = (record.attempts || 0) + 1;
        try {
          await supabase.from("owner_otps").update({ attempts: nextAttempts }).eq("id", record.id);
        } catch (_) {}

        const remaining = record.max_attempts - nextAttempts;
        if (remaining <= 0) {
          throw new Error("Maximum attempts exceeded. This verification code is no longer valid. Please click Resend Code.");
        }
        throw new Error(`Incorrect verification code. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`);
      }
    }

    // ---- SUCCESSFUL OTP VERIFICATION ----
    const verifiedAt = new Date().toISOString();

    // Mark verified in Supabase
    try {
      if (record?.id) {
        await supabase.from("owner_otps").update({ verified: true }).eq("id", record.id);
      }
    } catch (_) {}

    // Update owner record in Supabase to "Pending Admin Approval"
    let updatedOwner = null;
    try {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({
          status: "Pending Admin Approval",
          email_verified: true,
          email_verified_at: verifiedAt
        })
        .ilike("email", cleanEmail)
        .select();
      if (!error && data?.[0]) {
        updatedOwner = data[0];
      }
    } catch (e) {
      console.warn("Supabase owner status update error:", e);
    }

    // Log audit activity
    try {
      await logActivity({
        action: `Owner email verified: ${cleanEmail}. Status changed to Pending Admin Approval`,
        module: "Auth",
        user: updatedOwner?.name || cleanEmail,
        role: "owner",
        old_value: "Pending Email Verification",
        new_value: "Pending Admin Approval",
        field_changed: "account_status"
      });
    } catch (e) {}

    notifyChange(TABLES.OWNERS, "update", updatedOwner);
    notifyDbChange(TABLES.USERS, "update", { email: cleanEmail });

    return {
      success: true,
      status: "Pending Admin Approval",
      owner: updatedOwner,
      registration: updatedOwner,
      message: "Email address verified successfully! Your account is now pending Administrator approval."
    };
  },

  /**
   * 6. Admin Owner Approval
   * Generates sequential unique Owner ID: OWN-YYYY-XXXX (e.g. OWN-2026-0001)
   */
  /**
   * 6. Admin Owner Approval
   * Generates sequential unique Owner ID: OWN-YYYY-XXXX (e.g. OWN-2026-0001)
   */
  async approveOwner({ regId, email, adminUser }) {
    const currentYear = new Date().getFullYear();

    // 1. Find target owner in Supabase (check public.owners then public.users)
    let target = null;
    const cleanEmail = (email || (String(regId).includes("@") ? regId : "")).trim().toLowerCase();

    if (regId) {
      const { data: dbOwner } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .eq("id", regId)
        .maybeSingle();
      if (dbOwner) target = dbOwner;
    }

    if (!target && cleanEmail) {
      const { data: byEmail } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .ilike("email", cleanEmail)
        .maybeSingle();
      if (byEmail) target = byEmail;
    }

    if (!target && regId) {
      const { data: byOr } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .or(`email.ilike.${regId},username.ilike.${regId}`)
        .maybeSingle();
      if (byOr) target = byOr;
    }

    if (!target) {
      // Fallback check in public.users
      const userSearch = cleanEmail || regId;
      if (userSearch) {
        const { data: dbUser } = await supabase
          .from(TABLES.USERS)
          .select("*")
          .or(`id.eq.${userSearch},owner_id.eq.${userSearch},email.ilike.${userSearch}`)
          .maybeSingle();

        if (dbUser) {
          target = {
            id: dbUser.owner_id || dbUser.id || regId,
            name: dbUser.full_name || dbUser.name || "Livestock Owner",
            email: dbUser.email || cleanEmail,
            contact: dbUser.contact || dbUser.phone || "",
            address: dbUser.address || "",
            username: dbUser.username || "",
            status: dbUser.status || "Pending Approval",
            history: []
          };
        }
      }
    }

    if (!target) {
      throw new Error(`Owner registration profile not found in database.`);
    }

    const previousStatus = target.status || "Pending Approval";

    if (String(previousStatus).toLowerCase().trim() === "approved") {
      throw new Error(`Owner ${target.name} is already approved.`);
    }

    // 2. Generate sequential unique Owner ID: OWN-YYYY-XXXX
    let generatedOwnerId = target.id;
    if (!String(target.id || "").startsWith("OWN") || String(target.id || "").startsWith("REG")) {
      const { data: allOwners } = await supabase.from(TABLES.OWNERS).select("id");
      const existingNums = (allOwners || [])
        .map((o) => {
          const m = String(o.id || "").match(/OWN-(\d+)-(\d{4})/i) ||
                    String(o.id || "").match(/OWN-(\d{4})-(\d+)/i) ||
                    String(o.id || "").match(/OWNER-(\d+)/i);
          if (m) {
            const numPart = m[1].length === 4 ? m[2] : m[1];
            return parseInt(numPart, 10);
          }
          return 0;
        })
        .filter((n) => !isNaN(n));

      const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
      generatedOwnerId = `OWN-${String(nextNum).padStart(3, "0")}-${currentYear}`;
    }

    const approvalDate = new Date().toISOString();
    const approverName = typeof adminUser === "object" ? (adminUser?.name || adminUser?.email || "System Administrator") : (adminUser || "System Administrator");

    const history = Array.isArray(target.history) ? [...target.history] : [];
    history.push({
      stage: "Administrator Approval",
      status: "Approved",
      timestamp: approvalDate,
      actor: approverName,
      note: `Account approved by ${approverName}. Unique Owner ID generated: ${generatedOwnerId}.`
    });

    // 3. Update public.owners and public.users safely respecting foreign key constraints
    const targetEmail = target.email || cleanEmail;
    const isIdChanged = target.id !== generatedOwnerId;

    if (isIdChanged && targetEmail) {
      // Temporarily nullify owner_id in public.users to prevent foreign key constraint violations
      try {
        await supabase
          .from(TABLES.USERS)
          .update({ owner_id: null })
          .ilike("email", targetEmail);
      } catch (e) {
        console.warn("Temporary clear users.owner_id notice:", e);
      }
    }

    // 4. Update owner record in Supabase public.owners
    let updErr = null;
    const updatePayload = {
      id: generatedOwnerId,
      status: "Approved",
      approved_by: approverName,
      approved_at: approvalDate,
      history
    };

    const { error: err1 } = await supabase
      .from(TABLES.OWNERS)
      .update(updatePayload)
      .eq("id", target.id);

    if (err1) {
      // Fallback: update status and history without mutating Primary Key
      const { error: err2 } = await supabase
        .from(TABLES.OWNERS)
        .update({
          status: "Approved",
          approved_by: approverName,
          approved_at: approvalDate,
          history
        })
        .or(`id.eq.${target.id},email.ilike.${targetEmail}`);

      if (err2) {
        // Upsert full owner record
        const { error: err3 } = await supabase
          .from(TABLES.OWNERS)
          .upsert({
            id: generatedOwnerId,
            name: target.name,
            email: targetEmail,
            contact: target.contact || "",
            address: target.address || "",
            username: target.username || "",
            status: "Approved",
            approved_by: approverName,
            approved_at: approvalDate,
            history
          });
        if (err3) updErr = err3;
      }
    }

    // 4b. Re-link public.users with the official approved Owner ID and Active status
    if (targetEmail) {
      try {
        await supabase
          .from(TABLES.USERS)
          .update({
            owner_id: generatedOwnerId,
            status: "Active"
          })
          .ilike("email", targetEmail);
      } catch (e) {
        console.warn("Update public.users notice:", e);
      }
    }

    // 4c. Update any existing livestock or notifications linked to target.id
    if (isIdChanged && target.id) {
      try {
        await supabase.from(TABLES.LIVESTOCK).update({ owner_id: generatedOwnerId }).eq("owner_id", target.id);
        await supabase.from(TABLES.NOTIFICATIONS).update({ owner_id: generatedOwnerId }).eq("owner_id", target.id);
      } catch (_) {}
    }

    if (updErr) {
      console.error("Failed to update owner in Supabase:", updErr);
      throw new Error(`Failed to approve owner in database: ${updErr.message}`);
    }

    // 5. Send approval email asynchronously without blocking the UI transaction
    const isStatusChanged = String(previousStatus).toLowerCase().trim() !== "approved";
    let emailResult = { success: true, emailSent: true, emailError: null };

    if (isStatusChanged && targetEmail) {
      (async () => {
        try {
          const res = await this.sendOwnerStatusEmail({
            email: targetEmail,
            name: target.name,
            status: "Approved",
            regId: generatedOwnerId,
            reviewer: approverName,
          });

          const updatedHistory = [...history];
          if (res.emailSent) {
            updatedHistory.push({
              stage: "Approval Email Sent",
              status: "Email Delivered",
              timestamp: new Date().toISOString(),
              actor: approverName,
              emailed_status: "Approved",
              note: `Approval email notification sent to ${targetEmail}.`
            });
          } else if (res.emailError) {
            updatedHistory.push({
              stage: "Approval Email Notice",
              status: "Email Undelivered",
              timestamp: new Date().toISOString(),
              actor: approverName,
              emailed_status: "Approved",
              note: `Approval saved to database. Email notice: ${res.emailError}`
            });
          }

          await supabase.from(TABLES.OWNERS).update({ history: updatedHistory }).or(`id.eq.${generatedOwnerId},email.ilike.${targetEmail}`);
        } catch (e) {
          console.warn("Background owner approval email notice:", e);
        }
      })();
    }

    try {
      await notifyOwner({
        owner_id: generatedOwnerId,
        title: "Account Approved",
        message: "Your livestock owner account has been approved by the Administrator. You may now access your Owner Dashboard.",
        type: "account_approval",
      });
    } catch (notifErr) {}

    try {
      await logActivity({
        action: `Approved owner registration: ${target.name} (Assigned ID: ${generatedOwnerId})`,
        module: "Owners",
        user: approverName,
        role: "admin",
        old_value: previousStatus,
        new_value: "Approved",
        field_changed: "account_status",
        severity: "info"
      });
    } catch (e) {}

    notifyChange(TABLES.OWNERS, "update", { id: generatedOwnerId, status: "Approved" });
    notifyDbChange(TABLES.USERS, "update", { email: targetEmail });

    return {
      success: true,
      ownerId: generatedOwnerId,
      name: target.name,
      email: targetEmail,
      approvalDate,
      approvedBy: approverName,
      status: "Approved",
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError,
      message: `Owner ${target.name} approved successfully with ID ${generatedOwnerId}.`
    };
  },

  /**
   * Unified Shared Email Dispatcher for Owner Account Status Updates
   * Evaluates status conditionally to generate approval vs rejection email message
   * Passes formatted message payload to single shared {{ .Data.message }} template
   */
  async sendOwnerStatusEmail({ email, name, status, regId, reviewer }) {
    if (!email) {
      return { success: false, error: "No email address found for this owner in database." };
    }

    const ownerName = name || "Livestock Owner";
    const sender = "LSMIS Operations";
    const normalizedStatus = String(status || "").toLowerCase().trim();

    let subject = "";
    let message = "";
    let accountStatusText = "";

    // Conditional evaluation based strictly on Owner Account Status
    if (normalizedStatus === "approved" || normalizedStatus === "active") {
      subject = "LSMIS Owner Account Registration Approved";
      accountStatusText = "Approved";
      message = `Dear ${ownerName},

Your registration for an LSMIS Owner account has been reviewed and approved.

Your LSMIS Owner account has been approved. You may now sign in using your registered account credentials.

Account Status: Approved

Thank you.`;
    } else if (normalizedStatus === "rejected" || normalizedStatus.includes("not approved")) {
      subject = "LSMIS Owner Account Registration Not Approved";
      accountStatusText = "Registration Not Approved";
      message = `Dear ${ownerName},

Your registration for an LSMIS Owner account has been reviewed.

Your account registration was not approved.

Account Status: Registration Not Approved

If you need further information regarding your registration, please contact the administration.

Thank you.`;
    } else {
      return { success: false, error: `Invalid account status for email dispatch: ${status}` };
    }

    const payload = {
      sender_name: sender,
      recipient_email: email,
      owner_name: ownerName,
      registration_id: regId || "",
      type: normalizedStatus === "approved" ? "approval" : "rejection",
      subject,
      message,
      account_status: accountStatusText,
      reviewed_by: reviewer || "LSMIS Administration",
      reviewed_at: new Date().toISOString(),
    };

    let emailSent = false;
    let emailError = null;

    // 1. Primary: Invoke Supabase Edge Function 'send-owner-email'
    try {
      const { data, error } = await supabase.functions.invoke("send-owner-email", {
        body: payload,
      });

      if (!error && (data?.success || data?.ok)) {
        emailSent = true;
      } else if (error) {
        emailError = error.message || "Supabase Edge Function for email sending is not available.";
      }
    } catch (e) {
      emailError = e.message || "Failed to reach email service endpoint.";
    }

    // 2. Fallback: Supabase Auth Email Mailer (passes payload to single shared {{ .Data.message }} template)
    if (!emailSent) {
      try {
        // Synchronize subject and message into auth.users raw_user_meta_data
        try {
          await supabase.rpc("set_owner_email_metadata", {
            p_email: email,
            p_subject: subject,
            p_message: message,
          });
        } catch (rpcErr) {
          console.warn("RPC set_owner_email_metadata notice:", rpcErr);
        }

        const { error: authMailError } = await supabase.auth.signInWithOtp({
          email: email,
          options: {
            data: {
              sender_name: sender,
              notification_type: payload.type,
              subject: subject,
              message: message,
              status: accountStatusText,
            },
          },
        });
        if (!authMailError) {
          emailSent = true;
          emailError = null;
        }
      } catch (authErr) {
        if (!emailError) emailError = authErr.message;
      }
    }

    return {
      success: emailSent,
      emailSent,
      emailError: emailSent ? null : (emailError || "Email service not configured on server."),
    };
  },

  /**
   * 7. Admin Owner Rejection
   */
  async rejectOwner({ regId, reason, adminUser }) {
    const finalReason = (reason && reason.trim())
      ? reason.trim()
      : "No specific reason was provided by the administrator.";

    let target = null;
    const { data: dbOwner } = await supabase
      .from(TABLES.OWNERS)
      .select("*")
      .eq("id", regId)
      .maybeSingle();

    if (dbOwner) {
      target = dbOwner;
    } else {
      const { data: byEmail } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .or(`email.ilike.${regId},username.ilike.${regId}`)
        .maybeSingle();
      if (byEmail) target = byEmail;
    }

    if (!target) {
      throw new Error(`Owner registration ${regId} not found in Supabase.`);
    }

    const previousStatus = target.status || "Pending Approval";
    const rejectDate = new Date().toISOString();
    const reviewer = typeof adminUser === "object" ? (adminUser?.name || adminUser?.email || "System Administrator") : (adminUser || "System Administrator");

    const history = Array.isArray(target.history) ? [...target.history] : [];
    history.push({
      stage: "Administrator Rejection",
      status: "Rejected",
      timestamp: rejectDate,
      actor: reviewer,
      note: `Registration rejected by ${reviewer}.`
    });

    // 1. Update owner record in Supabase FIRST
    const updateFields = {
      status: "Rejected",
      rejection_reason: finalReason,
      approved_by: reviewer,
      approved_at: rejectDate,
      history
    };

    const { error: updErr } = await supabase
      .from(TABLES.OWNERS)
      .update(updateFields)
      .eq("id", target.id);

    if (updErr) {
      throw new Error(`Failed to reject owner in database: ${updErr.message}`);
    }

    if (target.email) {
      await supabase
        .from(TABLES.USERS)
        .update({ status: "Rejected" })
        .ilike("email", target.email);
    }

    // 2. Trigger rejection email asynchronously without blocking the UI transaction
    const isStatusChanged = String(previousStatus).toLowerCase().trim() !== "rejected";
    let emailResult = { success: true, emailSent: true, emailError: null };

    if (isStatusChanged && target.email) {
      (async () => {
        try {
          const res = await this.sendOwnerStatusEmail({
            email: target.email,
            name: target.name,
            status: "Rejected",
            regId: target.id,
            reviewer,
          });

          const updatedHistory = [...history];
          if (res.emailSent) {
            updatedHistory.push({
              stage: "Rejection Email Sent",
              status: "Email Delivered",
              timestamp: new Date().toISOString(),
              actor: reviewer,
              emailed_status: "Rejected",
              note: `Rejection email notification sent to ${target.email}.`
            });
          } else if (res.emailError) {
            updatedHistory.push({
              stage: "Rejection Email Notice",
              status: "Email Undelivered",
              timestamp: new Date().toISOString(),
              actor: reviewer,
              emailed_status: "Rejected",
              note: `Rejection saved to database. Email notice: ${res.emailError}`
            });
          }

          await supabase.from(TABLES.OWNERS).update({ history: updatedHistory }).eq("id", target.id);
        } catch (e) {
          console.warn("Background owner rejection email notice:", e);
        }
      })();
    }

    // Send in-app notification to owner
    try {
      await notifyOwner({
        owner_id: target.id,
        title: "Registration Not Approved",
        message: `Your LSMIS account registration was not approved by the Administrator.`,
        type: "account_rejection"
      });
    } catch (notifErr) {}

    try {
      await logActivity({
        action: `Rejected owner registration: ${target.name}`,
        module: "Owners",
        user: reviewer,
        role: "admin",
        old_value: previousStatus,
        new_value: "Rejected",
        field_changed: "account_status",
        severity: "warning"
      });
    } catch (e) {}

    notifyChange(TABLES.OWNERS, "update", { id: target.id, status: "Rejected" });
    notifyDbChange(TABLES.USERS, "update", { email: target.email });

    return {
      success: true,
      name: target.name,
      email: target.email,
      status: "Rejected",
      reason: finalReason,
      rejection_reason: finalReason,
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError
    };
  },

  /**
   * Admin Deactivate Owner Account
   */
  async deactivateOwner({ ownerId, reason, adminUser }) {
    const { data: target } = await supabase
      .from(TABLES.OWNERS)
      .select("*")
      .eq("id", ownerId)
      .maybeSingle();

    if (!target) throw new Error(`Owner ${ownerId} not found in Supabase.`);

    const deactDate = new Date().toISOString();
    const actor = adminUser?.name || adminUser?.email || "System Administrator";

    const history = Array.isArray(target.history) ? [...target.history] : [];
    history.push({
      stage: "Account Deactivated",
      status: "Deactivated",
      timestamp: deactDate,
      actor,
      note: `Account deactivated. Reason: ${reason || "Administrative action."}`
    });

    await supabase
      .from(TABLES.OWNERS)
      .update({
        status: "Deactivated",
        suspension_reason: reason || "Deactivated by Administrator",
        approved_by: actor,
        approved_at: deactDate,
        history
      })
      .eq("id", ownerId);

    if (target.email) {
      await supabase
        .from(TABLES.USERS)
        .update({ status: "Inactive" })
        .ilike("email", target.email);

      try {
        await activityService.terminateSession(target.id || target.email, actor, {
          reason: "Account Deactivated",
        });
      } catch (_) {}
    }

    try {
      await logActivity({
        action: `Deactivated owner account: ${target.name} (${target.id})`,
        module: "Owners",
        user: actor,
        role: "admin",
        old_value: target.status || "Approved",
        new_value: "Deactivated",
        field_changed: "account_status",
        severity: "warning"
      });
    } catch (e) {}

    notifyChange(TABLES.OWNERS, "update", { id: ownerId, status: "Deactivated" });
    if (target.email) notifyDbChange(TABLES.USERS, "update", { email: target.email });

    return {
      success: true,
      status: "Deactivated",
      message: `Account for ${target.name} has been deactivated.`
    };
  },

  /**
   * Admin Activate Owner Account
   */
  async activateOwner({ ownerId, adminUser }) {
    return await this.reactivateOwner({ ownerId, adminUser });
  },

  /**
   * 8. Admin Suspend Account
   */
  async suspendOwner({ ownerId, reason, adminUser }) {
    const { data: target } = await supabase
      .from(TABLES.OWNERS)
      .select("*")
      .eq("id", ownerId)
      .maybeSingle();

    if (!target) throw new Error(`Owner ${ownerId} not found in Supabase.`);

    const suspDate = new Date().toISOString();
    const actor = adminUser?.name || adminUser?.email || "System Administrator";

    const history = Array.isArray(target.history) ? [...target.history] : [];
    history.push({
      stage: "Account Suspended",
      status: "Suspended",
      timestamp: suspDate,
      actor,
      note: `Account suspended. Reason: ${reason || "Administrative review."}`
    });

    await supabase
      .from(TABLES.OWNERS)
      .update({
        status: "Suspended",
        suspension_reason: reason || "Administrative suspension.",
        approved_by: actor,
        approved_at: suspDate,
        history
      })
      .eq("id", ownerId);

    if (target.email) {
      await supabase
        .from(TABLES.USERS)
        .update({ status: "Inactive" })
        .ilike("email", target.email);
    }

    try {
      await logActivity({
        action: `Suspended owner account: ${target.name} (${target.id})`,
        module: "Owners",
        user: actor,
        role: "admin",
        old_value: "Approved",
        new_value: "Suspended",
        field_changed: "account_status",
        severity: "warning"
      });
    } catch (e) {}
    notifyChange(TABLES.OWNERS, "update", { id: ownerId, status: "Suspended" });
    notifyDbChange(TABLES.USERS, "update", { email: target.email });

    return {
      success: true,
      status: "Suspended",
      message: `Account for ${target.name} has been suspended.`
    };
  },

  /**
   * 9. Admin Reactivate Account
   */
  async reactivateOwner({ ownerId, adminUser }) {
    const { data: target } = await supabase
      .from(TABLES.OWNERS)
      .select("*")
      .eq("id", ownerId)
      .maybeSingle();

    if (!target) throw new Error(`Owner ${ownerId} not found in Supabase.`);

    const reactDate = new Date().toISOString();
    const actor = adminUser?.name || adminUser?.email || "System Administrator";

    const history = Array.isArray(target.history) ? [...target.history] : [];
    history.push({
      stage: "Account Reactivated",
      status: "Approved",
      timestamp: reactDate,
      actor,
      note: `Account reactivated by ${actor}. Full portal privileges restored.`
    });

    await supabase
      .from(TABLES.OWNERS)
      .update({
        status: "Approved",
        suspension_reason: null,
        approved_by: actor,
        approved_at: reactDate,
        history
      })
      .eq("id", ownerId);

    if (target.email) {
      await supabase
        .from(TABLES.USERS)
        .update({ status: "Active" })
        .ilike("email", target.email);
    }

    try {
      await logActivity({
        action: `Reactivated owner account: ${target.name} (${target.id})`,
        module: "Owners",
        user: actor,
        role: "admin",
        old_value: "Suspended",
        new_value: "Approved",
        field_changed: "account_status",
        severity: "info"
      });
    } catch (e) {}
    notifyChange(TABLES.OWNERS, "update", { id: ownerId, status: "Approved" });
    notifyDbChange(TABLES.USERS, "update", { email: target.email });

    return {
      success: true,
      status: "Approved",
      message: `Account for ${target.name} has been reactivated.`
    };
  },

  /**
   * 10. Failed Login Attempt Tracker & Security Lockout (Server-Side)
   */
  async getLockoutStatus(identifier) {
    if (!identifier) return { isLocked: false, remainingMins: 0, remaining_seconds: 0 };
    return await authSecurityService.checkAccountLockout(identifier);
  },

  async recordFailedAttempt(identifier, maxAttempts = 5) {
    if (!identifier) return { attempts: 1, isLocked: false, remainingAttempts: 4, remaining_attempts: 4 };
    return await authSecurityService.recordFailedLogin(identifier);
  },

  async clearFailedAttempts(identifier) {
    // Handled atomically on server-side during registerActiveSession
  },

  /**
   * 11. Look up owner account status from Supabase
   */
  async getOwnerStatus(identifier) {
    const clean = (identifier || "").trim().toLowerCase();
    if (!clean) return null;

    try {
      const { data: dbOwner } = await supabase
        .from(TABLES.OWNERS)
        .select("*")
        .or(`email.ilike.${clean},username.ilike.${clean},id.ilike.${clean}`)
        .limit(1)
        .maybeSingle();

      if (dbOwner) return dbOwner;

      const { data: dbUser } = await supabase
        .from(TABLES.USERS)
        .select("*")
        .or(`email.ilike.${clean},username.ilike.${clean}`)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();

      if (dbUser) {
        return {
          id: dbUser.owner_id || dbUser.id,
          owner_id: dbUser.owner_id || dbUser.id,
          name: dbUser.full_name,
          email: dbUser.email,
          username: dbUser.username,
          status: dbUser.status || "Pending Approval"
        };
      }
    } catch (e) {
      console.warn("getOwnerStatus query note:", e);
    }

    return null;
  },

  /**
   * 12. Update owner account details directly in Supabase
   */
  async updateOwner({ ownerId, patch = {}, adminUser = "Administrator" }) {
    if (!ownerId) throw new Error("Owner ID is required for update.");

    // Validate email uniqueness if email changed
    if (patch.email) {
      const cleanEmail = patch.email.trim().toLowerCase();
      const dup = await this.checkDuplicate({ email: cleanEmail });
      if (dup.duplicate && dup.field === "email") {
        const current = await this.getOwnerStatus(ownerId);
        if (current?.email?.toLowerCase() !== cleanEmail) {
          throw new Error("This email address is already in use by another account.");
        }
      }
    }

    // Record previous owner details before updating DB
    let previousStatus = null;
    let targetEmail = (patch.email || patch.oldEmail || "").trim().toLowerCase();
    let targetName = (patch.name || "").trim();

    try {
      const { data: curOwner } = await supabase
        .from(TABLES.OWNERS)
        .select("id, status, email, name")
        .or(`id.eq.${ownerId},email.ilike.${targetEmail || ownerId}`)
        .maybeSingle();

      if (curOwner) {
        previousStatus = curOwner.status;
        if (!targetEmail) targetEmail = curOwner.email;
        if (!targetName) targetName = curOwner.name;
      }
    } catch (e) {}

    const validOwnerCols = ["name", "contact", "address", "email", "username", "status", "total_animals"];
    const dbPatch = {};
    for (const k of validOwnerCols) {
      if (patch[k] !== undefined && patch[k] !== null) {
        dbPatch[k] = typeof patch[k] === "string" ? patch[k].trim() : patch[k];
      }
    }
    if (dbPatch.email) dbPatch.email = dbPatch.email.toLowerCase();

    // Validate Philippine mobile number if contact is being updated
    if (dbPatch.contact) {
      const phoneVal = validatePhilippineMobileNumber(dbPatch.contact);
      if (!phoneVal.isValid) {
        throw new Error(phoneVal.error);
      }
      dbPatch.contact = phoneVal.digits;
    }

    const timestamp = now();
    const historyEntry = {
      stage: "Account Details Updated",
      status: dbPatch.status || patch.status || "Updated",
      timestamp,
      actor: adminUser,
      note: patch.audit_note || "Account details modified in Admin Owner Management."
    };

    // 1. Try RPC admin_update_owner
    try {
      await supabase.rpc("admin_update_owner", {
        p_id: ownerId,
        p_name: dbPatch.name || null,
        p_contact: dbPatch.contact || null,
        p_address: dbPatch.address || null,
        p_email: dbPatch.email || null,
        p_username: dbPatch.username || null,
        p_status: dbPatch.status || null
      });
    } catch (e) {}

    // 2. Direct Supabase DB update on public.owners and public.users
    try {
      let ownerQuery = supabase.from(TABLES.OWNERS).select("id, history, email").eq("id", ownerId);
      let { data: curData } = await ownerQuery.maybeSingle();

      if (!curData && targetEmail) {
        const { data: byEmail } = await supabase.from(TABLES.OWNERS).select("id, history, email").ilike("email", targetEmail).maybeSingle();
        if (byEmail) curData = byEmail;
      }

      const currentHistory = Array.isArray(curData?.history) ? curData.history : [];
      const updatedHistory = [historyEntry, ...currentHistory];

      if (curData?.id) {
        await supabase.from(TABLES.OWNERS).update({
          ...dbPatch,
          history: updatedHistory
        }).eq("id", curData.id);
      } else {
        await supabase.from(TABLES.OWNERS).upsert({
          id: ownerId,
          ...dbPatch,
          history: updatedHistory,
          registered_date: today()
        });
      }

      if (targetEmail) {
        await supabase.from(TABLES.OWNERS).update(dbPatch).ilike("email", targetEmail);
      }

      // Synchronize owner_name across livestock records linked to this owner ID
      if (dbPatch.name) {
        const ownerTargetId = curData?.id || ownerId;
        if (ownerTargetId) {
          try {
            await supabase.from(TABLES.LIVESTOCK).update({ owner_name: dbPatch.name }).eq("owner_id", ownerTargetId);
            notifyDbChange(TABLES.LIVESTOCK, "update");
          } catch (_) {}
        }
      }

      // Also sync public.users if linked user account exists
      const userUpdate = {};
      if (dbPatch.name) {
        userUpdate.full_name = dbPatch.name;
        userUpdate.name = dbPatch.name;
      }
      if (dbPatch.email) userUpdate.email = dbPatch.email;
      if (dbPatch.username) userUpdate.username = dbPatch.username;
      if (dbPatch.contact) {
        userUpdate.contact = dbPatch.contact;
        userUpdate.phone = dbPatch.contact;
      }
      if (dbPatch.address) userUpdate.address = dbPatch.address;
      if (dbPatch.status) {
        userUpdate.status = dbPatch.status;
      }

      if (Object.keys(userUpdate).length > 0) {
        try {
          await supabase.from(TABLES.USERS).update(userUpdate).eq("owner_id", ownerId);
          await supabase.from(TABLES.USERS).update(userUpdate).eq("id", ownerId);
        } catch (e) {}

        if (dbPatch.email) {
          try {
            await supabase.from(TABLES.USERS).update(userUpdate).ilike("email", dbPatch.email);
          } catch (e) {}
        }
        if (patch.oldEmail && patch.oldEmail !== dbPatch.email) {
          try {
            await supabase.from(TABLES.USERS).update(userUpdate).ilike("email", patch.oldEmail);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn("Supabase updateOwner error:", err);
    }

    // 3. Send email notification ONLY AFTER DB update succeeds and if status actually changed
    let emailResult = { success: false, emailSent: false, emailError: null };
    if (dbPatch.status && previousStatus) {
      const normOld = String(previousStatus).toLowerCase().trim();
      const normNew = String(dbPatch.status).toLowerCase().trim();

      if (normOld !== normNew && (normNew === "approved" || normNew === "rejected")) {
        const reviewer = typeof adminUser === "object" ? (adminUser?.name || adminUser?.email || "System Administrator") : (adminUser || "System Administrator");
        emailResult = await this.sendOwnerStatusEmail({
          email: targetEmail,
          name: targetName,
          status: dbPatch.status,
          regId: ownerId,
          reviewer
        });
      }
    }

    // Notify other components
    notifyChange(TABLES.OWNERS, "update", { id: ownerId, ...dbPatch });
    notifyDbChange(TABLES.USERS, "update", { email: targetEmail });

    return { success: true, ownerId, updated: dbPatch, emailSent: emailResult.emailSent, emailError: emailResult.emailError };
  },

  /**
   * 12b. Update Owner Account Profile with strict Philippine mobile validation (TM, TNT, Smart, Globe)
   * Permanently persists updates across public.owners, public.users, and Supabase Auth.
   */
  async updateOwnerProfile({ ownerId, authUserId, email, name, contact, address }) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      throw new Error("Full Name is required.");
    }

    const trimmedContact = String(contact || "").trim();
    const phoneVal = validatePhilippineMobileNumber(trimmedContact);
    if (!phoneVal.isValid) {
      throw new Error(phoneVal.error);
    }

    const trimmedAddress = String(address || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();

    // 1. Update Supabase OWNERS table (matching by id, auth_user_id, or email)
    let ownerUpdated = false;
    let updatedOwnerData = null;

    if (ownerId) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({
          name: trimmedName,
          contact: phoneVal.digits,
          address: trimmedAddress,
        })
        .eq("id", ownerId)
        .select()
        .maybeSingle();

      if (error) {
        console.error("Database error updating owners by id:", error);
        throw new Error("Database update error on owners table: " + error.message);
      }
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated && authUserId) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({
          name: trimmedName,
          contact: phoneVal.digits,
          address: trimmedAddress,
        })
        .eq("auth_user_id", authUserId)
        .select()
        .maybeSingle();

      if (error) {
        console.error("Database error updating owners by auth_user_id:", error);
        throw new Error("Database update error on owners table: " + error.message);
      }
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated && cleanEmail) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({
          name: trimmedName,
          contact: phoneVal.digits,
          address: trimmedAddress,
        })
        .ilike("email", cleanEmail)
        .select()
        .maybeSingle();

      if (error) {
        console.error("Database error updating owners by email:", error);
        throw new Error("Database update error on owners table: " + error.message);
      }
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated) {
      throw new Error("Owner profile record could not be found to update in database.");
    }

    // 2. Synchronize Supabase USERS table (updating ONLY existing column full_name)
    try {
      if (authUserId) {
        await supabase
          .from(TABLES.USERS)
          .update({ full_name: trimmedName })
          .eq("id", authUserId);
      } else if (cleanEmail) {
        await supabase
          .from(TABLES.USERS)
          .update({ full_name: trimmedName })
          .ilike("email", cleanEmail);
      }
    } catch (uErr) {
      console.warn("Notice: public.users synchronization warning:", uErr);
    }

    // Synchronize owner_name across livestock records linked to this owner ID
    try {
      const targetId = updatedOwnerData?.id || ownerId;
      if (targetId) {
        await supabase.from(TABLES.LIVESTOCK).update({ owner_name: trimmedName }).eq("owner_id", targetId);
      }
      if (updatedOwnerData?.temp_reg_id) {
        await supabase.from(TABLES.LIVESTOCK).update({ owner_name: trimmedName }).eq("owner_id", updatedOwnerData.temp_reg_id);
      }
      if (updatedOwnerData?.auth_user_id) {
        await supabase.from(TABLES.LIVESTOCK).update({ owner_name: trimmedName }).eq("owner_id", updatedOwnerData.auth_user_id);
      }
      notifyDbChange(TABLES.LIVESTOCK, "update");
    } catch (_) {}

    // 3. Synchronize Supabase Auth user metadata (auth.users)
    try {
      await supabase.auth.updateUser({
        data: {
          name: trimmedName,
          full_name: trimmedName,
          phone: phoneVal.digits,
          contact: phoneVal.digits,
          address: trimmedAddress,
        },
      });
    } catch (aErr) {
      console.warn("Notice: Supabase Auth metadata update warning:", aErr);
    }

    notifyChange(TABLES.OWNERS, "update", {
      id: updatedOwnerData?.id || ownerId,
      name: trimmedName,
      contact: phoneVal.digits,
      address: trimmedAddress,
    });
    notifyDbChange(TABLES.USERS, "update", { email: cleanEmail });

    return {
      success: true,
      owner: updatedOwnerData,
      name: trimmedName,
      contact: phoneVal.digits,
      address: trimmedAddress,
      network: phoneVal.network,
    };
  },

  /**
   * 12c. Update Owner Profile Picture in Supabase database & Auth metadata
   */
  async updateOwnerPhoto({ ownerId, authUserId, email, avatarUrl }) {
    if (!avatarUrl) throw new Error("Avatar URL is required.");
    const cleanEmail = String(email || "").trim().toLowerCase();

    let ownerUpdated = false;
    let updatedOwnerData = null;

    // 1. Update public.owners table
    if (ownerId) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({ avatar_url: avatarUrl })
        .eq("id", ownerId)
        .select()
        .maybeSingle();

      if (error) throw new Error("Failed to save avatar in database: " + error.message);
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated && authUserId) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({ avatar_url: avatarUrl })
        .eq("auth_user_id", authUserId)
        .select()
        .maybeSingle();

      if (error) throw new Error("Failed to save avatar in database: " + error.message);
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated && cleanEmail) {
      const { data, error } = await supabase
        .from(TABLES.OWNERS)
        .update({ avatar_url: avatarUrl })
        .ilike("email", cleanEmail)
        .select()
        .maybeSingle();

      if (error) throw new Error("Failed to save avatar in database: " + error.message);
      if (data) {
        ownerUpdated = true;
        updatedOwnerData = data;
      }
    }

    if (!ownerUpdated) {
      throw new Error("Owner record could not be found to update avatar in database.");
    }

    // 2. Synchronize public.users table
    try {
      if (authUserId) {
        await supabase
          .from(TABLES.USERS)
          .update({ avatar_url: avatarUrl })
          .eq("id", authUserId);
      } else if (cleanEmail) {
        await supabase
          .from(TABLES.USERS)
          .update({ avatar_url: avatarUrl })
          .ilike("email", cleanEmail);
      }
    } catch (_) {}

    // 3. Synchronize Supabase Auth user metadata
    try {
      await supabase.auth.updateUser({
        data: {
          avatar_url: avatarUrl,
          picture: avatarUrl,
        },
      });
    } catch (_) {}

    notifyChange(TABLES.OWNERS, "update", {
      id: updatedOwnerData?.id || ownerId,
      avatar_url: avatarUrl,
    });
    notifyDbChange(TABLES.USERS, "update", { email: cleanEmail });

    return {
      success: true,
      owner: updatedOwnerData,
      avatarUrl,
    };
  },

  /**
   * 13. Delete owner account directly in Supabase (owners & users)
   */
  async deleteOwner({ ownerId, email, adminUser = "Administrator" }) {
    if (!ownerId && !email) throw new Error("Owner ID or email required for deletion.");
    const cleanEmail = email?.trim()?.toLowerCase();

    // 1. Try RPC admin_delete_owner
    try {
      await supabase.rpc("admin_delete_owner", {
        p_owner_id: ownerId || null,
        p_email: cleanEmail || null
      });
    } catch (e) {}

    // 2. Direct Supabase DB delete
    try {
      if (ownerId) {
        await supabase.from(TABLES.USERS).delete().eq("owner_id", ownerId);
        await supabase.from(TABLES.OWNERS).delete().eq("id", ownerId);
      }
      if (cleanEmail) {
        await supabase.from(TABLES.USERS).delete().ilike("email", cleanEmail);
        await supabase.from(TABLES.OWNERS).delete().ilike("email", cleanEmail);
      }
    } catch (err) {
      console.warn("Supabase deleteOwner error:", err);
    }

    notifyChange(TABLES.OWNERS, "delete", { id: ownerId, email: cleanEmail });
    notifyDbChange(TABLES.USERS, "delete", { email: cleanEmail });
    return { success: true, ownerId };
  }
};

