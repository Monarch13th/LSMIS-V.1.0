import { useState, useEffect, useRef, useMemo } from "react";
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
import { AlertDialog, Modal } from "../../components/ui";
import {
  validatePhilippineMobileNumber,
  sanitizePhilippineMobileInput,
} from "../../utils/phoneValidation";

export const OwnerProfile = () => {
  const { session, signOut, ownerId } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Profile data
  const [owner, setOwner] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarError, setAvatarError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Alert Dialog Popup state
  const [alertDialog, setAlertDialog] = useState({
    open: false,
    title: "",
    message: "",
    variant: "success",
  });

  // Edit Personal Information state
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null); // { type: 'success'|'error', text: '' }
  const [form, setForm] = useState({
    name: "",
    contact: "",
    address: "",
  });
  const [contactError, setContactError] = useState("");

  // Photo upload and preview state
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoMsg, setPhotoMsg] = useState(null);

  // Account Security / Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [securityMsg, setSecurityMsg] = useState(null);

  // Optional Download Application state (Owner portal only)
  const [appPackage, setAppPackage] = useState({
    name: "LSMIS",
    description: "Livestock Slaughter and Meat Inspection Management System",
    packageId: "ph.gov.nagacity.lsmis",
    version: "1.0.0",
    buildNumber: "1",
    platform: "Android 8.0+ (Signed Release APK)",
    fileName: "LSMIS-Mobile-v1.0.0.apk",
    downloadUrl: "/downloads/LSMIS-Mobile-v1.0.0.apk",
    fileSize: "40.5 MB",
    isAvailable: true,
    isChecking: false,
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMsg, setDownloadMsg] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  // Installed APK or installed PWA (Download Application is hidden in both)
  const isRunningInNativeApk = isInstalledApp();

  // Fetch real owner profile from Supabase (authoritative data from public.owners)
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

      // 1. Try finding owner in public.owners by auth_user_id (the authentic link to Supabase Auth user)
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

      // 2. If not found by auth_user_id, try by ownerId
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

      // 3. If not found, try by email
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

      // 4. Fallback: check public.users to find linked owner_id
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

      // Ensure auth_user_id is permanently linked on the owner record if it was missing
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

  // Handle Photo Selection & Preview
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

  // Upload and Save Profile Picture to Supabase Storage
  const handleSavePhoto = async () => {
    if (!selectedFile) return;
    setIsUploadingPhoto(true);
    setPhotoMsg(null);

    try {
      const authUserId = authUser?.id || session?.id || session?.user_id;
      const targetOwnerId = owner?.id || ownerId || session?.owner_id;
      const email = owner?.email || authUser?.email || session?.email;
      const targetIdentifier = targetOwnerId || authUserId || "owner";

      // 1. Upload to Supabase Storage ('avatars' bucket) and get public CDN URL
      const publicUrl = await uploadAvatarFile(selectedFile, targetIdentifier);
      if (!publicUrl) {
        throw new Error("Unable to retrieve public CDN URL for the uploaded photo.");
      }

      // 2. Persist in database records via ownerAuthService with confirmation
      await ownerAuthService.updateOwnerPhoto({
        ownerId: targetOwnerId,
        authUserId,
        email,
        avatarUrl: publicUrl,
      });

      // 3. Update session storage & authStore
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

      // Requirement 4: Display a success popup after successfully saving changes
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

  // Save Personal Information to Supabase
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

    // Strict validation for Philippine mobile number (TM, TNT, Smart, Globe)
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

    setIsSavingProfile(true);
    try {
      const email = owner?.email || authUser?.email || session?.email;
      const authUserId = authUser?.id || session?.id || session?.user_id;
      const targetOwnerId = owner?.id || ownerId || session?.owner_id;

      // 1. Invoke authoritative backend update with server-side validation
      await ownerAuthService.updateOwnerProfile({
        ownerId: targetOwnerId,
        authUserId,
        email,
        name: trimmedName,
        contact: phoneVal.digits,
        address: trimmedAddress,
      });

      // 2. Update session storage and global auth store
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

      // Requirement 4: Display a success popup after successfully saving changes
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

  // Change Password
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

      // Verify current password first
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: currentPassword,
      });

      if (signInErr) {
        setSecurityMsg({ type: "error", text: "Current password is incorrect. Please try again." });
        setIsChangingPassword(false);
        return;
      }

      // Update password
      const { error: updErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updErr) throw updErr;

      // Clear password inputs
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

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/?login=true", { replace: true });
    } catch (err) {
      console.warn("Logout error:", err);
    }
  };

  // Check Downloadable Package Availability and capture PWA beforeinstallprompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const checkPackage = async () => {
      if (isRunningInNativeApk) {
        setAppPackage((prev) => ({
          ...prev,
          isAvailable: true,
          fileSize: "Installed on Device (v1.0.0)",
          isChecking: false,
        }));
        return;
      }
      try {
        const res = await fetch("/downloads/LSMIS-Mobile-v1.0.0.apk", {
          method: "HEAD",
          cache: "no-store",
        });
        const length = parseInt(res.headers.get("content-length") || "0", 10);
        if (res.ok && length > 100000) {
          const formattedSize = `${(length / (1024 * 1024)).toFixed(2)} MB`;
          setAppPackage((prev) => ({
            ...prev,
            isAvailable: true,
            fileSize: formattedSize,
            isChecking: false,
          }));
        } else {
          setAppPackage((prev) => ({
            ...prev,
            isAvailable: true,
            fileSize: "40.5 MB",
            isChecking: false,
          }));
        }
      } catch {
        setAppPackage((prev) => ({
          ...prev,
          isAvailable: true,
          fileSize: "40.5 MB",
          isChecking: false,
        }));
      }
    };

    checkPackage();

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, [isRunningInNativeApk]);

  const handleDownloadApp = () => {
    setDownloadMsg(null);
    setIsDownloading(true);
    setDownloadProgress(35);

    try {
      // Trigger direct native APK download so Android's Download Manager & Package Installer handle the .apk file
      const link = document.createElement("a");
      link.href = `${appPackage.downloadUrl}?v=${encodeURIComponent(appPackage.version)}`;
      link.download = appPackage.fileName;
      link.setAttribute("target", "_blank");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => {
        setDownloadProgress(80);
      }, 400);

      setTimeout(() => {
        setDownloadProgress(100);
        setIsDownloading(false);
        setShowInstallGuide(true);

        const sizeLabel = appPackage.fileSize ? ` (${appPackage.fileSize})` : "";
        setDownloadMsg({
          type: "success",
          text: `Download initiated: ${appPackage.fileName}${sizeLabel}. Open the downloaded APK from your notifications or Downloads folder to install LSMIS.`,
        });
        setAlertDialog({
          open: true,
          title: "APK Download Started",
          message: `${appPackage.fileName}${sizeLabel} is downloading to your Android device. Once finished, tap "Open" in your notification bar or Downloads app and select "Install" to add LSMIS to your app drawer.`,
          variant: "success",
        });
      }, 900);
    } catch {
      setIsDownloading(false);
      setDownloadProgress(0);
      setDownloadMsg({
        type: "error",
        text: "Could not trigger download automatically. Please check your browser download settings.",
      });
    }
  };

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setDownloadMsg({
          type: "success",
          text: "LSMIS application installed successfully on your device!",
        });
        setAlertDialog({
          open: true,
          title: "Application Installed",
          message:
            "LSMIS was successfully installed. You can now launch it directly from your device home screen.",
          variant: "success",
        });
        setDeferredPrompt(null);
      }
    } catch (err) {
      console.warn("PWA install error:", err);
    }
  };

  // Resolve active avatar URL
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
      {/* Hidden File Input for Profile Picture Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={handlePhotoSelect}
      />

      {/* ============================================================ */}
      {/* SECTION A: PROFILE HEADER                                    */}
      {/* ============================================================ */}
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
          {/* Left: Circular Profile Picture */}
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

            {/* Change Photo Camera Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="owner-profile-camera-btn"
              title="Upload or change profile picture"
              aria-label="Upload profile picture"
            >
              <Icon.Camera size={14} />
            </button>

            {/* Verified Status Badge */}
            <div className="owner-profile-check-badge" title="Verified Livestock Owner">
              <Icon.Check size={12} style={{ strokeWidth: 3 }} />
            </div>
          </div>

          {/* Right: Name, Email & Status */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 5,
              textAlign: "left",
            }}
          >
            {/* Owner Full Name */}
            <h1 className="owner-profile-name" style={{ fontSize: 18, marginBottom: 0 }}>
              {loading ? "Loading..." : displayName}
            </h1>

            {/* Registered Email */}
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 5 }}>
              <Icon.Mail size={12} />
              <span>{registeredEmail}</span>
            </div>

            {/* Account Status Pill */}
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

        {/* ============================================================ */}
        {/* SECTION C: PROFILE PICTURE PREVIEW BEFORE SAVING             */}
        {/* ============================================================ */}
        {previewUrl && (
          <div className="owner-profile-preview-card" style={{ marginTop: 10 }}>
            <img src={previewUrl} alt="Preview" className="owner-profile-preview-img" />
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                New Picture Preview
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
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

      {/* ============================================================ */}
      {/* SECTION B: PERSONAL INFORMATION                              */}
      {/* ============================================================ */}
      <div className="owner-profile-card">
        <div className="owner-profile-section-title">
          <h2 className="owner-profile-section-heading">
            <Icon.User size={15} style={{ color: "#0284c7" }} />
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
          /* Edit Form */
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
              <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
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
                  color: "var(--color-text-muted, #64748b)",
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
          /* View List */
          <div className="owner-profile-info-grid">
            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.User size={14} style={{ color: "#0284c7" }} /> Full Name
              </span>
              <span className="owner-profile-info-val">
                {displayName}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.Mail size={14} style={{ color: "#0284c7" }} /> Email Address
              </span>
              <span className="owner-profile-info-val" style={{ wordBreak: "break-all" }}>
                {registeredEmail}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.Phone size={14} style={{ color: "#0284c7" }} /> Contact Number
              </span>
              <span className="owner-profile-info-val">
                {owner?.contact || owner?.phone || "Not specified"}
              </span>
            </div>

            <div className="owner-profile-info-row">
              <span className="owner-profile-info-label">
                <Icon.MapPin size={14} style={{ color: "#0284c7" }} /> Address
              </span>
              <span className="owner-profile-info-val">
                {owner?.address || "Not specified"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Download Application is website-only: not rendered inside the installed Android app */}
      {!isRunningInNativeApk && (
      <>
      {/* ============================================================ */}
      {/* SECTION F: DOWNLOAD APPLICATION (OWNER ACCOUNT ONLY)         */}
      {/* ============================================================ */}
      <div className="owner-profile-card">
        <div className="owner-profile-section-title">
          <h2 className="owner-profile-section-heading">
            <Icon.Download size={15} style={{ color: "#0284c7" }} />
            <span>Download Application</span>
          </h2>
        </div>

        {/* Download Progress Indicator */}
        {(isDownloading || downloadProgress > 0) && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#0284c7", marginBottom: 4 }}>
              <span>{downloadProgress < 100 ? `Downloading ${appPackage.fileName}...` : "APK Ready to Install"}</span>
              <span>{downloadProgress}%</span>
            </div>
            <div style={{ width: "100%", height: 6, borderRadius: 999, background: "rgba(2, 132, 199, 0.15)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${downloadProgress}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #0284c7, #10b981)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Status Feedback Message */}
        {downloadMsg && (
          <div
            style={{
              padding: "9px 12px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background:
                downloadMsg.type === "success"
                  ? "rgba(16, 185, 129, 0.12)"
                  : downloadMsg.type === "warning"
                  ? "rgba(245, 158, 11, 0.12)"
                  : "rgba(239, 68, 68, 0.12)",
              color:
                downloadMsg.type === "success"
                  ? "#10b981"
                  : downloadMsg.type === "warning"
                  ? "#d97706"
                  : "#ef4444",
              border: `1px solid ${
                downloadMsg.type === "success"
                  ? "rgba(16, 185, 129, 0.25)"
                  : downloadMsg.type === "warning"
                  ? "rgba(245, 158, 11, 0.25)"
                  : "rgba(239, 68, 68, 0.25)"
              }`,
            }}
          >
            {downloadMsg.type === "success" ? (
              <Icon.CheckCircle size={15} style={{ flexShrink: 0 }} />
            ) : downloadMsg.type === "warning" ? (
              <Icon.AlertTriangle size={15} style={{ flexShrink: 0 }} />
            ) : (
              <Icon.AlertCircle size={15} style={{ flexShrink: 0 }} />
            )}
            <span style={{ lineHeight: 1.4 }}>{downloadMsg.text}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={handleDownloadApp}
            disabled={isDownloading}
            className="owner-profile-action-btn primary"
            style={{
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minHeight: 46,
              padding: "10px 18px",
              borderRadius: 9999,
              border: "1px solid rgba(2, 132, 199, 0.4)",
              fontSize: 13.5,
              fontWeight: 700,
            }}
          >
            <Icon.Download size={16} />
            <span>
              {isDownloading
                ? "Preparing APK Download..."
                : `Download App (${appPackage.fileSize || "40.5 MB"})`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowInstallGuide(true)}
            className="owner-profile-action-btn"
            style={{
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minHeight: 46,
              padding: "10px 18px",
              borderRadius: 9999,
              border: "1px solid rgba(2, 132, 199, 0.25)",
              backgroundColor: "rgba(2, 132, 199, 0.1)",
              color: "#0284c7",
              fontSize: 13.5,
              fontWeight: 700,
            }}
          >
            <Icon.Info size={16} />
            <span>Installation Guide</span>
          </button>

          {deferredPrompt && (
            <button
              type="button"
              onClick={handleInstallPWA}
              className="owner-profile-action-btn"
              style={{
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minHeight: 44,
                padding: "10px 16px",
                borderRadius: 12,
                border: "none",
                backgroundColor: "var(--color-bg, #f8fafc)",
                color: "var(--color-text, #0f172a)",
                fontSize: 13.5,
                fontWeight: 700,
              }}
            >
              <Icon.Smartphone size={16} />
              <span>Install to Device (PWA)</span>
            </button>
          )}
        </div>
      </div>

      {/* LSMIS Installation Guide Modal */}
      <Modal
        open={showInstallGuide}
        onClose={() => setShowInstallGuide(false)}
        title="LSMIS Installation Guide"
        closeOnBackdropClick={true}
        size="md"
        dialogStyle={{
          maxWidth: 480,
          borderRadius: 20,
        }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
            <button
              type="button"
              onClick={() => setShowInstallGuide(false)}
              className="owner-profile-action-btn primary"
              style={{ minWidth: 90, minHeight: 36, padding: "8px 18px", borderRadius: 10 }}
            >
              Got it
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 12,
              backgroundColor: "rgba(2, 132, 199, 0.08)",
              border: "1px solid rgba(2, 132, 199, 0.2)",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                backgroundColor: "#0284c7",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Smartphone size={20} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-text, #0f172a)" }}>
                Android APK Installation
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)" }}>
                Follow these 4 simple steps to install LSMIS on your phone
              </div>
            </div>
          </div>

          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5, lineHeight: 1.55, color: "var(--color-text, #0f172a)" }}>
            <li>
              <strong>Download the APK</strong>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                Tap the blue <strong>Download App</strong> button to save <code>{appPackage.fileName}</code> to your mobile device.
              </div>
            </li>
            <li>
              <strong>Open the Downloaded File</strong>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                When the download finishes, tap <strong>Open</strong> in your browser notification or locate the APK in your phone&apos;s <strong>Downloads</strong> or <strong>Files</strong> manager.
              </div>
            </li>
            <li>
              <strong>Allow Installation from this Source</strong>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                If Android shows a security prompt (&ldquo;For your security, your phone is not allowed to install unknown apps&rdquo;), tap <strong>Settings</strong>, switch on <strong>&ldquo;Allow from this source&rdquo;</strong>, and press Back to continue.
              </div>
            </li>
            <li>
              <strong>Complete Installation &amp; Launch</strong>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                Tap <strong>Install</strong> on the Android screen. Once complete, tap <strong>Open</strong> or launch <strong>LSMIS</strong> from your device&apos;s app drawer.
              </div>
            </li>
          </ol>
        </div>
      </Modal>
      </>
      )}

      {/* ============================================================ */}
      {/* SECTION G: SIGN OUT                                          */}
      {/* ============================================================ */}
      <button
        type="button"
        onClick={handleLogout}
        className="owner-profile-logout-btn"
        title="Sign out of the Livestock Owner Portal"
      >
        <Icon.LogOut size={16} />
        <span>Sign Out of Portal</span>
      </button>

      {/* Confirmation & Status Popup Dialog */}
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
