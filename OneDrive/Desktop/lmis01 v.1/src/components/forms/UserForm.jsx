import { useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { PasswordRequirements } from "../ui/PasswordRequirements";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";
import { validateComEmail, isValidComEmail, EMAIL_COM_ERROR } from "../../utils/emailValidation";
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
  const [contactError, setContactError] = useState("");
  const [role, setRole] = useState(data.role || "staff");
  const [status, setStatus] = useState(data.status || "Active");

  const isPasswordValid = initial || validatePassword(password).isValid;

  const handleContactChange = (e) => {
    let val = e.target.value.replace(/\D/g, "");

    if (val.length === 1 && (val === "9" || val === "8")) {
      val = "0" + val;
    }

    val = val.slice(0, 11);

    setContactVal(val);

    if (val.length >= 2) {
      if (!val.startsWith("09") && !val.startsWith("08")) {
        setContactError("Contact number must start with 09 or 08 (e.g. 09171234567).");
        return;
      }
    }

    if (val.length === 11) {
      if (val.startsWith("09") || val.startsWith("08")) {
        setContactError("");
      }
    } else if (contactError) {
      if (val.startsWith("09") || val.startsWith("08") || val.length < 2) {
        setContactError("");
      }
    }

    if (error) setError("");
  };

  const handleContactBlur = () => {
    const raw = contactVal.trim().replace(/\D/g, "");
    if (!raw) {
      setContactError("");
      return;
    }
    if (!raw.startsWith("09") && !raw.startsWith("08")) {
      setContactError("Contact number must start with 09 or 08 (e.g. 09171234567).");
    } else if (raw.length !== 11) {
      setContactError(`Contact number must be exactly 11 digits (${raw.length}/11 entered).`);
    } else {
      setContactError("");
    }
  };

  const handleEmailBlur = async () => {
    const trimmed = emailVal.trim();
    if (trimmed !== emailVal) {
      setEmailVal(trimmed);
    }
    const clean = trimmed.toLowerCase();
    if (!clean) return;
    if (!isValidComEmail(clean)) {
      setEmailError(EMAIL_COM_ERROR);
      return;
    }
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
    const emailValidationMsg = validateComEmail(cleanEmail);
    if (emailValidationMsg) {
      setError(emailValidationMsg);
      setEmailError(emailValidationMsg);
      scrollToFirstError("personnel-email", { offset: 80 });
      return;
    }

    const rawContact = contactVal.trim().replace(/\D/g, "");
    if (rawContact) {
      if (!rawContact.startsWith("09") && !rawContact.startsWith("08")) {
        const msg = "Contact number must start with 09 or 08 (e.g. 09171234567).";
        setError(msg);
        setContactError(msg);
        scrollToFirstError("personnel-contact", { offset: 80 });
        return;
      }
      if (rawContact.length !== 11) {
        const msg = `Contact number must be exactly 11 digits (${rawContact.length}/11 entered).`;
        setError(msg);
        setContactError(msg);
        scrollToFirstError("personnel-contact", { offset: 80 });
        return;
      }
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
        contact: rawContact,
        phone: rawContact,
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
        return { bg: "#E6EFEA", color: "#136647", border: "#D3E0D8" };
      default:
        return { bg: "#E6EFEA", color: "#136647", border: "#D3E0D8" };
    }
  };

  const isSubmitDisabled = !isPasswordValid || submitting || !!emailError || !!contactError;

  return (
    <form onSubmit={handleSubmit} className="user-form-modal-wrap" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {initial ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            background: "var(--color-bg, #F7FAF9)",
            border: "1px solid var(--color-border, #E4EDE8)",
            borderRadius: "12px",
          }}
        >
          {data.avatar_url ? (
            <img
              src={data.avatar_url}
              alt={fullName || username || "Personnel"}
              referrerPolicy="no-referrer"
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                objectFit: "cover",
                boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                border: "1.5px solid var(--color-border)",
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
              width: 42,
              height: 42,
              borderRadius: "50%",
              background:
                role === "admin"
                  ? "linear-gradient(135deg, #f59e0b, #d97706)"
                  : role === "vet"
                  ? "#187A56"
                  : "linear-gradient(135deg, #24966D, #136647)",
              color: "#fff",
              display: data.avatar_url ? "none" : "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "0.92rem",
              boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              flexShrink: 0,
            }}
          >
            {initials(fullName || username || "Personnel")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: "0.94rem", color: "var(--color-text, #192420)" }}>
                {fullName || "Personnel Member"}
              </span>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: getRoleBadgeStyle(role).bg,
                  color: getRoleBadgeStyle(role).color,
                  border: `1px solid ${getRoleBadgeStyle(role).border}`,
                }}
              >
                {ROLE_LABELS[role] || role}
              </span>
            </div>
            <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted, #687D73)", marginTop: "2px" }}>
              @{username || "username"} • {initial.id ? `ID: ${String(initial.id).slice(0, 8)}...` : ""}
            </div>
          </div>
        </div>
      ) : null}

      {error && (
        <div
          style={{
            padding: "9px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            color: "#b91c1c",
            fontSize: "0.82rem",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Icon.AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {!initial ? (
        <div className="user-form-modal-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-fullname">
                  Full Name <span className="req" style={{ color: "#dc2626" }}>*</span>
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
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="personnel-username">
                  Username <span className="req" style={{ color: "#dc2626" }}>*</span>
                </label>
                <div className="login-pwd-wrap">
                  <span className="login-pwd-icon"><Icon.Tag size={14} /></span>
                  <input
                    id="personnel-username"
                    type="text"
                    className="form-control"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
                      if (error) setError("");
                    }}
                    placeholder="e.g. jdelacruz"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-email">
                Email Address <span className="req" style={{ color: "#dc2626" }}>*</span>
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
                  placeholder="e.g. personnel@nagacity.gov.ph"
                  required
                />
              </div>
              {emailError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginTop: "4px",
                    fontSize: "0.75rem",
                    color: "#dc2626",
                    fontWeight: 500,
                  }}
                >
                  <Icon.AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                <label className="form-label" htmlFor="personnel-contact" style={{ marginBottom: 0 }}>
                  Contact Number <span style={{ fontSize: "0.74rem", fontWeight: 500, color: "var(--color-text-muted, #687D73)" }}>(Optional)</span>
                </label>
                {contactVal.length > 0 && (
                  <span
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: contactVal.length === 11 ? "#10b981" : contactError ? "#dc2626" : "var(--color-text-muted, #687D73)",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {contactVal.length === 11 && <Icon.Check size={11} />}
                    {contactVal.length}/11
                  </span>
                )}
              </div>
              <div className={`login-pwd-wrap ${contactError ? "has-error" : ""}`}>
                <span className="login-pwd-icon"><Icon.Phone size={14} /></span>
                <input
                  id="personnel-contact"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  autoComplete="tel"
                  className="form-control"
                  value={contactVal}
                  onChange={handleContactChange}
                  onBlur={handleContactBlur}
                  placeholder="09171234567"
                />
              </div>
              {contactError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginTop: "4px",
                    fontSize: "0.75rem",
                    color: "#dc2626",
                    fontWeight: 500,
                  }}
                >
                  <Icon.AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span>{contactError}</span>
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-role">
                Role <span className="req" style={{ color: "#dc2626" }}>*</span>
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Shield size={14} /></span>
                <select
                  id="personnel-role"
                  className="form-control"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{ cursor: "pointer", fontWeight: 500 }}
                >
                  <option value="staff">Slaughterhouse Staff</option>
                  <option value="vet">Veterinary Inspector</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="personnel-password">
                Password <span className="req" style={{ color: "#dc2626" }}>*</span>
              </label>
              <div className="login-pwd-wrap">
                <span className="login-pwd-icon"><Icon.Lock size={14} /></span>
                <input
                  id="personnel-password"
                  type={showPwd ? "text" : "password"}
                  className="form-control"
                  placeholder="Enter secure password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
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

            <PasswordRequirements password={password} compact={true} />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                fontSize: "0.75rem",
                color: "#136647",
                background: "rgba(24, 122, 86, 0.08)",
                border: "1px solid rgba(24, 122, 86, 0.2)",
                borderRadius: "8px",
                padding: "8px 12px",
                marginTop: "2px",
              }}
            >
              <Icon.Info size={13} style={{ flexShrink: 0, color: "#187A56" }} />
              <span>Personnel can change this password after initial login.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="user-form-edit-grid">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="personnel-fullname">
              Full Name <span className="req" style={{ color: "#dc2626" }}>*</span>
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
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="personnel-username">
              Username <span className="req" style={{ color: "#dc2626" }}>*</span>
            </label>
            <div className="login-pwd-wrap">
              <span className="login-pwd-icon"><Icon.Tag size={14} /></span>
              <input
                id="personnel-username"
                type="text"
                className="form-control"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
                  if (error) setError("");
                }}
                placeholder="e.g. jdelacruz"
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="personnel-role">
              Role <span className="req" style={{ color: "#dc2626" }}>*</span>
            </label>
            <div className="login-pwd-wrap">
              <span className="login-pwd-icon"><Icon.Shield size={14} /></span>
              <select
                id="personnel-role"
                className="form-control"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ cursor: "pointer", fontWeight: 500 }}
              >
                <option value="staff">Slaughterhouse Staff</option>
                <option value="vet">Veterinary Inspector</option>
                {role === "admin" && <option value="admin">System Administrator</option>}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="personnel-status">
              Account Status <span className="req" style={{ color: "#dc2626" }}>*</span>
            </label>
            <div className="login-pwd-wrap">
              <span className="login-pwd-icon"><Icon.Activity size={14} /></span>
              <select
                id="personnel-status"
                className="form-control"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ cursor: "pointer", fontWeight: 500 }}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="personnel-email">
              Email Address <span className="req" style={{ color: "#dc2626" }}>*</span>
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
                required
              />
            </div>
            {emailError && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  marginTop: "4px",
                  fontSize: "0.75rem",
                  color: "#dc2626",
                  fontWeight: 500,
                }}
              >
                <Icon.AlertTriangle size={12} style={{ flexShrink: 0 }} />
                <span>{emailError}</span>
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
              <label className="form-label" htmlFor="personnel-contact" style={{ marginBottom: 0 }}>
                Contact Number <span style={{ fontSize: "0.74rem", fontWeight: 500, color: "var(--color-text-muted, #687D73)" }}>(Optional)</span>
              </label>
              {contactVal.length > 0 && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: contactVal.length === 11 ? "#10b981" : contactError ? "#dc2626" : "var(--color-text-muted, #687D73)",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  {contactVal.length === 11 && <Icon.Check size={11} />}
                  {contactVal.length}/11
                </span>
              )}
            </div>
            <div className={`login-pwd-wrap ${contactError ? "has-error" : ""}`}>
              <span className="login-pwd-icon"><Icon.Phone size={14} /></span>
              <input
                id="personnel-contact"
                type="tel"
                inputMode="numeric"
                maxLength={11}
                autoComplete="tel"
                className="form-control"
                value={contactVal}
                onChange={handleContactChange}
                onBlur={handleContactBlur}
                placeholder="09171234567"
              />
            </div>
            {contactError && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  marginTop: "4px",
                  fontSize: "0.75rem",
                  color: "#dc2626",
                  fontWeight: 500,
                }}
              >
                <Icon.AlertTriangle size={12} style={{ flexShrink: 0 }} />
                <span>{contactError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "10px",
          paddingTop: "14px",
          borderTop: "1px solid var(--color-border, #E4EDE8)",
          marginTop: "4px",
        }}
      >
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
          style={{
            height: "38px",
            fontSize: "0.84rem",
            fontWeight: 600,
            padding: "0 18px",
            borderRadius: "8px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Icon.X size={14} />
          <span>Cancel</span>
        </Button>
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          style={{
            minWidth: "150px",
            height: "38px",
            fontSize: "0.84rem",
            fontWeight: 700,
            padding: "0 20px",
            borderRadius: "8px",
            background: isSubmitDisabled ? undefined : "linear-gradient(135deg, #187A56 0%, #136647 100%)",
            border: "none",
            boxShadow: isSubmitDisabled ? "none" : "0 2px 8px rgba(24, 122, 86, 0.28)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
            color: "#ffffff",
          }}
        >
          {submitting ? (
            <>
              <div className="spin-animation"><Icon.RefreshCw size={15} /></div>
              <span>Saving...</span>
            </>
          ) : initial ? (
            <>
              <Icon.Check size={15} />
              <span>Save Changes</span>
            </>
          ) : (
            <>
              <Icon.UserPlus size={15} />
              <span>Create Personnel</span>
            </>
          )}
        </Button>
      </div>

      <style>{`
        .user-form-modal-wrap .form-label {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-text, #192420);
          margin-bottom: 4px;
          display: block;
        }
        .user-form-modal-wrap .login-pwd-wrap .form-control {
          height: 38px !important;
          font-size: 0.84rem !important;
          border-radius: 8px !important;
          padding-left: 36px !important;
          padding-right: 12px !important;
          border: 1.5px solid var(--color-border, #CADCD4) !important;
          background-color: var(--color-surface, #ffffff) !important;
          color: var(--color-text, #192420) !important;
          transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
          box-sizing: border-box !important;
        }
        .user-form-modal-wrap .login-pwd-wrap input#personnel-password {
          padding-right: 36px !important;
        }
        .user-form-modal-wrap .login-pwd-wrap .form-control:hover {
          border-color: #187A56 !important;
        }
        .user-form-modal-wrap .login-pwd-wrap .form-control:focus {
          border-color: #187A56 !important;
          box-shadow: 0 0 0 3px rgba(24, 122, 86, 0.14) !important;
          outline: none !important;
        }
        .user-form-modal-wrap .login-pwd-wrap.has-error .form-control {
          border-color: #dc2626 !important;
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12) !important;
        }
        .user-form-modal-wrap .login-pwd-icon {
          left: 12px !important;
          color: #687D73 !important;
        }
        .user-form-modal-wrap .login-pwd-wrap:focus-within .login-pwd-icon {
          color: #187A56 !important;
        }
        .user-form-modal-wrap .login-pwd-wrap.has-error .login-pwd-icon {
          color: #dc2626 !important;
        }
        [data-theme="dark"] .user-form-modal-wrap .login-pwd-wrap .form-control,
        .dark .user-form-modal-wrap .login-pwd-wrap .form-control {
          background-color: #1A2420 !important;
          border-color: #3E4E46 !important;
          color: #EFF5F2 !important;
        }
        [data-theme="dark"] .user-form-modal-wrap .login-pwd-wrap .form-control:focus,
        .dark .user-form-modal-wrap .login-pwd-wrap .form-control:focus {
          border-color: #34D399 !important;
          box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2) !important;
        }
      `}</style>
    </form>
  );
};
