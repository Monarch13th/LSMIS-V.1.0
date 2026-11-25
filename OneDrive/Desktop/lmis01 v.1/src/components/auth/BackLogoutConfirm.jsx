import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../ui";
import { useAuth } from "../../hooks/useAuth";

export const BackLogoutConfirm = () => {
  const { signOut, isAuthenticated, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const currentUrlRef = useRef(
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : "/"
  );
  const entryIdxRef = useRef(null);
  const confirmOpenRef = useRef(false);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    confirmOpenRef.current = confirmOpen;
  }, [confirmOpen]);

  useEffect(() => {
    currentUrlRef.current = `${location.pathname}${location.search}${location.hash}`;
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!isAuthenticated || !role || typeof window === "undefined") return;

    const currentState = window.history.state || {};
    if (entryIdxRef.current === null) {
      entryIdxRef.current = typeof currentState.idx === "number" ? currentState.idx : 0;
    }

    if (!currentState.lsmisAuthGuard) {
      try {
        window.history.pushState(
          { ...currentState, lsmisAuthGuard: true },
          "",
          currentUrlRef.current
        );
      } catch (_) {}
    }

    const handlePopState = (event) => {
      if (loggingOutRef.current) return;

      const nextPath = (window.location.pathname || "").toLowerCase();
      const isPublicOrExit =
        nextPath === "/" ||
        nextPath === "/login" ||
        nextPath.startsWith("/login") ||
        nextPath.startsWith("/register") ||
        nextPath.startsWith("/forgot-password") ||
        nextPath.startsWith("/reset-password");

      const nextIdx = event?.state?.idx;
      const poppedBeforeEntry =
        typeof nextIdx === "number" &&
        entryIdxRef.current !== null &&
        nextIdx < entryIdxRef.current;
      const poppedPastSentinel =
        !event?.state?.lsmisAuthGuard && typeof nextIdx !== "number";

      const isLeavingApp = isPublicOrExit || poppedBeforeEntry || poppedPastSentinel;
      if (!isLeavingApp) {
        return;
      }

      try {
        window.history.pushState(
          { ...(window.history.state || {}), idx: entryIdxRef.current ?? 0, lsmisAuthGuard: true },
          "",
          currentUrlRef.current
        );
      } catch (_) {}

      if (!confirmOpenRef.current) {
        setConfirmOpen(true);
      }
    };

    const handleHardwareBack = (e) => {
      if (loggingOutRef.current) return;
      if (e && typeof e.preventDefault === "function") {
        e.preventDefault();
      }
      if (!confirmOpenRef.current) {
        setConfirmOpen(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("backbutton", handleHardwareBack);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("backbutton", handleHardwareBack);
    };
  }, [isAuthenticated, role]);

  const handleCancel = useCallback(() => {
    if (loggingOutRef.current) return;
    setConfirmOpen(false);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    try {
      await signOut();
    } catch (_) {
    } finally {
      setConfirmOpen(false);
      setLoggingOut(false);
      navigate("/login", { replace: true });
    }
  }, [signOut, navigate]);

  return (
    <ConfirmDialog
      open={confirmOpen}
      onCancel={handleCancel}
      onConfirm={handleConfirmLogout}
      title="Confirm Logout"
      message="Are you sure you want to log out?"
      cancelText="Cancel"
      confirmText="Logout"
      confirmVariant="danger"
      loading={loggingOut}
      size="sm"
    />
  );
};
