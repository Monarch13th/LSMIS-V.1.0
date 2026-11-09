import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Card, Modal } from "../ui";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { mfaService } from "../../services/mfaService";
import { supabase } from "../../services/supabaseClient";

export const AuthSecuritySessions = ({ userEmail, userRole, userName, onSignOut }) => {
  const { showToast } = useToast();

  // 2FA State
  const [loading2FA, setLoading2FA] = useState(true);
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [verifiedFactor, setVerifiedFactor] = useState(null);
  const [assuranceLevel, setAssuranceLevel] = useState(null);
  const [lastVerifiedTime, setLastVerifiedTime] = useState(null);

  // Enrollment Modal State
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollData, setEnrollData] = useState(null); // { factorId, qrCode, secret, uri }
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [verifyingEnroll, setVerifyingEnroll] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const enrollInputRef = useRef(null);

  // Disable 2FA Modal State
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableOtpCode, setDisableOtpCode] = useState("");
  const [showDisablePw, setShowDisablePw] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState("");

  // Recovery Backup Codes Modal State
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [savedCodesChecked, setSavedCodesChecked] = useState(false);
  const [copiedRecoveryCodes, setCopiedRecoveryCodes] = useState(false);

  // Load MFA Status from Supabase Auth
  const fetchMfaStatus = useCallback(async () => {
    setLoading2FA(true);
    try {
      const { verifiedFactor: vf, is2FAEnabled: enabled } = await mfaService.listFactors();
      const aal = await mfaService.getAssuranceLevel();
      const cleanEmail = (userEmail || "").trim().toLowerCase();
      const local2FA = cleanEmail ? localStorage.getItem("lmis_2fa_enabled_" + cleanEmail) === "true" : false;

      const active2FA = enabled || local2FA;
      setIs2FAEnabled(active2FA);
      setVerifiedFactor(vf);
      setAssuranceLevel(aal);

      if (active2FA && aal?.currentLevel === "aal2") {
        setLastVerifiedTime("Verified during this active session (AAL2)");
      } else if (active2FA && vf?.created_at) {
        setLastVerifiedTime(`Enrolled on ${new Date(vf.created_at).toLocaleDateString()}`);
      } else if (active2FA) {
        setLastVerifiedTime("Active and enforced on login");
      } else {
        setLastVerifiedTime(null);
      }
    } catch (err) {
      console.warn("Failed to fetch Supabase MFA status:", err);
    } finally {
      setLoading2FA(false);
    }
  }, [userEmail]);

  useEffect(() => {
    fetchMfaStatus();
  }, [fetchMfaStatus]);

  // Handle Starting 2FA Enrollment
  const handleOpenEnrollment = async () => {
    setEnrolling(true);
    setEnrollError("");
    setEnrollCode("");
    setCopiedSecret(false);

    try {
      const { data, error } = await mfaService.startEnrollment("LSMIS Authenticator");
      if (error || !data) {
        throw new Error(error?.message || "Failed to generate authenticator enrollment QR code.");
      }

      setEnrollData(data);
      setEnrollModalOpen(true);
      setTimeout(() => enrollInputRef.current?.focus(), 300);
    } catch (err) {
      console.error("Enrollment error:", err);
      showToast(err.message || "Failed to begin Two-Factor enrollment.", "error");
    } finally {
      setEnrolling(false);
    }
  };

  // Handle Verifying Enrollment OTP Code
  const handleVerifyEnrollment = async (e) => {
    if (e) e.preventDefault();
    const cleanCode = enrollCode.trim();

    if (!cleanCode || cleanCode.length !== 6) {
      setEnrollError("Please enter a valid 6-digit verification code from your authenticator app.");
      enrollInputRef.current?.focus();
      return;
    }

    setVerifyingEnroll(true);
    setEnrollError("");

    try {
      const { error } = await mfaService.verifyEnrollment({
        factorId: enrollData.factorId,
        code: cleanCode,
      });

      if (error) {
        setEnrollError(error.message || "Invalid or expired verification code. Please check your authenticator app.");
        enrollInputRef.current?.focus();
        return;
      }

      // Success: 2FA is officially verified in Supabase!
      const cleanEmail = (userEmail || "").trim().toLowerCase();
      if (cleanEmail) {
        localStorage.setItem("lmis_2fa_enabled_" + cleanEmail, "true");
      }

      // Generate 6 single-use recovery backup codes
      let generatedCodes = [];
      try {
        const { plainCodes, hashes } = await mfaService.generateRecoveryCodes(6);
        generatedCodes = plainCodes;
        await supabase.auth.updateUser({
          data: {
            two_factor_enabled: true,
            recovery_code_hashes: hashes,
          },
        });
      } catch (recErr) {
        console.warn("Recovery codes generation notice:", recErr);
        try {
          await supabase.auth.updateUser({
            data: { two_factor_enabled: true },
          });
        } catch (_) {}
      }

      setEnrollModalOpen(false);
      setEnrollData(null);
      setEnrollCode("");
      await fetchMfaStatus();

      if (generatedCodes.length > 0) {
        setRecoveryCodes(generatedCodes);
        setSavedCodesChecked(false);
        setRecoveryModalOpen(true);
      }

      showToast("Two-Factor Authentication successfully activated! An authenticator code will now be required on every login.", "success");
    } catch (err) {
      console.error("Verification error:", err);
      setEnrollError(err.message || "Failed to verify security code.");
    } finally {
      setVerifyingEnroll(false);
    }
  };

  // Copy Secret Key
  const handleCopySecret = () => {
    if (!enrollData?.secret) return;
    navigator.clipboard?.writeText(enrollData.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2500);
  };

  // Copy Recovery Codes
  const handleCopyRecoveryCodes = () => {
    if (!recoveryCodes.length) return;
    const text = [
      "==================================================",
      "LSMIS - EMERGENCY TWO-FACTOR RECOVERY BACKUP CODES",
      `Account: ${userEmail}`,
      `Generated: ${new Date().toLocaleString()}`,
      "==================================================",
      "",
      "Keep these single-use recovery codes in a safe place (password manager).",
      "Each code can only be used once if you lose access to your authenticator app.",
      "",
      ...recoveryCodes.map((c, i) => `Code ${i + 1}: ${c}`),
      "",
      "==================================================",
    ].join("\n");

    navigator.clipboard?.writeText(text);
    setCopiedRecoveryCodes(true);
    showToast("Recovery codes copied to clipboard.", "info");
    setTimeout(() => setCopiedRecoveryCodes(false), 2500);
  };

  // Download Recovery Codes File
  const handleDownloadRecoveryCodes = () => {
    if (!recoveryCodes.length) return;
    const text = [
      "==================================================",
      "LSMIS - EMERGENCY TWO-FACTOR RECOVERY BACKUP CODES",
      `Account: ${userEmail}`,
      `Generated: ${new Date().toLocaleString()}`,
      "==================================================",
      "",
      "Keep these single-use recovery codes in a safe place (password manager).",
      "Each code can only be used once if you lose access to your authenticator app.",
      "",
      ...recoveryCodes.map((c, i) => `Code ${i + 1}: ${c}`),
      "",
      "==================================================",
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lsmis-recovery-codes-${(userEmail || "user").split("@")[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Recovery codes text file downloaded.", "success");
  };

  // Handle Disabling 2FA
  const handleConfirmDisable = async (e) => {
    if (e) e.preventDefault();
    if (!disablePassword && !disableOtpCode) {
      setDisableError("Please enter your current password or 6-digit authenticator code to authorize disabling 2FA.");
      return;
    }

    setDisabling(true);
    setDisableError("");

    try {
      const { error } = await mfaService.disable2FA({
        factorId: verifiedFactor?.id,
        password: disablePassword || null,
        email: userEmail,
        otpCode: disableOtpCode || null,
      });

      if (error) {
        setDisableError(error.message || "Failed to disable Two-Factor Authentication. Please verify your credentials.");
        return;
      }

      const cleanEmail = (userEmail || "").trim().toLowerCase();
      if (cleanEmail) {
        localStorage.setItem("lmis_2fa_enabled_" + cleanEmail, "false");
      }
      try {
        await supabase.auth.updateUser({
          data: {
            two_factor_enabled: false,
            recovery_code_hashes: [],
          },
        });
      } catch (_) {}

      setDisableModalOpen(false);
      setDisablePassword("");
      setDisableOtpCode("");
      await fetchMfaStatus();
      showToast("Two-Factor Authentication has been disabled.", "info");
    } catch (err) {
      console.error("Disable 2FA error:", err);
      setDisableError(err.message || "An unexpected error occurred while disabling 2FA.");
    } finally {
      setDisabling(false);
    }
  };

  return (
    <Card style={{ padding: "30px 32px", borderRadius: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Section Header */}
        <div style={{ borderBottom: "1px solid var(--color-border, #e2e8f0)", paddingBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)" }}>
                Two-Factor Authentication &amp; Security
              </h2>
              <p style={{ fontSize: 14, color: "var(--color-text-muted, #64748b)", margin: "4px 0 0" }}>
                Protect your account using Two-Factor Authentication (2FA) with Google Authenticator, Microsoft Authenticator, or 2FAS.
              </p>
            </div>
            {is2FAEnabled && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 14px",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 800,
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.28)",
                }}
              >
                <Icon.ShieldCheck size={14} /> 2FA Active (AAL2)
              </span>
            )}
          </div>
        </div>

        {/* 1. TWO-FACTOR AUTHENTICATION ROW */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 22px",
            borderRadius: 14,
            border: is2FAEnabled ? "1.5px solid rgba(16, 185, 129, 0.35)" : "1.5px solid var(--color-border, #e2e8f0)",
            background: is2FAEnabled ? "rgba(16, 185, 129, 0.03)" : "var(--color-bg, #f8fafc)",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260, flex: 1 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: is2FAEnabled ? "rgba(16, 185, 129, 0.15)" : "rgba(100, 116, 139, 0.12)",
                color: is2FAEnabled ? "#10b981" : "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Shield size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                  Two-Factor Authentication (2FA)
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: is2FAEnabled ? "#dcfce7" : "#f1f5f9",
                    color: is2FAEnabled ? "#15803d" : "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  {is2FAEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 3 }}>
                Secures your account using Time-based One-Time Passwords (TOTP). Compatible with Google Authenticator, Microsoft Authenticator, and 2FAS.
              </div>
              {lastVerifiedTime && (
                <div style={{ fontSize: 12, color: "#059669", fontWeight: 600, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon.Check size={12} strokeWidth={2.8} />
                  <span>{lastVerifiedTime}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {is2FAEnabled ? (
              <Button
                variant="outline"
                onClick={() => {
                  setDisablePassword("");
                  setDisableError("");
                  setDisableModalOpen(true);
                }}
                disabled={loading2FA}
                style={{
                  height: 40,
                  padding: "0 18px",
                  fontSize: 13.5,
                  fontWeight: 700,
                  borderRadius: 9,
                  color: "#ef4444",
                  borderColor: "rgba(239, 68, 68, 0.35)",
                }}
              >
                Disable 2FA
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleOpenEnrollment}
                disabled={loading2FA || enrolling}
                style={{
                  height: 40,
                  padding: "0 20px",
                  fontSize: 13.5,
                  fontWeight: 700,
                  borderRadius: 9,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.28)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {enrolling ? (
                  <>
                    <Icon.RefreshCw size={14} className="animate-spin" />
                    <span>Preparing...</span>
                  </>
                ) : (
                  <>
                    <Icon.Plus size={15} />
                    <span>Enable 2FA</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* 2. SINGLE SESSION CONCURRENCY PROTECTION ROW */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderRadius: 14,
            border: "1.5px solid var(--color-border, #e2e8f0)",
            background: "var(--color-bg, #f8fafc)",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260, flex: 1 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(16, 185, 129, 0.14)",
                color: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Check size={22} strokeWidth={2.4} />
            </div>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                Single Concurrent Session Protection
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 3 }}>
                Enforces unique login tokens per authenticated user. Logins from unauthorized devices or secondary browsers automatically trigger termination notices.
              </div>
            </div>
          </div>

          <span
            style={{
              padding: "5px 14px",
              borderRadius: 9999,
              fontSize: 12,
              fontWeight: 800,
              background: "rgba(16, 185, 129, 0.12)",
              color: "#10b981",
              border: "1px solid rgba(16, 185, 129, 0.28)",
            }}
          >
            Active &amp; Enforced
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2FA ENROLLMENT MODAL WITH QR CODE & OTP VERIFICATION          */}
      {/* ============================================================ */}
      <Modal
        open={enrollModalOpen}
        onClose={() => !verifyingEnroll && setEnrollModalOpen(false)}
        title="Set Up Two-Factor Authentication"
        size="md"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Instructions */}
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
            <strong>Step 1:</strong> Open <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>, or your preferred TOTP app on your mobile device. Scan the QR code below or enter the secret key manually.
          </div>

          {/* QR Code and Secret Key Container */}
          {enrollData?.qrCode && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                padding: "16px",
                borderRadius: 12,
                border: "1px solid var(--color-border, #e2e8f0)",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  width: 190,
                  height: 190,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#ffffff",
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              >
                <img
                  src={
                    enrollData.qrCode.startsWith("data:")
                      ? enrollData.qrCode
                      : `data:image/svg+xml;utf-8,${encodeURIComponent(enrollData.qrCode)}`
                  }
                  alt="2FA TOTP QR Code"
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </div>

              {/* Secret Key Alternative */}
              {enrollData.secret && (
                <div style={{ width: "100%", textAlign: "center" }}>
                  <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>
                    Can&apos;t scan? Enter this secret key manually into your app:
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: "#f1f5f9",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                    }}
                  >
                    <code
                      style={{
                        fontFamily: "monospace",
                        fontSize: 13.5,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        color: "#0f172a",
                      }}
                    >
                      {enrollData.secret}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      style={{
                        border: "none",
                        background: copiedSecret ? "#dcfce7" : "#e2e8f0",
                        color: copiedSecret ? "#15803d" : "#334155",
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {copiedSecret ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Verification Step */}
          <form onSubmit={handleVerifyEnrollment} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label
                htmlFor="mfa-enroll-code"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-text, #0f172a)",
                  marginBottom: 6,
                }}
              >
                Step 2: Enter 6-digit confirmation code <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                ref={enrollInputRef}
                id="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={enrollCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setEnrollCode(val);
                  if (enrollError) setEnrollError("");
                }}
                style={{
                  width: "100%",
                  height: 48,
                  fontSize: 22,
                  letterSpacing: "0.25em",
                  fontWeight: 800,
                  textAlign: "center",
                  borderRadius: 10,
                  border: enrollError ? "1.5px solid #ef4444" : "1.5px solid var(--color-border, #cbd5e1)",
                  background: "var(--color-bg, #ffffff)",
                  color: "var(--color-text, #0f172a)",
                  fontFamily: "monospace",
                }}
                required
              />
              {enrollError && (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon.AlertTriangle size={13} />
                  <span>{enrollError}</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEnrollModalOpen(false)}
                disabled={verifyingEnroll}
                style={{ flex: 1, height: 42, borderRadius: 9 }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={verifyingEnroll || enrollCode.length !== 6}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 9,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  fontWeight: 700,
                  color: "#ffffff",
                }}
              >
                {verifyingEnroll ? (
                  <>
                    <Icon.RefreshCw size={14} className="animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  "Verify & Activate 2FA"
                )}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* ============================================================ */}
      {/* DISABLE 2FA CONFIRMATION MODAL WITH RE-AUTHENTICATION         */}
      {/* ============================================================ */}
      <Modal
        open={disableModalOpen}
        onClose={() => !disabling && setDisableModalOpen(false)}
        title="Disable Two-Factor Authentication"
        size="md"
      >
        <form onSubmit={handleConfirmDisable} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "#b91c1c",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>Security Warning:</strong> Disabling Two-Factor Authentication removes the OTP verification requirement on future logins. To confirm this security change, verify your identity below.
          </div>

          {/* 6-Digit Authenticator OTP Code */}
          <div>
            <label
              htmlFor="mfa-disable-otp"
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--color-text, #0f172a)",
                marginBottom: 6,
              }}
            >
              Enter Current 6-Digit Code from Authenticator App <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="mfa-disable-otp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="••••••"
              value={disableOtpCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setDisableOtpCode(val);
                if (disableError) setDisableError("");
              }}
              style={{
                width: "100%",
                height: 44,
                fontSize: 22,
                letterSpacing: "0.25em",
                fontWeight: 800,
                textAlign: "center",
                borderRadius: 8,
                border: disableError ? "1.5px solid #ef4444" : "1px solid var(--color-border, #cbd5e1)",
                background: "var(--color-bg, #ffffff)",
                color: "var(--color-text, #0f172a)",
                fontFamily: "monospace",
              }}
              autoFocus
            />
          </div>

          {/* Optional Password field for additional verification */}
          <div>
            <label
              htmlFor="mfa-disable-password"
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--color-text, #0f172a)",
                marginBottom: 6,
              }}
            >
              Account Password (If Registered via Password)
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="mfa-disable-password"
                type={showDisablePw ? "text" : "password"}
                placeholder="Enter current password"
                value={disablePassword}
                onChange={(e) => {
                  setDisablePassword(e.target.value);
                  if (disableError) setDisableError("");
                }}
                style={{
                  width: "100%",
                  height: 42,
                  padding: "0 40px 0 12px",
                  fontSize: 13.5,
                  borderRadius: 8,
                  border: "1px solid var(--color-border, #cbd5e1)",
                  background: "var(--color-bg, #ffffff)",
                  color: "var(--color-text, #0f172a)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowDisablePw(!showDisablePw)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "transparent",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: 4,
                }}
                aria-label={showDisablePw ? "Hide password" : "Show password"}
              >
                {showDisablePw ? <Icon.EyeOff size={15} /> : <Icon.Eye size={15} />}
              </button>
            </div>
            {disableError && (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                <Icon.AlertTriangle size={13} />
                <span>{disableError}</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDisableModalOpen(false);
                setDisableOtpCode("");
                setDisablePassword("");
                setDisableError("");
              }}
              disabled={disabling}
              style={{ flex: 1, height: 40, borderRadius: 8 }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={disabling || (!disableOtpCode && !disablePassword)}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 8,
                background: "#dc2626",
                color: "#ffffff",
                fontWeight: 700,
              }}
            >
              {disabling ? (
                <>
                  <Icon.RefreshCw size={14} className="animate-spin" />
                  <span>Disabling...</span>
                </>
              ) : (
                "Confirm & Disable"
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================================ */}
      {/* EMERGENCY RECOVERY BACKUP CODES MODAL (SHOWN ONCE)           */}
      {/* ============================================================ */}
      <Modal
        open={recoveryModalOpen}
        onClose={() => savedCodesChecked && setRecoveryModalOpen(false)}
        title="Emergency Recovery Backup Codes"
        size="md"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#065f46",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>2FA is now active!</strong> Save these <strong>6 emergency backup recovery codes</strong>. Each code can be used <strong>once</strong> to sign in if you lose access to your authenticator application. These codes will <strong>never be shown again</strong>.
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              padding: "14px",
              background: "var(--color-bg, #f8fafc)",
              borderRadius: 12,
              border: "1px solid var(--color-border, #cbd5e1)",
            }}
          >
            {recoveryCodes.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: "#0f172a",
                  textAlign: "center",
                }}
              >
                {c}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyRecoveryCodes}
              style={{ flex: 1, height: 38, borderRadius: 8, fontSize: 13, fontWeight: 700 }}
            >
              {copiedRecoveryCodes ? "Copied All Codes!" : "Copy Codes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadRecoveryCodes}
              style={{ flex: 1, height: 38, borderRadius: 8, fontSize: 13, fontWeight: 700 }}
            >
              Download (.txt)
            </Button>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 650,
              color: "var(--color-text, #0f172a)",
              marginTop: 4,
            }}
          >
            <input
              type="checkbox"
              checked={savedCodesChecked}
              onChange={(e) => setSavedCodesChecked(e.target.checked)}
              style={{ width: 17, height: 17, cursor: "pointer", accentColor: "#10b981" }}
            />
            <span>I have securely saved my recovery backup codes in a safe place.</span>
          </label>

          <Button
            type="button"
            variant="primary"
            disabled={!savedCodesChecked}
            onClick={() => {
              setRecoveryModalOpen(false);
              setRecoveryCodes([]);
            }}
            style={{
              height: 42,
              borderRadius: 9,
              background: savedCodesChecked ? "linear-gradient(135deg, #10b981 0%, #047857 100%)" : undefined,
              fontWeight: 700,
            }}
          >
            I&apos;m All Set — Continue
          </Button>
        </div>
      </Modal>
    </Card>
  );
};
