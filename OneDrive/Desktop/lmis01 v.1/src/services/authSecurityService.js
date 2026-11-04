import { supabase } from "./supabaseClient.js";

const CLIENT_SESSION_STORAGE_KEY = "lsmis_client_session_id";

export const authSecurityService = {
  /**
   * Get or initialize a unique client identifier for this browser instance.
   * Stored in localStorage to recognize the same browser across tab reloads/reopens.
   */
  getClientSessionId() {
    if (typeof window === "undefined") return null;
    try {
      let id = localStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `cs_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, id);
      }
      return id;
    } catch {
      return null;
    }
  },

  setClientSessionId(sessionId) {
    if (typeof window === "undefined") return;
    try {
      if (sessionId) {
        localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, sessionId);
      } else {
        localStorage.removeItem(CLIENT_SESSION_STORAGE_KEY);
      }
    } catch {}
  },

  /**
   * Format lockout duration into a user-friendly string.
   * e.g., "4 hours", "3 hours and 45 minutes", "25 minutes", or "less than a minute"
   */
  formatLockoutTime(seconds) {
    const sec = Math.max(0, Math.ceil(Number(seconds) || 0));
    if (sec <= 0) return "a moment";

    const hours = Math.floor(sec / 3600);
    const minutes = Math.ceil((sec % 3600) / 60);

    if (hours > 0 && minutes > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""} and ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""}`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    return "less than a minute";
  },

  /**
   * Server-side check if the account is currently locked due to failed attempts.
   */
  async checkAccountLockout(email) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) {
      return { isLocked: false, remaining_seconds: 0, attempts: 0 };
    }

    try {
      const { data, error } = await supabase.rpc("check_account_lockout", {
        p_email: cleanEmail,
      });

      if (error) {
        console.warn("check_account_lockout RPC error:", error);
        return { isLocked: false, remaining_seconds: 0, attempts: 0 };
      }

      return {
        isLocked: Boolean(data?.is_locked),
        remaining_seconds: Number(data?.remaining_seconds || 0),
        locked_until: data?.locked_until || null,
        attempts: Number(data?.attempts || 0),
      };
    } catch (err) {
      console.warn("checkAccountLockout exception:", err);
      return { isLocked: false, remaining_seconds: 0, attempts: 0 };
    }
  },

  /**
   * Record a failed login attempt on the server.
   * Locks account for 4 hours upon reaching 5 failed attempts.
   */
  async recordFailedLogin(email) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) {
      return { isLocked: false, remaining_attempts: 4, remaining_seconds: 0, attempts: 1 };
    }

    try {
      const { data, error } = await supabase.rpc("record_failed_login", {
        p_email: cleanEmail,
      });

      if (error) {
        console.warn("record_failed_login RPC error:", error);
        return { isLocked: false, remaining_attempts: 4, remaining_seconds: 0, attempts: 1 };
      }

      return {
        isLocked: Boolean(data?.is_locked),
        remaining_attempts: Number(data?.remaining_attempts ?? 0),
        remaining_seconds: Number(data?.remaining_seconds || 0),
        locked_until: data?.locked_until || null,
        attempts: Number(data?.attempts || 0),
      };
    } catch (err) {
      console.warn("recordFailedLogin exception:", err);
      return { isLocked: false, remaining_attempts: 4, remaining_seconds: 0, attempts: 1 };
    }
  },

  /**
   * Server-side check if the account is already active on another device or browser.
   */
  async checkActiveSession(email, clientSessionId = null) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) {
      return { is_active_elsewhere: false };
    }

    const effectiveClientId = clientSessionId || this.getClientSessionId() || null;

    try {
      const { data, error } = await supabase.rpc("check_active_session", {
        p_email: cleanEmail,
        p_client_session_id: effectiveClientId,
      });

      if (error) {
        console.warn("check_active_session RPC error:", error);
        return { is_active_elsewhere: false };
      }

      return {
        is_active_elsewhere: Boolean(data?.is_active_elsewhere),
        message: data?.message || "This account is currently being used on another device. Please try again later.",
      };
    } catch (err) {
      console.warn("checkActiveSession exception:", err);
      return { is_active_elsewhere: false };
    }
  },

  /**
   * Server-side registration of the active session on successful login.
   * Resets failed login attempts and sets active_session_id.
   * Rejects if account is already logged in on another device.
   */
  async registerActiveSession(email, sessionId, clientSessionId = null) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail || !sessionId) {
      return { success: false, error: "Missing email or sessionId" };
    }

    const effectiveClientId = clientSessionId || this.getClientSessionId() || null;

    try {
      const { data, error } = await supabase.rpc("register_active_session_secure", {
        p_email: cleanEmail,
        p_session_id: sessionId,
        p_client_session_id: effectiveClientId,
      });

      if (error) {
        console.warn("register_active_session_secure RPC error:", error);
        return { success: false, error: error.message };
      }

      if (data?.success) {
        this.setClientSessionId(sessionId);
      }

      return {
        success: Boolean(data?.success),
        is_active_elsewhere: Boolean(data?.is_active_elsewhere),
        message: data?.message || "This account is currently being used on another device. Please try again later.",
        is_locked: Boolean(data?.is_locked),
        remaining_seconds: Number(data?.remaining_seconds || 0),
        session_id: data?.session_id || sessionId,
        updated_at: data?.updated_at || new Date().toISOString(),
      };
    } catch (err) {
      console.warn("registerActiveSession exception:", err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Heartbeat to keep active_session_updated_at fresh while user is active.
   */
  async heartbeatSession(email, sessionId) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail || !sessionId) return { isValid: true };

    try {
      const { data, error } = await supabase.rpc("heartbeat_session", {
        p_email: cleanEmail,
        p_session_id: sessionId,
      });

      if (error) {
        console.warn("heartbeat_session RPC error (preserving session):", error);
        return { isValid: true };
      }

      return {
        isValid: Boolean(data?.is_valid),
        reason: data?.reason || null,
        updated_at: data?.updated_at || null,
      };
    } catch (err) {
      console.warn("heartbeatSession exception (preserving session):", err);
      return { isValid: true };
    }
  },

  /**
   * Server-side release of the active session on logout.
   */
  async releaseActiveSession(email, sessionId = null) {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) return { success: true };

    try {
      const { data, error } = await supabase.rpc("release_active_session", {
        p_email: cleanEmail,
        p_session_id: sessionId,
      });

      this.setClientSessionId(null);

      if (error) {
        console.warn("release_active_session RPC error:", error);
        return { success: false };
      }

      return { success: Boolean(data?.success) };
    } catch (err) {
      console.warn("releaseActiveSession exception:", err);
      return { success: false };
    }
  },
};
