// Theme management hook and provider with per-user, device-local isolation
import { createContext, useContext, useEffect, useState, useMemo, useCallback, createElement } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { supabase } from "../services/supabaseClient";

/**
 * Determines whether a given pathname belongs to a public (unauthenticated) route.
 * Public pages must strictly display the default light theme at all times.
 */
export const isPublicPath = (pathname) => {
  if (!pathname || pathname === "/") return true;
  const p = pathname.toLowerCase().trim();
  if (
    p === "/" ||
    p === "/login" ||
    p === "/register" ||
    p === "/forgot-password" ||
    p === "/reset-password" ||
    p === "/waiting-approval" ||
    p === "/owner/waiting-approval" ||
    p.startsWith("/login") ||
    p.startsWith("/register") ||
    p.startsWith("/forgot-password") ||
    p.startsWith("/reset-password")
  ) {
    return true;
  }
  // Any path that doesn't start with an authenticated role prefix
  if (
    !p.startsWith("/admin") &&
    !p.startsWith("/vet") &&
    !p.startsWith("/staff") &&
    !p.startsWith("/owner") &&
    !p.startsWith("/dashboard")
  ) {
    return true;
  }
  return false;
};

/**
 * Builds an isolated list of localStorage keys for a user account on this device.
 * Guarantees that Admin, Veterinarian, Staff, and Owner accounts each
 * maintain completely independent light/dark preferences without collisions.
 */
export const getUserThemeKeys = (user) => {
  if (!user) return [];
  const keys = [];
  const id = user.id || user.user_id;
  const email = user.email ? String(user.email).toLowerCase().trim() : null;
  if (id) keys.push(`lsmis_theme_user_${id}`);
  if (email && email !== id) keys.push(`lsmis_theme_user_${email}`);
  if (user.username && user.username !== id && user.username !== email) {
    keys.push(`lsmis_theme_user_${user.username}`);
  }
  return keys;
};

export const getUserThemeKey = (user) => {
  const keys = getUserThemeKeys(user);
  return keys[0] || "lsmis_theme_guest";
};

export const getStoredUserTheme = (user) => {
  if (!user) return "light";
  try {
    const keys = getUserThemeKeys(user);
    for (const key of keys) {
      const val = localStorage.getItem(key);
      if (val === "dark" || val === "light") return val;
    }
    // Also check user_metadata if available
    const metaTheme = user.user_metadata?.theme;
    if (metaTheme === "dark" || metaTheme === "light") return metaTheme;
  } catch (_) {}
  return "light";
};

export const applyThemeToDom = (targetTheme) => {
  if (typeof document === "undefined") return;
  const safeTheme = targetTheme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", safeTheme);
  document.documentElement.classList.toggle("dark", safeTheme === "dark");
};

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const session = useAuthStore((s) => s?.session);
  const location = useLocation();
  const pathname = location?.pathname || (typeof window !== "undefined" ? window.location.pathname : "/");
  const isPublic = isPublicPath(pathname);

  // Active theme state
  const [theme, setThemeState] = useState(() => {
    if (session) return getStoredUserTheme(session);
    if (typeof localStorage !== "undefined") {
      const g = localStorage.getItem("lsmis_theme_guest");
      if (g === "dark" || g === "light") return g;
    }
    return "light";
  });

  // Whenever the route or session transitions:
  useEffect(() => {
    if (session && !isPublicPath(pathname)) {
      // Authenticated system route: load and apply this user's independent preference
      const userTheme = getStoredUserTheme(session);
      setThemeState(userTheme);
      applyThemeToDom(userTheme);
    } else if (pathname === "/") {
      // Landing page: load guest preference if toggled, otherwise light
      const guestTheme = (typeof localStorage !== "undefined" && localStorage.getItem("lsmis_theme_guest")) || "light";
      setThemeState(guestTheme);
      applyThemeToDom(guestTheme);
    } else if (isPublicPath(pathname)) {
      // Public authentication pages (login, register, forgot-password): strictly default light
      applyThemeToDom("light");
    } else {
      applyThemeToDom("light");
    }
  }, [pathname, session?.id, session?.email, session?.role]);

  const updateTheme = useCallback((newTheme) => {
    const safeTheme = newTheme === "dark" ? "dark" : "light";
    try {
      if (session) {
        const keys = getUserThemeKeys(session);
        keys.forEach((key) => {
          localStorage.setItem(key, safeTheme);
        });
        if (supabase?.auth?.updateUser) {
          supabase.auth.updateUser({ data: { theme: safeTheme } }).catch(() => {});
        }
      } else {
        localStorage.setItem("lsmis_theme_guest", safeTheme);
      }
    } catch (_) {}

    applyThemeToDom(safeTheme);
    setThemeState(safeTheme);
  }, [session]);

  const toggleTheme = useCallback(() => {
    updateTheme(theme === "dark" ? "light" : "dark");
  }, [theme, updateTheme]);

  const value = useMemo(() => ({
    theme,
    setTheme: updateTheme,
    toggleTheme,
    isPublic,
  }), [theme, updateTheme, toggleTheme, isPublic]);

  return createElement(ThemeContext.Provider, { value }, children);
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;

  // Fallback for any invocation outside of ThemeProvider
  const currentDom =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  return {
    theme: currentDom,
    setTheme: (t) => applyThemeToDom(t),
    toggleTheme: () => applyThemeToDom(currentDom === "dark" ? "light" : "dark"),
  };
};
