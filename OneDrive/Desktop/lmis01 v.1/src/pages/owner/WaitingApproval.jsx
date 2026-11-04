import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../services/supabaseClient";
import { TABLES, STORAGE_KEYS } from "../../utils/constants";
import { formatPhDateTime, formatDate } from "../../utils/formatters";
import { initials } from "../../utils/helpers";
import { Icon } from "../../components/icons";
import { Button } from "../../components/ui";
import { useToast } from "../../components/notifications/Toast";
import { authStore } from "../../store/authStore";
import { adminService } from "../../services/adminService";

// Official Google 4-Color "G" Brand Logo
const GoogleLogo = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      fill="#EA4335"
    />
  </svg>
);

export const WaitingApproval = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const [ownerInfo, setOwnerInfo] = useState(() => {
    try {
      if (location.state?.owner) return location.state.owner;
      const cached = sessionStorage.getItem("lsmis_pending_owner");
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  });

  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  // Load latest owner info from database
  const loadOwnerStatus = useCallback(async (isManual = false) => {
    if (isManual) setChecking(true);
    try {
      // 1. Get authenticated Supabase user or target email
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;

      let email =
        ownerInfo?.email ||
        authUser?.email ||
        authUser?.user_metadata?.email ||
        null;

      if (!email && !authUser) {
        // No session or cached state
        if (!ownerInfo) {
          navigate("/login", { replace: true });
        }
        return;
      }

      // Query public.owners for status
      let query = supabase.from(TABLES.OWNERS).select("*");
      if (email) {
        query = query.ilike("email", email.trim().toLowerCase());
      } else if (authUser?.id) {
        query = query.eq("auth_user_id", authUser.id);
      }

      const { data: dbOwner } = await query.limit(1).maybeSingle();

      if (dbOwner) {
        const normStatus = String(dbOwner.status || "").toLowerCase().trim();
        const approved =
          (normStatus === "approved" || normStatus === "active") &&
          !String(dbOwner.id || "").startsWith("REG");

        const merged = {
          ...ownerInfo,
          ...dbOwner,
          avatar_url: dbOwner.avatar_url || authUser?.user_metadata?.avatar_url || ownerInfo?.avatar_url,
          email: dbOwner.email || email,
          name: dbOwner.name || authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || ownerInfo?.name,
        };

        setOwnerInfo(merged);
        sessionStorage.setItem("lsmis_pending_owner", JSON.stringify(merged));

        if (approved) {
          setIsApproved(true);
          if (isManual) {
            showToast("Congratulations! Your account has been approved by the Administrator.", "success");
          }
        } else if (normStatus.includes("reject")) {
          showToast("Your registration application was not approved. Please contact the administration.", "error");
        } else if (isManual) {
          showToast("Status checked: Your registration is still awaiting administrator approval.", "info");
        }
      } else if (ownerInfo) {
        if (isManual) {
          showToast("Your registration is still awaiting review.", "info");
        }
      }
    } catch (err) {
      console.warn("WaitingApproval status check note:", err);
      if (isManual) {
        showToast("Unable to refresh status. Please check your connection.", "error");
      }
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [ownerInfo, navigate, showToast]);

  useEffect(() => {
    loadOwnerStatus();
  }, [loadOwnerStatus]);

  // Supabase Realtime listener to immediately detect when Admin clicks "Approve"
  useEffect(() => {
    let channel = null;
    try {
      const email = ownerInfo?.email;
      channel = supabase
        .channel("pending_owner_approval_watch")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: TABLES.OWNERS,
          },
          (payload) => {
            const updated = payload.new;
            if (!updated) return;
            const updatedEmail = (updated.email || "").toLowerCase().trim();
            const targetEmail = (email || "").toLowerCase().trim();
            if (updatedEmail === targetEmail || updated.id === ownerInfo?.id) {
              const st = String(updated.status || "").toLowerCase().trim();
              if (st === "approved" || st === "active") {
                setIsApproved(true);
                setOwnerInfo((prev) => ({ ...prev, ...updated }));
                showToast("Account approved! You can now enter the Owner Portal.", "success");
              } else if (st === "rejected") {
                setOwnerInfo((prev) => ({ ...prev, ...updated }));
                showToast("Your registration was not approved. Please contact the administration.", "error");
              }
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.warn("Realtime approval channel warning:", err);
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [ownerInfo?.email, ownerInfo?.id, showToast]);

  // Sign out cleanly
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (_) {}
      sessionStorage.removeItem("lsmis_pending_owner");
      sessionStorage.removeItem(STORAGE_KEYS.SESSION);
      sessionStorage.removeItem("lsmis_google_oauth_intent");
      sessionStorage.removeItem("lsmis_google_reg_pending");
      sessionStorage.removeItem("lsmis_google_reg_draft");
      authStore.set({ session: null, loading: false });
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  };

  // Enter dashboard after approval
  const handleProceedToDashboard = async () => {
    setChecking(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      const email = ownerInfo?.email || user?.email;

      // Register session in authStore
      let activeSessionId = "sess_" + Date.now();
      try {
        const regRes = await adminService.registerActiveSession({
          email,
          role: "owner",
          sessionId: activeSessionId,
        });
        if (regRes?.sessionId) activeSessionId = regRes.sessionId;
      } catch (_) {}

      const sessionObj = {
        id: user?.id || ownerInfo?.auth_user_id || ownerInfo?.id,
        user_id: user?.id || ownerInfo?.auth_user_id || ownerInfo?.id,
        role: "owner",
        name: ownerInfo?.name || "Livestock Owner",
        email: email,
        username: ownerInfo?.username || email?.split("@")[0] || "owner",
        owner_id: ownerInfo?.id,
        google_id: ownerInfo?.google_id,
        avatar_url: ownerInfo?.avatar_url,
        auth_provider: ownerInfo?.auth_provider || "google",
        session_id: activeSessionId,
        ts: Date.now(),
        login_time: new Date().toISOString(),
      };

      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sessionObj));
      sessionStorage.removeItem("lsmis_pending_owner");
      authStore.set({ session: sessionObj, loading: false, isInitialized: true });
      navigate("/owner", { replace: true });
    } catch (e) {
      console.warn("Proceed to dashboard notice:", e);
      navigate("/login", { replace: true });
    } finally {
      setChecking(false);
    }
  };

  const currentStatus = isApproved
    ? "Approved"
    : String(ownerInfo?.status || "").toLowerCase().includes("reject")
    ? "Rejected"
    : "Pending Approval";

  const isRejected = currentStatus === "Rejected";
  const displayName = ownerInfo?.name || "Livestock Owner";
  const displayEmail = ownerInfo?.email || "—";
  const displayId = ownerInfo?.id || "REG-001-2026";
  const regDateRaw = ownerInfo?.registered_date || ownerInfo?.created_at;
  const displayDate = formatPhDateTime(regDateRaw) || formatDate(regDateRaw) || "Today";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg, #f8fafc)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 540,
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: 18,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        }}
      >
        {/* Top Accent Bar */}
        <div
          style={{
            height: 6,
            background: isApproved
              ? "linear-gradient(90deg, #10b981 0%, #059669 100%)"
              : isRejected
              ? "linear-gradient(90deg, #ef4444 0%, #dc2626 100%)"
              : "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)",
          }}
        />

        <div style={{ padding: "32px 28px" }}>
          {/* Header Status Icon */}
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: isApproved
                  ? "rgba(16, 185, 129, 0.12)"
                  : isRejected
                  ? "rgba(239, 68, 68, 0.12)"
                  : "rgba(245, 158, 11, 0.14)",
                color: isApproved ? "#10b981" : isRejected ? "#ef4444" : "#d97706",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              {isApproved ? (
                <Icon.CheckCircle size={36} />
              ) : isRejected ? (
                <Icon.XCircle size={36} />
              ) : (
                <Icon.Clock size={36} />
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: isApproved ? "#10b981" : isRejected ? "#ef4444" : "#d97706",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              {isApproved
                ? "Account Approved"
                : isRejected
                ? "Application Not Approved"
                : "Registration Submitted Successfully"}
            </div>

            <h1
              style={{
                fontSize: "1.45rem",
                fontWeight: 800,
                color: "var(--color-text, #0f172a)",
                margin: "0 0 8px 0",
                lineHeight: 1.3,
              }}
            >
              {isApproved
                ? "Welcome to LSMIS!"
                : isRejected
                ? "Registration Rejected"
                : "Awaiting Administrator Approval"}
            </h1>

            <p
              style={{
                fontSize: "0.92rem",
                color: "var(--color-text-secondary, #64748b)",
                lineHeight: 1.55,
                margin: 0,
                maxWidth: 460,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              {isApproved
                ? "Your owner registration has been approved. You can now access your livestock dashboard."
                : isRejected
                ? (ownerInfo?.rejection_reason
                    ? `Reason: "${ownerInfo.rejection_reason}". Please contact the administration for assistance.`
                    : "Your account registration was not approved. Please contact the administration.")
                : "Your account is currently awaiting approval. You will receive an update once your registration has been reviewed."}
            </p>
          </div>

          {/* Details Card */}
          <div
            style={{
              background: "var(--color-surface-subtle, #f8fafc)",
              border: "1px solid var(--color-border, #e2e8f0)",
              borderRadius: 14,
              padding: "18px 20px",
              marginBottom: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Owner Identity Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border, #e2e8f0)",
              }}
            >
              {ownerInfo?.avatar_url && !avatarError ? (
                <img
                  src={ownerInfo.avatar_url}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid #3b82f6",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                    color: "#ffffff",
                    fontWeight: 800,
                    fontSize: "1rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {initials(displayName) || "OW"}
                </div>
              )}

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    color: "var(--color-text, #0f172a)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-text-secondary, #64748b)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#2563eb", fontWeight: 600 }}>
                    <GoogleLogo size={13} /> Connected Google Account
                  </span>
                </div>
              </div>
            </div>

            {/* Email */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.88rem" }}>
              <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Registration Email:</span>
              <strong style={{ color: "var(--color-text, #0f172a)", wordBreak: "break-all" }}>
                {displayEmail}
              </strong>
            </div>

            {/* Account Status */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.88rem" }}>
              <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Current Account Status:</span>
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: isApproved
                    ? "rgba(16, 185, 129, 0.15)"
                    : isRejected
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(245, 158, 11, 0.15)",
                  color: isApproved ? "#047857" : isRejected ? "#b91c1c" : "#b45309",
                  fontWeight: 700,
                  fontSize: "0.78rem",
                  border: isApproved
                    ? "1px solid rgba(16, 185, 129, 0.3)"
                    : isRejected
                    ? "1px solid rgba(239, 68, 68, 0.3)"
                    : "1px solid rgba(245, 158, 11, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {isApproved ? (
                  <Icon.CheckCircle size={12} />
                ) : isRejected ? (
                  <Icon.XCircle size={12} />
                ) : (
                  <Icon.Clock size={12} />
                )}
                {currentStatus}
              </span>
            </div>

            {/* Reference ID */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.88rem" }}>
              <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Reference ID:</span>
              <span className="mono" style={{ fontWeight: 700, color: "var(--color-primary, #0369a1)" }}>
                {displayId}
              </span>
            </div>

            {/* Submitted Date */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.88rem" }}>
              <span style={{ color: "var(--color-text-secondary, #64748b)" }}>Submitted On:</span>
              <span style={{ color: "var(--color-text-secondary, #64748b)" }}>{displayDate}</span>
            </div>
          </div>

          {/* Informational Notice */}
          <div
            style={{
              padding: "12px 14px",
              background: isApproved
                ? "rgba(16, 185, 129, 0.08)"
                : "rgba(59, 130, 246, 0.08)",
              border: isApproved
                ? "1px solid rgba(16, 185, 129, 0.25)"
                : "1px solid rgba(59, 130, 246, 0.2)",
              borderRadius: 10,
              fontSize: "0.82rem",
              color: isApproved ? "#065f46" : "#1e40af",
              lineHeight: 1.5,
              marginBottom: 22,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <Icon.Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              {isApproved ? (
                <span>
                  <strong>Approval Notice:</strong> You can now use <strong>Continue with Google</strong> on the Login page to access your registered livestock, slaughter queue schedules, and official meat permits at any time.
                </span>
              ) : (
                <span>
                  <strong>Regulatory Process:</strong> Abattoir security policies require administrator verification for newly registered livestock owners before granting portal access. You may check your status below.
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {isApproved ? (
              <Button
                variant="primary"
                size="lg"
                block
                onClick={handleProceedToDashboard}
                disabled={checking}
              >
                <Icon.ArrowRight size={16} />
                <span>Go to Owner Dashboard</span>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                block
                onClick={() => loadOwnerStatus(true)}
                disabled={checking}
              >
                <Icon.RefreshCw size={15} className={checking ? "spin" : ""} />
                <span>{checking ? "Checking Approval Status…" : "Check Approval Status"}</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="lg"
              block
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <Icon.LogOut size={15} />
              <span>{signingOut ? "Signing Out…" : "Sign Out"}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
