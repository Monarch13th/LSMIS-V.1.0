import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../utils/constants";
import { getActiveSessions, terminateSession as termActSession, removeActiveSession } from "./activityService";
import { authSecurityService } from "./authSecurityService";

/**
 * Parses a browser User-Agent string into human-friendly device and browser descriptions.
 */
export const parseUserAgent = (uaStr = null) => {
  const ua = uaStr || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua) {
    return {
      browser: "Web Browser",
      os: "Unknown OS",
      device: "Desktop Computer",
      summary: "Web Browser on Desktop",
    };
  }

  // Detect OS
  let os = "Unknown OS";
  let device = "Desktop Computer";

  if (/Windows NT 10.0/i.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6.3/i.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6.1/i.test(ua)) os = "Windows 7";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) {
    os = "Android";
    device = /Mobile/i.test(ua) ? "Android Phone" : "Android Tablet";
  } else if (/iPhone/i.test(ua)) {
    os = "iOS";
    device = "iPhone";
  } else if (/iPad/i.test(ua)) {
    os = "iPadOS";
    device = "iPad";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
    device = "Mac";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  // Detect Browser
  let browser = "Web Browser";
  const edgeMatch = ua.match(/Edg\/(\d+[\.\d]*)/i);
  const chromeMatch = ua.match(/Chrome\/(\d+[\.\d]*)/i);
  const firefoxMatch = ua.match(/Firefox\/(\d+[\.\d]*)/i);
  const safariMatch = ua.match(/Version\/(\d+[\.\d]*).*Safari/i);
  const operaMatch = ua.match(/OPR\/(\d+[\.\d]*)/i);

  if (edgeMatch) {
    browser = `Microsoft Edge ${edgeMatch[1].split(".")[0]}`;
  } else if (operaMatch) {
    browser = `Opera ${operaMatch[1].split(".")[0]}`;
  } else if (chromeMatch) {
    browser = `Google Chrome ${chromeMatch[1].split(".")[0]}`;
  } else if (firefoxMatch) {
    browser = `Mozilla Firefox ${firefoxMatch[1].split(".")[0]}`;
  } else if (safariMatch) {
    browser = `Apple Safari ${safariMatch[1].split(".")[0]}`;
  }

  return {
    browser,
    os,
    device,
    summary: `${browser} on ${os} (${device})`,
  };
};

export const sessionManagementService = {
  /**
   * Get the current active session ID for this browser tab.
   */
  getCurrentSessionId() {
    if (typeof window === "undefined") return null;
    try {
      return (
        sessionStorage.getItem("lsmis_active_session_id") ||
        sessionStorage.getItem("lsmis_pending_session_id") ||
        localStorage.getItem("lsmis_client_session_id") ||
        null
      );
    } catch {
      return null;
    }
  },

  /**
   * Load all active sessions registered for a given user email or current session.
   */
  async getUserActiveSessions(userEmail) {
    const cleanEmail = (userEmail || "").trim().toLowerCase();
    const currentSessionId = this.getCurrentSessionId();
    const currentDevice = parseUserAgent();

    try {
      const allActive = getActiveSessions() || [];
      const userSessions = allActive.filter(
        (s) => (s.email || "").toLowerCase().trim() === cleanEmail && s.status !== "Terminated"
      );

      // If current session isn't in the list, synthesize it
      const hasCurrent = userSessions.some((s) => s.id === currentSessionId || s.session_id === currentSessionId);
      if (!hasCurrent && currentSessionId) {
        userSessions.unshift({
          id: currentSessionId,
          session_id: currentSessionId,
          email: cleanEmail,
          device: currentDevice.summary,
          browser: currentDevice.browser,
          os: currentDevice.os,
          login_time: new Date().toISOString(),
          last_active: new Date().toISOString(),
          status: "Active",
          is_current: true,
        });
      }

      // Mark current session flag and format device info
      return userSessions.map((s) => {
        const isCurrent = s.id === currentSessionId || s.session_id === currentSessionId;
        const devInfo = s.device ? { summary: s.device, browser: s.browser || "Browser" } : parseUserAgent();
        return {
          ...s,
          is_current: isCurrent,
          device_summary: isCurrent ? `${currentDevice.summary}` : (s.device || devInfo.summary),
          browser: isCurrent ? currentDevice.browser : (s.browser || devInfo.browser),
          os: isCurrent ? currentDevice.os : (s.os || devInfo.os),
          login_time_formatted: s.login_time ? new Date(s.login_time).toLocaleString() : "Active Now",
          last_active_formatted: s.last_active ? new Date(s.last_active).toLocaleTimeString() : "Just now",
        };
      });
    } catch (err) {
      console.warn("getUserActiveSessions error:", err);
      return [
        {
          id: currentSessionId || "current",
          session_id: currentSessionId || "current",
          email: cleanEmail,
          device_summary: currentDevice.summary,
          browser: currentDevice.browser,
          os: currentDevice.os,
          login_time_formatted: "Current Session",
          last_active_formatted: "Just now",
          status: "Active",
          is_current: true,
        },
      ];
    }
  },

  /**
   * Terminate all other sessions across other devices/browsers.
   * Uses Supabase Auth's native signOut scope: 'others' so other refresh tokens are invalidated immediately.
   */
  async terminateOtherSessions(userEmail) {
    const cleanEmail = (userEmail || "").trim().toLowerCase();
    const currentSessionId = this.getCurrentSessionId();

    try {
      // 1. Invalidate tokens on other devices via Supabase Auth
      await supabase.auth.signOut({ scope: "others" });
    } catch (err) {
      console.warn("supabase.auth.signOut(others) warning:", err);
    }

    try {
      // 2. Clean up server-side active session record if mismatched
      if (cleanEmail && currentSessionId) {
        await authSecurityService.registerActiveSession(cleanEmail, currentSessionId, currentSessionId);
      }
    } catch (_) {}

    try {
      // 3. Update activity service sessions
      const all = getActiveSessions() || [];
      for (const s of all) {
        if ((s.email || "").toLowerCase().trim() === cleanEmail && s.id !== currentSessionId) {
          await termActSession(s.id, "Account Owner", { reason: "User requested termination of other sessions" });
        }
      }
    } catch (_) {}

    return { success: true };
  },

  /**
   * Terminate a specific active session.
   */
  async terminateSpecificSession(sessionId, userEmail) {
    const currentSessionId = this.getCurrentSessionId();

    if (sessionId === currentSessionId) {
      // User is terminating current session -> perform standard sign out
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (_) {}
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEYS.SESSION);
        window.location.href = "/login";
      }
      return { success: true };
    }

    try {
      await supabase.auth.signOut({ scope: "others" });
    } catch (_) {}

    try {
      await termActSession(sessionId, "Account Owner", { reason: "User terminated session from Settings" });
    } catch (_) {}

    return { success: true };
  },
};
