import { useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { PasswordRequirements } from "../ui/PasswordRequirements";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";
import { isEmailTakenAcrossSystem } from "../../services/adminService";
import { initials } from "../../utils/helpers";
import { ROLE_LABELS } from "../../utils/constants";
import { scrollToFirstError } from "../../utils/formValidation";

export const UserForm = ({ initial, onSubmit, onCancel }) => {
  const [showPwd, setShowPwd] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const data = initial || { full_name: "", email: "", role: "staff", username: "", status: "Active" };

  const [fullName, setFullName] = useState(data.full_name || "");
  const [username, setUsername] = useState(data.username || "");
  const [emailVal, setEmailVal] = useState(data.email || "");
  const [contactVal, setContactVal] = useState(data.contact || data.phone || "");
  const [emailError, setEmailError] = useState("");
  const [role, setRole] = useState(data.role || "staff");
  const [status, setStatus] = useState(data.status || "Active");

  const isPasswordValid = initial || validatePassword(password).isValid;

  const handleEmailBlur = async () => {
    const clean = emailVal.trim().toLowerCase();
    if (!clean || !clean.includes("@")) return;
    try {
      const taken = await isEmailTakenAcrossSystem(clean, initial?.id);
      if (taken) {
        setEmailError("This email address is already in use by another account. Please use another email.");
      } else {
        setEmailError("");
      }
    } catch (e) {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!fullName.trim()) {
      setError("Full Name is required.");
      scrollToFirstError("personnel-fullname", { offset: 80 });
      return;
    }
    if (!username.trim()) {
      setError("Username is required.");
      scrollToFirstError("personnel-username", { offset: 80 });
      return;
    }
    const cleanEmail = emailVal.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email Address is required.");
      scrollToFirstError("personnel-email", { offset: 80 });
      return;
    }

    setSubmitting(true);
    try {
      const taken = await isEmailTakenAcrossSystem(cleanEmail, initial?.id);
      if (taken) {
        const msg = "This email address is already in use by another account. Please use another email.";
        setError(msg);
        setEmailError(msg);
        scrollToFirstError("personnel-email", { offset: 80 });
        setSubmitting(false);
        return;
      }

      const formValues = {
        full_name: fullName.trim(),
        username: username.trim(),
        email: cleanEmail,
        contact: contactVal.trim(),
        phone: contactVal.trim(),
        role,
        status,
      };

      if (!initial) {
        const val = validatePassword(password);
        if (!val.isValid) {
          setError(getPasswordValidationError(password));
          scrollToFirstError("personnel-password", { offset: 80 });
          setSubmitting(false);
          return;
        }
        formValues.password = password;
      }

      setError("");
      await onSubmit(formValues);
    } catch (err) {
      setError(err.message || "An error occurred saving the personnel record.");
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleBadgeStyle = (r) => {
    switch (r) {
      case "admin":
        return { bg: "#fef3c7", color: "#b45309", border: "#fde68a" };
      case "vet":
        return { bg: "#e0f2fe", color: "#0369a1", border: "#bae6fd" };
      default:
        return { bg: "#ede9fe", color: "#6d28d9", border: "#ddd6fe" };
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Header Profile Summary if editing */}
      {initial ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 14px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "9px",
          }}
        >
          {data.avatar_url ? (
            <img
              src={data.avatar_url}
              alt={fullName || username || "Personnel"}
              referrerPolicy="no-referrer"
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                objectFit: "cover",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                border: "1.5px solid #e2e8f0",
                flexShrink: 0,
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                if (e.currentTarget.nextSibling) {
                  e.currentTarget.nextSibling.style.display = "flex";
                }
              }}
            />
          ) : null}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background:
                role === "admin"
                  ? "linear-gradient(135deg, #f59e0b, #d97706)"
                  : role === "vet"
                  ? "linear-gradient(135deg, #0284c7, #0369a1)"
                  : "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              color: "#fff",
              display: data.avatar_url ? "none" : "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "0.9rem",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              flexShrink: 0,
            }}
          >
            {initials(fullName || username || "Personnel")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>
                {fullName || "Personnel Member"}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: "999px",
                  background: getRoleBadgeStyle(role).bg,
                  color: getRoleBadgeStyle(role).color,
                  border: `1px solid ${getRoleBadgeStyle(role).border}`,
                }}
              >
                {ROLE_LABELS[role] || role}
              </span>
            </div>
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              @{username || "username"} · {initial.id ? `ID: ${String(initial.id).slice(0, 8)}...` : ""}
            </span>
          </div>
        </div>
      ) : null}

      {/* Error Notice */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "7px",
            color: "#b91c1c",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <Icon.AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Form Fields Grid */}
      {!initial ? (
        /* Registration Layout: Balanced 2-Column Grid (One Page, No Scrolling) */
        <div className="user-form-modal-grid">
          {/* Left Column: Personal Identity & Role */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Full Name & Username */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-fullname" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Full Name <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.User size={14} /></span>
                  <input
                    id="personnel-fullname"
                    type="text"
                    className="form-control"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="Juan Dela Cruz"
                    style={{ height: "36px", fontSize: "0.82rem" }}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-username" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Username <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Tag size={14} /></span>
                  <input
                    id="personnel-username"
                    type="text"
                    className="form-control"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="jdelacruz"
                    style={{ height: "36px", fontSize: "0.82rem" }}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Email Address */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-email" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Email Address <span className="req">*</span>
              </label>
              <div className={`login-pwd-wrap ${emailError ? "has-error" : ""}`}>
                <span className="login-pwd-icon"><Icon.Mail size={14} /></span>
                <input
                  id="personnel-email"
                  type="email"
                  className="form-control"
                  value={emailVal}
                  onChange={(e) => {
                    setEmailVal(e.target.value);
                    if (emailError) setEmailError("");
                    if (error) setError("");
                  }}
                  onBlur={handleEmailBlur}
                  placeholder="personnel@nagacity.gov.ph"
                  style={{ height: "36px", fontSize: "0.82rem" }}
                  required
                />
              </div>
              {emailError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginTop: "3px",
                    fontSize: "0.75rem",
                    color: "#dc2626",
                    fontWeight: 500,
                  }}
                >
                  <Icon.AlertTriangle size={12} />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            {/* Contact Number */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-contact" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Contact Number
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Phone size={14} /></span>
                <input
                  id="personnel-contact"
                  type="tel"
                  className="form-control"
                  value={contactVal}
                  onChange={(e) => setContactVal(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  style={{ height: "36px", fontSize: "0.82rem" }}
                />
              </div>
            </div>

            {/* Role Selection */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-role" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Role <span className="req">*</span>
              </label>
              <select
                id="personnel-role"
                className="form-control"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ height: "36px", fontWeight: 500, fontSize: "0.82rem" }}
              >
                <option value="staff">Slaughterhouse Staff</option>
                <option value="vet">Veterinarian (Meat Inspector)</option>
              </select>
            </div>
          </div>

          {/* Right Column: Password & Security Checklist */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-password" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Password <span className="req">*</span>
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Lock size={14} /></span>
                <input
                  id="personnel-password"
                  type={showPwd ? "text" : "password"}
                  className="form-control"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                  style={{ height: "36px", fontSize: "0.82rem" }}
                  required
                />
                <button
                  type="button"
                  className="login-pwd-toggle"
                  onClick={() => setShowPwd(!showPwd)}
                  aria-label={showPwd ? "Hide password" : "Show password"}
                  title={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <Icon.EyeOff size={14} /> : <Icon.Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Compact Real-Time Password Requirements Card */}
            <PasswordRequirements password={password} compact={true} />

            {/* Security Notice */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "0.73rem",
                color: "var(--color-text-muted, #64748b)",
                padding: "2px 2px",
              }}
            >
              <Icon.Info size={12} style={{ flexShrink: 0, color: "#0284c7" }} />
              <span>Personnel can change this password after login.</span>
            </div>
          </div>
        </div>
      ) : (
        /* Edit Mode Layout: 2-Column Grid */
        <div className="user-form-modal-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Full Name & Username */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-fullname" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Full Name <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.User size={14} /></span>
                  <input
                    id="personnel-fullname"
                    type="text"
                    className="form-control"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="e.g. Juan Dela Cruz"
                    style={{ height: "36px", fontSize: "0.82rem" }}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-username" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Username <span className="req">*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Tag size={14} /></span>
                  <input
                    id="personnel-username"
                    type="text"
                    className="form-control"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="e.g. jdelacruz"
                    style={{ height: "36px", fontSize: "0.82rem" }}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Email Address */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-email" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Email Address <span className="req">*</span>
              </label>
              <div className={`login-pwd-wrap ${emailError ? "has-error" : ""}`}>
                <span className="login-pwd-icon"><Icon.Mail size={14} /></span>
                <input
                  id="personnel-email"
                  type="email"
                  className="form-control"
                  value={emailVal}
                  onChange={(e) => {
                    setEmailVal(e.target.value);
                    if (emailError) setEmailError("");
                    if (error) setError("");
                  }}
                  onBlur={handleEmailBlur}
                  placeholder="personnel@nagacityabattoir.gov.ph"
                  style={{ height: "36px", fontSize: "0.82rem" }}
                  required
                />
              </div>
              {emailError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginTop: "3px",
                    fontSize: "0.75rem",
                    color: "#dc2626",
                    fontWeight: 500,
                  }}
                >
                  <Icon.AlertTriangle size={12} />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            {/* Contact Number */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-contact" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                Contact Number
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Phone size={14} /></span>
                <input
                  id="personnel-contact"
                  type="tel"
                  className="form-control"
                  value={contactVal}
                  onChange={(e) => setContactVal(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  style={{ height: "36px", fontSize: "0.82rem" }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Role Selection & Account Status */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-role" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Role <span className="req">*</span>
                </label>
                <select
                  id="personnel-role"
                  className="form-control"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{ height: "36px", fontWeight: 500, fontSize: "0.82rem" }}
                >
                  <option value="staff">Slaughterhouse Staff</option>
                  <option value="vet">Veterinarian (Meat Inspector)</option>
                  {role === "admin" && <option value="admin">System Administrator</option>}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-status" style={{ fontSize: "0.78rem", marginBottom: "3px" }}>
                  Account Status <span className="req">*</span>
                </label>
                <select
                  id="personnel-status"
                  className="form-control"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ height: "36px", fontWeight: 500, fontSize: "0.82rem" }}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
          paddingTop: "10px",
          borderTop: "1px solid var(--color-border)",
          marginTop: "2px",
        }}
      >
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} style={{ height: "36px", fontSize: "0.82rem", padding: "0 16px" }}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!isPasswordValid || submitting || !!emailError}
          style={{ minWidth: "130px", height: "36px", fontSize: "0.82rem", padding: "0 16px" }}
        >
          {submitting ? "Saving..." : initial ? "Save Changes" : "Create Personnel"}
        </Button>
      </div>
    </form>
  );
};
