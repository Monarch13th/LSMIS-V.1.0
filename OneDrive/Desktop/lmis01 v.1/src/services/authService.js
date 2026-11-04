import { supabase } from "./supabaseClient";
import { STORAGE_KEYS, TABLES } from "../utils/constants";
import { uuid, now } from "../utils/helpers";
import { logActivity, removeActiveSession } from "./activityService";
import { authSecurityService } from "./authSecurityService";

const SESSION_KEY = STORAGE_KEYS.SESSION;

export const authService = {
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      try {
        logActivity({
          action: `Failed login attempt for ${email} (Reason: ${error.message || "Invalid credentials"})`,
          module: "Auth",
          security_event: "Failed Login",
          severity: "warning",
          user: email,
          role: "unknown",
        });
      } catch (e) {}
      return { data: null, error };
    }
    return { data, error: null };
  },

  async signOut() {
    const session = this.getSession();
    if (session) {
      try {
        const loginTs = session.ts || session.login_time;
        let durationStr = "N/A";
        if (loginTs) {
          const durationMs = Date.now() - (typeof loginTs === "number" ? loginTs : new Date(loginTs).getTime());
          const minutes = Math.floor(durationMs / 60000);
          const seconds = Math.floor((durationMs % 60000) / 1000);
          if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remMins = minutes % 60;
            durationStr = `${hours}h ${remMins}m`;
          } else {
            durationStr = `${minutes}m ${seconds}s`;
          }
        }

        if (session.role !== "admin") {
          await logActivity({
            action: `User logged out (Session Duration: ${durationStr})`,
            module: "Auth",
            user: session.name || session.email || session.username,
            role: session.role || "staff",
            old_value: "Active Session",
            new_value: `Logged Out (${durationStr})`,
            field_changed: "session_state",
          });
        }

        removeActiveSession(session.email);

        // Server-side active session release on logout
        if (session.email) {
          try {
            await authSecurityService.releaseActiveSession(session.email, session.session_id);
          } catch (_) {}
        }
      } catch (err) {
        console.error("Logout logging failed:", err);
      }
    }
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      console.warn("Supabase local signout warning:", e);
    }
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("lsmis_active_session_id");
    localStorage.removeItem("lsmis_active_session_id");
    localStorage.removeItem("lsmis_single_session_signal");
    sessionStorage.removeItem("lsmis_concurrent_logout_notice");
    return { error: null };
  },

  async resetPassword(email) {
    const cleanEmail = (email || "").trim().toLowerCase();
    // 1. Verify if the email is registered in users or owners table
    const { data: users, error: searchError } = await supabase
      .from(TABLES.USERS)
      .select("id")
      .ilike("email", cleanEmail)
      .limit(1);

    if (searchError) {
      console.error("Database user check error:", searchError);
      return { error: searchError };
    }

    let isRegistered = Boolean(users && users.length > 0);
    if (!isRegistered) {
      const { data: owners } = await supabase
        .from(TABLES.OWNERS)
        .select("id")
        .ilike("email", cleanEmail)
        .limit(1);
      isRegistered = Boolean(owners && owners.length > 0);
    }

    if (!isRegistered) {
      return { error: { message: "This email address is not registered in our system." } };
    }

    // 2. Trigger reset link
    const redirectTo = `${window.location.origin}/reset-password`;
    const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
    if (error) {
      console.error("Supabase resetPasswordForEmail error:", error);
      return { error };
    }

    logActivity({
      action: `Password reset requested for ${email}`,
      module: "Auth",
      security_event: "Password Reset",
      severity: "warning",
      user: email,
    });

    return { data: { message: "Password reset link sent to " + email } };
  },

  getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setSession(session) {
    try {
      if (session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      console.warn("authService.setSession error:", e);
    }
  },
};

