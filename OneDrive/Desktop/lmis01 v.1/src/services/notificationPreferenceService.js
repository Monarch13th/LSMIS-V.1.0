import { supabase } from "./supabaseClient";
import { TABLES } from "../utils/constants";

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  account_notifications: true,
  registration_updates: true,
  approval_updates: true,
  livestock_process_updates: true,
  inspection_updates: true,
  system_announcements: true,
};

const STORAGE_PREFIX = "lsmis_notif_prefs_";

export const getUserNotificationPreferences = async (userEmail, userId) => {
  const cleanEmail = (userEmail || "").trim().toLowerCase();
  const cleanId = (userId || "").trim();

  const cacheKey = `${STORAGE_PREFIX}${cleanEmail || cleanId || "guest"}`;
  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch (_) {}

  if (cached && typeof cached === "object") {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...cached };
  }

  if (cleanEmail || cleanId) {
    try {
      if (TABLES.USER_PREFERENCES) {
        let query = supabase.from(TABLES.USER_PREFERENCES).select("notification_preferences");
        if (cleanId) {
          query = query.or(`user_id.eq.${cleanId},email.ilike.${cleanEmail}`);
        } else {
          query = query.ilike("email", cleanEmail);
        }

        const { data, error } = await Promise.race([
          query.maybeSingle(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000)),
        ]);

        if (!error && data?.notification_preferences) {
          const merged = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data.notification_preferences };
          try {
            localStorage.setItem(cacheKey, JSON.stringify(merged));
          } catch (_) {}
          return merged;
        }
      }
    } catch (_) {
    }
  }

  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
};

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

  try {
    if (TABLES.USER_PREFERENCES && (cleanEmail || cleanId)) {
      const payload = {
        notification_preferences: merged,
        updated_at: new Date().toISOString(),
      };
      if (cleanEmail) payload.email = cleanEmail;
      if (cleanId) payload.user_id = cleanId;

      if (cleanId) {
        await supabase
          .from(TABLES.USER_PREFERENCES)
          .upsert(payload, { onConflict: "user_id" });
      } else {
        await supabase
          .from(TABLES.USER_PREFERENCES)
          .upsert(payload, { onConflict: "email" });
      }
    }
  } catch (_) {}

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("lsmis_notif_prefs_updated", { detail: merged })
    );
  }

  return merged;
};

export const classifyNotificationCategory = (title = "", message = "") => {
  const text = `${title} ${message}`.toLowerCase();
  if (text.includes("registered") || text.includes("intake") || text.includes("tag")) {
    return "registration_updates";
  }
  if (text.includes("approv") || text.includes("reject") || text.includes("status")) {
    return "approval_updates";
  }
  if (text.includes("slaughter") || text.includes("scalding") || text.includes("evisceration") || text.includes("processing") || text.includes("weighed")) {
    return "livestock_process_updates";
  }
  if (text.includes("inspection") || text.includes("ante-mortem") || text.includes("post-mortem") || text.includes("condemn")) {
    return "inspection_updates";
  }
  if (text.includes("system") || text.includes("announcement") || text.includes("maintenance")) {
    return "system_announcements";
  }
  return "account_notifications";
};
