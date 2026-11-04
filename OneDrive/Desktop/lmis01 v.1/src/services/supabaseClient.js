import { createClient } from "@supabase/supabase-js";
import { isCapacitorNativeApp, isInstalledApp } from "../utils/capacitor";

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_URL : "");
const supabaseKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_ANON_KEY : "");

/**
 * Returns a stable, tab-scoped identifier for the current browsing context.
 * Persists across page reloads (F5 / Ctrl+R / mobile pull-to-refresh) and same-tab OAuth redirects,
 * while remaining completely isolated when a user opens a new tab or window.
 */
export function getTabId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = sessionStorage.getItem("lsmis_tab_id");
    if (existing && existing.startsWith("lsmis_tab_")) {
      window.name = existing;
      return existing;
    }
    if (window.name && window.name.startsWith("lsmis_tab_")) {
      sessionStorage.setItem("lsmis_tab_id", window.name);
      return window.name;
    }
    const newId = "lsmis_tab_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    window.name = newId;
    sessionStorage.setItem("lsmis_tab_id", newId);
    return newId;
  } catch {
    return "lsmis_tab_default";
  }
}

const currentTabId = getTabId();
const isNativeApp = typeof window !== "undefined" && isCapacitorNativeApp();
// Installed APK or installed PWA: persist the session in localStorage so it survives closing the app.
const isInstalled = typeof window !== "undefined" && isInstalledApp();

/**
 * Capture initial OAuth callback URL state before createClient() runs,
 * because detectSessionInUrl: true may consume and strip #access_token=... from window.location.hash
 * before React components mount.
 */
export const initialOAuthCallback =
  typeof window !== "undefined"
    ? {
        pathname: window.location.pathname || "/",
        search: window.location.search || "",
        hash: window.location.hash || "",
        hasOAuthTokens:
          (window.location.hash || "").includes("access_token=") ||
          (window.location.search || "").includes("code=") ||
          (window.location.hash || "").includes("error=") ||
          (window.location.search || "").includes("error="),
      }
    : { pathname: "/", search: "", hash: "", hasOAuthTokens: false };

// Single unified source of truth for the Supabase database client
// Inside installed Capacitor Android app: use localStorage so session persists across app close/reopen
// In regular web browsers: use tab-isolated sessionStorage so tabs don't collide
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage:
      typeof window !== "undefined"
        ? (isInstalled ? window.localStorage : window.sessionStorage)
        : undefined,
    storageKey:
      typeof window !== "undefined"
        ? (isNativeApp ? "sb_native_auth_token" : isInstalled ? "sb_standalone_auth_token" : `sb_${currentTabId}_auth_token`)
        : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
