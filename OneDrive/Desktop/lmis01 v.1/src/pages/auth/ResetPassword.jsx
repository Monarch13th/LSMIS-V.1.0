import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { AlertDialog } from "../../components/ui/Modal";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { supabase } from "../../services/supabaseClient";
import { PasswordRequirements } from "../../components/ui/PasswordRequirements";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";

export const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showCpwd, setShowCpwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (!password || !confirmPassword) {
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

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });

      if (error) {
        showToast(error.message, "error");
        return;
      }

      setDone(true);
      showToast("Password updated successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to update password", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />
      <div className="login-form" style={{ maxWidth: 440, width: "100%", position: "relative", zIndex: 1 }}>
        <Link to="/login" className="text-sm text-primary font-semibold">← Back to login</Link>
        <h1 style={{ marginTop: 16 }}>Set New Password</h1>
        <p className="subtitle">Enter your new secure password below.</p>
        
        {done ? (
          <div>
            <div className="alert alert-success" style={{ marginBottom: 20 }}>
              <Icon.Check size={16} /> Password has been changed successfully!
            </div>
            <Button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut().catch(() => {});
                navigate("/login");
              }}
              block
            >
              Proceed to Sign In
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          >
            <div className="form-group">
              <label className="form-label" htmlFor="reset-new-pwd">
                New Password <span className="req">*</span>
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                <input
                  id="reset-new-pwd"
                  className="form-control"
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Min. 8 characters"
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

            <div className="form-group">
              <label className="form-label" htmlFor="reset-confirm-pwd">
                Confirm New Password <span className="req">*</span>
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Lock size={16} /></span>
                <input
                  id="reset-confirm-pwd"
                  className="form-control"
                  type={showCpwd ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Re-enter password"
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

            <div style={{ marginTop: "-6px", marginBottom: "16px" }}>
              <PasswordRequirements password={password} />
            </div>

            <Button type="button" onClick={submit} disabled={loading || !validatePassword(password).isValid} block>
              {loading ? "Updating..." : "Update Password"}
            </Button>
          </form>
        )}
      </div>

      <AlertDialog
        open={done}
        onClose={() => navigate("/login")}
        title="Password Updated Successfully"
        message="Your password has been changed successfully! You can now sign in with your new password."
        buttonText="Proceed to Sign In"
        variant="success"
      />
    </div>
  );
};
