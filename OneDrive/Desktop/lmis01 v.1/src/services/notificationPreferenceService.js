import { supabase } from "./supabaseClient";
import { TABLES } from "../utils/constants";
import { notifyDbChange } from "./realtimeSync";

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  account_notifications: true,
  registration_updates: true,
  approval_updates: true,
  livestock_process_updates: true,
  inspection_updates: true,
  system_announcements: true,
};

const STORAGE_PREFIX = "lsmis_notif_prefs_";

/**
 * Get current user notification preferences from Supabase,
 * falling back to user metadata / localStorage.
 */
export const getUserNotificationPreferences = async (userEmail, userId) => {
  const cleanEmail = (userEmail || "").trim().toLowerCase();
  const cleanId = (userId || "").trim();

  // Check localStorage cache first
  const cacheKey = `${STORAGE_PREFIX}${cleanEmail || cleanId || "guest"}`;
  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch (_) {}

  try {
    let query = supabase.from(TABLES.USER_PREFERENCES).select("notification_preferences");
    if (cleanId) {
      query = query.or(`user_id.eq.${cleanId},email.ilike.${cleanEmail}`);
    } else if (cleanEmail) {
      query = query.ilike("email", cleanEmail);
    } else {
      return cached || { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    const { data, error } = await query.maybeSingle();

    if (!error && data?.notification_preferences) {
      const merged = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data.notification_preferences };
      try {
        localStorage.setItem(cacheKey, JSON.stringify(merged));
      } catch (_) {}
      return merged;
    }
  } catch (err) {
    console.warn("Could not query user_preferences table:", err);
  }

  // Fallback to auth user metadata
  try {
    const { data: authUser } = await supabase.auth.getUser();
    const metaPrefs = authUser?.user?.user_metadata?.notification_preferences;
    if (metaPrefs && typeof metaPrefs === "object") {
      const merged = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...metaPrefs };
      try {
        localStorage.setItem(cacheKey, JSON.stringify(merged));
      } catch (_) {}
      return merged;
    }
  } catch (_) {}

  return cached || { ...DEFAULT_NOTIFICATION_PREFERENCES };
};

/**
 * Save user notification preferences to Supabase and update local storage & user metadata.
 */
export const updateUserNotificationPreferences = async ({
  email,
  userId,
  preferences,
}) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanId = (userId || "").trim();
  const merged = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...preferences };

  const cacheKey = `${STORAGE_PREFIX}${cleanEmail || cleanId || "guest"}`;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(merged));
  } catch (_) {}

  // 1. Upsert into public.user_preferences table
  try {
    const payload = {
      notification_preferences: merged,
      updated_at: new Date().toISOString(),
    };
    if (cleanEmail) payload.email = cleanEmail;
    if (cleanId) payload.user_id = cleanId;

    let res = null;
    if (cleanId) {
      res = await supabase
        .from(TABLES.USER_PREFERENCES)
        .upsert(payload, { onConflict: "user_id" })
        .select();
    } else if (cleanEmail) {
      res = await supabase
        .from(TABLES.USER_PREFERENCES)
        .upsert(payload, { onConflict: "email" })
        .select();
    }

    if (res?.error) {
      console.warn("Upsert user_preferences error:", res.error);
    }
  } catch (err) {
    console.warn("user_preferences table write exception:", err);
  }

  // 2. Also persist in supabase.auth user_metadata
  try {
    await supabase.auth.updateUser({
      data: { notification_preferences: merged },
    });
  } catch (_) {}

  // 3. Dispatch broadcast events for instant live reactive sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("lsmis_notif_prefs_updated", { detail: merged })
    );
  }

  return merged;
};

/**
 * Classifies an incoming notification title/message into a preference category:
 * 'account_notifications' | 'registration_updates' | 'approval_updates' |
 * 'livestock_process_updates' | 'inspection_updates' | 'system_announcements'
 */
export const classifyNotificationCategory = (title = "", message = "") => {
  const text = `${title} ${message}`.toLowerCase();

  if (
    text.includes("password") ||
    text.includes("login") ||
    text.includes("session") ||
    text.includes("2fa") ||
    text.includes("account terminated") ||
    text.includes("account access") ||
    text.includes("profile")
  ) {
    return "account_notifications";
  }

  if (
    text.includes("registration") ||
    text.includes("registered") ||
    text.includes("new animal received") ||
    text.includes("registered owner") ||
    text.includes("intake")
  ) {
    return "registration_updates";
  }

  if (
    text.includes("approv") ||
    text.includes("approved") ||
    text.includes("reject") ||
    text.includes("rejected") ||
    text.includes("permit issued") ||
    text.includes("cleared") ||
    text.includes("verified")
  ) {
    return "approval_updates";
  }

  if (
    text.includes("ante-mortem") ||
    text.includes("post-mortem") ||
    text.includes("inspection") ||
    text.includes("condemn") ||
    text.includes("carcass") ||
    text.includes("branding")
  ) {
    return "inspection_updates";
  }

  if (
    text.includes("slaughter") ||
    text.includes("marking") ||
    text.includes("schedule") ||
    text.includes("weigh") ||
    text.includes("payment") ||
    text.includes("dispatch") ||
    text.includes("timeout") ||
    text.includes("reassign")
  ) {
    return "livestock_process_updates";
  }

  return "system_announcements";
};
