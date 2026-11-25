import { Capacitor } from "@capacitor/core";

export function isCapacitorNativeApp() {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
    if (Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios") return true;
  } catch (_) {}

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

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;

  try {
    if (sessionStorage.getItem("lsmis_installed_mode") === "1") return true;
  } catch (_) {}

  let matched = false;
  try {
    if (window.matchMedia) {
      if (window.matchMedia("(display-mode: standalone)").matches) matched = true;
      else if (window.matchMedia("(display-mode: fullscreen)").matches) matched = true;
      else if (window.matchMedia("(display-mode: minimal-ui)").matches) matched = true;
    }
  } catch (_) {}

  if (!matched) {
    try {
      if (window.navigator && window.navigator.standalone === true) matched = true;
    } catch (_) {}
  }

  if (!matched) {
    try {
      const search = window.location.search || "";
      if (search.includes("source=pwa") || search.includes("source=installed") || search.includes("source=app")) {
        matched = true;
      }
    } catch (_) {}
  }

  if (!matched) {
    try {
      if (document.referrer && document.referrer.startsWith("android-app://")) {
        matched = true;
      }
    } catch (_) {}
  }

  if (matched) {
    try {
      sessionStorage.setItem("lsmis_installed_mode", "1");
    } catch (_) {}
    return true;
  }

  return false;
}

export function isInstalledApp() {
  return isCapacitorNativeApp() || isStandalonePwa();
}

export function getMobileDeviceInfo() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { isMobileDevice: false, isAndroid: false, isIOS: false, isDesktop: true };
  }

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isAndroid = /Android/i.test(ua);
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    ((/Macintosh/i.test(ua) || platform === "MacIntel") && maxTouchPoints > 1);
  const uaDataMobile =
    typeof navigator.userAgentData?.mobile === "boolean"
      ? navigator.userAgentData.mobile
      : false;
  const isOtherMobile = /webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  const isMobileDevice = isAndroid || isIOS || uaDataMobile || isOtherMobile;
  return {
    isMobileDevice,
    isAndroid,
    isIOS,
    isDesktop: !isMobileDevice,
  };
}
