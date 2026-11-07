import { useEffect } from "react";
import { Icon } from "../icons";
import { Button } from "./Button";

let activeModalCount = 0;

const lockScroll = () => {
  activeModalCount++;
  document.body.style.overflow = "hidden";
};

const unlockScroll = () => {
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    document.body.style.overflow = "";
  }
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdropClick = false,
  hideCloseButton = false,
  bodyStyle = null,
  alert = null,
  headerRight = null,
  backdropStyle = null,
  dialogStyle = null,
  dialogClassName = "",
  headerStyle = null,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    lockScroll();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlockScroll();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizeClass = size === "lg" ? "modal-lg" : size === "xl" ? "modal-xl" : size === "sm" ? "modal-sm" : "";

  return (
    <div
      className="modal-backdrop"
      style={backdropStyle}
      onClick={(e) => {
        // Backdrop click-to-exit disabled by default: clicking outside does not close or dismiss modal
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      role="presentation"
    >
      <div
        className={`modal ${sizeClass} ${dialogClassName || ""}`.trim()}
        style={dialogStyle || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div
          className="modal-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "nowrap",
            gap: 12,
            ...(headerStyle || {}),
          }}
        >
          <h3
            id="modal-title"
            className="modal-title"
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              flex: 1,
              minWidth: 0,
              wordBreak: "break-word",
              fontSize: "clamp(15px, 3.5vw, 18px)",
              lineHeight: 1.3,
            }}
          >
            {title}
          </h3>
          {headerRight && (
            <div
              className="modal-header-right"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginLeft: "auto",
                marginRight: hideCloseButton ? 0 : 8,
                flexShrink: 0,
              }}
            >
              {headerRight}
            </div>
          )}
          {!hideCloseButton && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon.X size={16} />
            </button>
          )}
        </div>
        <div className="modal-body" style={bodyStyle || undefined}>
          {alert && (
            <div
              className="modal-alert-notification"
              role="alert"
              style={{
                marginBottom: 16,
                padding: "12px 16px",
                borderRadius: 9,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                fontWeight: 600,
                background: alert.type === "error" ? "#fef2f2" : "#ecfdf5",
                color: alert.type === "error" ? "#991b1b" : "#065f46",
                border: alert.type === "error" ? "1.5px solid #fecaca" : "1.5px solid #6ee7b7",
                boxShadow: "0 2px 6px rgba(5, 150, 105, 0.08)",
              }}
            >
              <Icon.CheckCircle size={18} color="#059669" />
              <span>{typeof alert === "string" ? alert : alert.message}</span>
            </div>
          )}
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

export const ConfirmDialog = ({
  open,
  onConfirm,
  onCancel,
  title = "Are you sure?",
  message,
  confirmText = "Confirm",
  confirmVariant = "danger",
  loading = false,
  closeOnBackdropClick = false,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    lockScroll();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlockScroll();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = confirmVariant === "danger";
  const isWarning = confirmVariant === "warning";
  const isSuccess = confirmVariant === "success";

  return (
    <div
      className="modal-backdrop confirm-modal-backdrop"
      style={{ zIndex: 1100 }}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget && !loading) {
          onCancel?.();
        }
      }}
      role="presentation"
    >
      <div
        className="modal modal-sm confirm-modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
      >
        <button
          type="button"
          className="modal-close confirm-card-close"
          onClick={onCancel}
          disabled={loading}
          aria-label="Close dialog"
        >
          <Icon.X size={15} />
        </button>

        <div className="confirm-modal-body">
          <div className={`confirm-icon-badge confirm-icon-${confirmVariant}`}>
            {isDanger ? (
              <Icon.AlertTriangle size={26} strokeWidth={2.2} />
            ) : isWarning ? (
              <Icon.AlertTriangle size={26} strokeWidth={2.2} />
            ) : isSuccess ? (
              <Icon.CheckCircle size={26} strokeWidth={2.2} />
            ) : (
              <Icon.Info size={26} strokeWidth={2.2} />
            )}
          </div>
          <h3 id="confirm-title" className="confirm-title">{title}</h3>
          <p id="confirm-desc" className="confirm-message">{message}</p>
        </div>

        <div className="confirm-modal-footer">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className="confirm-btn confirm-btn-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={loading}
            className="confirm-btn confirm-btn-action"
          >
            {loading ? (
              <><span className="spinner" style={{ width: 14, height: 14, marginRight: 6 }} /> Processing...</>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const AlertDialog = ({
  open,
  onClose,
  title = "Notification",
  message,
  buttonText = "OK",
  variant = "success",
  closeOnBackdropClick = false,
  hideCloseButton = false,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "Enter") onClose?.();
    };
    lockScroll();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlockScroll();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isDanger = variant === "danger";
  const isWarning = variant === "warning";
  const isSuccess = variant === "success";

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1200 }}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      role="presentation"
    >
      <div
        className="modal modal-sm confirm-modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-desc"
        style={{
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
          maxWidth: 420,
        }}
      >
        {!hideCloseButton && (
          <button
            type="button"
            className="modal-close confirm-card-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon.X size={15} />
          </button>
        )}

        <div className="confirm-modal-body" style={{ textAlign: "center", padding: "24px 20px 16px" }}>
          <div
            className={`confirm-icon-badge confirm-icon-${variant}`}
            style={{
              margin: "0 auto 14px",
              width: 54,
              height: 54,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isSuccess ? "#ecfdf5" : isDanger ? "#fef2f2" : isWarning ? "#fffbeb" : "#eff6ff",
              color: isSuccess ? "#059669" : isDanger ? "#dc2626" : isWarning ? "#d97706" : "#2563eb",
              border: isSuccess ? "2px solid #a7f3d0" : isDanger ? "2px solid #fecaca" : isWarning ? "2px solid #fde68a" : "2px solid #bfdbfe",
            }}
          >
            {isDanger ? (
              <Icon.AlertTriangle size={28} strokeWidth={2.2} />
            ) : isWarning ? (
              <Icon.AlertTriangle size={28} strokeWidth={2.2} />
            ) : isSuccess ? (
              <Icon.CheckCircle size={28} strokeWidth={2.2} />
            ) : (
              <Icon.Info size={28} strokeWidth={2.2} />
            )}
          </div>
          <h3 id="alert-dialog-title" className="confirm-title" style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
            {title}
          </h3>
          <p id="alert-dialog-desc" className="confirm-message" style={{ fontSize: "0.92rem", color: "#475569", lineHeight: 1.55, margin: 0 }}>
            {message}
          </p>
        </div>

        <div className="confirm-modal-footer" style={{ justifyContent: "center", padding: "12px 20px 20px", borderTop: "none" }}>
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
            autoFocus
            style={{
              minWidth: 120,
              padding: "8px 26px",
              fontWeight: 700,
              fontSize: 13,
              background: isSuccess ? "#059669" : isWarning ? "#d97706" : isDanger ? "#dc2626" : "#059669",
              borderColor: isSuccess ? "#059669" : isWarning ? "#d97706" : isDanger ? "#dc2626" : "#059669",
              color: "#ffffff",
              boxShadow: "0 2px 5px rgba(0, 0, 0, 0.1)",
            }}
          >
            {buttonText}
          </Button>
        </div>
      </div>
    </div>
  );
};

