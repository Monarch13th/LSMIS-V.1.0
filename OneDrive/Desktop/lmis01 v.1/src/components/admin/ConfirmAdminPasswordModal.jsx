import { useState, useEffect, useRef } from "react";
import { Icon } from "../icons";
import { Button } from "../ui/Button";
import { verifyAdminPassword } from "../../services/adminAuthVerification";

export const ConfirmAdminPasswordModal = ({
  open,
  onClose,
  onConfirmSuccess,
  title = "Admin Password Required",
  actionDescription = "Please enter your administrator password to confirm and apply this change.",
  confirmButtonText = "Confirm & Apply",
  danger = false,
  actionContext = {},
}) => {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setShowPassword(false);
      setError(null);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setPassword("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError(null);

    const result = await verifyAdminPassword(password, actionContext);
    setPassword(""); // Clear immediately after attempt

    if (result.success) {
      try {
        if (onConfirmSuccess) {
          await onConfirmSuccess();
        }
      } catch (err) {
        console.error("Action confirmation execution failed:", err);
      } finally {
        setLoading(false);
        onClose();
      }
    } else {
      setLoading(false);
      setError(result.error || "Incorrect password. Verification failed.");
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 3000, position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        style={{
          background: "var(--color-surface)",
          borderRadius: 20,
          padding: 28,
          maxWidth: 440,
          width: "100%",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          border: "1px solid var(--color-border)",
          position: "relative"
        }}
      >
        {/* Close Icon */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            background: "none",
            border: "none",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            padding: 4,
            borderRadius: 6
          }}
          aria-label="Close"
        >
          <Icon.X size={18} />
        </button>

        {/* Modal Icon & Header */}
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              background: danger ? "rgba(239, 68, 68, 0.12)" : "rgba(2, 132, 199, 0.12)",
              color: danger ? "#ef4444" : "#0284c7",
              border: danger ? "1px solid rgba(239, 68, 68, 0.28)" : "1px solid rgba(2, 132, 199, 0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Lock size={22} />
          </div>
          <div style={{ paddingRight: 20 }}>
            <h3 id="admin-confirm-title" style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800, color: "var(--color-text)" }}>
              {title}
            </h3>
            <p
              className="confirm-dialog-description"
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--color-text-muted)",
                lineHeight: 1.6,
                textAlign: "justify",
                textJustify: "inter-word",
                textAlignLast: "left",
              }}
            >
              {actionDescription}
            </p>
          </div>
        </div>

        {/* Inline Error Callout */}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#ef4444",
              fontSize: 12.5,
              fontWeight: 600,
              marginBottom: 16
            }}
            role="alert"
          >
            <Icon.AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 8, letterSpacing: "0.03em", textTransform: "uppercase" }}>
              Enter Current Password
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••••••"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "11px 40px 11px 14px",
                  borderRadius: 10,
                  border: error ? "1.5px solid #ef4444" : "1.5px solid var(--color-border)",
                  fontSize: 14,
                  color: "var(--color-text)",
                  outline: "none",
                  background: "var(--color-bg)",
                  transition: "border-color 0.15s ease",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                style={{
                  position: "absolute",
                  right: 12,
                  background: "none",
                  border: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center"
                }}
              >
                {showPassword ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600 }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!password.trim() || loading}
              style={{
                padding: "9px 22px",
                fontSize: 13,
                fontWeight: 700,
                background: danger ? "#dc2626" : "var(--color-primary)",
                borderColor: danger ? "#dc2626" : "var(--color-primary)",
                color: "#ffffff"
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.4)",
                      borderTopColor: "#ffffff",
                      borderRadius: "50%",
                      marginRight: 8,
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Verifying...
                </>
              ) : (
                confirmButtonText
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
