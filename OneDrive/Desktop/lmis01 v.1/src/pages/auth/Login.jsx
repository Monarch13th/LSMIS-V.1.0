import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Modal, AlertDialog } from "../../components/ui/Modal";
import { Icon } from "../../components/icons";
import { isCapacitorNativeApp, isInstalledApp } from "../../utils/capacitor";
import { useToast } from "../../components/notifications/Toast";
import { PasswordRequirements } from "../../components/ui/PasswordRequirements";
import { authStore } from "../../store/authStore";
import { STORAGE_KEYS, TABLES, ROLE_LABELS } from "../../utils/constants";
import { now, uuid } from "../../utils/helpers";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";
import { logActivity, registerLoginSession } from "../../services/activityService";
import { ownerAuthService } from "../../services/ownerAuthService";
import { supabase, initialOAuthCallback } from "../../services/supabaseClient";
import { adminService } from "../../services/adminService";
import { authSecurityService } from "../../services/authSecurityService";
import { mfaService } from "../../services/mfaService";
import { useAuth } from "../../hooks/useAuth";
import { scrollToFirstError } from "../../utils/formValidation";
import logoImg from "../../assets/logo.jpg";

// Official Google 4-Color "G" Brand Logo
const GoogleLogo = ({ size = 19 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0 }}
  >
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

