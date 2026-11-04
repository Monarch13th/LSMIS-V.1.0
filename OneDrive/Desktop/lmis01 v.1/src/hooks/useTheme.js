// Theme management hook and provider with per-user, device-local isolation
import { createContext, useContext, useEffect, useState, useMemo, useCallback, createElement } from "react";
import { useAuthStore } from "../store/authStore";

/**
 * Builds an isolated localStorage key per user account on this device.
 * Guarantees that Admin, Veterinarian, Staff, and Owner accounts each
 * maintain completely independent light/dark preferences.
 */
export const getUserThemeKey = (user) => {
  if (!user) return "lsmis_theme_guest";
  const id =
    user.id ||
    user.user_id ||
    (user.email ? String(user.email).toLowerCase().trim() : null) ||
    user.username ||
    user.role;
  return id ? `lsmis_theme_user_${id}` : "lsmis_theme_guest";
};

export const getStoredUserTheme = (user) => {
  try {
    const key = getUserThemeKey(user);
    const val = localStorage.getItem(key);
    if (val === "dark" || val === "light") return val;
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

  // Active theme state for the currently logged-in account
  const [theme, setThemeState] = useState(() => {
    return getStoredUserTheme(session);
  });

  // Whenever the authenticated session transitions (login, logout, account switch),
  // immediately load and apply that user's local preference on this device.
  useEffect(() => {
    const userTheme = getStoredUserTheme(session);
    setThemeState(userTheme);
    applyThemeToDom(userTheme);
  }, [session?.id, session?.email, session?.role]);

  const updateTheme = useCallback((newTheme) => {
    const safeTheme = newTheme === "dark" ? "dark" : "light";
    try {
      const key = getUserThemeKey(session);
      localStorage.setItem(key, safeTheme);
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
  }), [theme, updateTheme, toggleTheme]);

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
