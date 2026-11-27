import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES, STORAGE_KEYS } from "../../utils/constants";
import { formatDate } from "../../utils/formatters";
import { uploadAvatarFile } from "../../services/avatarService";
import { authStore } from "../../store/authStore";
import { ownerAuthService } from "../../services/ownerAuthService";
import { isInstalledApp } from "../../utils/capacitor";
import { AlertDialog, ConfirmDialog } from "../../components/ui";
import {
  validatePhilippineMobileNumber,
  sanitizePhilippineMobileInput,
} from "../../utils/phoneValidation";
import { AuthSecuritySessions } from "../../components/settings/AuthSecuritySessions";

export const OwnerProfile = () => {
  const { session, signOut, ownerId } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [owner, setOwner] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarError, setAvatarError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const [alertDialog, setAlertDialog] = useState({
    open: false,
    title: "",
    message: "",
    variant: "success",
  });

  const [isEditing, setIsEditing] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [form, setForm] = useState({
    name: "",
    contact: "",
    address: "",
  });
  const [contactError, setContactError] = useState("");

  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoMsg, setPhotoMsg] = useState(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [securityMsg, setSecurityMsg] = useState(null);

  const isRunningInNativeApk = isInstalledApp();

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      setAuthUser(user);

      const email = (user?.email || session?.email || "").trim().toLowerCase();
      const authUid = user?.id || session?.id || session?.user_id;
      let targetOwnerId = ownerId || session?.owner_id;
      let foundOwner = null;

      if (authUid) {
        const { data: oByAuthId } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("auth_user_id", authUid)
          .maybeSingle();

        if (oByAuthId) {
          foundOwner = oByAuthId;
          targetOwnerId = oByAuthId.id;
        }
      }

      if (!foundOwner && targetOwnerId) {
        const { data: oById } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", targetOwnerId)
          .maybeSingle();

        if (oById) {
          foundOwner = oById;
        }
      }

      if (!foundOwner && email) {
        const { data: oByEmail } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .ilike("email", email)
          .maybeSingle();

        if (oByEmail) {
          foundOwner = oByEmail;
          targetOwnerId = oByEmail.id;
        }
      }

      if (!foundOwner && (authUid || email)) {
        let uQ = supabase.from(TABLES.USERS).select("owner_id, full_name, avatar_url");
        if (authUid && email) {
          uQ = uQ.or(`id.eq.${authUid},email.ilike.${email}`);
        } else if (authUid) {
          uQ = uQ.eq("id", authUid);
        } else {
          uQ = uQ.ilike("email", email);
        }
        const { data: uData } = await uQ.limit(1).maybeSingle();

        if (uData?.owner_id) {
          targetOwnerId = uData.owner_id;
          const { data: oById } = await supabase
            .from(TABLES.OWNERS)
            .select("*")
            .eq("id", targetOwnerId)
            .maybeSingle();
          if (oById) foundOwner = oById;
        }
      }

      if (foundOwner && authUid && !foundOwner.auth_user_id) {
        try {
          await supabase.from(TABLES.OWNERS).update({ auth_user_id: authUid }).eq("id", foundOwner.id);
          foundOwner.auth_user_id = authUid;
        } catch (_) {}
      }

      setOwner(foundOwner);
      setForm({
        name: foundOwner?.name || user?.user_metadata?.full_name || session?.name || "",
        contact: foundOwner?.contact || foundOwner?.phone || user?.user_metadata?.contact || user?.user_metadata?.phone || "",
        address: foundOwner?.address || user?.user_metadata?.address || "",
      });
    } catch (err) {
      console.warn("Failed to load owner profile:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    const onRefresh = () => fetchProfile();
    window.addEventListener("lmis-db-change", onRefresh);
    window.addEventListener("storage", onRefresh);
    return () => {
      window.removeEventListener("lmis-db-change", onRefresh);
      window.removeEventListener("storage", onRefresh);
    };
  }, [ownerId]);

  const handlePhotoSelect = (e) => {
    setPhotoMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      const errText = "Please select an image file (PNG, JPG, or WEBP).";
      setPhotoMsg({ type: "error", text: errText });
      setAlertDialog({
        open: true,
        title: "Invalid File Type",
        message: errText,
        variant: "danger",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      const errText = "Image file size must be 5MB or less.";
      setPhotoMsg({ type: "error", text: errText });
      setAlertDialog({
        open: true,
        title: "File Too Large",
        message: errText,
        variant: "danger",
      });
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setAvatarError(false);
  };

  const handleCancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSavePhoto = () => {
    if (!selectedFile || isUploadingPhoto) return;
    setConfirmAction({
      type: "photo",
      title: "Update Profile Photo",
      message: "Are you sure you want to update your profile picture?",
    });
  };

  const executeSavePhoto = async () => {
    if (!selectedFile || isUploadingPhoto) return;
    setConfirmAction(null);
    setIsUploadingPhoto(true);
    setPhotoMsg(null);

    try {
      const authUserId = authUser?.id || session?.id || session?.user_id;
      const targetOwnerId = owner?.id || ownerId || session?.owner_id;
      const email = owner?.email || authUser?.email || session?.email;
      const targetIdentifier = targetOwnerId || authUserId || "owner";

      const publicUrl = await uploadAvatarFile(selectedFile, targetIdentifier);
      if (!publicUrl) {
        throw new Error("Unable to retrieve public CDN URL for the uploaded photo.");
      }

      await ownerAuthService.updateOwnerPhoto({
        ownerId: targetOwnerId,
        authUserId,
        email,
        avatarUrl: publicUrl,
      });

      const curSess = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
      const newSess = { ...curSess, avatar_url: publicUrl };
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(newSess));
      authStore.set({ session: newSess });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lmis_profile_updated", { detail: newSess }));
      }

      setOwner((prev) => ({ ...prev, avatar_url: publicUrl }));
      setPreviewUrl(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPhotoMsg({ type: "success", text: "Profile picture saved successfully!" });

      setAlertDialog({
        open: true,
        title: "Profile Picture Updated",
        message: "Your profile picture has been successfully uploaded to Supabase Storage and saved.",
        variant: "success",
      });
    } catch (err) {
      console.error("Photo upload error:", err);
      const errMsg = err.message || "Failed to upload photo.";
      setPhotoMsg({ type: "error", text: errMsg });
      setAlertDialog({
        open: true,
        title: "Upload Failed",
        message: errMsg,
        variant: "danger",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e?.preventDefault();
    setProfileMsg(null);
    setContactError("");

    const trimmedName = form.name.trim();
    const trimmedContact = form.contact.trim();
    const trimmedAddress = form.address.trim();

    if (!trimmedName) {
      setProfileMsg({ type: "error", text: "Full Name is required." });
      setAlertDialog({
        open: true,
        title: "Validation Error",
        message: "Full Name is required.",
        variant: "danger",
      });
      return;
    }

    const phoneVal = validatePhilippineMobileNumber(trimmedContact);
    if (!phoneVal.isValid) {
      setContactError(phoneVal.error);
      setProfileMsg({ type: "error", text: phoneVal.error });
      setAlertDialog({
        open: true,
        title: "Invalid Phone Number",
        message: phoneVal.error,
        variant: "danger",
      });
      return;
    }

    if (isSavingProfile) return;
    setConfirmAction({
      type: "profile",
      title: "Update Profile Information",
      message: "Are you sure you want to save your updated profile information?",
    });
  };

  const executeSaveProfile = async () => {
    if (isSavingProfile) return;
    const trimmedName = form.name.trim();
    const trimmedContact = form.contact.trim();
    const trimmedAddress = form.address.trim();
    const phoneVal = validatePhilippineMobileNumber(trimmedContact);
    setConfirmAction(null);
    setIsSavingProfile(true);
    try {
      const email = owner?.email || authUser?.email || session?.email;
      const authUserId = authUser?.id || session?.id || session?.user_id;
      const targetOwnerId = owner?.id || ownerId || session?.owner_id;

      await ownerAuthService.updateOwnerProfile({
        ownerId: targetOwnerId,
        authUserId,
        email,
        name: trimmedName,
        contact: phoneVal.digits,
        address: trimmedAddress,
      });

      const curSess = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
      const newSess = { ...curSess, name: trimmedName, phone: phoneVal.digits };
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(newSess));
      authStore.set({ session: newSess });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lmis_profile_updated", { detail: newSess }));
      }

      setOwner((prev) => ({
        ...prev,
        name: trimmedName,
        contact: phoneVal.digits,
        address: trimmedAddress,
      }));

      setIsEditing(false);
      setProfileMsg({
        type: "success",
        text: "Personal information updated successfully!",
      });

      setAlertDialog({
        open: true,
        title: "Profile Updated",
        message: "Your profile information has been successfully saved to Supabase.",
        variant: "success",
      });
    } catch (err) {
      console.error("Save profile error:", err);
      const errMsg = err.message || "Failed to update profile.";
      setProfileMsg({ type: "error", text: errMsg });
      setAlertDialog({
        open: true,
        title: "Update Failed",
        message: errMsg,
        variant: "danger",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e?.preventDefault();
    setSecurityMsg(null);

    if (!currentPassword) {
      setSecurityMsg({ type: "error", text: "Please enter your current password." });
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setSecurityMsg({ type: "error", text: "New password must be at least 8 characters long." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setSecurityMsg({ type: "error", text: "New password and confirmation do not match." });
      return;
    }

    setIsChangingPassword(true);
    try {
      const email = owner?.email || authUser?.email || session?.email;
      if (!email) throw new Error("Authenticated email not found.");

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: currentPassword,
      });

      if (signInErr) {
        setSecurityMsg({ type: "error", text: "Current password is incorrect. Please try again." });
        setIsChangingPassword(false);
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updErr) throw updErr;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSecurityMsg({ type: "success", text: "Password changed successfully!" });
    } catch (err) {
      console.error("Password change error:", err);
      setSecurityMsg({ type: "error", text: err.message || "Failed to update password." });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleCopyId = () => {
    const idToCopy = owner?.id || ownerId;
    if (!idToCopy) return;
    navigator.clipboard?.writeText(idToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/?login=true", { replace: true });
    } catch (err) {
      console.warn("Logout error:", err);
    }
  };

  const handleOpenLogoutConfirm = () => {
    if (logoutConfirmOpen || loggingOut) return;
    setLogoutConfirmOpen(true);
  };

  const handleCancelLogout = () => {
    if (loggingOut) return;
    setLogoutConfirmOpen(false);
  };

  const handleConfirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await handleLogout();
    } finally {
      setLogoutConfirmOpen(false);
      setLoggingOut(false);
    }
  };

  const resolvedAvatarUrl =
    previewUrl ||
    owner?.avatar_url ||
    authUser?.user_metadata?.avatar_url ||
    authUser?.user_metadata?.picture ||
    session?.avatar_url ||
    "";

  const registeredEmail = owner?.email || authUser?.email || session?.email || "—";
  const displayName = form.name || owner?.name || session?.name || "Livestock Owner";
  const isGoogleAuth = Boolean(
    owner?.auth_provider === "google" ||
    authUser?.app_metadata?.provider === "google" ||
    authUser?.user_metadata?.auth_provider === "google"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={handlePhotoSelect}
      />

      <div className="owner-profile-card" style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div className="owner-profile-avatar-wrap" style={{ margin: 0, flexShrink: 0 }}>
            {resolvedAvatarUrl && !avatarError ? (
              <img
                src={resolvedAvatarUrl}
                alt={displayName}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="owner-profile-avatar-img"
              />
            ) : (
              <Icon.User size={38} />
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="owner-profile-camera-btn"
              title="Upload or change profile picture"
              aria-label="Upload profile picture"
            >
              <Icon.Camera size={14} />
            </button>

            <div className="owner-profile-check-badge" title="Verified Livestock Owner">
              <Icon.Check size={12} style={{ strokeWidth: 3 }} />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 5,
              textAlign: "left",
            }}
          >
            <h1 className="owner-profile-name" style={{ fontSize: 18, marginBottom: 0 }}>
              {loading ? "Loading..." : displayName}
            </h1>

            <div style={{ fontSize: 12, color: "#5D6660", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 5 }}>
              <Icon.Mail size={12} />
              <span>{registeredEmail}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  padding: "2px 8px",
                  borderRadius: 9999,
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Icon.ShieldCheck size={11} /> Verified Raiser
              </span>
            </div>
          </div>
        </div>

        {previewUrl && (
          <div className="owner-profile-preview-card" style={{ marginTop: 10 }}>
            <img src={previewUrl} alt="Preview" className="owner-profile-preview-img" />
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text, #1A201C)" }}>
                New Picture Preview
              </div>
              <div style={{ fontSize: 11, color: "#5D6660" }}>
                Ready to save as your profile photo.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={handleSavePhoto}
                disabled={isUploadingPhoto}
                className="owner-profile-action-btn primary"
                style={{ padding: "6px 12px", fontSize: 11.5, minHeight: 32 }}
              >
                {isUploadingPhoto ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={handleCancelPreview}
                disabled={isUploadingPhoto}
                className="owner-profile-action-btn cancel"
                style={{ padding: "6px 10px", fontSize: 11.5, minHeight: 32 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {photoMsg && (
          <div
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
              marginTop: 6,
              background: photoMsg.type === "success" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
              color: photoMsg.type === "success" ? "#10b981" : "#ef4444",
              border: `1px solid ${photoMsg.type === "success" ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
              textAlign: "center",
            }}
          >
            {photoMsg.text}
          </div>
        )}
      </div>

      <div className="owner-profile-card">
        <div className="owner-profile-section-title">
          <h2 className="owner-profile-section-heading">
            <Icon.User size={15} style={{ color: "#187A56" }} />
            <span>Personal Information</span>
          </h2>
          {!isEditing && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(true);
                setProfileMsg(null);
              }}
              className="owner-profile-edit-toggle-btn"
              style={{ padding: "3px 9px", fontSize: 11 }}
            >
              <Icon.Edit size={11} /> Edit
            </button>
          )}
        </div>

        {profileMsg && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: profileMsg.type === "success" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
              color: profileMsg.type === "success" ? "#10b981" : "#ef4444",
              border: `1px solid ${profileMsg.type === "success" ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
            }}
          >
            {profileMsg.text}
          </div>
        )}

        {isEditing ? (
          <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="owner-profile-field">
              <label className="owner-profile-label" htmlFor="owner-fullname">
                Full Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="owner-fullname"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter full name"
                className="owner-profile-input"
                required
              />
            </div>

            <div className="owner-profile-field">
              <label className="owner-profile-label" htmlFor="owner-email">
                Registered Email (Locked)
              </label>
              <input
                id="owner-email"
                type="email"
                value={registeredEmail}
                disabled
                className="owner-profile-input"
              />
              <span style={{ fontSize: 10.5, color: "#9BA49E" }}>
                Email address is tied to your login account and cannot be modified directly.
              </span>
            </div>

            <div className="owner-profile-field">
              <label className="owner-profile-label" htmlFor="owner-contact">
                Contact Number <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="owner-contact"
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={form.contact}
                onChange={(e) => {
                  const sanitized = sanitizePhilippineMobileInput(e.target.value);
                  setForm({ ...form, contact: sanitized });
                  if (contactError) setContactError("");
                }}
                placeholder="09XXXXXXXXX"
                className={`owner-profile-input ${contactError ? "has-error" : ""}`}
                style={contactError ? { borderColor: "#ef4444" } : {}}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted, #5D6660)",
                  marginTop: 4,
                  display: "block",
                }}
              >
                11-digit Philippine mobile number starting with 09 (Globe, TM, Smart, TNT)
              </span>
              {contactError && (
                <span
                  style={{
                    fontSize: 11.5,
                    color: "#ef4444",
                    fontWeight: 600,
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Icon.AlertTriangle size={12} /> {contactError}
                </span>
              )}
            </div>

            <div className="owner-profile-field">
              <label className="owner-profile-label" htmlFor="owner-address">
                Address
              </label>
              <input
                id="owner-address"
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Barangay, City, Province"
                className="owner-profile-input"
              />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                disabled={isSavingProfile}
                className="owner-profile-action-btn primary"
                style={{ flex: 1 }}
              >
                {isSavingProfile ? "Saving Changes..." : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm({
                    name: owner?.name || authUser?.user_metadata?.full_name || session?.name || "",
                    contact: owner?.contact || owner?.phone || authUser?.user_metadata?.phone || "",
                    address: owner?.address || authUser?.user_metadata?.address || "",
                  });
                  setIsEditing(false);
                }}
                disabled={isSavingProfile}
                className="owner-profile-action-btn cancel"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="owner-profile-info-grid">
            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.User size={14} style={{ color: "#187A56" }} /> Full Name
              </span>
              <span className="owner-profile-info-val">
                {displayName}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.Mail size={14} style={{ color: "#187A56" }} /> Email Address
              </span>
              <span className="owner-profile-info-val" style={{ wordBreak: "break-all" }}>
                {registeredEmail}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.Phone size={14} style={{ color: "#187A56" }} /> Contact Number
              </span>
              <span className="owner-profile-info-val">
                {owner?.contact || owner?.phone || "Not specified"}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.MapPin size={14} style={{ color: "#187A56" }} /> Address
              </span>
              <span className="owner-profile-info-val">
                {owner?.address || "Not specified"}
              </span>
            </div>
          </div>
        )}
      </div>


      <AuthSecuritySessions
        userEmail={registeredEmail}
        userRole="owner"
        userName={displayName}
        onSignOut={handleLogout}
      />

      <button
        type="button"
        onClick={handleOpenLogoutConfirm}
        className="owner-profile-logout-btn"
        title="Sign out of the Livestock Owner Portal"
      >
        <Icon.LogOut size={16} />
        <span>Sign Out of Portal</span>
      </button>

      <ConfirmDialog
        open={logoutConfirmOpen}
        onCancel={handleCancelLogout}
        onConfirm={handleConfirmLogout}
        title="Confirm Logout"
        message="Are you sure you want to log out?"
        cancelText="Cancel"
        confirmText="Yes, Logout"
        confirmVariant="danger"
        loading={loggingOut}
        size="sm"
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onCancel={() => {
          if (!isSavingProfile && !isUploadingPhoto) setConfirmAction(null);
        }}
        onConfirm={() => {
          if (confirmAction?.type === "photo") executeSavePhoto();
          else if (confirmAction?.type === "profile") executeSaveProfile();
        }}
        title={confirmAction?.title || "Confirm Action"}
        message={confirmAction?.message || "Are you sure you want to proceed?"}
        confirmText="Confirm"
        cancelText="Cancel"
        confirmVariant="primary"
        loading={isSavingProfile || isUploadingPhoto}
      />

      <AlertDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog((prev) => ({ ...prev, open: false }))}
        title={alertDialog.title}
        message={alertDialog.message}
        variant={alertDialog.variant}
        buttonText="OK"
      />
    </div>
  );
};

export default OwnerProfile;
