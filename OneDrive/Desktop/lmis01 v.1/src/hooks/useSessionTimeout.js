import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { adminService } from "../services/adminService";
import { authSecurityService } from "../services/authSecurityService";

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
const CHECK_INTERVAL_MS = 5 * 1000; // Check every 5 seconds for rapid single-session enforcement

export const useSessionTimeout = (timeoutMs = INACTIVITY_LIMIT_MS) => {
  const { session, isAuthenticated, signOut, isInitialized, loading } = useAuth();
  const navigate = useNavigate();
  const lastActiveRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(Date.now());

  const recordActivity = useCallback(() => {
    lastActiveRef.current = Date.now();
    try {
      sessionStorage.setItem("lsmis_last_active", String(Date.now()));
    } catch {
      // ignore storage errors
    }
  }, []);

  const isPublicRoute = () => {
    const pathname = typeof window !== "undefined" ? window.location.pathname || "" : "";
    return (
      pathname === "/" ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/reset-password")
    );
  };

  const handleTimeout = useCallback(async () => {
    if (isPublicRoute()) return;
    try {
      await signOut();
    } catch {
      // ignore
    }
    navigate("/login?reason=session_timeout", { replace: true });
  }, [signOut, navigate]);

  const handleTerminationRevocation = useCallback(async (details = {}) => {
    if (isPublicRoute()) return;
    try {
      sessionStorage.removeItem("lsmis_concurrent_logout_notice");
      localStorage.removeItem("lsmis_single_session_signal");
      if (details.reason !== undefined || details.terminatedUntil !== undefined) {
        sessionStorage.setItem(
          "lsmis_termination_notice",
          JSON.stringify({
            reason: details.reason || "",
            terminatedUntil: details.terminatedUntil || null,
          })
        );
      }
      await signOut();
    } catch (_) {}
    navigate("/login?terminated=true", { replace: true });
  }, [signOut, navigate]);

  const handleConcurrentLogout = useCallback(async () => {
    if (isPublicRoute()) return;
    if (sessionStorage.getItem("lsmis_termination_notice")) return;
    try {
      sessionStorage.setItem("lsmis_concurrent_logout_notice", "true");
      await signOut();
    } catch (_) {}
    navigate("/login?reason=concurrent_login", { replace: true });
  }, [signOut, navigate]);

  useEffect(() => {
    // Wait for authentication and session validation to fully finish before making termination decisions
    if (!isInitialized || loading) return;
    if (!isAuthenticated || !session?.email || !session?.session_id) return;
    if (isPublicRoute()) return;

    const userRole = (session.role || "").toLowerCase();
    const cleanEmail = (session.email || "").toLowerCase();
    const currentSessionId = session.session_id || null;
    const sessionLoginTime = session.login_time || session.ts || null;

    recordActivity();

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    const handleEvent = () => {
      recordActivity();
    };

    events.forEach((event) => {
      window.addEventListener(event, handleEvent, { passive: true });
    });

    // Check account termination and single active session across all roles (Admin, Vet, Staff, Owner)
    const checkSecurityStatus = async () => {
      if (isPublicRoute()) return;

      // 1. Check account termination status
      try {
        const rawSignal = localStorage.getItem("lsmis_session_termination_signal");
        if (rawSignal) {
          const sig = JSON.parse(rawSignal);
          if (sig && sig.email && sig.email.toLowerCase() === cleanEmail) {
            handleTerminationRevocation({ reason: sig.reason, terminatedUntil: sig.terminatedUntil });
            return;
          }
        }
      } catch (_) {}

      try {
        const statusCheck = await adminService.checkUserTerminationStatus(cleanEmail);
        if (statusCheck.isTerminated) {
          handleTerminationRevocation({ reason: statusCheck.reason, terminatedUntil: statusCheck.terminatedUntil });
          return;
        }
      } catch (_) {}

      // 2. Check Single Active Session against Supabase as the source of truth
      if (currentSessionId) {
        // Pulse server heartbeat every ~20 seconds to maintain active session presence
        if (Date.now() - lastHeartbeatRef.current >= 20000) {
          lastHeartbeatRef.current = Date.now();
          try {
            const hb = await authSecurityService.heartbeatSession(cleanEmail, currentSessionId);
            if (!hb.isValid && hb.reason === "concurrent_login") {
              handleConcurrentLogout();
              return;
            }
          } catch (_) {}
        }

        try {
          const val = await adminService.validateUserActiveSession(cleanEmail, currentSessionId, userRole, sessionLoginTime);
          if (!val.isValid) {
            if (val.reason === "account_terminated") {
              handleTerminationRevocation();
              return;
            } else if (val.reason === "concurrent_login") {
              // Retry confirmation to guard against transient network glitches or in-flight updates
              const confirmVal = await adminService.validateUserActiveSession(cleanEmail, currentSessionId, userRole, sessionLoginTime);
              if (!confirmVal.isValid && confirmVal.reason === "concurrent_login") {
                const termCheck = await adminService.checkUserTerminationStatus(cleanEmail);
                if (termCheck.isTerminated) {
                  handleTerminationRevocation({ reason: termCheck.reason, terminatedUntil: termCheck.terminatedUntil });
                  return;
                }
                handleConcurrentLogout();
                return;
              }
            }
          }
        } catch (_) {}
      }
    };

    const handleSessionTerminatedEvent = (e) => {
      const detail = e?.detail;
      if (detail && detail.email && detail.email.toLowerCase() === cleanEmail) {
        handleTerminationRevocation({ reason: detail.reason, terminatedUntil: detail.terminatedUntil });
      }
    };

    const handleSingleSessionReplacedEvent = async (e) => {
      const detail = e?.detail;
      if (detail && detail.email && detail.email.toLowerCase() === cleanEmail) {
        if (detail.activeSessionId && detail.activeSessionId !== currentSessionId) {
          const sigTs = detail.timestamp || 0;
          const myLoginTs = sessionLoginTime ? new Date(sessionLoginTime).getTime() : 0;
          // Must be strictly newer than our session
          if (!sigTs || !myLoginTs || (sigTs <= myLoginTs + 3000)) return;

          // Confirm with database as source of truth
          const confirmVal = await adminService.validateUserActiveSession(cleanEmail, currentSessionId, userRole, sessionLoginTime);
          if (!confirmVal.isValid && confirmVal.reason === "concurrent_login") {
            const termCheck = await adminService.checkUserTerminationStatus(cleanEmail);
            if (termCheck.isTerminated) {
              handleTerminationRevocation({ reason: termCheck.reason, terminatedUntil: termCheck.terminatedUntil });
              return;
            }
            handleConcurrentLogout();
          }
        }
      }
    };

    const handleStorageChange = (e) => {
      if (e?.key === "lsmis_single_session_signal" && e.newValue) {
        try {
          const sig = JSON.parse(e.newValue);
          if (sig?.email === cleanEmail && sig?.activeSessionId && sig.activeSessionId !== currentSessionId) {
            const sigTs = sig.timestamp || 0;
            const myLoginTs = sessionLoginTime ? new Date(sessionLoginTime).getTime() : 0;
            // Only trigger check if signal was emitted after our session was created
            if (!sigTs || !myLoginTs || (sigTs <= myLoginTs + 3000)) return;
            checkSecurityStatus();
          }
        } catch (_) {}
      } else if (e?.key === "lsmis_session_termination_signal") {
        checkSecurityStatus();
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (Date.now() - lastHeartbeatRef.current >= 15000) {
          lastHeartbeatRef.current = Date.now();
          authSecurityService.heartbeatSession(cleanEmail, currentSessionId).catch(() => {});
        }
        checkSecurityStatus();
      }
    };

    window.addEventListener("lsmis_session_terminated", handleSessionTerminatedEvent);
    window.addEventListener("lsmis_single_session_replaced", handleSingleSessionReplacedEvent);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("focus", checkSecurityStatus);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    const intervalId = setInterval(() => {
      const now = Date.now();
      const storedLast = Number(sessionStorage.getItem("lsmis_last_active")) || lastActiveRef.current;
      const effectiveLast = Math.max(lastActiveRef.current, storedLast);

      if (now - effectiveLast >= timeoutMs) {
        handleTimeout();
      } else {
        checkSecurityStatus();
      }
    }, CHECK_INTERVAL_MS);

    // Initial check on mount
    checkSecurityStatus();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleEvent);
      });
      window.removeEventListener("lsmis_session_terminated", handleSessionTerminatedEvent);
      window.removeEventListener("lsmis_single_session_replaced", handleSingleSessionReplacedEvent);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("focus", checkSecurityStatus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      clearInterval(intervalId);
    };
  }, [isAuthenticated, session, timeoutMs, recordActivity, handleTimeout, handleTerminationRevocation, handleConcurrentLogout, isInitialized, loading]);
};

