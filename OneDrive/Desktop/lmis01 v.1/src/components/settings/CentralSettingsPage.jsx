import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, Button, AlertDialog } from "../ui";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../notifications/Toast";
import { supabase } from "../../services/supabaseClient";
import { TABLES, STORAGE_KEYS, ROLE_LABELS, ROLE_COLORS } from "../../utils/constants";
import { authStore } from "../../store/authStore";
import { logActivity } from "../../services/activityService";
import { uploadAvatarFile } from "../../services/avatarService";
import { notifyDbChange } from "../../services/realtimeSync";
import {
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "../../services/notificationPreferenceService";
import { PasswordRequirements } from "../ui/PasswordRequirements";
import { validatePassword, getPasswordValidationError } from "../../utils/passwordValidation";
import { initials } from "../../utils/helpers";
import {
  validatePhilippineMobileNumber,
  sanitizePhilippineMobileInput,
} from "../../utils/phoneValidation";
import { formatDate } from "../../utils/formatters";
import { PermitConfig } from "../../pages/admin/PermitConfig";

export const CentralSettingsPage = ({ role = "admin", initialTab = "profile" }) => {
  const { session, signOut } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const getTabFromLocation = () => {
    const p = location.pathname;
    if (p.endsWith("/notifications") || location.search.includes("tab=notifications")) {
      return "notifications";
    }
    if (p.endsWith("/security") || location.search.includes("tab=security")) {
      return "security";
    }
    if (p.endsWith("/permit-config") || location.search.includes("tab=permit-config")) {
      return role === "admin" ? "permit-config" : "profile";
    }
    if (p.endsWith("/profile") || location.search.includes("tab=profile")) {
      return "profile";
    }
    return initialTab || "profile";
  };

  const [activeTab, setActiveTab] = useState(getTabFromLocation);

  useEffect(() => {
    const nextTab = getTabFromLocation();
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [location.pathname, location.search, initialTab]);

  const contentPaneRef = useRef(null);

  const handleNavWheel = (e) => {
    if (contentPaneRef.current) {
      contentPaneRef.current.scrollTop += e.deltaY;
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (contentPaneRef.current) {
      contentPaneRef.current.scrollTop = 0;
    }
    if (role) {
      navigate(`/${role}/${tab}`);
    }
  };

  const [loading, setLoading] = useState(true);

  // 1. Profile State
  const [profile, setProfile] = useState({
    full_name: "",
    email: "",
    username: "",
    role: role,
    phone: "",
    address: "",
    license: "",
    specialization: "",
    avatar_url: "",
  });
  const [initialProfile, setInitialProfile] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const fileInputRef = useRef(null);

  // Edit Personal Information state (matching Owner Profile design)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    username: "",
    phone: "",
    address: "",
    license: "",
    specialization: "",
  });
  const [contactError, setContactError] = useState("");
  const [personnelId, setPersonnelId] = useState("");
  const [userCreatedAt, setUserCreatedAt] = useState("");
  const [copiedPersonnelId, setCopiedPersonnelId] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Photo upload and preview state (matching Owner Profile design)
  const [selectedPhotoFile, setSelectedPhotoFile] = useState(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoMsg, setPhotoMsg] = useState(null);
  const [profileMsg, setProfileMsg] = useState(null);

  // Status popup alert dialog
  const [profileAlert, setProfileAlert] = useState({
    open: false,
    title: "",
    message: "",
    variant: "success",
  });

  // 2. Notification Preferences State
  const [notifPrefs, setNotifPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [initialNotifPrefs, setInitialNotifPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  // 3. Account Security State
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNextPw, setShowNextPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isChangingPw, setIsChangingPw] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [passwordErrorField, setPasswordErrorField] = useState(null); // 'current' | 'next' | 'confirm' | null
  const [passwordAlert, setPasswordAlert] = useState({
    open: false,
    title: "",
    message: "",
    buttonText: "OK",
    variant: "danger",
  });

  // Load user data on mount
  useEffect(() => {
    let isCurrent = true;

    const loadAll = async () => {
      setLoading(true);
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const user = authUser?.user;
        const email = user?.email || session?.email || "";
        const userId = user?.id || session?.id || "";

        // Query public.users
        let dbUser = null;
        if (email) {
          const { data: uData } = await supabase
            .from(TABLES.USERS)
            .select("*")
            .ilike("email", email.trim())
            .maybeSingle();
          dbUser = uData;
        }

        // Query public.owners if role is owner or not in users
        let dbOwner = null;
        if (email && (role === "owner" || !dbUser)) {
          const { data: oData } = await supabase
            .from(TABLES.OWNERS)
            .select("*")
            .ilike("email", email.trim())
            .maybeSingle();
          dbOwner = oData;
        }

        const userMeta = user?.user_metadata || {};
        const storedLocal = JSON.parse(
          localStorage.getItem("lmis_profile_" + email) || "{}"
        );

        const currentRole =
          dbUser?.role || (dbOwner ? "owner" : session?.role || role);

        const loadedProfile = {
          full_name:
            dbUser?.full_name ||
            dbOwner?.name ||
            userMeta?.full_name ||
            userMeta?.name ||
            storedLocal?.full_name ||
            session?.name ||
            "",
          email: email,
          username:
            dbUser?.username ||
            dbOwner?.username ||
            userMeta?.username ||
            storedLocal?.username ||
            email.split("@")[0] ||
            "",
          role: currentRole,
          phone:
            dbOwner?.contact ||
            userMeta?.contact ||
            userMeta?.phone ||
            storedLocal?.phone ||
            "",
          address:
            dbOwner?.address ||
            userMeta?.address ||
            storedLocal?.address ||
            "",
          license: userMeta?.license || storedLocal?.license || "",
          specialization:
            userMeta?.specialization || storedLocal?.specialization || "",
          avatar_url:
            dbUser?.avatar_url ||
            dbOwner?.avatar_url ||
            userMeta?.avatar_url ||
            userMeta?.picture ||
            storedLocal?.avatar_url ||
            "",
        };

        if (isCurrent) {
          setProfile(loadedProfile);
          setInitialProfile(loadedProfile);
          setProfileForm({
            full_name: loadedProfile.full_name,
            username: loadedProfile.username,
            phone: loadedProfile.phone,
            address: loadedProfile.address,
            license: loadedProfile.license,
            specialization: loadedProfile.specialization,
          });
          setPersonnelId(dbUser?.id || userId || "");
          setUserCreatedAt(dbUser?.created_at || user?.created_at || "");
          setTwoFA(Boolean(userMeta?.two_factor_enabled || storedLocal?.two_factor_enabled));
        }

        // Load Notification Preferences
        const prefs = await getUserNotificationPreferences(email, userId);
        if (isCurrent) {
          setNotifPrefs(prefs);
          setInitialNotifPrefs(prefs);
        }
      } catch (err) {
        console.warn("Failed to load settings data:", err);
      } finally {
        if (isCurrent) setLoading(false);
      }
    };

    loadAll();

    return () => {
      isCurrent = false;
    };
  }, [role, session]);

  // Handle Photo Selection & Preview (Matching Owner Profile)
  const handlePhotoSelect = (e) => {
    setPhotoMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      const errText = "Please select an image file (PNG, JPG, or WEBP).";
      setPhotoMsg({ type: "error", text: errText });
      setProfileAlert({
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
      setProfileAlert({
        open: true,
        title: "File Too Large",
        message: errText,
        variant: "danger",
      });
      return;
    }

    setSelectedPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewPhotoUrl(objectUrl);
    setAvatarError(false);
  };

  const handleCancelPhotoPreview = () => {
    if (previewPhotoUrl) URL.revokeObjectURL(previewPhotoUrl);
    setPreviewPhotoUrl(null);
    setSelectedPhotoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Upload and Save Profile Picture to Supabase Storage
  const handleSavePhoto = async () => {
    if (!selectedPhotoFile) return;
    setIsUploadingPhoto(true);
    setPhotoMsg(null);

    try {
      const email = profile.email || session?.email || "";
      const targetIdentifier = personnelId || email || "personnel";

      // 1. Upload to Supabase Storage ('avatars' bucket) and get public CDN URL
      const uploadedUrl = await uploadAvatarFile(selectedPhotoFile, targetIdentifier);
      if (!uploadedUrl) {
        throw new Error("Unable to retrieve public CDN URL for the uploaded photo.");
      }

      // 2. Persist in database
      const trimmedEmail = email.trim();
      if (profile.role === "owner") {
        await supabase
          .from(TABLES.OWNERS)
          .update({ avatar_url: uploadedUrl })
          .ilike("email", trimmedEmail);
        try {
          notifyDbChange(TABLES.OWNERS, "update", { email: trimmedEmail, avatar_url: uploadedUrl });
        } catch (_) {}
      } else {
        const { error: dbErr } = await supabase
          .from(TABLES.USERS)
          .update({ avatar_url: uploadedUrl })
          .ilike("email", trimmedEmail);
        if (dbErr) {
          console.warn("DB update avatar error:", dbErr);
        }
        try {
          notifyDbChange(TABLES.USERS, "update", { email: trimmedEmail, avatar_url: uploadedUrl });
        } catch (_) {}
      }

      // 3. Update Supabase Auth metadata
      await supabase.auth.updateUser({
        data: {
          avatar_url: uploadedUrl,
          picture: uploadedUrl,
        },
      });

      // 4. Update session storage & authStore
      const curSess = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
      const newSess = { ...curSess, avatar_url: uploadedUrl };
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(newSess));
      authStore.set({ session: newSess });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lmis_profile_updated", { detail: newSess }));
        window.dispatchEvent(new CustomEvent("lmis-db-change", { detail: { table: TABLES.USERS, action: "update" } }));
      }

      setProfile((prev) => ({ ...prev, avatar_url: uploadedUrl }));
      setInitialProfile((prev) => (prev ? { ...prev, avatar_url: uploadedUrl } : prev));
      if (previewPhotoUrl) URL.revokeObjectURL(previewPhotoUrl);
      setPreviewPhotoUrl(null);
      setSelectedPhotoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPhotoMsg({ type: "success", text: "Profile picture saved successfully!" });

      setProfileAlert({
        open: true,
        title: "Profile Picture Updated",
        message: "Your profile picture has been successfully uploaded to Supabase Storage and saved.",
        variant: "success",
      });
    } catch (err) {
      console.error("Avatar upload failed:", err);
      const errMsg = err.message || "Failed to upload photo.";
      setPhotoMsg({ type: "error", text: errMsg });
      setProfileAlert({
        open: true,
        title: "Upload Failed",
        message: errMsg,
        variant: "danger",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // Save Profile Changes
  const handleSaveProfile = async (e) => {
    e?.preventDefault();
    setProfileMsg(null);
    setContactError("");

    const trimmedName = profileForm.full_name?.trim() || "";
    const trimmedUsername = profileForm.username ? profileForm.username.trim() : null;
    const trimmedContact = profileForm.phone?.trim() || "";
    const trimmedAddress = profileForm.address?.trim() || "";
    const trimmedLicense = profileForm.license?.trim() || "";
    const trimmedSpec = profileForm.specialization?.trim() || "";

    if (!trimmedName) {
      setProfileMsg({ type: "error", text: "Full Name is required." });
      setProfileAlert({
        open: true,
        title: "Validation Error",
        message: "Full Name is required.",
        variant: "danger",
      });
      return;
    }

    let formattedPhone = trimmedContact;
    if (trimmedContact) {
      const phoneVal = validatePhilippineMobileNumber(trimmedContact);
      if (!phoneVal.isValid) {
        setContactError(phoneVal.error);
        setProfileMsg({ type: "error", text: phoneVal.error });
        setProfileAlert({
          open: true,
          title: "Invalid Phone Number",
          message: phoneVal.error,
          variant: "danger",
        });
        return;
      }
      formattedPhone = phoneVal.digits;
    }

    setIsSavingProfile(true);
    try {
      const trimmedEmail = (profile.email || session?.email || "").trim();

      // 1. Update Database Table (users or owners)
      if (profile.role === "owner") {
        await supabase
          .from(TABLES.OWNERS)
          .update({
            name: trimmedName,
            username: trimmedUsername,
            contact: formattedPhone || "",
            address: trimmedAddress,
          })
          .ilike("email", trimmedEmail);
        try {
          notifyDbChange(TABLES.OWNERS, "update", { email: trimmedEmail });
        } catch (_) {}
      } else {
        const updatePayload = {
          full_name: trimmedName,
          phone: formattedPhone || "",
          contact: formattedPhone || "",
          address: trimmedAddress,
          license: trimmedLicense,
          specialization: trimmedSpec,
        };
        if (trimmedUsername) {
          updatePayload.username = trimmedUsername;
        }
        const { error: dbErr } = await supabase
          .from(TABLES.USERS)
          .update(updatePayload)
          .ilike("email", trimmedEmail);

        if (dbErr) {
          throw new Error(dbErr.message || "Failed to update user profile in database.");
        }
        try {
          notifyDbChange(TABLES.USERS, "update", { email: trimmedEmail, ...updatePayload });
        } catch (_) {}
      }

      // 2. Update Supabase Auth user metadata
      const { error: authErr } = await supabase.auth.updateUser({
        data: {
          full_name: trimmedName,
          name: trimmedName,
          username: trimmedUsername,
          phone: formattedPhone,
          contact: formattedPhone,
          address: trimmedAddress,
          license: trimmedLicense,
          specialization: trimmedSpec,
        },
      });

      if (authErr) {
        throw new Error(authErr.message || "Failed to update auth metadata.");
      }

      // 3. Update session storage & authStore
      const curSess = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
      const newSess = {
        ...curSess,
        name: trimmedName,
        username: trimmedUsername,
      };
      sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(newSess));
      authStore.set({ session: newSess });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lmis_profile_updated", { detail: newSess }));
        window.dispatchEvent(new CustomEvent("lmis-db-change", { detail: { table: TABLES.USERS, action: "update" } }));
      }

      const updatedProfile = {
        ...profile,
        full_name: trimmedName,
        username: trimmedUsername || "",
        phone: formattedPhone,
        address: trimmedAddress,
        license: trimmedLicense,
        specialization: trimmedSpec,
      };
      setProfile(updatedProfile);
      setInitialProfile(updatedProfile);
      setIsEditingProfile(false);

      await logActivity({
        action: `Updated profile settings for ${trimmedName}`,
        module: "Settings",
      });

      setProfileMsg({ type: "success", text: "Profile settings saved successfully!" });
      setProfileAlert({
        open: true,
        title: "Profile Updated",
        message: "Your profile information has been successfully saved to Supabase.",
        variant: "success",
      });
    } catch (err) {
      console.error("Save profile error:", err);
      const errMsg = err.message || "Failed to save profile changes.";
      setProfileMsg({ type: "error", text: errMsg });
      setProfileAlert({
        open: true,
        title: "Update Failed",
        message: errMsg,
        variant: "danger",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCopyPersonnelId = () => {
    const idToCopy = personnelId || session?.id || profile.email;
    if (idToCopy) {
      navigator.clipboard.writeText(idToCopy);
      setCopiedPersonnelId(true);
      setTimeout(() => setCopiedPersonnelId(false), 2000);
    }
  };

  // Notification Preference Toggle
  const handleTogglePref = (key) => {
    setNotifPrefs((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleToggleAllPrefs = (enableAll) => {
    setNotifPrefs({
      account_notifications: enableAll,
      registration_updates: enableAll,
      approval_updates: enableAll,
      livestock_process_updates: enableAll,
      inspection_updates: enableAll,
      system_announcements: enableAll,
    });
  };

  const handleSaveNotificationPreferences = async () => {
    setIsSavingPrefs(true);
    try {
      const updated = await updateUserNotificationPreferences({
        email: profile.email || session?.email,
        userId: session?.id,
        preferences: notifPrefs,
      });

      setInitialNotifPrefs(updated);
      setNotifPrefs(updated);

      await logActivity({
        action: `Updated notification preferences for ${profile.full_name || profile.email}`,
        module: "Settings",
      });

      showToast("Notification preferences updated!", "success");
    } catch (err) {
      console.error("Save preferences error:", err);
      showToast(err.message || "Failed to update preferences", "error");
    } finally {
      setIsSavingPrefs(false);
    }
  };

  // Change Password
  const handleChangePassword = async (e) => {
    e?.preventDefault();
    if (isChangingPw) return;

    // Check internet connectivity
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setPasswordErrorField(null);
      setPasswordAlert({
        open: true,
        title: "Network Connection Failed",
        message: "Network connection failed. Please check your internet connection and try again.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 1. Validate Current Password presence
    if (!pw.current || !pw.current.trim()) {
      setPasswordErrorField("current");
      setPasswordAlert({
        open: true,
        title: "Current Password Required",
        message: "Please enter your current password to verify your account identity before proceeding.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 2. Validate New Password presence
    if (!pw.next || !pw.next.trim()) {
      setPasswordErrorField("next");
      setPasswordAlert({
        open: true,
        title: "New Password Required",
        message: "Please enter a new password complying with municipal abattoir security policies.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 3. Validate Password Criteria
    const val = validatePassword(pw.next);
    if (!val.isValid) {
      setPasswordErrorField("next");
      const specificReq = getPasswordValidationError(pw.next);
      setPasswordAlert({
        open: true,
        title: "Password Requirements Not Met",
        message: specificReq || "New password does not meet the required password criteria. It must be at least 8 characters long and contain uppercase, lowercase, numbers, and special symbols.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 4. Validate that New Password is not the same as Current Password
    if (pw.current.trim() === pw.next.trim()) {
      setPasswordErrorField("next");
      setPasswordAlert({
        open: true,
        title: "Password Cannot Be Reused",
        message: "New password is the same as the current password. Please choose a different, new password.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 5. Validate Password Confirmation presence
    if (!pw.confirm || !pw.confirm.trim()) {
      setPasswordErrorField("confirm");
      setPasswordAlert({
        open: true,
        title: "Password Confirmation Required",
        message: "Please confirm your new password in the confirmation field.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    // 6. Validate that New Password and Confirmation match
    if (pw.next !== pw.confirm) {
      setPasswordErrorField("confirm");
      setPasswordAlert({
        open: true,
        title: "Passwords Do Not Match",
        message: "New password and confirmation do not match. Please verify both fields.",
        buttonText: "OK",
        variant: "danger",
      });
      return;
    }

    setIsChangingPw(true);
    setPasswordErrorField(null);

    try {
      const activeEmail = (profile.email || session?.email || "").trim();
      if (!activeEmail) {
        setPasswordAlert({
          open: true,
          title: "Session Expired",
          message: "Session expired. Please log in again.",
          buttonText: "OK",
          variant: "warning",
        });
        setIsChangingPw(false);
        return;
      }

      // 7. Verify current password with Supabase Auth
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: activeEmail,
        password: pw.current,
      });

      if (verifyErr) {
        setIsChangingPw(false);
        const errMsg = String(verifyErr.message || "").toLowerCase();
        const errStatus = verifyErr.status;

        // Offline / Network Failure
        if (errMsg.includes("network") || errMsg.includes("fetch failed") || (typeof navigator !== "undefined" && !navigator.onLine)) {
          setPasswordAlert({
            open: true,
            title: "Network Connection Failed",
            message: "Network connection failed. Please check your internet connection and try again.",
            buttonText: "OK",
            variant: "danger",
          });
          return;
        }

        // Session Expiration
        if (errMsg.includes("jwt") || errMsg.includes("session") || (errStatus === 401 && errMsg.includes("token"))) {
          setPasswordAlert({
            open: true,
            title: "Session Expired",
            message: "Session expired. Please log in again.",
            buttonText: "OK",
            variant: "warning",
          });
          return;
        }

        // Incorrect Current Password
        if (
          errMsg.includes("invalid login credentials") ||
          errMsg.includes("invalid_grant") ||
          errMsg.includes("invalid credentials") ||
          errMsg.includes("password")
        ) {
          setPasswordErrorField("current");
          setPasswordAlert({
            open: true,
            title: "Current Password Incorrect",
            message: "Current password is incorrect. Please verify your current password and try again.",
            buttonText: "OK",
            variant: "danger",
          });
          return;
        }

        // Other Supabase verification error
        setPasswordErrorField("current");
        setPasswordAlert({
          open: true,
          title: "Password Verification Failed",
          message: verifyErr.message || "Password update was rejected by Supabase.",
          buttonText: "OK",
          variant: "danger",
        });
        return;
      }

      // 8. Execute Password Update in Supabase
      const { error: updErr } = await supabase.auth.updateUser({
        password: pw.next,
      });

      if (updErr) {
        setIsChangingPw(false);
        const updMsg = String(updErr.message || "").toLowerCase();

        // Network error
        if (updMsg.includes("network") || updMsg.includes("fetch failed") || (typeof navigator !== "undefined" && !navigator.onLine)) {
          setPasswordAlert({
            open: true,
            title: "Network Connection Failed",
            message: "Network connection failed. Please check your internet connection and try again.",
            buttonText: "OK",
            variant: "danger",
          });
          return;
        }

        // Same password error from Supabase
        if (
          updMsg.includes("same_password") ||
          updMsg.includes("same as") ||
          updMsg.includes("different from the old password")
        ) {
          setPasswordErrorField("next");
          setPasswordAlert({
            open: true,
            title: "Password Cannot Be Reused",
            message: "New password is the same as the current password. Please choose a different, new password.",
            buttonText: "OK",
            variant: "danger",
          });
          return;
        }

        // Session expired
        if (updMsg.includes("session") || updMsg.includes("jwt") || updMsg.includes("auth session missing")) {
          setPasswordAlert({
            open: true,
            title: "Session Expired",
            message: "Session expired. Please log in again.",
            buttonText: "OK",
            variant: "warning",
          });
          return;
        }

        // Weak password / criteria rejection
        if (updMsg.includes("weak") || updMsg.includes("criteria") || updMsg.includes("characters")) {
          setPasswordErrorField("next");
          setPasswordAlert({
            open: true,
            title: "Password Requirements Not Met",
            message: updErr.message || "New password does not meet the required password criteria.",
            buttonText: "OK",
            variant: "danger",
          });
          return;
        }

        // General Supabase rejection
        setPasswordErrorField("next");
        setPasswordAlert({
          open: true,
          title: "Password Update Rejected",
          message: `Password update was rejected by Supabase: ${updErr.message}`,
          buttonText: "OK",
          variant: "danger",
        });
        return;
      }

      // Ensure active session remains persistent and valid in authStore and storage
      const currentCached = authStore.get()?.session || JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION) || "null");
      if (currentCached) {
        sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(currentCached));
        authStore.set({ session: currentCached, loading: false, isInitialized: true });
      }

      try {
        await logActivity({
          action: `Changed account password for ${profile.full_name || profile.email}`,
          module: "Security",
          security_event: "Password Change",
        });
      } catch (logErr) {
        console.warn("Audit log for password change skipped:", logErr);
      }

      // Success: Clear form inputs, clear validation error highlights, and present success alert
      setPw({ current: "", next: "", confirm: "" });
      setPasswordErrorField(null);
      setShowCurrentPw(false);
      setShowNextPw(false);
      setShowConfirmPw(false);

      setPasswordAlert({
        open: true,
        title: "Password Changed Successfully",
        message: "Your password has been changed successfully! Your new password is now active for all future logins.",
        buttonText: "OK",
        variant: "success",
      });
    } catch (err) {
      console.error("Change password error:", err);
      const rawMsg = String(err?.message || "").toLowerCase();
      if (rawMsg.includes("network") || rawMsg.includes("failed to fetch") || (typeof navigator !== "undefined" && !navigator.onLine)) {
        setPasswordAlert({
          open: true,
          title: "Network Connection Failed",
          message: "Network connection failed. Please check your internet connection and try again.",
          buttonText: "OK",
          variant: "danger",
        });
      } else {
        setPasswordAlert({
          open: true,
          title: "Password Update Failed",
          message: err?.message ? `Password update was rejected: ${err.message}` : "Password update was rejected by Supabase.",
          buttonText: "OK",
          variant: "danger",
        });
      }
    } finally {
      setIsChangingPw(false);
    }
  };

  // Toggle Two-Factor Authentication
  const handleToggle2FA = async () => {
    const nextVal = !twoFA;
    setTwoFA(nextVal);
    const cleanEmail = (profile.email || "").toLowerCase();
    try {
      localStorage.setItem("lmis_2fa_enabled_" + cleanEmail, nextVal ? "true" : "false");
      await supabase.auth.updateUser({
        data: { two_factor_enabled: nextVal },
      });
      showToast(
        nextVal
          ? "Two-Factor Authentication enabled! Verification required on your next login."
          : "Two-Factor Authentication disabled.",
        nextVal ? "success" : "info"
      );
    } catch (_) {}
  };

  const isProfileDirty =
    initialProfile && JSON.stringify(profile) !== JSON.stringify(initialProfile);
  const isPrefsDirty =
    initialNotifPrefs &&
    JSON.stringify(notifPrefs) !== JSON.stringify(initialNotifPrefs);

  // Role display details
  const roleLabel = ROLE_LABELS[profile.role] || ROLE_LABELS[role] || "Personnel";
  const colors = ROLE_COLORS[profile.role] || ROLE_COLORS[role] || ROLE_COLORS.admin;
  const resolvedAvatarUrl =
    previewPhotoUrl ||
    profile.avatar_url ||
    session?.avatar_url ||
    "";

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 460 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              border: "3.5px solid var(--color-border, #e2e8f0)",
              borderTopColor: "var(--color-primary, #0284c7)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text-muted, #64748b)" }}>
            Loading Settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="central-settings-container"
      style={{
        width: "100%",
        maxWidth: 1240,
        margin: "0 auto",
        height: "100%",
        maxHeight: "100%",
        display: "flex",
        flexDirection: "column",
        fontSize: 15,
        boxSizing: "border-box",
      }}
    >
      {/* ── SETTINGS 2-COLUMN LAYOUT WITH FIXED LEFT NAVIGATION & SCROLLABLE CONTENT ── */}
      <div
        className="settings-layout-grid"
        style={{
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          width: "100%",
          height: "100%",
          maxHeight: "100%",
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Left Side Navigation — stationary, fixed in viewport, never scrolls */}
        <div
          className="settings-sidebar-nav"
          onWheel={handleNavWheel}
          style={{
            width: 240,
            flexShrink: 0,
            background: "var(--color-surface, #ffffff)",
            borderRadius: 14,
            border: "1px solid var(--color-border, #e2e8f0)",
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            position: "sticky",
            top: 0,
            alignSelf: "flex-start",
          }}
        >
          <div
            className="nav-section-title"
            style={{
              padding: "4px 12px 8px",
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted, #64748b)",
            }}
          >
            Settings &amp; Account
          </div>

          <button
            type="button"
            className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => handleTabChange("profile")}
            style={{ cursor: "pointer", border: "none", textAlign: "left", width: "100%" }}
          >
            <span className="nav-item-icon">
              <Icon.User size={18} />
            </span>
            <span className="nav-item-label" style={{ fontWeight: activeTab === "profile" ? 600 : 500 }}>
              Profile
            </span>
            {isEditingProfile && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#0284c7",
                  marginLeft: "auto",
                }}
                title="Editing profile"
              />
            )}
          </button>

          <button
            type="button"
            className={`nav-item ${activeTab === "notifications" ? "active" : ""}`}
            onClick={() => handleTabChange("notifications")}
            style={{ cursor: "pointer", border: "none", textAlign: "left", width: "100%" }}
          >
            <span className="nav-item-icon">
              <Icon.Bell size={18} />
            </span>
            <span className="nav-item-label" style={{ fontWeight: activeTab === "notifications" ? 600 : 500 }}>
              Notifications
            </span>
            {isPrefsDirty && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  marginLeft: "auto",
                }}
                title="Unsaved preferences"
              />
            )}
          </button>

          <button
            type="button"
            className={`nav-item ${activeTab === "security" ? "active" : ""}`}
            onClick={() => handleTabChange("security")}
            style={{ cursor: "pointer", border: "none", textAlign: "left", width: "100%" }}
          >
            <span className="nav-item-icon">
              <Icon.Lock size={18} />
            </span>
            <span className="nav-item-label" style={{ fontWeight: activeTab === "security" ? 600 : 500 }}>
              Account Security
            </span>
          </button>

          {role === "admin" && (
            <button
              type="button"
              className={`nav-item ${activeTab === "permit-config" ? "active" : ""}`}
              onClick={() => handleTabChange("permit-config")}
              style={{ cursor: "pointer", border: "none", textAlign: "left", width: "100%" }}
            >
              <span className="nav-item-icon">
                <Icon.FileText size={18} />
              </span>
              <span className="nav-item-label" style={{ fontWeight: activeTab === "permit-config" ? 600 : 500 }}>
                Meat Permit Configuration
              </span>
            </button>
          )}
        </div>

        {/* Right Side: Tab Content (Scrolls independently) */}
        <div
          ref={contentPaneRef}
          className="settings-content-pane"
          style={{
            flex: 1,
            minWidth: 0,
            width: "100%",
            height: "100%",
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
          }}
        >
          {/* ── TAB 1: PROFILE SETTINGS (Matching Owner Profile Design) ── */}
          {activeTab === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 20 }}>
              {/* Hidden File Input for Profile Picture Upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/jpg"
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
                        alt={profile.full_name || "Profile"}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarError(true)}
                        className="owner-profile-avatar-img"
                      />
                    ) : (
                      <span style={{ fontSize: 26, fontWeight: 800 }}>
                        {initials(profile.full_name || "User")}
                      </span>
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
                    <div
                      className="owner-profile-check-badge"
                      title={`Verified ${roleLabel}`}
                    >
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
                    {/* Personnel Full Name */}
                    <h1 className="owner-profile-name" style={{ fontSize: 18, marginBottom: 0 }}>
                      {loading ? "Loading..." : profile.full_name || "Account Profile"}
                    </h1>

                    {/* Registered Email */}
                    <div
                      style={{
                        fontSize: 12,
                        color: "#64748b",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        gap: 5,
                      }}
                    >
                      <Icon.Mail size={12} />
                      <span>{profile.email}</span>
                    </div>

                    {/* Account Status Pill */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
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
                        <Icon.ShieldCheck size={11} />
                        Verified {roleLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Photo Preview Card Before Saving */}
                {previewPhotoUrl && (
                  <div className="owner-profile-preview-card" style={{ marginTop: 10 }}>
                    <img src={previewPhotoUrl} alt="Preview" className="owner-profile-preview-img" />
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
                        onClick={handleCancelPhotoPreview}
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
                      background:
                        photoMsg.type === "success"
                          ? "rgba(16, 185, 129, 0.12)"
                          : "rgba(239, 68, 68, 0.12)",
                      color: photoMsg.type === "success" ? "#10b981" : "#ef4444",
                      border: `1px solid ${
                        photoMsg.type === "success"
                          ? "rgba(16, 185, 129, 0.25)"
                          : "rgba(239, 68, 68, 0.25)"
                      }`,
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
                  {!isEditingProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileForm({
                          full_name: profile.full_name || "",
                          username: profile.username || "",
                          phone: profile.phone || "",
                          address: profile.address || "",
                          license: profile.license || "",
                          specialization: profile.specialization || "",
                        });
                        setIsEditingProfile(true);
                        setProfileMsg(null);
                        setContactError("");
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
                      background:
                        profileMsg.type === "success"
                          ? "rgba(16, 185, 129, 0.12)"
                          : "rgba(239, 68, 68, 0.12)",
                      color: profileMsg.type === "success" ? "#10b981" : "#ef4444",
                      border: `1px solid ${
                        profileMsg.type === "success"
                          ? "rgba(16, 185, 129, 0.25)"
                          : "rgba(239, 68, 68, 0.25)"
                      }`,
                    }}
                  >
                    {profileMsg.text}
                  </div>
                )}

                {isEditingProfile ? (
                  /* Edit Form */
                  <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="owner-profile-field">
                      <label className="owner-profile-label" htmlFor="personnel-fullname">
                        Full Name <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        id="personnel-fullname"
                        type="text"
                        value={profileForm.full_name}
                        onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                        placeholder="Enter full name"
                        className="owner-profile-input"
                        required
                      />
                    </div>

                    <div className="owner-profile-field">
                      <label className="owner-profile-label" htmlFor="personnel-email">
                        Registered Email (Locked)
                      </label>
                      <input
                        id="personnel-email"
                        type="email"
                        value={profile.email}
                        disabled
                        className="owner-profile-input"
                      />
                      <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
                        Email address is tied to your login account and cannot be modified directly.
                      </span>
                    </div>

                    <div className="owner-profile-field">
                      <label className="owner-profile-label" htmlFor="personnel-username">
                        Portal Username
                      </label>
                      <input
                        id="personnel-username"
                        type="text"
                        value={profileForm.username}
                        onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
                        placeholder="e.g. jdelacruz"
                        className="owner-profile-input"
                      />
                    </div>

                    <div className="owner-profile-field">
                      <label className="owner-profile-label" htmlFor="personnel-contact">
                        Contact Number
                      </label>
                      <input
                        id="personnel-contact"
                        type="tel"
                        inputMode="numeric"
                        maxLength={11}
                        value={profileForm.phone}
                        onChange={(e) => {
                          const sanitized = sanitizePhilippineMobileInput(e.target.value);
                          setProfileForm({ ...profileForm, phone: sanitized });
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
                      <label className="owner-profile-label" htmlFor="personnel-address">
                        Station / Facility Address
                      </label>
                      <input
                        id="personnel-address"
                        type="text"
                        value={profileForm.address}
                        onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                        placeholder="e.g. City Abattoir, Naga City, Cebu"
                        className="owner-profile-input"
                      />
                    </div>

                    {(role === "vet" || role === "veterinarian") && (
                      <>
                        <div className="owner-profile-field">
                          <label className="owner-profile-label" htmlFor="personnel-license">
                            PRC Veterinary License Number
                          </label>
                          <input
                            id="personnel-license"
                            type="text"
                            value={profileForm.license}
                            onChange={(e) => setProfileForm({ ...profileForm, license: e.target.value })}
                            placeholder="e.g. PRC-VET-0094821"
                            className="owner-profile-input"
                          />
                        </div>

                        <div className="owner-profile-field">
                          <label className="owner-profile-label" htmlFor="personnel-specialization">
                            Clinical Specialization / Focus
                          </label>
                          <input
                            id="personnel-specialization"
                            type="text"
                            value={profileForm.specialization}
                            onChange={(e) => setProfileForm({ ...profileForm, specialization: e.target.value })}
                            placeholder="e.g. Livestock Meat Inspection & Large Animal Health"
                            className="owner-profile-input"
                          />
                        </div>
                      </>
                    )}

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
                          setProfileForm({
                            full_name: profile.full_name || "",
                            username: profile.username || "",
                            phone: profile.phone || "",
                            address: profile.address || "",
                            license: profile.license || "",
                            specialization: profile.specialization || "",
                          });
                          setIsEditingProfile(false);
                          setContactError("");
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
                        {profile.full_name || "—"}
                      </span>
                    </div>

                    <div className="owner-profile-info-row">
                      <span className="owner-profile-info-label">
                        <Icon.Mail size={14} style={{ color: "#0284c7" }} /> Email Address
                      </span>
                      <span className="owner-profile-info-val" style={{ wordBreak: "break-all" }}>
                        {profile.email || "—"}
                      </span>
                    </div>

                    <div className="owner-profile-info-row">
                      <span className="owner-profile-info-label">
                        <Icon.User size={14} style={{ color: "#0284c7" }} /> Portal Username
                      </span>
                      <span className="owner-profile-info-val">
                        @{profile.username || "user"}
                      </span>
                    </div>

                    <div className="owner-profile-info-row">
                      <span className="owner-profile-info-label">
                        <Icon.Phone size={14} style={{ color: "#0284c7" }} /> Contact Number
                      </span>
                      <span className="owner-profile-info-val">
                        {profile.phone || "Not specified"}
                      </span>
                    </div>

                    <div className="owner-profile-info-row">
                      <span className="owner-profile-info-label">
                        <Icon.MapPin size={14} style={{ color: "#0284c7" }} /> Station / Address
                      </span>
                      <span className="owner-profile-info-val">
                        {profile.address || "Not specified"}
                      </span>
                    </div>

                    {(role === "vet" || role === "veterinarian") && (
                      <>
                        <div className="owner-profile-info-row">
                          <span className="owner-profile-info-label">
                            <Icon.Award size={14} style={{ color: "#0284c7" }} /> PRC License
                          </span>
                          <span className="owner-profile-info-val">
                            {profile.license || "Not specified"}
                          </span>
                        </div>

                        <div className="owner-profile-info-row">
                          <span className="owner-profile-info-label">
                            <Icon.Stethoscope size={14} style={{ color: "#0284c7" }} /> Specialization
                          </span>
                          <span className="owner-profile-info-val">
                            {profile.specialization || "Not specified"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ============================================================ */}
              {/* SECTION C: ACCOUNT INFORMATION                               */}
              {/* ============================================================ */}
              <div className="owner-profile-card">
                <div className="owner-profile-section-title">
                  <h2 className="owner-profile-section-heading">
                    <Icon.ShieldCheck size={15} style={{ color: "#0284c7" }} />
                    <span>Account Information</span>
                  </h2>
                </div>

                <div className="owner-profile-info-grid">
                  <div className="owner-profile-info-row">
                    <span className="owner-profile-info-label">
                      <Icon.Calendar size={14} style={{ color: "#0284c7" }} /> Member Since
                    </span>
                    <span className="owner-profile-info-val">
                      {userCreatedAt ? formatDate(userCreatedAt) : "—"}
                    </span>
                  </div>

                  <div className="owner-profile-info-row">
                    <span className="owner-profile-info-label">
                      <Icon.CheckCircle size={14} style={{ color: "#10b981" }} /> Account Status
                    </span>
                    <span className="owner-profile-info-val" style={{ color: "#10b981" }}>
                      Active {roleLabel}
                    </span>
                  </div>

                  <div className="owner-profile-info-row">
                    <span className="owner-profile-info-label">
                      <Icon.Shield size={14} style={{ color: "#0284c7" }} /> Assigned Role
                    </span>
                    <span className="owner-profile-info-val">
                      {roleLabel}
                    </span>
                  </div>

                  <div className="owner-profile-info-row">
                    <span className="owner-profile-info-label">
                      <Icon.Mail size={14} style={{ color: "#0284c7" }} /> Registered Email
                    </span>
                    <span className="owner-profile-info-val" style={{ wordBreak: "break-all" }}>
                      {profile.email || "—"}
                    </span>
                  </div>

                  <div className="owner-profile-info-row">
                    <span className="owner-profile-info-label">
                      <Icon.Tag size={14} style={{ color: "#0ea5e9" }} /> Personnel ID
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPersonnelId}
                      className="owner-profile-id-chip"
                      style={{ margin: 0 }}
                      title="Click to copy official Personnel ID"
                    >
                      <span>{personnelId || "—"}</span>
                      {copiedPersonnelId ? (
                        <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 2 }}>
                          <Icon.Check size={12} /> Copied
                        </span>
                      ) : (
                        <Icon.Copy size={11} style={{ color: "#94a3b8" }} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

      {/* ── TAB 2: NOTIFICATION PREFERENCES ── */}
      {activeTab === "notifications" && (
        <Card style={{ padding: "30px 32px", borderRadius: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Header with Quick Actions */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 18,
                borderBottom: "1px solid var(--color-border, #e2e8f0)",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)" }}>
                  Notification Delivery Preferences
                </h2>
                <p style={{ fontSize: 14, color: "var(--color-text-muted, #64748b)", margin: "4px 0 0" }}>
                  Select the alerts delivered to your top bell icon and in-app feeds. Preferences are persisted per-user to Supabase.
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleToggleAllPrefs(true)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: "var(--color-bg, #f1f5f9)",
                    color: "var(--color-primary, #0284c7)",
                    border: "1px solid var(--color-border, #cbd5e1)",
                    cursor: "pointer",
                  }}
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleAllPrefs(false)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: "var(--color-bg, #f1f5f9)",
                    color: "var(--color-text-muted, #64748b)",
                    border: "1px solid var(--color-border, #cbd5e1)",
                    cursor: "pointer",
                  }}
                >
                  Disable All
                </button>
              </div>
            </div>

            {/* Notification Category Rows (Spacious & Comfortable) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  key: "account_notifications",
                  icon: <Icon.Shield size={19} />,
                  color: "#8b5cf6",
                  bg: "rgba(139, 92, 246, 0.12)",
                  title: "Account Security & Session Alerts",
                  desc: "Logins, password changes, two-factor OTP verification alerts, and concurrent session events.",
                },
                {
                  key: "registration_updates",
                  icon: <Icon.Cow size={19} />,
                  color: "#0284c7",
                  bg: "rgba(2, 132, 199, 0.12)",
                  title: "Registration & Receiving Updates",
                  desc: "New livestock owner registrations, corral intake at facility gates, and ear tagging records.",
                },
                {
                  key: "approval_updates",
                  icon: <Icon.Check size={19} />,
                  color: "#10b981",
                  bg: "rgba(16, 185, 129, 0.12)",
                  title: "Approval & Certification Updates",
                  desc: "Owner account verifications, veterinary health approvals, and meat permit dispatch releases.",
                },
                {
                  key: "livestock_process_updates",
                  icon: <Icon.Scissors size={19} />,
                  color: "#f59e0b",
                  bg: "rgba(245, 158, 11, 0.12)",
                  title: "Livestock & Slaughter Operations",
                  desc: "Slaughter line assignment, 24h fallback timeouts, carcass weighing, and payment completions.",
                },
                {
                  key: "inspection_updates",
                  icon: <Icon.Stethoscope size={19} />,
                  color: "#0ea5e9",
                  bg: "rgba(14, 165, 233, 0.12)",
                  title: "Clinical Inspection & Condemnation Alerts",
                  desc: "Ante-mortem clinical examinations, post-mortem pathology results, condemnation notices, and carcass branding.",
                },
                {
                  key: "system_announcements",
                  icon: <Icon.Bell size={19} />,
                  color: "#64748b",
                  bg: "rgba(100, 116, 139, 0.12)",
                  title: "System Announcements & Maintenance",
                  desc: "Official municipal abattoir operating hours, emergency bulletins, and platform updates.",
                },
              ].map((item) => {
                const isChecked = Boolean(notifPrefs[item.key]);
                return (
                  <div
                    key={item.key}
                    onClick={() => handleTogglePref(item.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "18px 22px",
                      borderRadius: 14,
                      border: `1.5px solid ${isChecked ? "var(--color-border, #e2e8f0)" : "var(--color-border, #f1f5f9)"}`,
                      background: isChecked ? "var(--color-bg, #f8fafc)" : "var(--color-surface, #ffffff)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      gap: 16,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--color-primary, #0284c7)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = isChecked ? "var(--color-border, #e2e8f0)" : "var(--color-border, #f1f5f9)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      {/* Category Icon Badge (42px) */}
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 11,
                          background: item.bg,
                          color: item.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {item.icon}
                      </div>

                      <div>
                        <div style={{ fontSize: 15.5, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 2, lineHeight: 1.4 }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>

                    {/* Zoomed-in Toggle Switch (52px x 28px) */}
                    <div
                      role="switch"
                      aria-checked={isChecked}
                      style={{
                        position: "relative",
                        width: 52,
                        height: 28,
                        borderRadius: 28,
                        background: isChecked ? "#10b981" : "#cbd5e1",
                        transition: "background 0.2s ease",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 3,
                          left: isChecked ? 27 : 3,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#ffffff",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.25)",
                          transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save Preferences Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 18,
                borderTop: "1px solid var(--color-border, #e2e8f0)",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                {isPrefsDirty ? (
                  <span style={{ fontSize: 13.5, fontWeight: 750, color: "#d97706", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon.AlertTriangle size={15} /> You have unsaved notification preferences
                  </span>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--color-text-muted, #94a3b8)" }}>
                    Notification settings automatically apply to alerts sent to your profile.
                  </span>
                )}
              </div>

              <Button
                variant="primary"
                onClick={handleSaveNotificationPreferences}
                disabled={isSavingPrefs || !isPrefsDirty}
                style={{
                  height: 44,
                  padding: "0 24px",
                  fontSize: 14.5,
                  fontWeight: 700,
                  borderRadius: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon.Check size={16} />
                <span>{isSavingPrefs ? "Saving..." : "Save Preferences"}</span>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 3: ACCOUNT SECURITY ── */}
      {activeTab === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Card 1: Change Password */}
          <Card style={{ padding: "30px 32px", borderRadius: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--color-border, #e2e8f0)",
                  paddingBottom: 18,
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: "rgba(2, 132, 199, 0.12)",
                      color: "#0284c7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon.Key size={22} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)", letterSpacing: "-0.01em" }}>
                      Change Account Password
                    </h2>
                    <p style={{ fontSize: 13.5, color: "var(--color-text-muted, #64748b)", margin: "3px 0 0" }}>
                      Ensure your account uses a secure password complying with municipal abattoir security policies.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#10b981",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                  }}
                >
                  <Icon.ShieldCheck size={14} />
                  <span>Encrypted &amp; Protected</span>
                </div>
              </div>

              {/* Form & Security Checklist Grid */}
              <form onSubmit={handleChangePassword} noValidate>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    gap: 28,
                    alignItems: "start",
                  }}
                >
                  {/* Left Column: Input Fields */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {/* 1. Current Password */}
                    <div>
                      <label
                        htmlFor="current-password-input"
                        style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--color-text, #0f172a)", marginBottom: 7 }}
                      >
                        Current Password <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <div style={{ position: "relative" }}>
                        <div
                          style={{
                            position: "absolute",
                            left: 14,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: passwordErrorField === "current" ? "#ef4444" : "var(--color-text-muted, #94a3b8)",
                            pointerEvents: "none",
                            display: "flex",
                          }}
                        >
                          <Icon.Lock size={17} />
                        </div>
                        <input
                          id="current-password-input"
                          type={showCurrentPw ? "text" : "password"}
                          value={pw.current}
                          onChange={(e) => {
                            setPw({ ...pw, current: e.target.value });
                            if (passwordErrorField === "current") setPasswordErrorField(null);
                          }}
                          placeholder="Enter current password"
                          autoComplete="current-password"
                          style={{
                            width: "100%",
                            height: 46,
                            padding: "0 44px 0 42px",
                            borderRadius: 10,
                            border: passwordErrorField === "current"
                              ? "2px solid #ef4444"
                              : "1.5px solid var(--color-border, #cbd5e1)",
                            boxShadow: passwordErrorField === "current"
                              ? "0 0 0 3.5px rgba(239, 68, 68, 0.18)"
                              : "none",
                            background: "var(--color-bg, #f8fafc)",
                            color: "var(--color-text, #0f172a)",
                            fontSize: 14.5,
                            outline: "none",
                            transition: "all 0.15s ease",
                          }}
                          onFocus={(e) => {
                            if (passwordErrorField !== "current") {
                              e.target.style.borderColor = "var(--color-primary, #0284c7)";
                              e.target.style.boxShadow = "0 0 0 3.5px rgba(2, 132, 199, 0.15)";
                            }
                          }}
                          onBlur={(e) => {
                            if (passwordErrorField !== "current") {
                              e.target.style.borderColor = "var(--color-border, #cbd5e1)";
                              e.target.style.boxShadow = "none";
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPw(!showCurrentPw)}
                          style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            color: "var(--color-text-muted, #64748b)",
                            cursor: "pointer",
                            padding: 4,
                            display: "flex",
                          }}
                          title={showCurrentPw ? "Hide password" : "Show password"}
                        >
                          {showCurrentPw ? <Icon.EyeOff size={18} /> : <Icon.Eye size={18} />}
                        </button>
                      </div>
                      <span style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)", marginTop: 4, display: "block" }}>
                        Required to verify account ownership before saving changes.
                      </span>
                    </div>

                    {/* 2. New Password */}
                    <div>
                      <label
                        htmlFor="new-password-input"
                        style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--color-text, #0f172a)", marginBottom: 7 }}
                      >
                        New Password <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <div style={{ position: "relative" }}>
                        <div
                          style={{
                            position: "absolute",
                            left: 14,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: passwordErrorField === "next" ? "#ef4444" : "var(--color-text-muted, #94a3b8)",
                            pointerEvents: "none",
                            display: "flex",
                          }}
                        >
                          <Icon.Key size={17} />
                        </div>
                        <input
                          id="new-password-input"
                          type={showNextPw ? "text" : "password"}
                          value={pw.next}
                          onChange={(e) => {
                            setPw({ ...pw, next: e.target.value });
                            if (passwordErrorField === "next") setPasswordErrorField(null);
                          }}
                          placeholder="Enter new strong password"
                          autoComplete="new-password"
                          style={{
                            width: "100%",
                            height: 46,
                            padding: "0 44px 0 42px",
                            borderRadius: 10,
                            border: passwordErrorField === "next"
                              ? "2px solid #ef4444"
                              : "1.5px solid var(--color-border, #cbd5e1)",
                            boxShadow: passwordErrorField === "next"
                              ? "0 0 0 3.5px rgba(239, 68, 68, 0.18)"
                              : "none",
                            background: "var(--color-bg, #f8fafc)",
                            color: "var(--color-text, #0f172a)",
                            fontSize: 14.5,
                            outline: "none",
                            transition: "all 0.15s ease",
                          }}
                          onFocus={(e) => {
                            if (passwordErrorField !== "next") {
                              e.target.style.borderColor = "var(--color-primary, #0284c7)";
                              e.target.style.boxShadow = "0 0 0 3.5px rgba(2, 132, 199, 0.15)";
                            }
                          }}
                          onBlur={(e) => {
                            if (passwordErrorField !== "next") {
                              e.target.style.borderColor = "var(--color-border, #cbd5e1)";
                              e.target.style.boxShadow = "none";
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNextPw(!showNextPw)}
                          style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            color: "var(--color-text-muted, #64748b)",
                            cursor: "pointer",
                            padding: 4,
                            display: "flex",
                          }}
                          title={showNextPw ? "Hide password" : "Show password"}
                        >
                          {showNextPw ? <Icon.EyeOff size={18} /> : <Icon.Eye size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* 3. Confirm New Password */}
                    <div>
                      <label
                        htmlFor="confirm-password-input"
                        style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--color-text, #0f172a)", marginBottom: 7 }}
                      >
                        Confirm New Password <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <div style={{ position: "relative" }}>
                        <div
                          style={{
                            position: "absolute",
                            left: 14,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: passwordErrorField === "confirm" ? "#ef4444" : "var(--color-text-muted, #94a3b8)",
                            pointerEvents: "none",
                            display: "flex",
                          }}
                        >
                          <Icon.Lock size={17} />
                        </div>
                        <input
                          id="confirm-password-input"
                          type={showConfirmPw ? "text" : "password"}
                          value={pw.confirm}
                          onChange={(e) => {
                            setPw({ ...pw, confirm: e.target.value });
                            if (passwordErrorField === "confirm") setPasswordErrorField(null);
                          }}
                          placeholder="Re-type new password"
                          autoComplete="new-password"
                          style={{
                            width: "100%",
                            height: 46,
                            padding: "0 44px 0 42px",
                            borderRadius: 10,
                            border: passwordErrorField === "confirm"
                              ? "2px solid #ef4444"
                              : `1.5px solid ${
                                  pw.confirm
                                    ? pw.next === pw.confirm
                                      ? "#10b981"
                                      : "#ef4444"
                                    : "var(--color-border, #cbd5e1)"
                                }`,
                            boxShadow: passwordErrorField === "confirm"
                              ? "0 0 0 3.5px rgba(239, 68, 68, 0.18)"
                              : "none",
                            background: "var(--color-bg, #f8fafc)",
                            color: "var(--color-text, #0f172a)",
                            fontSize: 14.5,
                            outline: "none",
                            transition: "all 0.15s ease",
                          }}
                          onFocus={(e) => {
                            if (passwordErrorField !== "confirm" && !pw.confirm) {
                              e.target.style.borderColor = "var(--color-primary, #0284c7)";
                              e.target.style.boxShadow = "0 0 0 3.5px rgba(2, 132, 199, 0.15)";
                            }
                          }}
                          onBlur={(e) => {
                            if (passwordErrorField !== "confirm" && !pw.confirm) {
                              e.target.style.borderColor = "var(--color-border, #cbd5e1)";
                              e.target.style.boxShadow = "none";
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPw(!showConfirmPw)}
                          style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            color: "var(--color-text-muted, #64748b)",
                            cursor: "pointer",
                            padding: 4,
                            display: "flex",
                          }}
                          title={showConfirmPw ? "Hide password" : "Show password"}
                        >
                          {showConfirmPw ? <Icon.EyeOff size={18} /> : <Icon.Eye size={18} />}
                        </button>
                      </div>

                      {/* Real-time Match Indicator */}
                      {pw.confirm && (
                        <div style={{ marginTop: 7, fontSize: 12.5, fontWeight: 700 }}>
                          {pw.next === pw.confirm ? (
                            <span
                              style={{
                                color: "#10b981",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "3px 10px",
                                borderRadius: 6,
                                background: "rgba(16, 185, 129, 0.1)",
                              }}
                            >
                              <Icon.Check size={14} /> Passwords match perfectly
                            </span>
                          ) : (
                            <span
                              style={{
                                color: "#ef4444",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "3px 10px",
                                borderRadius: 6,
                                background: "rgba(239, 68, 68, 0.1)",
                              }}
                            >
                              ⚠ Passwords do not match
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                      <button
                        type="submit"
                        disabled={isChangingPw}
                        style={{
                          height: 44,
                          padding: "0 26px",
                          fontSize: 14.5,
                          fontWeight: 700,
                          borderRadius: 10,
                          border: "none",
                          background: isChangingPw
                            ? "var(--color-border, #cbd5e1)"
                            : "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                          color: isChangingPw ? "var(--color-text-muted, #94a3b8)" : "#ffffff",
                          cursor: isChangingPw ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          boxShadow: isChangingPw ? "none" : "0 4px 14px rgba(2, 132, 199, 0.3)",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {isChangingPw ? (
                          <>
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                border: "2px solid #ffffff",
                                borderTopColor: "transparent",
                                borderRadius: "50%",
                                animation: "spin 0.8s linear infinite",
                              }}
                            />
                            <span>Updating Password...</span>
                          </>
                        ) : (
                          <>
                            <Icon.Lock size={16} />
                            <span>Update Password</span>
                          </>
                        )}
                      </button>

                      {(pw.current || pw.next || pw.confirm) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPw({ current: "", next: "", confirm: "" });
                            setPasswordErrorField(null);
                            setShowCurrentPw(false);
                            setShowNextPw(false);
                            setShowConfirmPw(false);
                          }}
                          disabled={isChangingPw}
                          style={{
                            height: 44,
                            padding: "0 16px",
                            fontSize: 13.5,
                            fontWeight: 600,
                            borderRadius: 10,
                            border: "1.5px solid var(--color-border, #cbd5e1)",
                            background: "transparent",
                            color: "var(--color-text-muted, #64748b)",
                            cursor: isChangingPw ? "not-allowed" : "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Real-time Password Security Advisor */}
                  <div
                    style={{
                      background: "var(--color-bg, #f8fafc)",
                      borderRadius: 12,
                      border: "1px solid var(--color-border, #e2e8f0)",
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "rgba(2, 132, 199, 0.12)",
                          color: "#0284c7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon.Shield size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                          Security Requirements
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--color-text-muted, #64748b)" }}>
                          National &amp; abattoir compliance standards
                        </div>
                      </div>
                    </div>

                    <PasswordRequirements password={pw.next} showHeading={false} />

                    <div
                      style={{
                        marginTop: 4,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "rgba(2, 132, 199, 0.06)",
                        border: "1px solid rgba(2, 132, 199, 0.15)",
                        fontSize: 12,
                        color: "var(--color-text-muted, #64748b)",
                        lineHeight: 1.45,
                      }}
                    >
                      <strong style={{ color: "#0284c7" }}>Security Tip:</strong> Use at least 8 characters with a mix of uppercase, lowercase, numbers, and special symbols to ensure maximum security.
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </Card>

          {/* Card 2: Security & Session Protection */}
          <Card style={{ padding: "30px 32px", borderRadius: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ borderBottom: "1px solid var(--color-border, #e2e8f0)", paddingBottom: 16 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)" }}>
                  Authentication &amp; Active Sessions
                </h2>
                <p style={{ fontSize: 14, color: "var(--color-text-muted, #64748b)", margin: "4px 0 0" }}>
                  Active session status, single-device concurrency protection, and two-factor authentication.
                </p>
              </div>

              {/* 2FA Card Row */}
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
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: twoFA ? "rgba(16, 185, 129, 0.14)" : "rgba(100, 116, 139, 0.12)",
                      color: twoFA ? "#10b981" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon.Shield size={20} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                      Two-Factor Authentication (2FA)
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                      Requires email verification code on logins from unfamiliar browsers.
                    </div>
                  </div>
                </div>

                <Button
                  variant={twoFA ? "outline" : "primary"}
                  onClick={handleToggle2FA}
                  style={{
                    height: 40,
                    padding: "0 18px",
                    fontSize: 13.5,
                    fontWeight: 700,
                    borderRadius: 9,
                  }}
                >
                  {twoFA ? "Disable 2FA" : "Enable 2FA"}
                </Button>
              </div>

              {/* Single Session Concurrency Protection */}
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
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: "rgba(16, 185, 129, 0.14)",
                      color: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon.Check size={20} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 750, color: "var(--color-text, #0f172a)" }}>
                      Single Concurrent Session Protection
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                      Enforces unique login tokens per device. Subsequent logins automatically terminate older browser tabs.
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    padding: "5px 14px",
                    borderRadius: 999,
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

              {/* Sign out Active Session */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "18px 22px",
                  borderRadius: 14,
                  border: "1.5px solid rgba(239, 68, 68, 0.25)",
                  background: "rgba(239, 68, 68, 0.04)",
                  flexWrap: "wrap",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 750, color: "#ef4444" }}>
                    Sign Out Active Session
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted, #64748b)", marginTop: 2 }}>
                    Clears session credentials and returns you to the login screen.
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => signOut?.()}
                  style={{
                    height: 40,
                    padding: "0 18px",
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#ef4444",
                    borderColor: "rgba(239, 68, 68, 0.35)",
                    borderRadius: 9,
                  }}
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

          {/* ── TAB 4: MEAT PERMIT CONFIGURATION (ADMIN ONLY) ── */}
          {activeTab === "permit-config" && role === "admin" && (
            <PermitConfig />
          )}
        </div>
      </div>

      {/* Change Password Alert Dialog */}
      <AlertDialog
        open={passwordAlert.open}
        onClose={() => setPasswordAlert((prev) => ({ ...prev, open: false }))}
        title={passwordAlert.title}
        message={passwordAlert.message}
        buttonText={passwordAlert.buttonText || "OK"}
        variant={passwordAlert.variant || "danger"}
      />

      {/* Profile Status & Confirmation Alert Dialog */}
      <AlertDialog
        open={profileAlert.open}
        onClose={() => setProfileAlert((prev) => ({ ...prev, open: false }))}
        title={profileAlert.title}
        message={profileAlert.message}
        buttonText="OK"
        variant={profileAlert.variant || "success"}
      />
    </div>
  );
};

export default CentralSettingsPage;