export const Login = ({ embedded = false, initialView }) => {
  const [view, setView] = useState(() => {
    if (initialView) return initialView;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (
        searchParams.get("oauth_intent") === "register" ||
        searchParams.get("view") === "register" ||
        window.location.pathname === "/register" ||
        sessionStorage.getItem("lsmis_google_oauth_intent") === "register" ||
        sessionStorage.getItem("lsmis_google_reg_pending")
      ) {
        return "register";
      }
    } catch (_) { }
    return "signin";
  }); // "signin" | "forgot" | "register" | "verify-otp" | "reg-submitted"
  const [email, setEmail] = useState(() => localStorage.getItem("lsmis_saved_identifier") || "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Installed Capacitor Android app: Google sign-in is hidden (website-only)
  const isNativeAndroidApp = isCapacitorNativeApp();
  // Installed mobile application detection (Capacitor Android APK or installed standalone PWA)
  const isInstalled = isInstalledApp();

  // Smooth, professional opening animation when launching the installed mobile application
  const [showLaunchSplash, setShowLaunchSplash] = useState(() => {
    if (!isInstalled) return false;
    try {
      if (sessionStorage.getItem("lsmis_launch_splash_seen") === "true") {
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  });
  const [splashFadingOut, setSplashFadingOut] = useState(false);

  useEffect(() => {
    if (!showLaunchSplash) return;
    const holdTimer = setTimeout(() => {
      setSplashFadingOut(true);
    }, 1100);

    const endTimer = setTimeout(() => {
      setShowLaunchSplash(false);
      try {
        sessionStorage.setItem("lsmis_launch_splash_seen", "true");
      } catch (_) {}
    }, 1450);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(endTimer);
    };
  }, [showLaunchSplash]);

  // Lock history in installed mobile app so back action does not navigate to landing page
  useEffect(() => {
    if (isInstalled) {
      try {
        if (window.location.pathname === "/login") {
          window.history.replaceState(null, "", "/login");
        }
      } catch (_) {}
    }
  }, [isInstalled]);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("lsmis_remember_me") === "true");
  const [isShaking, setIsShaking] = useState(false);

  // Google OAuth state (Owner Login only)
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
  const oauthHandledRef = useRef(false);
  const signInInFlightRef = useRef(false);
  const inFlightOAuthRef = useRef(false);
  const popupRef = useRef(null);
  const popupPollTimerRef = useRef(null);

  // Unregistered Google Account Warning Modal State
  const [unregisteredModalOpen, setUnregisteredModalOpen] = useState(false);
  const [unregisteredGoogleEmail, setUnregisteredGoogleEmail] = useState("");

  // Account Termination Popup Notice State
  const [terminationNotice, setTerminationNotice] = useState({ open: false, reason: "", terminatedUntil: null });

  // Single Active Session Concurrent Logout Notice State
  const [concurrentNoticeOpen, setConcurrentNoticeOpen] = useState(false);

  // Owner Registration state
  const [regName, setRegName] = useState("");
  const [regContact, setRegContact] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regAgreement, setRegAgreement] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegCpwd, setShowRegCpwd] = useState(false);
  const [regError, setRegError] = useState("");
  const [regFieldErrors, setRegFieldErrors] = useState({});
  const [regShake, setRegShake] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);

  const [registeredOwnerInfo, setRegisteredOwnerInfo] = useState(null);

  // Forgot password state
  const [fpStep, setFpStep] = useState(1); // 1: Send Code, 2: Reset Password
  const [fpEmail, setFpEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingSend, setLoadingSend] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [showFpPwd, setShowFpPwd] = useState(false);
  const [showFpCpwd, setShowFpCpwd] = useState(false);
  const [fpCooldown, setFpCooldown] = useState(0);
  const [fpCodeSent, setFpCodeSent] = useState(false);
  const [fpError, setFpError] = useState("");
  const [showFpRequirements, setShowFpRequirements] = useState(false);
  const [fpSuccess, setFpSuccess] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);

  // Two-Factor Authentication (2FA) Verification State
  const [pending2FA, setPending2FA] = useState(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaCooldown, setTwoFaCooldown] = useState(0);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const twoFaInputRef = useRef(null);

  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { session: currentSession, role: currentRole, loading: authLoading } = useAuth();

  // Sync view when route changes between /login and /register
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (
      initialView === "register" ||
      location.pathname === "/register" ||
      searchParams.get("view") === "register" ||
      location.state?.view === "register"
    ) {
      setView("register");
    } else if (
      location.pathname === "/login" &&
      !searchParams.get("oauth_intent") &&
      !sessionStorage.getItem("lsmis_google_oauth_intent") &&
      !sessionStorage.getItem("lsmis_google_reg_pending") &&
      view === "register" &&
      !initialView
    ) {
      setView("signin");
    }
  }, [initialView, location.pathname, location.search, location.state]);

  // If already authenticated with active role, redirect directly to assigned module
  useEffect(() => {
    // Prevent premature redirection while Google OAuth handshake is running or URL contains OAuth tokens
    const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
    const search = typeof window !== "undefined" ? window.location.search || "" : "";
    const isOAuthInFlight =
      Boolean(initialOAuthCallback?.hasOAuthTokens) ||
      hash.includes("access_token=") ||
      search.includes("code=") ||
      search.includes("oauth_intent=") ||
      Boolean(sessionStorage.getItem("lsmis_google_oauth_in_flight")) ||
      Boolean(sessionStorage.getItem("lsmis_google_reg_pending")) ||
      Boolean(inFlightOAuthRef.current);

    if (isOAuthInFlight) {
      return;
    }

    if (!embedded && !authLoading && currentSession && currentRole) {
      const prevPath = location.state?.from?.pathname;
      if (prevPath && prevPath.startsWith(`/${currentRole}`)) {
        navigate(prevPath, { replace: true });
      } else {
        navigate(`/${currentRole}`, { replace: true });
      }
    }
  }, [embedded, authLoading, currentSession, currentRole, navigate, location.state]);

  const emailRef = useRef(null);
  const fpEmailRef = useRef(null);
  const fpCodeRef = useRef(null);
  const regNameRef = useRef(null);
  const regContactRef = useRef(null);
  const regUsernameRef = useRef(null);
  const regAddressRef = useRef(null);
  const regEmailRef = useRef(null);
  const regPasswordRef = useRef(null);
  const regConfirmPasswordRef = useRef(null);
  const regAgreementRef = useRef(null);

  // Autofocus logic
  useEffect(() => {
    const timer = setTimeout(() => {
      if (view === "signin") emailRef.current?.focus();
      else if (view === "register") regNameRef.current?.focus();
      else if (view === "verify-otp") twoFaInputRef.current?.focus();
      else if (view === "forgot") {
        if (fpCodeSent) fpCodeRef.current?.focus();
        else fpEmailRef.current?.focus();
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [view, fpCodeSent]);

  // 2FA OTP resend cooldown timer
  useEffect(() => {
    let interval = null;
    if (twoFaCooldown > 0) {
      interval = setInterval(() => {
        setTwoFaCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [twoFaCooldown]);

  // Forgot password OTP resend cooldown timer
  useEffect(() => {
    let interval = null;
    if (fpCooldown > 0) {
      interval = setInterval(() => {
        setFpCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [fpCooldown]);

  useEffect(() => {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    if (
      hash.includes("type=recovery") ||
      search.includes("type=recovery")
    ) {
      navigate("/reset-password", { replace: true });
    }
  }, [navigate]);

  // ---- OAuth Popup Window Detection (Runs if Login page is loaded inside the popup) ----
  useEffect(() => {
    if (typeof window === "undefined" || !window.opener || window.opener === window) return;

    try {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

      const oauthError = searchParams.get("error") || hashParams.get("error");
      const oauthErrorDesc = searchParams.get("error_description") || hashParams.get("error_description");

      if (oauthError || oauthErrorDesc) {
        const isCancelled =
          oauthError === "access_denied" ||
          oauthError === "cancelled" ||
          String(oauthErrorDesc || "").toLowerCase().includes("cancel") ||
          String(oauthErrorDesc || "").toLowerCase().includes("denied");

        try {
          window.opener.postMessage(
            {
              type: isCancelled ? "LSMIS_GOOGLE_OAUTH_CANCELLED" : "LSMIS_GOOGLE_OAUTH_ERROR",
              error: oauthError,
              errorDescription: oauthErrorDesc,
              message: isCancelled ? "Google sign-in was cancelled." : (oauthErrorDesc || oauthError || "Google authentication failed."),
            },
            window.location.origin
          );
        } catch (_) { }
        setTimeout(() => {
          try { window.close(); } catch (_) { }
        }, 50);
        return;
      }

      const hasAuthCode = Boolean(searchParams.get("code"));
      const hasAccessToken = Boolean(hashParams.get("access_token"));

      if (hasAuthCode || hasAccessToken) {
        try {
          window.opener.postMessage(
            {
              type: "LSMIS_GOOGLE_OAUTH_CALLBACK",
              status: "success",
              url: window.location.href,
              search: window.location.search,
              hash: window.location.hash,
            },
            window.location.origin
          );
        } catch (_) { }
        setTimeout(() => {
          try { window.close(); } catch (_) { }
        }, 80);
      }
    } catch (_) { }
  }, []);

  // ---- Handle PostMessages from OAuth Popup in Main Window ----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOAuthMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "LSMIS_GOOGLE_OAUTH_CANCELLED") {
        if (popupPollTimerRef.current) {
          clearInterval(popupPollTimerRef.current);
          popupPollTimerRef.current = null;
        }
        popupRef.current = null;
        inFlightOAuthRef.current = false;
        ownerAuthService.cleanGoogleOAuthState();
        setGoogleLoginLoading(false);
        // Quietly reset loading on cancellation without displaying an error alert
      } else if (msg.type === "LSMIS_GOOGLE_OAUTH_ERROR") {
        if (popupPollTimerRef.current) {
          clearInterval(popupPollTimerRef.current);
          popupPollTimerRef.current = null;
        }
        popupRef.current = null;
        inFlightOAuthRef.current = false;
        ownerAuthService.cleanGoogleOAuthState();
        setGoogleLoginLoading(false);

        const errMsg = msg.message || "Google authentication failed. Please try again.";
        setError(errMsg);
      } else if (msg.type === "LSMIS_GOOGLE_OAUTH_CALLBACK" && msg.status === "success") {
        if (popupPollTimerRef.current) {
          clearInterval(popupPollTimerRef.current);
          popupPollTimerRef.current = null;
        }
        popupRef.current = null;
        inFlightOAuthRef.current = false;
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, []);

  // ---- Detect Return from External Navigation / Browser Back Button (bfcache) ----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkOAuthReturnWithoutTokens = async () => {
      if (oauthHandledRef.current) return;
      const inFlightTs = sessionStorage.getItem("lsmis_google_oauth_in_flight");
      if (!inFlightTs) return;

      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

      const hasOAuthTokens =
        Boolean(initialOAuthCallback?.hasOAuthTokens) ||
        Boolean(hashParams.get("access_token")) ||
        Boolean(searchParams.get("code")) ||
        Boolean(searchParams.get("error")) ||
        Boolean(hashParams.get("error"));

      if (hasOAuthTokens) return;

      // Check whether Supabase already exchanged the URL token into an active session
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user || oauthHandledRef.current) return;
      } catch (_) {}

      // Ignore if OAuth was just initiated within the last 1.5s (redirect still starting)
      if (Date.now() - Number(inFlightTs) < 1500) return;

      // User navigated back / cancelled without completing OAuth
      ownerAuthService.cleanGoogleOAuthState();
      inFlightOAuthRef.current = false;
      if (popupPollTimerRef.current) {
        clearInterval(popupPollTimerRef.current);
        popupPollTimerRef.current = null;
      }
      popupRef.current = null;
      setGoogleLoginLoading(false);
    };

    const handlePageShow = () => {
      checkOAuthReturnWithoutTokens();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !popupRef.current) {
        checkOAuthReturnWithoutTokens();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [view]);

  // ---- Google OAuth Callback Handler (Owner Login & Owner Create Account) ----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

    const oauthError = searchParams.get("error") || hashParams.get("error");
    const oauthErrorDesc = searchParams.get("error_description") || hashParams.get("error_description");
    const urlIntent = searchParams.get("oauth_intent");
    const storedIntent = ownerAuthService.getGoogleOAuthIntent();
    const hasUrlTokens =
      Boolean(initialOAuthCallback?.hasOAuthTokens) ||
      Boolean(hashParams.get("access_token")) ||
      Boolean(searchParams.get("code"));

    // 1. Handle OAuth provider error / user cancellation
    if (oauthError || oauthErrorDesc) {
      const isCancellation =
        oauthError === "access_denied" ||
        oauthError === "cancelled" ||
        String(oauthErrorDesc || "").toLowerCase().includes("cancel") ||
        String(oauthErrorDesc || "").toLowerCase().includes("denied");

      ownerAuthService.cleanGoogleOAuthState();
      inFlightOAuthRef.current = false;
      if (popupPollTimerRef.current) {
        clearInterval(popupPollTimerRef.current);
        popupPollTimerRef.current = null;
      }
      popupRef.current = null;

      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      setGoogleLoginLoading(false);

      if (isCancellation) {
        // Quietly reset loading on cancellation without displaying an error alert
        return;
      }

      const cleanMsg = decodeURIComponent(String(oauthErrorDesc || oauthError || "Google authentication failed. Please try again.")).replace(/\+/g, " ");

      setView("signin");
      setError(cleanMsg);
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      return;
    }

    // Process Google OAuth redirect flow when URL contains tokens OR an OAuth handshake is in-flight
    const isGoogleInFlight =
      hasUrlTokens ||
      Boolean(urlIntent) ||
      Boolean(storedIntent);

    if (!isGoogleInFlight) {
      return;
    }

    setView("signin");
    setGoogleLoginLoading(true);
    setError("");

    let isCancelled = false;

    const finalizeGoogleOAuth = async (sbSession) => {
      if (isCancelled || oauthHandledRef.current) return;
      if (!sbSession?.user) return;
      oauthHandledRef.current = true;
      inFlightOAuthRef.current = false;
      if (initialOAuthCallback) {
        initialOAuthCallback.hasOAuthTokens = false;
      }

      if (popupPollTimerRef.current) {
        clearInterval(popupPollTimerRef.current);
        popupPollTimerRef.current = null;
      }
      popupRef.current = null;

      ownerAuthService.cleanGoogleOAuthState();
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Google Login via Google OAuth (Owner and Personnel)
      try {
        const result = await ownerAuthService.verifyAndConnectGoogleLogin(sbSession.user);
        if (isCancelled) return;

        const cleanEmail = result.googleData.email;
        const role = result.role;
        const name = result.name;
        const username = result.username;
        const ownerId = result.ownerId;
        const userId = result.userId;
        const avatarUrl = result.avatarUrl;
        const googleId = result.googleData.googleId;

        // Cover gradient
        let cover_gradient = null;
        try {
          const storedProfile = localStorage.getItem("lmis_profile_" + cleanEmail);
          if (storedProfile) {
            cover_gradient = JSON.parse(storedProfile).cover_gradient;
          }
        } catch (_) { }

        // Register Single Active Session
        const clientSessionId = authSecurityService.getClientSessionId();
        let activeSessionId = clientSessionId || uuid();
        let activeSessionUpdatedAt = new Date().toISOString();

        try {
          const secRes = await authSecurityService.registerActiveSession(cleanEmail, activeSessionId, clientSessionId);
          if (secRes?.is_active_elsewhere) {
            try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
            setGoogleLoginLoading(false);
            inFlightOAuthRef.current = false;
            ownerAuthService.cleanGoogleOAuthState();
            setError("This account is currently being used on another device. Please try again later.");
            setIsShaking(true);
            setTimeout(() => setIsShaking(false), 500);
            return;
          }
          if (secRes?.session_id) activeSessionId = secRes.session_id;
          if (secRes?.updated_at) activeSessionUpdatedAt = secRes.updated_at;
        } catch (e) {
          console.warn("Google login registerActiveSession notice:", e);
        }

        authSecurityService.setClientSessionId(activeSessionId);
        try {
          sessionStorage.setItem("lsmis_active_session_id", activeSessionId);
        } catch (_) {}

        const loginTimeIso = activeSessionUpdatedAt || new Date().toISOString();
        const session = {
          id: userId,
          user_id: userId,
          role,
          name,
          email: cleanEmail,
          username: username || cleanEmail.split("@")[0],
          owner_id: ownerId,
          google_id: googleId,
          avatar_url: avatarUrl,
          auth_provider: "google",
          session_id: activeSessionId,
          ts: Date.now(),
          login_time: loginTimeIso,
          cover_gradient,
          ...(sbSession || {}),
        };

        // Check if Two-Factor Authentication (2FA) is enabled for this account via Supabase Auth MFA
        let mfaRequired = false;
        let targetFactor = null;
        let challengeId = null;

        try {
          const { verifiedFactor, factors } = await mfaService.listFactors();
          const aal = await mfaService.getAssuranceLevel();
          const isLocal2faEnabled = localStorage.getItem("lmis_2fa_enabled_" + cleanEmail) === "true";
          const isMetadata2faEnabled = Boolean(sbSession?.user?.user_metadata?.two_factor_enabled);

          const activeFactor =
            verifiedFactor ||
            factors?.find((f) => f.status === "verified") ||
            ((isLocal2faEnabled || isMetadata2faEnabled) ? factors?.[0] : null);

          if (activeFactor || aal?.nextLevel === "aal2" || isLocal2faEnabled || isMetadata2faEnabled) {
            mfaRequired = true;
            targetFactor = activeFactor;
            if (targetFactor?.id) {
              const { data: chData } = await mfaService.createChallenge({ factorId: targetFactor.id });
              if (chData?.id) challengeId = chData.id;
            }
          }
        } catch (mfaChkErr) {
          console.warn("Google login MFA check notice:", mfaChkErr);
        }

        if (mfaRequired && targetFactor) {
          setPending2FA({
            session,
            role,
            name,
            cleanEmail,
            userId,
            factorId: targetFactor.id,
            challengeId,
          });

          setTwoFaCode("");
          setTwoFaError("");
          setGoogleLoginLoading(false);
          setView("verify-otp");
          showToast(`Authenticator security code required for ${cleanEmail}`, "info");
          return;
        }

        sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
        authStore.set({ session, loading: false, isInitialized: true });
        setGoogleLoginLoading(false);

        try {
          supabase.from(TABLES.USERS).update({ last_login: now() }).ilike("email", cleanEmail).then();
          registerLoginSession({ name, email: cleanEmail, role, module: "Dashboard", loginTime: loginTimeIso });
          logActivity({
            action: `User logged in via Google OAuth (${name} - ${role})`,
            module: "Auth",
            user: name,
            role,
            old_value: "Offline",
            new_value: "Active Session (Google OAuth)",
            field_changed: "session_state",
          }).then();
        } catch (_) { }

        showToast(`Welcome back, ${name}!`, "success");
        const prevPath = location.state?.from?.pathname;
        if (prevPath && prevPath.startsWith(`/${role}`)) {
          navigate(prevPath, { replace: true });
        } else {
          navigate(`/${role}`, { replace: true });
        }
      } catch (err) {
        if (isCancelled) return;
        setGoogleLoginLoading(false);
        inFlightOAuthRef.current = false;
        try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}

        // Make sure any temporary or mismatched session in authStore/sessionStorage is purged
        try {
          sessionStorage.removeItem(STORAGE_KEYS.SESSION);
        } catch (_) {}
        authStore.set({ session: null, loading: false, isInitialized: true });

        setView("signin");

        if (err.code === "ACCOUNT_PENDING") {
          setError("Your account is awaiting Admin approval.");
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          return;
        }

        if (err.code === "ACCOUNT_NOT_REGISTERED" || err.message?.includes("is not registered")) {
          setError("This Google account is not registered in the system. Please use your registered account.");
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          setUnregisteredGoogleEmail(err.email || "");
          setUnregisteredModalOpen(false);
          return;
        }

        if (err.code === "ACCOUNT_REJECTED") {
          setError(err.message || "Your account has been rejected by the administrator.");
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          return;
        }

        if (err.code === "ACCOUNT_DEACTIVATED") {
          setError(err.message || "Your account is deactivated. Please contact support.");
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          return;
        }

        const msg = err.message || "Google authentication failed. Please try again.";
        setError(msg);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      }
    };

    // Attempt immediate session resolution or listen for Supabase OAuth exchange completion
    let authSub = null;
    let cancelFallbackTimer = null;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          await finalizeGoogleOAuth(data.session);
          return;
        }
      } catch (_) { }

      const { data: subData } = supabase.auth.onAuthStateChange(async (event, sbSession) => {
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && sbSession?.user) {
          await finalizeGoogleOAuth(sbSession);
        }
      });
      authSub = subData?.subscription;

      // Safety fallback: if no session resolves (e.g. user clicked Back from Google screen),
      // clean up loading state so the button never stays stuck
      cancelFallbackTimer = setTimeout(async () => {
        if (isCancelled || oauthHandledRef.current) return;
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user) {
            await finalizeGoogleOAuth(data.session);
            return;
          }
        } catch (_) {}
        if (!oauthHandledRef.current) {
          ownerAuthService.cleanGoogleOAuthState();
          inFlightOAuthRef.current = false;
          setGoogleLoginLoading(false);
        }
      }, 4000);
    })();

    return () => {
      isCancelled = true;
      if (cancelFallbackTimer) clearTimeout(cancelFallbackTimer);
      try {
        authSub?.unsubscribe();
      } catch (_) { }
    };
  }, [navigate, location.state, showToast]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const isTerminatedQuery = searchParams.get("terminated") === "true";
    const isConcurrentQuery = searchParams.get("reason") === "concurrent_login";
    const rawNotice = sessionStorage.getItem("lsmis_termination_notice");
    const hasConcurrentFlag = sessionStorage.getItem("lsmis_concurrent_logout_notice") === "true";

    // Clean URL query parameters immediately so that refreshing or navigating never re-triggers the modals
    if (
      isTerminatedQuery ||
      isConcurrentQuery ||
      searchParams.has("reason") ||
      searchParams.has("terminated") ||
      searchParams.has("timeout")
    ) {
      if (typeof window !== "undefined" && window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    if (isTerminatedQuery || rawNotice) {
      sessionStorage.removeItem("lsmis_concurrent_logout_notice");
      setConcurrentNoticeOpen(false);
      let reason = "";
      let terminatedUntil = null;
      if (rawNotice) {
        try {
          const parsed = JSON.parse(rawNotice);
          reason = parsed.reason || "";
          terminatedUntil = parsed.terminatedUntil || null;
        } catch (_) { }
      }
      setTerminationNotice({
        open: true,
        reason,
        terminatedUntil,
      });
    } else if (hasConcurrentFlag || isConcurrentQuery) {
      sessionStorage.removeItem("lsmis_concurrent_logout_notice");
      setConcurrentNoticeOpen(true);
    }
  }, []);

  // Handle MFA redirect from route guards (?mfa=required)
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const isMfaRequiredQuery = searchParams.get("mfa") === "required";
    const storeMfaRequired = authStore.get()?.mfaRequired;

    if (isMfaRequiredQuery || storeMfaRequired) {
      (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const user = data?.session?.user;
          if (user) {
            const cleanEmail = (user.email || "").trim().toLowerCase();
            const { verifiedFactor, factors } = await mfaService.listFactors();
            const targetFactor = verifiedFactor || factors?.[0];

            let challengeId = null;
            if (targetFactor?.id) {
              const { data: chData } = await mfaService.createChallenge({ factorId: targetFactor.id });
              if (chData?.id) challengeId = chData.id;
            }

            let role = user.user_metadata?.role || "staff";
            let name = user.user_metadata?.full_name || user.user_metadata?.name || cleanEmail;
            let userId = user.id;

            try {
              const { data: dbUser } = await supabase
                .from(TABLES.USERS)
                .select("*")
                .ilike("email", cleanEmail)
                .maybeSingle();
              if (dbUser) {
                role = dbUser.role || role;
                name = dbUser.full_name || name;
                userId = dbUser.id || userId;
              }
            } catch (_) {}

            const activeSessionId = authSecurityService.getClientSessionId() || uuid();
            const session = {
              id: userId,
              user_id: userId,
              role,
              name,
              email: cleanEmail,
              session_id: activeSessionId,
              ts: Date.now(),
              login_time: new Date().toISOString(),
              ...(data?.session || {}),
            };

            setPending2FA({
              session,
              role,
              name,
              cleanEmail,
              userId,
              factorId: targetFactor?.id,
              challengeId,
            });
            setView("verify-otp");
          }
        } catch (err) {
          console.warn("MFA redirect recovery failed:", err);
        }
      })();
    }
  }, []);

  // ---- Reset Owner Registration Form State ----
  const resetOwnerRegistrationForm = (keepGoogleSessionCleanup = true) => {
    if (popupPollTimerRef.current) {
      clearInterval(popupPollTimerRef.current);
      popupPollTimerRef.current = null;
    }
    if (popupRef.current && !popupRef.current.closed) {
      try { popupRef.current.close(); } catch (_) { }
    }
    popupRef.current = null;
    inFlightOAuthRef.current = false;

    setRegName("");
    setRegContact("");
    setRegAddress("");
    setRegEmail("");
    setRegUsername("");
    setRegPassword("");
    setRegConfirmPassword("");
    setRegAgreement(false);
    setShowRegPwd(false);
    setShowRegCpwd(false);
    setRegError("");
    setRegFieldErrors({});
    setRegShake(false);
    setRegLoading(false);
    setAgreementModalOpen(false);
    setUnregisteredModalOpen(false);
    setUnregisteredGoogleEmail("");
    setRegisteredOwnerInfo(null);
    ownerAuthService.cleanGoogleOAuthState();
  };

  // ---- Initiate Google OAuth for Owner Login ----
  const handleGoogleOwnerLogin = async () => {
    // Prevent duplicate authentication requests
    if (inFlightOAuthRef.current || googleLoginLoading || loading) return;

    setError("");
    setConcurrentNoticeOpen(false);
    setGoogleLoginLoading(true);
    inFlightOAuthRef.current = true;
    oauthHandledRef.current = false;

    if (popupPollTimerRef.current) {
      clearInterval(popupPollTimerRef.current);
      popupPollTimerRef.current = null;
    }

    try {
      const res = await ownerAuthService.signInWithGoogle({ intent: "login", mode: "popup" });
      const authUrl = res?.url;
      if (!authUrl) {
        throw new Error("Unable to obtain Google authentication URL. Please try again.");
      }

      // Same-tab redirect: Supabase Auth uses tab-scoped sessionStorage, so a popup window
      // would complete the OAuth exchange in its own storage and the session would never
      // reach this tab. Redirecting keeps the PKCE verifier and resulting session in one tab.
      ownerAuthService.setGoogleOAuthInFlight("login");
      window.location.assign(authUrl);
      return;
    } catch (err) {
      inFlightOAuthRef.current = false;
      ownerAuthService.cleanGoogleOAuthState();
      setGoogleLoginLoading(false);

      const isNetworkError =
        !navigator.onLine ||
        err.message?.toLowerCase().includes("failed to fetch") ||
        err.message?.toLowerCase().includes("network") ||
        err.message?.toLowerCase().includes("offline");

      const msg = isNetworkError
        ? "Network error: Unable to connect to Google authentication. Please check your internet connection and try again."
        : (err.message || "Failed to connect with Google. Please try again.");

      setError(msg);
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  const switchToForgot = (e) => {
    if (e) e.preventDefault();
    resetOwnerRegistrationForm();
    setError("");
    setFpEmail("");
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    setFpStep(1);
    setFpCooldown(0);
    setFpCodeSent(false);
    setFpError("");
    setFpSuccess(false);
    setShowFpRequirements(false);
    setView("forgot");
  };

  const switchToSignin = (e) => {
    if (e) e.preventDefault();
    resetOwnerRegistrationForm();
    setError("");
    setFpSuccess(false);
    setPending2FA(null);
    setTwoFaCode("");
    setTwoFaError("");
    setView("signin");
  };

  const switchToRegister = (e) => {
    if (e) e.preventDefault();
    resetOwnerRegistrationForm();
    setError("");
    setView("register");
  };

  // ---- Handle Contact Number: strict digits, 11 length max, 09/08 prefix ----
  const handleRegContactChange = (e) => {
    // 1. Keep only numeric digits (immediately reject letters/symbols)
    let val = e.target.value.replace(/\D/g, "");

    // 2. If user begins by typing 9 or 8, intelligently auto-prepend 0 so it forms 09 or 08
    if (val.length === 1 && (val === "9" || val === "8")) {
      val = "0" + val;
    }

    // 3. Stop strictly at exactly 11 digits
    val = val.slice(0, 11);

    setRegContact(val);

    // 4. Real-time validation for 09 or 08 prefix
    if (val.length >= 2) {
      if (!val.startsWith("09") && !val.startsWith("08")) {
        setRegFieldErrors((prev) => ({
          ...prev,
          contact: "Contact number must start with 09 or 08 (e.g. 09171234567).",
        }));
        return;
      }
    }

    // If valid prefix or currently typing, clear previous contact error
    if (val.length === 11) {
      if (val.startsWith("09") || val.startsWith("08")) {
        setRegFieldErrors((prev) => ({ ...prev, contact: "" }));
      }
    } else if (regFieldErrors.contact) {
      if (val.startsWith("09") || val.startsWith("08") || val.length < 2) {
        setRegFieldErrors((prev) => ({ ...prev, contact: "" }));
      }
    }

    if (regError) setRegError("");
  };

  // ---- Validate Owner Registration Form ----
  const validateOwnerRegistrationForm = () => {
    const errs = {};

    // 1. Full Name
    const trimmedName = regName.trim();
    if (!trimmedName) {
      errs.name = "Full Name is required.";
    } else if (trimmedName.length < 2) {
      errs.name = "Full Name must be at least 2 characters.";
    }

    // 2. Contact Number (Must be exactly 11 digits and start with 09 or 08)
    const rawContact = regContact.trim().replace(/\D/g, "");
    if (!rawContact) {
      errs.contact = "Contact Number is required.";
    } else if (!rawContact.startsWith("09") && !rawContact.startsWith("08")) {
      errs.contact = "Contact number must start with 09 or 08 (e.g. 09171234567).";
    } else if (rawContact.length !== 11) {
      errs.contact = `Contact number must be exactly 11 digits (${rawContact.length}/11 entered).`;
    }

    // 3. Username
    const trimmedUsername = regUsername.trim();
    if (!trimmedUsername) {
      errs.username = "Username is required.";
    } else if (trimmedUsername.length < 3) {
      errs.username = "Username must be at least 3 characters.";
    } else if (!/^[a-zA-Z0-9._-]+$/.test(trimmedUsername)) {
      errs.username = "Username can only contain letters, numbers, dots, and underscores.";
    }

    // 4. Address
    const trimmedAddress = regAddress.trim();
    if (!trimmedAddress) {
      errs.address = "Address is required.";
    } else if (trimmedAddress.length < 5) {
      errs.address = "Please enter a complete address (Barangay, City, Province).";
    }

    // 5. Email Address
    const trimmedEmail = regEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail) {
      errs.email = "Email Address is required.";
    } else if (!emailRegex.test(trimmedEmail)) {
      errs.email = "Please enter a valid email address (e.g. owner@example.com).";
    }

    // 6. Password
    if (!regPassword) {
      errs.password = "Password is required.";
    } else {
      const pwCheck = validatePassword(regPassword);
      if (!pwCheck.isValid) {
        errs.password = "Password does not meet security rules (min 8 chars, uppercase, lowercase, number, special char).";
      }
    }

    // 7. Confirm Password
    if (!regConfirmPassword) {
      errs.confirmPassword = "Confirm Password is required.";
    } else if (regPassword !== regConfirmPassword) {
      errs.confirmPassword = "Passwords do not match. Please verify your confirm password.";
    }

    // 8. Terms and Conditions (Agreement Checkbox)
    if (!regAgreement) {
      errs.agreement = "You must check and accept the User Agreement and Privacy Policy to proceed.";
    }

    return errs;
  };

  // ---- Submit Owner Registration ----
  const submitOwnerRegistration = async (e) => {
    e.preventDefault();
    setRegError("");

    const errs = validateOwnerRegistrationForm();
    if (Object.keys(errs).length > 0) {
      setRegFieldErrors(errs);
      const firstKey = Object.keys(errs)[0];
      const firstMsg = errs[firstKey];
      setRegError(firstMsg);
      setRegShake(true);
      setTimeout(() => setRegShake(false), 500);

      // Focus and smoothly scroll to the first invalid field
      const refMap = {
        name: regNameRef,
        contact: regContactRef,
        username: regUsernameRef,
        address: regAddressRef,
        email: regEmailRef,
        password: regPasswordRef,
        confirmPassword: regConfirmPasswordRef,
        agreement: regAgreementRef,
      };
      const targetRef = refMap[firstKey];
      if (targetRef && targetRef.current) {
        scrollToFirstError(targetRef.current, { offset: 80 });
      }

      return;
    }

    setRegFieldErrors({});
    setRegLoading(true);
    try {
      const res = await ownerAuthService.registerOwner({
        name: regName.trim(),
        contact: regContact.trim(),
        address: regAddress.trim(),
        email: regEmail.trim(),
        username: regUsername.trim(),
        password: regPassword,
        agreementAccepted: regAgreement,
      });

      const pendingInfo = {
        ...(res.owner || {}),
        id: res.owner?.id || res.regId,
        name: regName.trim(),
        email: regEmail.trim(),
        contact: regContact.trim(),
        username: regUsername.trim(),
        status: res.owner?.status || "Pending Approval",
        avatar_url: res.owner?.avatar_url || null,
        auth_provider: "email",
        registered_date: res.owner?.registered_date || new Date().toISOString().split("T")[0],
        created_at: res.owner?.created_at || new Date().toISOString(),
      };

      setRegisteredOwnerInfo(pendingInfo);
      try {
        sessionStorage.setItem("lsmis_pending_owner", JSON.stringify(pendingInfo));
      } catch (_) {}

      // Clear all registration input fields and validations immediately so that stale form data does not persist
      setRegName("");
      setRegContact("");
      setRegAddress("");
      setRegEmail("");
      setRegUsername("");
      setRegPassword("");
      setRegConfirmPassword("");
      setRegAgreement(false);
      setShowRegPwd(false);
      setShowRegCpwd(false);
      setRegError("");
      setRegFieldErrors({});
      setRegShake(false);

      setView("reg-submitted");
      showToast("Registration submitted! Awaiting administrator approval.", "success");
    } catch (err) {
      const msg = err.message || "Failed to submit registration. Please try again.";
      setRegError(msg);
      if (msg.toLowerCase().includes("email")) {
        setRegFieldErrors((prev) => ({ ...prev, email: msg }));
        regEmailRef.current?.focus();
      } else if (msg.toLowerCase().includes("contact")) {
        setRegFieldErrors((prev) => ({ ...prev, contact: msg }));
        regContactRef.current?.focus();
      } else if (msg.toLowerCase().includes("username")) {
        setRegFieldErrors((prev) => ({ ...prev, username: msg }));
        regUsernameRef.current?.focus();
      }
      setRegShake(true);
      setTimeout(() => setRegShake(false), 500);
    } finally {
      setRegLoading(false);
    }
  };


  // ---- Sign In with Animation ----
  const submitSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setConcurrentNoticeOpen(false);
    sessionStorage.removeItem("lsmis_concurrent_logout_notice");
    if (typeof window !== "undefined" && window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const triggerShake = () => {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    };

    const inputIdentifier = email.trim();
    const inputPassword = password;

    if (!inputIdentifier) {
      setError("Please enter your email address.");
      triggerShake();
      scrollToFirstError("login-email", { offset: 80 });
      return;
    }

    if (!inputPassword) {
      setError("Please enter your password.");
      triggerShake();
      scrollToFirstError("login-password", { offset: 80 });
      return;
    }

    if (!inputIdentifier.includes("@")) {
      setError("Please enter a valid email address.");
      triggerShake();
      scrollToFirstError("login-email", { offset: 80 });
      return;
    }

    // Ignore repeated clicks while a sign-in is already in flight
    // (a ref is used because state-based `disabled` only applies after re-render).
    if (signInInFlightRef.current) return;
    signInInFlightRef.current = true;

    // Show the loading state immediately, before any network round trip.
    setLoading(true);

    try {
      const authEmail = inputIdentifier.toLowerCase();
      const clientSessionId = authSecurityService.getClientSessionId();

      // 1 & 2. Independent server-side checks run in parallel instead of one after another:
      //  - failed login attempts lockout (5 consecutive failures = 4-hour lock)
      //  - simultaneous login on another device/browser
      //  - owner account status (needed later for the approval checks)
      const [lockout, activeCheck, ownerAcctInitial] = await Promise.all([
        authSecurityService.checkAccountLockout(inputIdentifier),
        authSecurityService.checkActiveSession(inputIdentifier, clientSessionId),
        ownerAuthService.getOwnerStatus(authEmail),
      ]);

      if (lockout.isLocked) {
        const remainingText = authSecurityService.formatLockoutTime(lockout.remaining_seconds);
        setLoading(false);
        setError(
          `Account is temporarily locked due to repeated failed login attempts. Please try again in ${remainingText}.`
        );
        triggerShake();
        return;
      }

      if (activeCheck.is_active_elsewhere) {
        setLoading(false);
        setError(activeCheck.message || "This account is currently being used on another device. Please try again later.");
        triggerShake();
        return;
      }

      // Prepare planned session ID so that any auth listeners in authStore
      // use the exact same session ID that will be registered in the database
      const plannedSessionId = clientSessionId || uuid();
      try {
        sessionStorage.setItem("lsmis_pending_session_id", plannedSessionId);
      } catch (_) {}

      // 3. Check Owner Account Status if identifier is an owner (fetched in parallel above)
      let ownerAcct = ownerAcctInitial;
      if (ownerAcct) {
        const stLower = String(ownerAcct.status || "").toLowerCase().trim();
        if (
          stLower.includes("pending") ||
          stLower.includes("verification") ||
          stLower.includes("review") ||
          stLower.includes("approval") ||
          (String(ownerAcct.id || "").startsWith("REG") && !stLower.includes("approved") && !stLower.includes("active"))
        ) {
          setLoading(false);
          setError("Your registration is awaiting Administrator approval. You will receive portal access once reviewed.");
          triggerShake();
          return;
        }
        if (stLower.includes("reject")) {
          setLoading(false);
          setError(
            `Your registration was rejected by the Administrator. Reason: ${ownerAcct.rejection_reason || "Unspecified"}. Please contact the abattoir administration.`
          );
          triggerShake();
          return;
        }
        if (stLower.includes("suspend")) {
          setLoading(false);
          setError(
            `Your account has been suspended by the Administrator. Reason: ${ownerAcct.suspension_reason || "Administrative review"}. Please contact the abattoir office.`
          );
          triggerShake();
          return;
        }
      }

      // 4. Authenticate with Supabase
      let authData = null;
      let authError = null;
      try {
        const res = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: inputPassword
        });
        authData = res.data;
        authError = res.error;
      } catch (err) {
        authError = err;
      }

      if (authError) {
        const failResult = await authSecurityService.recordFailedLogin(authEmail);
        try {
          logActivity({
            action: `Failed login attempt for ${authEmail} (Reason: ${authError.message || "Invalid credentials"})`,
            module: "Auth",
            security_event: "Failed Login",
            severity: "warning",
            user: authEmail,
            role: "unknown",
          }).then();
        } catch (err) { }
        setLoading(false);
        if (failResult.isLocked) {
          const remainingText = authSecurityService.formatLockoutTime(failResult.remaining_seconds);
          setError(`Too many failed login attempts. Account locked for 4 hours. Please try again in ${remainingText}.`);
        } else {
          const rem = failResult.remaining_attempts ?? 4;
          setError(
            `Incorrect email or password. (${rem} attempt${rem === 1 ? "" : "s"} remaining before 4-hour account lockout)`
          );
        }
        triggerShake();
        return;
      }

      // Check account termination status for Veterinarian & Staff Personnel accounts
      const termCheck = await adminService.checkUserTerminationStatus(authEmail);
      if (termCheck.isTerminated) {
        try { await supabase.auth.signOut(); } catch (e) { }
        sessionStorage.removeItem(STORAGE_KEYS.SESSION);
        sessionStorage.removeItem("lsmis_concurrent_logout_notice");
        localStorage.removeItem("lsmis_single_session_signal");
        sessionStorage.setItem("lsmis_termination_notice", JSON.stringify({
          reason: termCheck.reason || "",
          terminatedUntil: termCheck.terminatedUntil || null,
        }));
        authStore.set({ session: null });
        setLoading(false);
        setConcurrentNoticeOpen(false);
        setTerminationNotice({
          open: true,
          reason: termCheck.reason || "",
          terminatedUntil: termCheck.terminatedUntil || null,
        });
        triggerShake();
        return;
      }

      // Clear failed login attempts upon successful authentication
      ownerAuthService.clearFailedAttempts(inputIdentifier);

      // Save or clear Remember Me identifier
      if (rememberMe) {
        localStorage.setItem("lsmis_remember_me", "true");
        localStorage.setItem("lsmis_saved_identifier", inputIdentifier);
      } else {
        localStorage.removeItem("lsmis_remember_me");
        localStorage.removeItem("lsmis_saved_identifier");
      }

      // Determine user role and name accurately from database
      const cleanEmail = authEmail.trim().toLowerCase();
      let role = null;
      let name = "Livestock Owner";
      let ownerId = null;
      let userId = authData?.user?.id || null;

      // Declared at this scope: also used when building the session object below.
      let dbUser = null;
      let matchedOwner = null;

      // 1. Query users database table (case-insensitive email or username or id)
      try {
        let q = supabase
          .from(TABLES.USERS)
          .select("id, role, full_name, username, owner_id");

        if (userId) {
          q = q.or(`id.eq.${userId},email.ilike.${cleanEmail},username.ilike.${cleanEmail}`);
        } else {
          q = q.or(`email.ilike.${cleanEmail},username.ilike.${cleanEmail}`);
        }

        const { data: dbUserData } = await q.limit(1).maybeSingle();
        dbUser = dbUserData;

        if (dbUser) {
          if (dbUser.id) userId = dbUser.id;
          if (dbUser.full_name) name = dbUser.full_name;
          if (dbUser.owner_id) ownerId = dbUser.owner_id;
          if (dbUser.role) {
            const r = dbUser.role.toLowerCase().trim();
            if (r === "veterinarian" || r === "vet" || r.includes("vet") || r.includes("doctor")) {
              role = "vet";
            } else if (r === "administrator" || r === "admin" || r.includes("admin")) {
              role = "admin";
            } else if (r === "owner" || r.includes("owner")) {
              role = "owner";
            } else if (r === "staff" || r.includes("staff") || r.includes("operator")) {
              role = "staff";
            } else {
              role = r;
            }
          }
        }
      } catch (e) {
        console.warn("DB user lookup error:", e);
      }

      // 2. Check if user is an owner in Supabase OWNERS table
      if (!role || role === "owner") {
        matchedOwner = ownerAcct;
        if (!matchedOwner) {
          matchedOwner = await ownerAuthService.getOwnerStatus(cleanEmail);
        }
        if (!matchedOwner && inputIdentifier) {
          matchedOwner = await ownerAuthService.getOwnerStatus(inputIdentifier);
        }
        if (matchedOwner) {
          role = "owner";
          if (matchedOwner.name) name = matchedOwner.name;
          ownerId = matchedOwner.owner_id || matchedOwner.official_owner_id || matchedOwner.id || matchedOwner.temp_reg_id || null;
        }
      }

      // 3. Fallback heuristic based on email keywords if no record in users table
      if (!role) {
        if (cleanEmail.includes("admin")) role = "admin";
        else if (cleanEmail.includes("vet") || cleanEmail.includes("doctor")) role = "vet";
        else if (cleanEmail.includes("staff") || cleanEmail.includes("operator")) role = "staff";
        else {
          role = "owner";
        }
      }

      if (role === "owner") {
        let checkOwner = ownerAcct;
        if (!checkOwner) {
          checkOwner = (await ownerAuthService.getOwnerStatus(cleanEmail)) || (await ownerAuthService.getOwnerStatus(inputIdentifier));
        }
        if (checkOwner) {
          const stLower = String(checkOwner.status || "").toLowerCase().trim();
          if (
            stLower.includes("pending") ||
            stLower.includes("verification") ||
            stLower.includes("review") ||
            stLower.includes("approval") ||
            (String(checkOwner.id || "").startsWith("REG") && !stLower.includes("approved") && !stLower.includes("active"))
          ) {
            try { await supabase.auth.signOut(); } catch (e) { }
            setLoading(false);
            setError("Your registration is awaiting Administrator approval. You will receive portal access once reviewed.");
            triggerShake();
            return;
          }
          if (stLower.includes("reject")) {
            try { await supabase.auth.signOut(); } catch (e) { }
            setLoading(false);
            setError(`Your registration was rejected by the Administrator. Reason: ${checkOwner.rejection_reason || "Unspecified"}.`);
            triggerShake();
            return;
          }
          if (stLower.includes("suspend")) {
            try { await supabase.auth.signOut(); } catch (e) { }
            setLoading(false);
            setError(`Your account has been suspended by the Administrator. Reason: ${checkOwner.suspension_reason || "Administrative review"}.`);
            triggerShake();
            return;
          }
        }
      }

      if (role === "owner" && !ownerId) {
        try {
          const { data: dbOwner } = await supabase
            .from(TABLES.OWNERS)
            .select("id")
            .ilike("email", cleanEmail)
            .limit(1)
            .maybeSingle();
          if (dbOwner?.id) {
            ownerId = dbOwner.id;
          } else {
            const { data: dbUserRow } = await supabase
              .from(TABLES.USERS)
              .select("owner_id")
              .ilike("email", cleanEmail)
              .limit(1)
              .maybeSingle();
            if (dbUserRow?.owner_id) {
              ownerId = dbUserRow.owner_id;
            }
          }
        } catch (e) {
          console.warn("Could not resolve owner ID during login:", e);
        }
      }

      // Cover gradient
      let cover_gradient = null;
      try {
        const storedProfile = localStorage.getItem("lmis_profile_" + cleanEmail);
        if (storedProfile) {
          cover_gradient = JSON.parse(storedProfile).cover_gradient;
        }
      } catch (e) { }

      // Register Single Active Session across all roles (Admin, Vet, Staff, Owner)
      let activeSessionId = plannedSessionId || uuid();
      let activeSessionUpdatedAt = new Date().toISOString();

      try {
        const secRes = await authSecurityService.registerActiveSession(cleanEmail, activeSessionId, clientSessionId);
        if (secRes?.is_active_elsewhere) {
          try { await supabase.auth.signOut({ scope: "local" }); } catch (_) {}
          try { sessionStorage.removeItem("lsmis_pending_session_id"); } catch (_) {}
          setLoading(false);
          setError(secRes?.message || "This account is currently being used on another device. Please try again later.");
          triggerShake();
          return;
        }
        if (secRes?.session_id) {
          activeSessionId = secRes.session_id;
        }
        if (secRes?.updated_at) {
          activeSessionUpdatedAt = secRes.updated_at;
        }
      } catch (e) {
        console.warn("registerActiveSession warning:", e);
      }

      authSecurityService.setClientSessionId(activeSessionId);
      try {
        sessionStorage.removeItem("lsmis_pending_session_id");
        sessionStorage.setItem("lsmis_active_session_id", activeSessionId);
      } catch (_) {}

      const loginTimeIso = activeSessionUpdatedAt || new Date().toISOString();
      const effectiveName = matchedOwner?.name || dbUser?.full_name || name;
      const effectiveAvatar = matchedOwner?.avatar_url || dbUser?.avatar_url || null;

      const session = {
        id: userId,
        user_id: userId,
        role,
        name: effectiveName,
        email: cleanEmail,
        owner_id: ownerId || null,
        avatar_url: effectiveAvatar,
        session_id: activeSessionId,
        ts: Date.now(),
        login_time: loginTimeIso,
        cover_gradient,
        ...(authData?.session || {})
      };

      // Check if Two-Factor Authentication (2FA) is enabled for this account via Supabase Auth MFA
      let mfaRequired = false;
      let targetFactor = null;
      let challengeId = null;

      try {
        const { verifiedFactor, factors } = await mfaService.listFactors();
        const aal = await mfaService.getAssuranceLevel();
        const isLocal2faEnabled = localStorage.getItem("lmis_2fa_enabled_" + cleanEmail) === "true";
        const isMetadata2faEnabled = Boolean(authData?.user?.user_metadata?.two_factor_enabled);

        const activeFactor =
          verifiedFactor ||
          factors?.find((f) => f.status === "verified") ||
          ((isLocal2faEnabled || isMetadata2faEnabled) ? factors?.[0] : null);

        if (activeFactor || aal?.nextLevel === "aal2" || isLocal2faEnabled || isMetadata2faEnabled) {
          mfaRequired = true;
          targetFactor = activeFactor;

          if (targetFactor?.id) {
            const { data: chData, error: chErr } = await mfaService.createChallenge({ factorId: targetFactor.id });
            if (!chErr && chData?.id) {
              challengeId = chData.id;
            }
          }
        }
      } catch (mfaChkErr) {
        console.warn("Supabase MFA status check notice:", mfaChkErr);
      }

      if (mfaRequired && targetFactor) {
        setPending2FA({
          session,
          role,
          name: effectiveName,
          cleanEmail,
          userId,
          factorId: targetFactor.id,
          challengeId,
        });

        setTwoFaCode("");
        setTwoFaError("");
        setLoading(false);
        setView("verify-otp");
        showToast(`Authenticator security code required for ${cleanEmail}`, "info");
        return;
      }

      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      authStore.set({ session });

      // DB Activity logging & Presence Registration
      try {
        supabase.from(TABLES.USERS).update({ last_login: now() }).ilike("email", cleanEmail).then();
        // Immediately register a fresh active session — shows user Online right away
        registerLoginSession({ name, email: cleanEmail, role, module: "Dashboard", loginTime: loginTimeIso });
        logActivity({
          action: `User logged in (${name} - ${role})`,
          module: "Auth",
          user: name,
          role: role,
          old_value: "Offline",
          new_value: "Active Session",
          field_changed: "session_state",
        }).then();
      } catch (e) {
        console.error("Login logging failed:", e);
      }

      // Navigate directly to authenticated role dashboard
      const prevPath = location.state?.from?.pathname;
      if (prevPath && prevPath.startsWith(`/${role}`)) {
        navigate(prevPath, { replace: true });
      } else {
        navigate(`/${role}`, { replace: true });
      }

    } catch (err) {
      console.error("Sign in unexpected error:", err);
      setLoading(false);
      setError(err.message || "An unexpected error occurred while logging in. Please try again.");
      triggerShake();
    } finally {
      signInInFlightRef.current = false;
    }
  };

  // ---- Two-Factor Authentication (2FA) Handlers ----
  const handleVerify2FA = async (e) => {
    if (e) e.preventDefault();
    if (!pending2FA) return;

    setTwoFaError("");
    const cleanCode = twoFaCode.trim();

    if (!cleanCode) {
      setTwoFaError("Please enter the 6-digit verification code from your authenticator app.");
      twoFaInputRef.current?.focus();
      return;
    }

    if (cleanCode.length !== 6) {
      setTwoFaError("Verification code must be exactly 6 digits.");
      twoFaInputRef.current?.focus();
      return;
    }

    setTwoFaLoading(true);

    try {
      let factorId = pending2FA.factorId;
      if (!factorId) {
        const { verifiedFactor, factors } = await mfaService.listFactors();
        factorId = verifiedFactor?.id || factors?.[0]?.id;
      }

      if (!factorId) {
        setTwoFaError("No active authenticator factor found for this account. Please sign in again.");
        setTwoFaLoading(false);
        return;
      }

      let verifyRes;
      if (pending2FA.challengeId) {
        verifyRes = await mfaService.verifyChallenge({
          factorId,
          challengeId: pending2FA.challengeId,
          code: cleanCode,
        });
      } else {
        verifyRes = await mfaService.challengeAndVerify({
          factorId,
          code: cleanCode,
        });
      }

      if (verifyRes?.error) {
        const errMsg = verifyRes.error.message || "";
        setTwoFaError(
          errMsg.toLowerCase().includes("expired")
            ? "Verification challenge has expired. Click 'Refresh Security Challenge' below to generate a new code challenge."
            : "Invalid authenticator code. Please check your authenticator app (Google Authenticator, Microsoft Authenticator) and try again."
        );
        setTwoFaLoading(false);
        twoFaInputRef.current?.focus();
        return;
      }

      // MFA successfully verified: session has satisfied AAL2!
      const { session, role, name, cleanEmail } = pending2FA;
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      authStore.set({ session, loading: false, isInitialized: true, mfaRequired: false });

      try {
        supabase.from(TABLES.USERS).update({ last_login: now() }).ilike("email", cleanEmail).then();
        registerLoginSession({ name, email: cleanEmail, role, module: "Dashboard", loginTime: session.login_time });
        logActivity({
          action: `User verified Supabase MFA & logged in (${name} - ${role})`,
          module: "Auth",
          user: name,
          role: role,
          old_value: "MFA Pending",
          new_value: "Active Session (AAL2)",
          field_changed: "session_state",
        }).then();
      } catch (e) {
        console.error("2FA login logging error:", e);
      }

      showToast(`Welcome back, ${name}! Two-Factor Authentication verified.`, "success");
      const prevPath = location.state?.from?.pathname;
      if (prevPath && prevPath.startsWith(`/${role}`)) {
        navigate(prevPath, { replace: true });
      } else {
        navigate(`/${role}`, { replace: true });
      }

    } catch (err) {
      console.error("2FA verification error:", err);
      setTwoFaError(err.message || "Failed to verify security code.");
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleRefreshChallenge = async () => {
    let factorId = pending2FA?.factorId;
    if (!factorId) {
      const { verifiedFactor, factors } = await mfaService.listFactors();
      factorId = verifiedFactor?.id || factors?.[0]?.id;
    }
    if (!factorId) {
      setTwoFaError("Unable to locate active authenticator factor. Please return to sign in.");
      return;
    }

    setTwoFaLoading(true);
    setTwoFaError("");
    try {
      const { data: chData, error: chErr } = await mfaService.createChallenge({ factorId });
      if (chErr) throw chErr;
      setPending2FA((prev) => ({ ...prev, factorId, challengeId: chData.id }));
      setTwoFaCooldown(15);
      showToast("Security challenge refreshed. Please enter the current code from your authenticator app.", "info");
    } catch (err) {
      setTwoFaError("Could not refresh security challenge. Please cancel and sign in again.");
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleCancel2FA = async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (_) {}
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    authStore.set({ session: null, loading: false, isInitialized: true, mfaRequired: false });
    setPending2FA(null);
    setTwoFaCode("");
    setTwoFaError("");
    setShowRecoveryModal(false);
    switchToSignin();
  };

  // ---- Two-Factor Recovery Backup Code Handlers ----
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [showAdminAssistance, setShowAdminAssistance] = useState(false);

  const handleVerifyRecoveryCode = async (e) => {
    if (e) e.preventDefault();
    if (!pending2FA) return;

    setRecoveryError("");
    const cleanCode = recoveryCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setRecoveryError("Please enter your emergency recovery code.");
      return;
    }

    setRecoveryLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      const storedHashes = user?.user_metadata?.recovery_code_hashes || [];

      if (!storedHashes.length) {
        setRecoveryError(
          "No recovery backup codes registered for this account. Please use the Administrator-Assisted 2FA Reset procedure below."
        );
        setShowAdminAssistance(true);
        setRecoveryLoading(false);
        return;
      }

      const inputHash = await mfaService.hashRecoveryCode(cleanCode);
      const matchIndex = storedHashes.indexOf(inputHash);

      if (matchIndex === -1) {
        setRecoveryError("Invalid recovery code. Please check and try again, or contact your Administrator.");
        setRecoveryLoading(false);
        return;
      }

      // Valid recovery code used: remove it from stored hashes
      const updatedHashes = storedHashes.filter((_, idx) => idx !== matchIndex);

      // Unenroll the lost factor to reset 2FA
      if (pending2FA.factorId) {
        try {
          await supabase.auth.mfa.unenroll({ factorId: pending2FA.factorId });
        } catch (_) {}
      }

      // Update user metadata
      try {
        await supabase.auth.updateUser({
          data: {
            two_factor_enabled: false,
            recovery_code_hashes: updatedHashes,
          },
        });
      } catch (_) {}

      // Clean local storage flag
      const cleanEmail = pending2FA.cleanEmail;
      if (cleanEmail) {
        localStorage.removeItem("lmis_2fa_enabled_" + cleanEmail);
      }

      // Complete login
      const { session, role, name } = pending2FA;
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      authStore.set({ session, loading: false, isInitialized: true, mfaRequired: false });

      try {
        supabase.from(TABLES.USERS).update({ last_login: now() }).ilike("email", cleanEmail).then();
        registerLoginSession({ name, email: cleanEmail, role, module: "Dashboard", loginTime: session.login_time });
        logActivity({
          action: `User accessed account via single-use Recovery Code (${name} - ${role})`,
          module: "Auth",
          user: name,
          role: role,
          old_value: "2FA Active",
          new_value: "2FA Reset via Recovery Code",
          field_changed: "mfa_recovery",
        }).then();
      } catch (_) {}

      setShowRecoveryModal(false);
      setRecoveryCodeInput("");
      showToast(
        `Welcome back, ${name}! Your recovery code was accepted. Please re-enable 2FA in Account Settings.`,
        "success"
      );

      const prevPath = location.state?.from?.pathname;
      if (prevPath && prevPath.startsWith(`/${role}`)) {
        navigate(prevPath, { replace: true });
      } else {
        navigate(`/${role}`, { replace: true });
      }
    } catch (err) {
      console.error("Recovery verification error:", err);
      setRecoveryError(err.message || "Failed to verify recovery code.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  // ---- Forgot Password Handlers ----
  const handleSendCode = async () => {
    setFpError("");
    let inputVal = fpEmail.trim();
    if (!inputVal) {
      showToast("Please enter your registered email or username", "error");
      setFpError("Please enter your registered email address or username.");
      fpEmailRef.current?.focus();
      return;
    }

    if (fpCooldown > 0) {
      showToast(`Please wait ${fpCooldown}s before requesting a new code.`, "warning");
      return;
    }

    setLoadingSend(true);
    try {
      let resolvedEmail = inputVal.toLowerCase();

      // If user typed a username (no @ symbol), resolve it to their registered email
      if (!resolvedEmail.includes("@")) {
        const cleanUser = resolvedEmail;
        try {
          const { data: userRow } = await supabase
            .from(TABLES.USERS)
            .select("email")
            .or(`username.ilike.${cleanUser},full_name.ilike.${cleanUser}`)
            .limit(1)
            .maybeSingle();
          if (userRow?.email) {
            resolvedEmail = userRow.email.toLowerCase();
          } else {
            const { data: ownerRow } = await supabase
              .from(TABLES.OWNERS)
              .select("email")
              .or(`username.ilike.${cleanUser},name.ilike.${cleanUser}`)
              .limit(1)
              .maybeSingle();
            if (ownerRow?.email) {
              resolvedEmail = ownerRow.email.toLowerCase();
            }
          }
        } catch (_) { }
      }

      // Update email state if resolved from username
      if (resolvedEmail !== fpEmail) {
        setFpEmail(resolvedEmail);
      }

      // Validate that the email exists in system (users or owners)
      const { data: userRow } = await supabase
        .from(TABLES.USERS)
        .select("id, email")
        .ilike("email", resolvedEmail)
        .limit(1)
        .maybeSingle();

      let targetEmail = userRow?.email?.toLowerCase();
      if (!targetEmail) {
        const { data: ownerRow } = await supabase
          .from(TABLES.OWNERS)
          .select("id, email")
          .ilike("email", resolvedEmail)
          .limit(1)
          .maybeSingle();
        targetEmail = ownerRow?.email?.toLowerCase();
      }

      if (!targetEmail) {
        const notFoundMsg = "This email address is not registered in our system.";
        showToast(notFoundMsg, "error");
        setFpError(notFoundMsg);
        setLoadingSend(false);
        return;
      }

      // Check database-enforced rate limit (max 3 OTP requests per 15 min)
      try {
        const { data: limitRes, error: rpcError } = await supabase.rpc("request_otp_rate_limit", {
          p_email: targetEmail
        });
        if (!rpcError && limitRes && limitRes.allowed === false) {
          const limitMsg = limitRes.message || "Too many OTP attempts. You are temporarily blocked for 15 minutes.";
          showToast(limitMsg, "error");
          setFpError(limitMsg);
          setLoadingSend(false);
          return;
        }
      } catch (rpcErr) {
        console.warn("Rate limit check notice:", rpcErr);
      }

      // Send official Supabase Password Recovery OTP
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(targetEmail);
      if (resetErr) {
        console.error("Supabase resetPasswordForEmail error:", resetErr);
        let userFriendlyMsg = resetErr.message || "Failed to send reset code. Please try again.";
        if (
          resetErr.message?.includes("535") ||
          resetErr.message?.includes("Username and Password not accepted") ||
          resetErr.message?.includes("BadCredentials") ||
          resetErr.message?.includes("Error sending recovery email")
        ) {
          userFriendlyMsg =
            "Email delivery failed: The server's SMTP mail credentials were not accepted (535 Bad Credentials). Please ensure valid SMTP credentials are configured in your Supabase project dashboard.";
        } else if (resetErr.status === 429 || resetErr.message?.toLowerCase().includes("rate limit")) {
          userFriendlyMsg = "Email rate limit exceeded. Please wait a few minutes before trying again.";
        }
        showToast(userFriendlyMsg, "error");
        setFpError(userFriendlyMsg);
        setLoadingSend(false);
        return;
      }

      // Successful request dispatched by Supabase
      setFpCodeSent(true);
      setFpCooldown(60);
      setFpStep(2);
      showToast(`Verification code sent to ${targetEmail}! Please check your email inbox.`, "success");

      // Auto-focus code input
      setTimeout(() => {
        fpCodeRef.current?.focus();
      }, 150);

    } catch (err) {
      console.error("Failed to send OTP:", err);
      showToast(err.message || "Failed to send reset code. Please try again.", "error");
      setFpError(err.message || "Failed to send reset code.");
    } finally {
      setLoadingSend(false);
    }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setFpError("");

    const emailToVerify = fpEmail.trim().toLowerCase();
    const inputCode = code.trim();

    if (!emailToVerify) {
      showToast("Please enter your account email", "error");
      setFpError("Please enter your account email address.");
      fpEmailRef.current?.focus();
      return;
    }
    if (!inputCode) {
      showToast("Please enter the 6-digit verification code", "error");
      setFpError("Please enter the 6-digit verification code sent to your email.");
      fpCodeRef.current?.focus();
      return;
    }
    if (!newPassword) {
      showToast("Please enter your new password", "error");
      setFpError("Please enter your new password.");
      return;
    }
    if (!confirmPassword) {
      showToast("Please confirm your new password", "error");
      setFpError("Please confirm your new password.");
      return;
    }

    const valResult = validatePassword(newPassword);
    if (!valResult.isValid) {
      const msg = getPasswordValidationError(newPassword);
      showToast(msg, "error");
      setFpError(msg);
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match", "error");
      setFpError("Passwords do not match. Please ensure both passwords match.");
      return;
    }

    setLoadingReset(true);
    try {
      // 1. Verify OTP strictly with Supabase Auth Recovery
      const { data: verifyData, error: otpError } = await supabase.auth.verifyOtp({
        email: emailToVerify,
        token: inputCode,
        type: "recovery"
      });

      if (otpError) {
        console.error("Supabase verifyOtp recovery error:", otpError);
        let msg = otpError.message || "Invalid or expired verification code.";
        if (msg.toLowerCase().includes("token has expired")) {
          msg = "Verification code has expired. Please request a new code.";
        } else if (msg.toLowerCase().includes("invalid token")) {
          msg = "Invalid verification code. Please check the 6-digit code sent to your email.";
        }
        throw new Error(msg);
      }

      if (verifyData?.session) {
        await supabase.auth.setSession(verifyData.session);
      }

      // 2. Update password in Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        console.error("Supabase updateUser error:", updateError);
        throw new Error(updateError.message || "Failed to update password in authentication service.");
      }

      // 3. Clear rate limit record on successful password reset
      try {
        await supabase.from("otp_rate_limits").delete().eq("email", emailToVerify);
      } catch (_) { }

      // 4. Sign out from temporary recovery session to ensure clean login state
      try {
        await supabase.auth.signOut();
      } catch (_) { }

      // Log activity
      try {
        logActivity({
          action: `Password successfully reset for ${emailToVerify}`,
          module: "Auth",
          severity: "info",
          user: emailToVerify
        });
      } catch (_) { }

      // Pre-fill email in signin and set success UI state
      setEmail(emailToVerify);
      setPassword("");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setFpSuccess(true);
      setSuccessModalOpen(true);
      showToast("Password has been changed successfully! You can now sign in with your new password.", "success");

    } catch (err) {
      console.error("Password reset error:", err);
      showToast(err.message || "Password update failed.", "error");
      setFpError(err.message || "Password update failed.");
    } finally {
      setLoadingReset(false);
    }
  };

  return (
    <div className={`login-page${embedded ? " login-page-embedded" : ""}${isInstalled ? " is-installed-app" : ""}`}>
      {/* Professional Opening Animation for Installed Mobile App */}
      {showLaunchSplash && (
        <div className={`lsmis-launch-splash ${splashFadingOut ? "fade-out" : ""}`} role="status" aria-live="polite">
          <div className="launch-splash-content">
            <div className="launch-splash-logo-wrap">
              <img src={logoImg} alt="LSMIS Official Seal" className="launch-splash-logo" width="88" height="88" />
            </div>
            <div className="launch-splash-text">
              <h1 className="launch-splash-title">LSMIS</h1>
              <p className="launch-splash-sub">Livestock Slaughter &amp; Meat Inspection System</p>
              <span className="launch-splash-loc">City Government of Naga, Cebu</span>
            </div>
            <div className="launch-splash-loader">
              <div className="launch-splash-loader-bar" />
            </div>
          </div>
        </div>
      )}

      <div className="login-container">
        {/* Left brand panel */}
        <div className="login-brand">
          <div>
            <div className="login-brand-header">
              {isInstalled ? (
                <div className="login-brand-header-link" style={{ cursor: "default" }}>
                  <div className="logo"><img src={logoImg} alt="LSMIS Official Logo" /></div>
                  <div>
                    <h1>LSMIS</h1>
                    <p>Republic of the Philippines</p>
                  </div>
                </div>
              ) : (
                <Link to="/" className="login-brand-header-link" title="Return to Landing Page">
                  <div className="logo"><img src={logoImg} alt="LSMIS Official Logo" /></div>
                  <div>
                    <h1>LSMIS</h1>
                    <p>Republic of the Philippines</p>
                  </div>
                </Link>
              )}
            </div>
            <div className="login-brand-hero">
              <h2>Livestock Slaughter and Meat Inspection Management System</h2>
              <p>
                City Government of Naga, Cebu · City Abattoir Complex. Providing certified animal traceability, veterinary meat inspection clearances, and automated statutory fee assessment.
              </p>
            </div>
            <div className="login-features">
              <div className="login-feature">
                <div className="feature-icon"><Icon.Shield size={16} /></div>
                <div>
                  <h4>Food Safety Compliance</h4>
                  <p>Certified Class AA standards under RA 9296 and RA 10536 mandates.</p>
                </div>
              </div>
              <div className="login-feature">
                <div className="feature-icon"><Icon.Stethoscope size={16} /></div>
                <div>
                  <h4>Veterinary Clinical Oversight</h4>
                  <p>Ante-mortem health screening and post-mortem carcass inspection.</p>
                </div>
              </div>
              <div className="login-feature">
                <div className="feature-icon"><Icon.Activity size={16} /></div>
                <div>
                  <h4>Traceability &amp; Revenue Audit</h4>
                  <p>Digital records from pen receiving to official meat permit issuance.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="login-brand-foot">
            <Icon.CheckCircle size={14} />
            <span>Tinaan, City of Naga, Cebu</span>
          </div>
        </div>

        {/* Right form panel */}
        <div className="login-form-wrap">

          <div className={`login-box login-form ${isShaking ? "shake-error" : ""}`}>

            {/* Mobile / Installed App Brand Header */}
            <div className="login-mobile-brand">
              <div className="login-mobile-logo">
                <img src={logoImg} alt="LSMIS Official Logo" width="62" height="62" />
              </div>
              <div className="login-mobile-title">LSMIS</div>
              <div className="login-mobile-subtitle">Livestock Slaughter &amp; Meat Inspection</div>
              <span className="login-mobile-badge">City Government of Naga, Cebu</span>
            </div>

            {/* LOGIN SUCCESS ANIMATION OVERLAY */}
            {view === "verify-otp" ? (
              <>
                <div className="login-form-head" style={{ textAlign: "center" }}>
                  <div style={{
                    width: 60,
                    height: 60,
                    borderRadius: "50%",
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "2px solid #10b981",
                    color: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 14px",
                    boxShadow: "0 8px 20px rgba(16, 185, 129, 0.18)"
                  }}>
                    <Icon.ShieldCheck size={32} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-primary, #059669)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                    Two-Factor Authentication
                  </div>
                  <h1 style={{ fontSize: 23, fontWeight: 800 }}>Enter Authenticator Code</h1>
                  <p className="subtitle" style={{ maxWidth: 440, margin: "0 auto", fontSize: 13.5, lineHeight: 1.5 }}>
                    Open your authenticator app (Google Authenticator, Microsoft Authenticator, or 2FAS) and enter the 6-digit code for <strong>{pending2FA?.cleanEmail}</strong>.
                  </p>
                </div>

                {/* Helpful TOTP Info Card */}
                <div style={{
                  margin: "16px 0 18px",
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "rgba(14, 165, 233, 0.06)",
                  border: "1px solid rgba(14, 165, 233, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12
                }}>
                  <Icon.Smartphone size={20} style={{ color: "var(--color-primary, #0284c7)", flexShrink: 0 }} />
                  <div style={{ fontSize: 12.5, color: "var(--color-text-muted, #64748b)", lineHeight: 1.4 }}>
                    <strong style={{ color: "var(--color-text, #0f172a)" }}>Time-Based Code:</strong> Codes refresh every 30 seconds. Enter the current code displayed on your device.
                  </div>
                </div>

                <form onSubmit={handleVerify2FA} className="login-form-body" noValidate>
                  <div className="form-group">
                    <label className="form-label" htmlFor="twofa-code" style={{ textAlign: "center", display: "block", marginBottom: 8, fontSize: 13, fontWeight: 700 }}>
                      6-Digit Security Code
                    </label>
                    <div className={`login-pwd-wrap ${twoFaError ? "has-error" : ""}`}>
                      <input
                        id="twofa-code"
                        ref={twoFaInputRef}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        autoComplete="one-time-code"
                        className="form-control"
                        value={twoFaCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                          setTwoFaCode(val);
                          if (twoFaError) setTwoFaError("");
                        }}
                        placeholder="••••••"
                        style={{
                          textAlign: "center",
                          fontSize: 26,
                          letterSpacing: "0.35em",
                          fontWeight: 800,
                          fontFamily: "ui-monospace, monospace"
                        }}
                        required
                        disabled={twoFaLoading}
                        autoFocus
                      />
                    </div>
                  </div>

                  {twoFaError && (
                    <div id="twofa-error-alert" className="alert alert-error" role="alert" style={{ marginTop: 10 }}>
                      <span className="alert-icon"><Icon.AlertTriangle size={16} /></span>
                      <div><strong>Verification Failed</strong><span>{twoFaError}</span></div>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={twoFaLoading || twoFaCode.length !== 6}
                    block
                    size="lg"
                    className="login-submit"
                    style={{ marginTop: 16 }}
                  >
                    {twoFaLoading ? (
                      <>
                        <span className="spinner" />
                        <span>Verifying Code...</span>
                      </>
                    ) : (
                      <>
                        <Icon.CheckCircle size={16} />
                        <span>Verify &amp; Sign In</span>
                      </>
                    )}
                  </Button>

                  {/* Refresh challenge button */}
                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={handleRefreshChallenge}
                      disabled={twoFaLoading || twoFaCooldown > 0}
                      style={{
                        background: "none",
                        border: "none",
                        color: twoFaCooldown > 0 ? "var(--color-text-subtle)" : "var(--color-primary, #059669)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: twoFaCooldown > 0 ? "default" : "pointer",
                        textDecoration: twoFaCooldown > 0 ? "none" : "underline"
                      }}
                    >
                      {twoFaCooldown > 0 ? `Refresh challenge in ${twoFaCooldown}s` : "Code not working? Refresh Challenge"}
                    </button>
                  </div>

                  {/* Recovery Code Option */}
                  <div style={{ textAlign: "center", marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryError("");
                        setRecoveryCodeInput("");
                        setShowAdminAssistance(false);
                        setShowRecoveryModal(true);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--color-text-muted, #64748b)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      Lost access to your authenticator? Use Recovery Code
                    </button>
                  </div>

                  {/* Back to sign in */}
                  <button
                    type="button"
                    className="btn-back-to-landing"
                    onClick={handleCancel2FA}
                    style={{ marginTop: 12 }}
                  >
                    <Icon.ArrowLeft size={16} />
                    <span>Cancel &amp; Return to Sign In</span>
                  </button>
                </form>

                {/* Emergency Recovery Modal */}
                <Modal
                  open={showRecoveryModal}
                  onClose={() => !recoveryLoading && setShowRecoveryModal(false)}
                  title="Two-Factor Account Recovery"
                  size="md"
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        background: "rgba(2, 132, 199, 0.08)",
                        border: "1px solid rgba(2, 132, 199, 0.2)",
                        color: "#0369a1",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>Emergency Access:</strong> Enter one of your single-use 12-character recovery codes generated when you activated 2FA.
                    </div>

                    {!showAdminAssistance ? (
                      <form onSubmit={handleVerifyRecoveryCode} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                          <label
                            htmlFor="recovery-code-input"
                            style={{
                              display: "block",
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: "var(--color-text, #0f172a)",
                              marginBottom: 6,
                            }}
                          >
                            Emergency Recovery Code <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input
                            id="recovery-code-input"
                            type="text"
                            placeholder="XXXX-XXXX-XXXX"
                            value={recoveryCodeInput}
                            onChange={(e) => {
                              setRecoveryCodeInput(e.target.value.toUpperCase());
                              if (recoveryError) setRecoveryError("");
                            }}
                            maxLength={14}
                            style={{
                              width: "100%",
                              height: 44,
                              fontSize: 18,
                              letterSpacing: "0.15em",
                              fontWeight: 800,
                              textAlign: "center",
                              borderRadius: 8,
                              border: recoveryError ? "1.5px solid #ef4444" : "1px solid var(--color-border, #cbd5e1)",
                              background: "var(--color-bg, #ffffff)",
                              color: "var(--color-text, #0f172a)",
                              fontFamily: "ui-monospace, monospace",
                            }}
                            autoFocus
                            disabled={recoveryLoading}
                          />
                          {recoveryError && (
                            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                              <Icon.AlertTriangle size={13} />
                              <span>{recoveryError}</span>
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowRecoveryModal(false)}
                            disabled={recoveryLoading}
                            style={{ flex: 1, height: 40, borderRadius: 8 }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={recoveryLoading || !recoveryCodeInput.trim()}
                            style={{
                              flex: 1,
                              height: 40,
                              borderRadius: 8,
                              background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                              color: "#ffffff",
                              fontWeight: 700,
                            }}
                          >
                            {recoveryLoading ? (
                              <>
                                <Icon.RefreshCw size={14} className="animate-spin" />
                                <span>Verifying...</span>
                              </>
                            ) : (
                              "Verify & Access Account"
                            )}
                          </Button>
                        </div>

                        <div style={{ textAlign: "center", marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => setShowAdminAssistance(true)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-text-muted, #64748b)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            Don&apos;t have recovery codes? Request Administrator Assistance
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div
                          style={{
                            padding: "14px",
                            borderRadius: 10,
                            background: "var(--color-bg, #f8fafc)",
                            border: "1px solid var(--color-border, #cbd5e1)",
                            fontSize: 13,
                            color: "var(--color-text, #0f172a)",
                            lineHeight: 1.5,
                          }}
                        >
                          <h4 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 800 }}>
                            Administrator-Assisted 2FA Reset Procedure
                          </h4>
                          <p style={{ margin: "0 0 8px", color: "var(--color-text-muted, #64748b)" }}>
                            If you lost both your authenticator device and your recovery backup codes, you must verify your identity with the City Abattoir System Administration to authorize a security reset:
                          </p>
                          <ul style={{ margin: "0 0 10px 18px", padding: 0 }}>
                            <li>Present official City Government Employee ID or Meat Establishment Certificate.</li>
                            <li>Contact: <strong>Naga City Abattoir Admin Office</strong></li>
                            <li>Email: <strong>admin1@gmail.com / pardillojustin7@gmail.com</strong></li>
                          </ul>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            Once your identity is confirmed in person, the System Administrator will reset your 2FA factor in Admin Personnel Management.
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowAdminAssistance(false)}
                            style={{ flex: 1, height: 40, borderRadius: 8 }}
                          >
                            Back to Code Input
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => setShowRecoveryModal(false)}
                            style={{ flex: 1, height: 40, borderRadius: 8 }}
                          >
                            Understood
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Modal>
              </>
            ) : view === "signin" ? (
              <>
                <div className="login-form-head">
                  <h1>Login</h1>
                  <p className="subtitle">Enter your authorized email address to access the portal</p>
                </div>

                <form onSubmit={submitSignIn} className="login-form-body" noValidate>
                  <div className="form-group">
                    <label className="form-label" htmlFor="login-email">
                      Email <span className="req">*</span>
                    </label>
                    <div className="login-pwd-wrap">
                      <span className="login-pwd-icon"><Icon.Mail size={16} /></span>
                      <input
                        id="login-email"
                        ref={emailRef}
                        type="email"
                        className="form-control"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            document.getElementById("login-password")?.focus();
                          }
                        }}
                        placeholder="Enter your email address"
                        autoComplete="email"
                        required
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? "login-error-alert" : undefined}
                        disabled={loading || googleLoginLoading}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="login-password">
                      Password <span className="req">*</span>
                    </label>
                    <div className="login-pwd-wrap">
                      <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                      <input
                        id="login-password"
                        className="form-control"
                        type={showPwd ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        required
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? "login-error-alert" : undefined}
                        disabled={loading || googleLoginLoading}
                      />
                      <button
                        type="button"
                        className="login-pwd-toggle"
                        onClick={() => setShowPwd(!showPwd)}
                        aria-label={showPwd ? "Hide password" : "Show password"}
                        title={showPwd ? "Hide password" : "Show password"}
                      >
                        {showPwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                      </button>
                    </div>

                    {/* Remember Me and Forgot Password Row */}
                    <div className="login-options-row">
                      <label className="remember-me-label" htmlFor="remember-me">
                        <input
                          id="remember-me"
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => {
                            setRememberMe(e.target.checked);
                            localStorage.setItem("lsmis_remember_me", e.target.checked ? "true" : "false");
                          }}
                        />
                        <span>Remember me</span>
                      </label>
                      <a href="#" className="forgot-link" onClick={switchToForgot}>Forgot password?</a>
                    </div>
                  </div>

                  {/* Register as owner prompt */}
                  <div className="register-owner-prompt">
                    <span>Livestock producer or farm owner?</span>{" "}
                    <button
                      type="button"
                      className="register-owner-link"
                      onClick={switchToRegister}
                    >
                      Register as Owner
                    </button>
                  </div>

                  {error && (
                    <div id="login-error-alert" className="alert alert-error" role="alert">
                      <span className="alert-icon"><Icon.AlertTriangle size={16} /></span>
                      <div><strong>Authentication Failed</strong><span>{error}</span></div>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading || googleLoginLoading}
                    block
                    size="lg"
                    className={`login-submit ${loading ? "is-submitting" : ""}`}
                  >
                    {loading ? (
                      <>
                        <span className="spinner" />
                        <span>Verifying Credentials...</span>
                      </>
                    ) : (
                      <span>Login</span>
                    )}
                  </Button>

                  {/* Google sign-in is website-only: hidden inside the installed Android app */}
                  {!isNativeAndroidApp && (
                  <>
                  <div className="login-oauth-divider" role="separator" aria-label="Google Sign-In">
                    <span>or continue with</span>
                  </div>

                  <button
                    type="button"
                    className={`btn-google-oauth ${googleLoginLoading ? "is-loading" : ""}`}
                    onClick={handleGoogleOwnerLogin}
                    disabled={loading || googleLoginLoading}
                    aria-label="Continue with Google"
                  >
                    {googleLoginLoading ? (
                      <>
                        <span className="spinner spinner-google" />
                        <span>Connecting to Google...</span>
                      </>
                    ) : (
                      <>
                        <GoogleLogo size={19} />
                        <span>Continue with Google</span>
                      </>
                    )}
                  </button>
                  </>
                  )}

                  {!embedded && !isInstalled && (
                    <Link to="/" className="btn-back-to-landing btn-back-to-home">
                      <Icon.ArrowLeft size={16} />
                      <span>Back to Landing Page</span>
                    </Link>
                  )}


                </form>


              </>
            ) : view === "register" ? (
              <>
                {/* Owner Registration View */}
                <div className="login-form-head">
                  <h1>Register as Owner</h1>
                  <p className="subtitle">Create an official abattoir account to track livestock, slaughter progress, and clearances</p>
                </div>

                <form onSubmit={submitOwnerRegistration} className={`login-form-body ${regShake ? "form-shake" : ""}`} noValidate autoComplete="off">
                  {/* Full Name */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="reg-name">Full Name <span className="req">*</span></label>
                    <div className={`login-pwd-wrap ${regFieldErrors.name ? "has-error" : ""}`}>
                      <span className="login-pwd-icon"><Icon.User size={16} /></span>
                      <input
                        id="reg-name"
                        ref={regNameRef}
                        type="text"
                        autoComplete="off"
                        className="form-control"
                        value={regName}
                        onChange={(e) => {
                          setRegName(e.target.value);
                          if (regFieldErrors.name) setRegFieldErrors(prev => ({ ...prev, name: "" }));
                          if (regError) setRegError("");
                        }}
                        placeholder="e.g. Jastine Pardillo"
                        required
                        disabled={regLoading}
                      />
                    </div>
                    {regFieldErrors.name && (
                      <div className="field-error-text">
                        <Icon.AlertTriangle size={13} />
                        <span>{regFieldErrors.name}</span>
                      </div>
                    )}
                  </div>

                  {/* Contact Number & Username Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-contact">Contact Number <span className="req">*</span></label>
                      <div className={`login-pwd-wrap ${regFieldErrors.contact ? "has-error" : ""}`}>
                        <span className="login-pwd-icon"><Icon.Phone size={16} /></span>
                        <input
                          id="reg-contact"
                          ref={regContactRef}
                          type="tel"
                          inputMode="numeric"
                          maxLength={11}
                          autoComplete="off"
                          className="form-control"
                          value={regContact}
                          onChange={handleRegContactChange}
                          onBlur={async () => {
                            const digits = regContact.trim().replace(/\D/g, "");
                            if (digits.length === 11) {
                              try {
                                const dup = await ownerAuthService.checkDuplicate({
                                  contact: digits,
                                });
                                if (dup.duplicate && dup.field === "contact") {
                                  setRegFieldErrors((prev) => ({ ...prev, contact: dup.message }));
                                }
                              } catch (e) { }
                            }
                          }}
                          placeholder="09171234567"
                          required
                          disabled={regLoading}
                        />
                      </div>
                      {regFieldErrors.contact && (
                        <div className="field-error-text">
                          <Icon.AlertTriangle size={13} />
                          <span>{regFieldErrors.contact}</span>
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-username">Username <span className="req">*</span></label>
                      <div className={`login-pwd-wrap ${regFieldErrors.username ? "has-error" : ""}`}>
                        <span className="login-pwd-icon"><Icon.Tag size={16} /></span>
                        <input
                          id="reg-username"
                          ref={regUsernameRef}
                          type="text"
                          autoComplete="off"
                          className="form-control"
                          value={regUsername}
                          onChange={(e) => {
                            setRegUsername(e.target.value);
                            if (regFieldErrors.username) setRegFieldErrors(prev => ({ ...prev, username: "" }));
                            if (regError) setRegError("");
                          }}
                          onBlur={async () => {
                            const u = regUsername.trim();
                            if (u.length >= 3) {
                              try {
                                const dup = await ownerAuthService.checkDuplicate({
                                  username: u,
                                });
                                if (dup.duplicate && dup.field === "username") {
                                  setRegFieldErrors((prev) => ({ ...prev, username: dup.message }));
                                }
                              } catch (e) { }
                            }
                          }}
                          placeholder="e.g. jpardillo"
                          required
                          disabled={regLoading}
                        />
                      </div>
                      {regFieldErrors.username && (
                        <div className="field-error-text">
                          <Icon.AlertTriangle size={13} />
                          <span>{regFieldErrors.username}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Address */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="reg-address">Address <span className="req">*</span></label>
                    <div className={`login-pwd-wrap ${regFieldErrors.address ? "has-error" : ""}`}>
                      <span className="login-pwd-icon"><Icon.MapPin size={16} /></span>
                      <input
                        id="reg-address"
                        ref={regAddressRef}
                        type="text"
                        autoComplete="off"
                        className="form-control"
                        value={regAddress}
                        onChange={(e) => {
                          setRegAddress(e.target.value);
                          if (regFieldErrors.address) setRegFieldErrors(prev => ({ ...prev, address: "" }));
                          if (regError) setRegError("");
                        }}
                        placeholder="Barangay, City, Province (e.g. Sitio Baybay, Tinaan, Naga City)"
                        required
                        disabled={regLoading}
                      />
                    </div>
                    {regFieldErrors.address && (
                      <div className="field-error-text">
                        <Icon.AlertTriangle size={13} />
                        <span>{regFieldErrors.address}</span>
                      </div>
                    )}
                  </div>

                  {/* Email Address */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="reg-email">
                      Email Address <span className="req">*</span>
                    </label>
                    <div className={`login-pwd-wrap ${regFieldErrors.email ? "has-error" : ""}`}>
                      <span className="login-pwd-icon"><Icon.Mail size={16} /></span>
                      <input
                        id="reg-email"
                        ref={regEmailRef}
                        type="email"
                        autoComplete="off"
                        className="form-control"
                        value={regEmail}
                        onChange={(e) => {
                          setRegEmail(e.target.value);
                          if (regFieldErrors.email) setRegFieldErrors(prev => ({ ...prev, email: "" }));
                          if (regError) setRegError("");
                        }}
                        onBlur={async () => {
                          const em = regEmail.trim().toLowerCase();
                          if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
                            try {
                              const dup = await ownerAuthService.checkDuplicate({
                                email: em,
                              });
                              if (dup.duplicate && dup.field === "email") {
                                setRegFieldErrors((prev) => ({ ...prev, email: dup.message }));
                              }
                            } catch (e) { }
                          }
                        }}
                        placeholder="e.g. owner@example.com"
                        required
                        disabled={regLoading}
                      />
                    </div>
                    {regFieldErrors.email && (
                      <div className="field-error-text">
                        <Icon.AlertTriangle size={13} />
                        <span>{regFieldErrors.email}</span>
                      </div>
                    )}
                  </div>

                  {/* Password & Confirm Password */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-password">Password <span className="req">*</span></label>
                      <div className={`login-pwd-wrap ${regFieldErrors.password ? "has-error" : ""}`}>
                        <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                        <input
                          id="reg-password"
                          ref={regPasswordRef}
                          type={showRegPwd ? "text" : "password"}
                          autoComplete="new-password"
                          className="form-control"
                          value={regPassword}
                          onChange={(e) => {
                            setRegPassword(e.target.value);
                            if (regFieldErrors.password) setRegFieldErrors(prev => ({ ...prev, password: "" }));
                            if (regError) setRegError("");
                          }}
                          placeholder="Min 8 chars"
                          required
                          disabled={regLoading}
                        />
                        <button
                          type="button"
                          className="login-pwd-toggle"
                          onClick={() => setShowRegPwd(!showRegPwd)}
                          aria-label="Toggle password"
                        >
                          {showRegPwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                        </button>
                      </div>
                      {regFieldErrors.password && (
                        <div className="field-error-text">
                          <Icon.AlertTriangle size={13} />
                          <span>{regFieldErrors.password}</span>
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-cpwd">Confirm Password <span className="req">*</span></label>
                      <div className={`login-pwd-wrap ${regFieldErrors.confirmPassword ? "has-error" : ""}`}>
                        <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                        <input
                          id="reg-cpwd"
                          ref={regConfirmPasswordRef}
                          type={showRegCpwd ? "text" : "password"}
                          autoComplete="new-password"
                          className="form-control"
                          value={regConfirmPassword}
                          onChange={(e) => {
                            setRegConfirmPassword(e.target.value);
                            if (regFieldErrors.confirmPassword) setRegFieldErrors(prev => ({ ...prev, confirmPassword: "" }));
                            if (regError) setRegError("");
                          }}
                          placeholder="Re-enter password"
                          required
                          disabled={regLoading}
                        />
                        <button
                          type="button"
                          className="login-pwd-toggle"
                          onClick={() => setShowRegCpwd(!showRegCpwd)}
                          aria-label="Toggle confirm password"
                        >
                          {showRegCpwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                        </button>
                      </div>
                      {regFieldErrors.confirmPassword && (
                        <div className="field-error-text">
                          <Icon.AlertTriangle size={13} />
                          <span>{regFieldErrors.confirmPassword}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Real-time Password Security Visualizer */}
                  {regPassword && (
                    <div style={{ marginTop: "-4px", marginBottom: 12 }}>
                      <PasswordRequirements password={regPassword} />
                    </div>
                  )}

                  {/* User Agreement & Privacy Policy Checkbox */}
                  <div className={`reg-agreement-box ${regFieldErrors.agreement ? "has-error" : ""}`} style={{ flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%" }}>
                      <input
                        id="reg-agreement"
                        ref={regAgreementRef}
                        type="checkbox"
                        checked={regAgreement}
                        onChange={(e) => {
                          setRegAgreement(e.target.checked);
                          if (regFieldErrors.agreement) setRegFieldErrors(prev => ({ ...prev, agreement: "" }));
                          if (regError) setRegError("");
                        }}
                        className="reg-agreement-checkbox"
                        required
                      />
                      <label htmlFor="reg-agreement" className="reg-agreement-label">
                        I agree to the{" "}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setAgreementModalOpen(true);
                          }}
                          className="reg-agreement-link"
                        >
                          User Agreement and Privacy Policy
                        </button>{" "}
                        for LSMIS Livestock Owners. I understand that government ID upload is not required and my account will be reviewed by the Administrator.
                      </label>
                    </div>
                    {regFieldErrors.agreement && (
                      <div className="field-error-text" style={{ marginTop: 8, paddingLeft: 30 }}>
                        <Icon.AlertTriangle size={14} />
                        <span>{regFieldErrors.agreement}</span>
                      </div>
                    )}
                  </div>

                  {regError && (
                    <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>
                      <span className="alert-icon"><Icon.AlertTriangle size={16} /></span>
                      <div><strong>Registration Blocked</strong><span>{regError}</span></div>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={regLoading}
                    block
                    size="lg"
                    className={`login-submit ${regLoading ? "is-submitting" : ""}`}
                  >
                    {regLoading ? (
                      <>
                        <span className="spinner" />
                        <span>Submitting Registration...</span>
                      </>
                    ) : (
                      <span>Submit Registration</span>
                    )}
                  </Button>

                  {/* Back to Sign In directly below Submit */}
                  <button
                    type="button"
                    className="btn-back-to-landing"
                    onClick={switchToSignin}
                  >
                    <Icon.ArrowLeft size={16} />
                    <span>Already have an account? Sign In</span>
                  </button>
                </form>
              </>
            ) : view === "reg-submitted" ? (
              <>
                {/* Registration Submitted & Pending Admin Approval Confirmation */}
                <div className="login-form-head" style={{ textAlign: "center" }}>
                  <div style={{
                    width: 68,
                    height: 68,
                    borderRadius: "50%",
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "2px solid #10b981",
                    color: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                    boxShadow: "0 8px 20px rgba(16, 185, 129, 0.2)"
                  }}>
                    <Icon.CheckCircle size={38} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#10b981", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                    Registration Submitted Successfully
                  </div>
                  <h1>Pending Admin Approval</h1>
                  <p className="subtitle" style={{ maxWidth: 440, margin: "0 auto" }}>
                    Your registration form has been submitted. In compliance with abattoir regulatory standards, your owner account is awaiting review and approval by the Administrator.
                  </p>
                </div>

                <div style={{
                  background: "var(--color-surface, #ffffff)",
                  border: "1px solid var(--color-border, #e2e8f0)",
                  borderRadius: 14,
                  padding: "18px 20px",
                  margin: "20px 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Registered Owner:</span>
                    <strong style={{ color: "var(--color-text, #0f172a)" }}>{registeredOwnerInfo?.name || "-"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Email:</span>
                    <strong style={{ color: "var(--color-text, #0f172a)" }}>{registeredOwnerInfo?.email || "-"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14.5 }}>
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Current Status:</span>
                    <span style={{
                      padding: "4px 12px",
                      borderRadius: 999,
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#d97706",
                      fontWeight: 700,
                      fontSize: 13,
                      border: "1px solid rgba(245, 158, 11, 0.3)"
                    }}>
                      Pending Admin Approval
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Registration Ref ID:</span>
                    <strong style={{ color: "var(--color-text, #0f172a)", fontFamily: "monospace" }}>
                      {registeredOwnerInfo?.id || "REG-001-2026"}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Owner ID:</span>
                    <span style={{ fontStyle: "italic", color: "var(--color-text-muted, #94a3b8)" }}>To be assigned upon approval (e.g. OWN-001-2026)</span>
                  </div>
                </div>

                <div style={{
                  padding: "14px 16px",
                  background: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  borderRadius: 11,
                  fontSize: 14,
                  color: "var(--color-text, #1e40af)",
                  lineHeight: 1.5,
                  marginBottom: 20
                }}>
                  ℹ️ <strong>Next Steps:</strong> Once the Administrator approves your registration, you may log in using <strong>Continue with Google</strong> or your registered username/email and password to access the Owner Portal.
                </div>

                <Button
                  type="button"
                  onClick={switchToSignin}
                  block
                  size="lg"
                  className="login-submit"
                >
                  <Icon.Lock size={16} />
                  <span>Return to Sign In</span>
                </Button>
              </>
            ) : fpSuccess ? (
              <>
                {/* Password Changed Successfully Alert Screen */}
                <div className="login-form-head">
                  <div className="form-icon-badge" style={{ background: "rgba(16, 185, 129, 0.12)", color: "var(--color-primary, #007A53)", width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px auto" }}>
                    <Icon.CheckCircle size={32} />
                  </div>
                  <h1>Password Changed</h1>
                  <p className="subtitle">Your account password has been successfully updated</p>
                </div>

                <div className="alert alert-success" role="alert" style={{ marginBottom: 20, padding: "16px", borderRadius: 10 }}>
                  <span className="alert-icon" style={{ marginTop: 2 }}><Icon.CheckCircle size={20} /></span>
                  <div>
                    <strong style={{ fontSize: 14 }}>Password Updated Successfully</strong>
                    <span style={{ fontSize: 13, marginTop: 4 }}>
                      The password for <strong>{fpEmail}</strong> has been changed. You can now sign in using your new credentials.
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={switchToSignin}
                  block
                  size="lg"
                  className="login-submit"
                >
                  <Icon.LogIn size={18} />
                  <span>Proceed to Sign In</span>
                </Button>


              </>
            ) : (
              <>
                {/* Forgot Password Header - Unified with Sign In */}
                <div className="login-form-head">
                  <h1>Reset Password</h1>
                  <p className="subtitle">Enter your registered email and verification code to recover your account</p>
                </div>

                <form
                  onSubmit={submitForgot}
                  className="login-form-body"
                  noValidate
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                    }
                  }}
                >
                  {/* Registered Email + Send Code row */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="fp-email">
                      Registered Email Address or Username <span className="req">*</span>
                    </label>
                    <div className="fp-email-row">
                      <div className="login-pwd-wrap fp-email-input-wrap">
                        <span className="login-pwd-icon"><Icon.Mail size={16} /></span>
                        <input
                          id="fp-email"
                          ref={fpEmailRef}
                          type="text"
                          className="form-control"
                          value={fpEmail}
                          onChange={(e) => {
                            setFpEmail(e.target.value);
                            if (fpError) setFpError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          placeholder="e.g. user@gmail.com or username"
                          autoComplete="username"
                          required
                          disabled={loadingSend}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={loadingSend || !fpEmail.trim() || fpCooldown > 0}
                        className="btn-send-code"
                        title={fpCooldown > 0 ? `Wait ${fpCooldown}s before requesting a new code` : "Send 6-digit OTP code to email"}
                      >
                        {loadingSend ? (
                          <>
                            <span className="spinner" />
                            <span>Sending...</span>
                          </>
                        ) : fpCooldown > 0 ? (
                          <>
                            <Icon.Clock size={15} />
                            <span>Resend ({fpCooldown}s)</span>
                          </>
                        ) : (
                          <>
                            <Icon.Send size={15} />
                            <span>{fpCodeSent ? "Resend OTP" : "Send OTP"}</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="fp-helper-text">
                      Click <strong>{fpCodeSent ? "Resend OTP" : "Send OTP"}</strong> to dispatch a 6-digit recovery code to your registered email.
                    </div>
                  </div>

                  {/* Alert Message */}
                  {fpError && (
                    <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>
                      <span className="alert-icon"><Icon.AlertTriangle size={16} /></span>
                      <div><strong>Password Recovery Alert</strong><span>{fpError}</span></div>
                    </div>
                  )}

                  {/* Verification Code */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="fp-code">
                      6-Digit Verification Code <span className="req">*</span>
                    </label>
                    <div className="login-pwd-wrap">
                      <span className="login-pwd-icon"><Icon.Shield size={16} /></span>
                      <input
                        id="fp-code"
                        ref={fpCodeRef}
                        type="text"
                        maxLength={6}
                        className="form-control fp-code-input"
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                          if (fpError) setFpError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.preventDefault();
                        }}
                        placeholder="• • • • • •"
                        required
                      />
                    </div>
                  </div>

                  {/* New Password */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="fp-new-password">
                      New Password <span className="req">*</span>
                    </label>
                    <div className="login-pwd-wrap">
                      <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                      <input
                        id="fp-new-password"
                        className="form-control"
                        type={showFpPwd ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        onFocus={() => setShowFpRequirements(true)}
                        onClick={() => setShowFpRequirements(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.preventDefault();
                        }}
                        placeholder="Enter new strong password"
                        required
                      />
                      <button
                        type="button"
                        className="login-pwd-toggle"
                        onClick={() => setShowFpPwd(!showFpPwd)}
                        aria-label={showFpPwd ? "Hide password" : "Show password"}
                      >
                        {showFpPwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm New Password */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="fp-confirm-password">
                      Confirm New Password <span className="req">*</span>
                    </label>
                    <div className="login-pwd-wrap">
                      <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                      <input
                        id="fp-confirm-password"
                        className="form-control"
                        type={showFpCpwd ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.preventDefault();
                        }}
                        placeholder="Re-enter password"
                        required
                      />
                      <button
                        type="button"
                        className="login-pwd-toggle"
                        onClick={() => setShowFpCpwd(!showFpCpwd)}
                        aria-label={showFpCpwd ? "Hide password" : "Show password"}
                      >
                        {showFpCpwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Password Requirements - only show when password field is focused or clicked */}
                  {showFpRequirements && (
                    <div style={{ marginTop: "-6px", marginBottom: "16px" }}>
                      <PasswordRequirements password={newPassword} />
                    </div>
                  )}

                  {/* Explicit Submit Button - Click required */}
                  <Button
                    type="button"
                    onClick={submitForgot}
                    disabled={loadingReset}
                    block
                    size="lg"
                    className="login-submit"
                  >
                    {loadingReset ? (
                      <><span className="spinner" /><span>Updating Password...</span></>
                    ) : (
                      <><Icon.ShieldCheck size={18} /><span>Update Password</span></>
                    )}
                  </Button>

                  {/* Secondary Back Button directly below Submit */}
                  <button
                    type="button"
                    className="btn-back-to-landing"
                    onClick={switchToSignin}
                  >
                    <Icon.ArrowLeft size={16} />
                    <span>Back to Sign In</span>
                  </button>
                </form>


              </>
            )}

            {/* USER AGREEMENT & DATA PRIVACY MODAL */}
            <Modal
              open={agreementModalOpen}
              onClose={() => setAgreementModalOpen(false)}
              title="LSMIS Livestock Owner User Agreement & Privacy Policy"
              size="lg"
            >
              <div className="agreement-modal-content">
                <div className="agreement-modal-notice">
                  <strong>Regulatory Notice (Republic of the Philippines)</strong>
                  <p>
                    Standard abattoir operations operating under Republic Act No. 9296 (The Meat Inspection Code of the Philippines) as amended by RA 10536, and the National Meat Inspection Service (NMIS).
                  </p>
                </div>

                <h4>1. Purpose of Account Registration</h4>
                <p>
                  By registering for the Livestock Slaughter and Meat Inspection System (LSMIS) Owner Portal, you are establishing an authorized profile as a livestock producer, farm operator, or consignee. This account allows you to securely monitor intake receiving, ante-mortem veterinary evaluations, slaughter stages, carcass weights, payments, and regulatory meat inspection certificates (MIC) for your registered animals.
                </p>

                <h4>2. View-Only Access &amp; Anti-Tamper Policy</h4>
                <p>
                  Livestock owners are granted strict <strong>View-Only</strong> access to their own animals and records. Official veterinary inspection findings, carcass scale weights, laboratory results, fee tariffs, and gate passes are recorded exclusively by authorized City Meat Inspectors, Licensed Veterinarians, and Abattoir Staff. Any attempt to tamper with or alter digital inspection records is strictly prohibited under Philippine law.
                </p>

                <h4>3. Data Privacy Act of 2012 (RA 10173) Consent</h4>
                <p>
                  You consent to the collection and processing of your full name, contact number, address, and livestock provenance details. This information is utilized solely for animal traceability, food safety oversight, official receipting, and disease outbreak containment in coordination with the Bureau of Animal Industry (BAI) and local government authorities.
                </p>

                <h4>4. Administrator Approval &amp; Unique Owner ID</h4>
                <p>
                  Account creation does not grant immediate portal access. Upon submitting your registration form, your application will be reviewed by the Abattoir Administrator. When approved, a permanent unique Owner ID (e.g. <code>OWN-2026-XXXX</code>) will be generated, allowing staff to select your profile for livestock intake without redundant data encoding.
                </p>

                <div className="agreement-modal-actions">
                  <Button variant="outline" onClick={() => setAgreementModalOpen(false)}>Close</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setRegAgreement(true);
                      setAgreementModalOpen(false);
                      showToast("User Agreement & Privacy Policy accepted", "success");
                    }}
                  >
                    <Icon.Check size={16} />
                    <span>I Understand &amp; Accept (v1.0-2026)</span>
                  </Button>
                </div>
              </div>
            </Modal>

            {/* PASSWORD UPDATED CONFIRMATION MODAL */}
            <AlertDialog
              open={successModalOpen}
              onClose={() => {
                setSuccessModalOpen(false);
                switchToSignin();
              }}
              title="Password Updated Successfully"
              message="Your password has been changed successfully! You can now sign in with your new password."
              buttonText="Proceed to Sign In"
              variant="success"
            />

            {/* ACCOUNT TERMINATED POPUP MODAL */}
            <Modal
              open={terminationNotice.open}
              onClose={() => {
                setTerminationNotice({ open: false, reason: "", terminatedUntil: null });
                sessionStorage.removeItem("lsmis_termination_notice");
              }}
              title="Account Terminated"
              size="sm"
              closeOnBackdropClick={false}
            >
              <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                  }}
                >
                  <Icon.AlertTriangle size={24} style={{ color: "#dc2626", flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: "block", fontSize: "14px", color: "#991b1b" }}>Access Temporarily Restricted</strong>
                    <span style={{ fontSize: "12px", color: "#7f1d1d" }}>Account termination restriction active (4 hours)</span>
                  </div>
                </div>

                <p style={{ fontSize: "13.5px", color: "#334155", lineHeight: 1.6, margin: 0 }}>
                  Your account is still under termination. You are unable to log in until the restriction expires or the administrator restores your account. Changing your password will not remove this restriction.
                </p>

                {terminationNotice.reason && (
                  <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: "3px" }}>
                      Reason for Termination:
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                      {terminationNotice.reason}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "8px" }}>
                  <Button onClick={() => {
                    setTerminationNotice({ open: false, reason: "", terminatedUntil: null });
                    sessionStorage.removeItem("lsmis_termination_notice");
                  }}>
                    Understand &amp; Close
                  </Button>
                </div>
              </div>
            </Modal>

            {/* CONCURRENT LOGIN / SINGLE ACTIVE SESSION POPUP MODAL */}
            <Modal
              open={concurrentNoticeOpen && !terminationNotice.open && !sessionStorage.getItem("lsmis_termination_notice")}
              onClose={() => {
                setConcurrentNoticeOpen(false);
                sessionStorage.removeItem("lsmis_concurrent_logout_notice");
                if (typeof window !== "undefined" && window.history && window.history.replaceState) {
                  window.history.replaceState({}, document.title, window.location.pathname);
                }
              }}
              title="Account Logged Out"
              size="sm"
            >
              <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    color: "#1e40af",
                  }}
                >
                  <Icon.ShieldAlert size={24} style={{ color: "#2563eb", flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: "block", fontSize: "14px", color: "#1e40af" }}>Session Active Elsewhere</strong>
                    <span style={{ fontSize: "12px", color: "#1d4ed8" }}>Single Active Session Security Rule</span>
                  </div>
                </div>

                <p style={{ fontSize: "13.5px", color: "#334155", lineHeight: 1.6, margin: 0 }}>
                  Your session has ended because your account was signed in elsewhere. For your security, only one active authenticated session is allowed per account at a time. If this was not you, please change your password or contact your system administrator.
                </p>

                <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "8px" }}>
                  <Button onClick={() => {
                    setConcurrentNoticeOpen(false);
                    sessionStorage.removeItem("lsmis_concurrent_logout_notice");
                    if (typeof window !== "undefined" && window.history && window.history.replaceState) {
                      window.history.replaceState({}, document.title, window.location.pathname);
                    }
                  }}>
                    Understand &amp; Close
                  </Button>
                </div>
              </div>
            </Modal>

            {/* UNREGISTERED GOOGLE ACCOUNT WARNING MODAL */}
            <Modal
              open={unregisteredModalOpen}
              onClose={() => setUnregisteredModalOpen(false)}
              title="Account Not Registered"
              size="sm"
              closeOnBackdropClick={false}
            >
              <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="unregistered-account-badge">
                  <Icon.AlertTriangle size={24} style={{ color: "#d97706", flexShrink: 0 }} />
                  <div>
                    <strong>Account Not Registered</strong>
                    <span>Owner registration required before login</span>
                  </div>
                </div>

                <p style={{ fontSize: "13.5px", color: "var(--color-text, #334155)", lineHeight: 1.6, margin: 0 }}>
                  This Google account is not registered. Please register an owner account first.
                </p>

                {unregisteredGoogleEmail && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background: "var(--color-surface-hover, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    fontSize: "12.5px"
                  }}>
                    <GoogleLogo size={14} />
                    <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Google Account:</span>
                    <strong style={{ color: "var(--color-text, #0f172a)" }}>{unregisteredGoogleEmail}</strong>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", paddingTop: "8px" }}>
                  <Button
                    variant="outline"
                    onClick={() => setUnregisteredModalOpen(false)}
                  >
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setUnregisteredModalOpen(false);
                      switchToRegister();
                    }}
                  >
                    Create Account
                  </Button>
                </div>
              </div>
            </Modal>

          </div>
        </div>
      </div>
    </div>
  );
};
