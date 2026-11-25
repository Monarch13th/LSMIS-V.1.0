import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import { adminService } from "../services/adminService";
import { authSecurityService } from "../services/authSecurityService";

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;

export const useSessionTimeout = (timeoutMs = INACTIVITY_LIMIT_MS) => {
  const { session, isAuthenticated, signOut, isInitialized, loading } = useAuth();
  const navigate = useNavigate();
  const lastActiveRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(Date.now());
  const lastSecurityCheckRef = useRef(0);
  const isCheckingRef = useRef(false);

  const recordActivity = useCallback(() => {
    lastActiveRef.current = Date.now();
    try {
      sessionStorage.setItem("lsmis_last_active", String(Date.now()));
    } catch {
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
    if (!isInitialized || loading) return;
    if (!isAuthenticated || !session?.email || !session?.session_id) return;
    if (isPublicRoute()) return;

    const userRole = (session.role || "").toLowerCase();
    const cleanEmail = (session.email || "").toLowerCase();
    const currentSessionId = session.session_id || null;
    const sessionLoginTime = session.login_time || session.ts || null;

    recordActivity();

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click", "input"];
    const handleEvent = () => {
      recordActivity();
    };

    events.forEach((event) => {
      window.addEventListener(event, handleEvent, { passive: true });
    });

    const checkSecurityStatus = async (force = false) => {
      if (isPublicRoute()) return;
      if (isCheckingRef.current) return;
      const now = Date.now();
      if (!force && now - lastSecurityCheckRef.current < 10000) return;
      lastSecurityCheckRef.current = now;
      isCheckingRef.current = true;

      try {
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

        if (currentSessionId) {
          let needsValidation = false;
          if (Date.now() - lastHeartbeatRef.current >= 30000) {
            lastHeartbeatRef.current = Date.now();
            try {
              const hb = await authSecurityService.heartbeatSession(cleanEmail, currentSessionId);
              if (!hb.isValid && hb.reason === "concurrent_login") {
                needsValidation = true;
              }
            } catch (_) {}
          }

          if (needsValidation || force) {
            try {
              const val = await adminService.validateUserActiveSession(cleanEmail, currentSessionId, userRole, sessionLoginTime);
              if (!val.isValid) {
                if (val.reason === "account_terminated") {
                  handleTerminationRevocation();
                  return;
                } else if (val.reason === "concurrent_login") {
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
        }
      } finally {
        isCheckingRef.current = false;
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
          if (!sigTs || !myLoginTs || (sigTs <= myLoginTs + 3000)) return;

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
        recordActivity();
        checkSecurityStatus(false);
      }
    };

    const handleFocus = () => {
      recordActivity();
      checkSecurityStatus(false);
    };

    window.addEventListener("lsmis_session_terminated", handleSessionTerminatedEvent);
    window.addEventListener("lsmis_single_session_replaced", handleSingleSessionReplacedEvent);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("focus", handleFocus);
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
        checkSecurityStatus(false);
      }
    }, CHECK_INTERVAL_MS);

    checkSecurityStatus(true);

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleEvent);
      });
      window.removeEventListener("lsmis_session_terminated", handleSessionTerminatedEvent);
      window.removeEventListener("lsmis_single_session_replaced", handleSingleSessionReplacedEvent);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("focus", handleFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      clearInterval(intervalId);
    };
  }, [isAuthenticated, session?.email, session?.session_id, session?.role, session?.login_time, timeoutMs, recordActivity, handleTimeout, handleTerminationRevocation, handleConcurrentLogout, isInitialized, loading]);
};

