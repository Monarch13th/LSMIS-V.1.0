import { Capacitor } from "@capacitor/core";

/**
 * Returns true strictly when running inside the native installed mobile application (Capacitor Android/iOS).
 * Returns false on standard web browsers (mobile Chrome, Safari, desktop browsers).
 */
export function isCapacitorNativeApp() {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
    if (Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios") return true;
  } catch (_) {}

  // Secondary checks for Capacitor WebView environment
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) {
      return true;
    }
    if (window.location && window.location.origin === "https://localhost" && !window.location.port) {
      return true;
    }
  } catch (_) {}

  return false;
}

/**
 * Returns true when LSMIS is launched from the home screen as an installed PWA
 * (Android Chrome / desktop "display-mode: standalone", or iOS "Add to Home Screen").
 * A normal browser tab always returns false.
 */
export function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia) {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
      if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
    }
  } catch (_) {}
  try {
    if (window.navigator && window.navigator.standalone === true) return true; // iOS Safari
  } catch (_) {}
  return false;
}

/**
 * True for any installed LSMIS experience: the Capacitor Android APK or the installed PWA.
 * Browser tabs return false, so the public Landing Page stays available on the website.
 */
export function isInstalledApp() {
  return isCapacitorNativeApp() || isStandalonePwa();
}
