import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { AlertDialog } from "../../components/ui/Modal";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { PasswordRequirements } from "../../components/ui/PasswordRequirements";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";
import { isInstalledApp } from "../../utils/capacitor";
import logoImg from "../../assets/logo.jpg";

export const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingSend, setLoadingSend] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showCpwd, setShowCpwd] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);

  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSendCode = async () => {
    if (!email.trim()) {
      showToast("Please enter your registered email first", "error");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    setLoadingSend(true);
    try {
      // 1. Check database-enforced rate limit
      try {
        const { data: limitRes, error: rpcError } = await supabase.rpc("request_otp_rate_limit", {
          p_email: cleanEmail
        });

        if (!rpcError && limitRes && limitRes.allowed === false) {
          showToast(limitRes.message || "Too many OTP attempts. You are temporarily blocked.", "error");
          setLoadingSend(false);
          return;
        }
      } catch (rpcErr) {
        console.warn("Rate limit check:", rpcErr);
      }

      // 2. Validate registered user or owner
      const { data: userRow } = await supabase
        .from(TABLES.USERS)
        .select("id, email")
        .ilike("email", cleanEmail)
        .limit(1)
        .maybeSingle();

      let isRegistered = Boolean(userRow?.email);
      if (!isRegistered) {
        const { data: ownerRow } = await supabase
          .from(TABLES.OWNERS)
          .select("id, email")
          .ilike("email", cleanEmail)
          .limit(1)
          .maybeSingle();
        isRegistered = Boolean(ownerRow?.email);
      }

      if (!isRegistered) {
        showToast("This email address is not registered in our system.", "error");
        setLoadingSend(false);
        return;
      }

      // 3. Send Supabase Password Recovery OTP
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) {
        console.error("Supabase resetPasswordForEmail error:", error);
        let userFriendlyMsg = error.message || "Failed to send reset code. Please try again.";
        if (
          error.message?.includes("535") ||
          error.message?.includes("Username and Password not accepted") ||
          error.message?.includes("BadCredentials") ||
          error.message?.includes("Error sending recovery email")
        ) {
          userFriendlyMsg =
            "Email delivery failed: The server's SMTP mail credentials were not accepted (535 Bad Credentials). Please check your Supabase SMTP settings.";
        } else if (error.status === 429 || error.message?.toLowerCase().includes("rate limit")) {
          userFriendlyMsg = "Email rate limit exceeded. Please wait a few minutes before trying again.";
        }
        showToast(userFriendlyMsg, "error");
        setLoadingSend(false);
        return;
      }

      showToast(`Reset code sent to ${cleanEmail}! Please check your email inbox.`, "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to send reset code", "error");
    } finally {
      setLoadingSend(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const inputCode = code.trim();

    if (!cleanEmail || !inputCode || !password || !confirmPassword) {
      showToast("Please fill in all fields", "error");
      return;
    }
    const valResult = validatePassword(password);
    if (!valResult.isValid) {
      showToast(getPasswordValidationError(password), "error");
      return;
    }
    if (password !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }

    setLoadingReset(true);
    try {
      const { data: verifyData, error: otpError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
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

      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      });

      if (updateError) throw updateError;

      // Clear rate limit record on successful password reset
      try {
        await supabase.from("otp_rate_limits").delete().eq("email", cleanEmail);
      } catch (e) {}

      // Sign out recovery session to ensure fresh sign in
      try {
        await supabase.auth.signOut();
      } catch (e) {}

      setSuccessModalOpen(true);
      showToast("Password reset successfully! You can now sign in with your new password.", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Verification failed. Check your code.", "error");
    } finally {
      setLoadingReset(false);
    }
  };

  const isInstalled = isInstalledApp();

  return (
    <div className={`login-page lsmis-login is-view-forgot${isInstalled ? " is-installed-app" : ""}`}>
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
              <span className="login-pill">
                <Icon.Shield size={13} /> Official Management System
              </span>
              <h2>Livestock Slaughter and Meat Inspection Management System</h2>
              <p>
                Integrated municipal gateway for livestock intake traceability, veterinary inspection certification, and regulatory fee auditing.
              </p>
            </div>
            <div className="login-features">
              <div className="login-feature">
                <div className="feature-icon"><Icon.Shield size={16} /></div>
                <div>
                  <h4>Food Safety Compliance</h4>
                  <p>Certified under Republic Act No. 9296 and RA 10536 mandates.</p>
                </div>
              </div>
              <div className="login-feature">
                <div className="feature-icon"><Icon.Stethoscope size={16} /></div>
                <div>
                  <h4>Veterinary Inspection Authority</h4>
                  <p>Clinical ante-mortem and post-mortem clearance oversight.</p>
                </div>
              </div>
              <div className="login-feature">
                <div className="feature-icon"><Icon.Activity size={16} /></div>
                <div>
                  <h4>Traceability &amp; Revenue Audit</h4>
                  <p>Digital records from pen intake to final meat transport release.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="login-brand-foot">
            <Icon.CheckCircle size={14} />
            <span>Secure Municipal Government Portal</span>
          </div>
        </div>

        {/* Right form panel */}
        <div className="login-form-wrap">
          <div className="login-box login-form">

            {/* Mobile / Installed App Brand Header */}
            <div className="login-mobile-brand">
              <div className="login-mobile-logo">
                <img src={logoImg} alt="LSMIS Official Logo" width="62" height="62" />
              </div>
              <div className="login-mobile-title">LSMIS</div>
              <div className="login-mobile-subtitle">Livestock Slaughter &amp; Meat Inspection</div>
              <span className="login-mobile-badge">City Government of Naga, Cebu</span>
            </div>
            
            <form onSubmit={handleResetPassword} className="login-form-body" noValidate>
              {/* Header - Unified with Sign In */}
              <div className="login-form-head">
                <h1>Reset Password</h1>
                <p className="subtitle">Enter your registered email and verification code to recover your account</p>
              </div>

              {/* Account Email + Send Code */}
              <div className="form-group">
                <label className="form-label" htmlFor="fp-page-email">
                  Email <span className="req">*</span>
                </label>
                <div className="fp-email-row">
                  <div className="login-pwd-wrap" style={{ flex: 1 }}>
                    <span className="login-pwd-icon"><Icon.Mail size={16} /></span>
                    <input
                      id="fp-page-email"
                      className="form-control"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. user@gmail.com"
                      autoComplete="email"
                      required
                      disabled={loadingSend}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loadingSend || !email.trim()}
                    onClick={handleSendCode}
                    className="fp-send-btn"
                  >
                    {loadingSend ? (
                      <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending</>
                    ) : (
                      <><Icon.Send size={13} /> Send Code</>
                    )}
                  </button>
                </div>
              </div>

              {/* Verification Code */}
              <div className="form-group">
                <label className="form-label" htmlFor="fp-page-code">
                  6-Digit Verification Code <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Key size={16} /></span>
                  <input
                    id="fp-page-code"
                    className="form-control"
                    type="text"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter 6-digit verification code"
                    required
                  />
                </div>
              </div>

              {/* New Password */}
              <div className="form-group">
                <label className="form-label" htmlFor="fp-page-pwd">
                  New Password <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                  <input
                    id="fp-page-pwd"
                    className="form-control"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder="Min. 8 characters"
                    required
                  />
                  <button
                    type="button"
                    className="login-pwd-toggle"
                    onClick={() => setShowPwd(!showPwd)}
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="form-group">
                <label className="form-label" htmlFor="fp-page-cpwd">
                  Confirm Password <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                  <input
                    id="fp-page-cpwd"
                    className="form-control"
                    type={showCpwd ? "text" : "password"}
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
                    onClick={() => setShowCpwd(!showCpwd)}
                    aria-label={showCpwd ? "Hide password" : "Show password"}
                  >
                    {showCpwd ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: "-4px", marginBottom: "14px" }}>
                <PasswordRequirements password={password} />
              </div>

              {/* Submit button */}
              <Button type="button" onClick={handleResetPassword} disabled={loadingReset || !validatePassword(password).isValid} block size="lg" className="login-submit">
                {loadingReset ? (
                  <><span className="spinner" /><span>Resetting Password...</span></>
                ) : (
                  <><Icon.ShieldCheck size={18} /><span>Update Password</span></>
                )}
              </Button>

              {/* Secondary Back Button directly below Submit */}
              <Link to="/login" className="btn-back-to-landing">
                <Icon.ArrowLeft size={16} />
                <span>Back to Sign In</span>
              </Link>
            </form>



          </div>
        </div>
      </div>

      <AlertDialog
        open={successModalOpen}
        onClose={() => {
          setSuccessModalOpen(false);
          navigate("/login");
        }}
        title="Password Updated Successfully"
        message="Your password has been changed successfully! You can now sign in with your new password."
        buttonText="Proceed to Sign In"
        variant="success"
      />
    </div>
  );
};
