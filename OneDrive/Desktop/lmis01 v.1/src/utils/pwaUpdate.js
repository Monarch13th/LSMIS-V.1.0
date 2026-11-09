// Service worker registration + update handling for LSMIS (PWA & Web).
// - Development mode: explicitly unregisters any service workers and purges dev caches so HMR is instant.
// - Capacitor Native APK: returns early since native APK assets are bundled internally.
// - Production PWA / Web: implements dual-detection (SW byte-diff & version.json polling),
//   safe silent activation at app launch / background, non-disruptive update banners during active work,
//   and reliable reload guards.
import { isCapacitorNativeApp } from "./capacitor";

const RELOAD_GUARD_KEY = "lsmis_sw_reload_ts";
const RELOAD_GUARD_MS = 6000; // never reload twice within 6s -> prevents reload loops
const AUTO_APPLY_WINDOW_MS = 15000; // updates found within 15s of launch are applied silently
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000; // check every 60s for rapid detection

const startedAt = Date.now();
let isReloading = false;
let waitingWorkerInstance = null;

// Build ID injected at compile time by Vite define; fallback to empty string
const RUNNING_BUILD_ID =
  typeof __APP_BUILD_ID__ !== "undefined" && __APP_BUILD_ID__
    ? String(__APP_BUILD_ID__)
    : "";

/**
 * Checks whether the current page context is safe to reload silently without
 * interrupting unsaved user form input.
 */
function isSafeToAutoReload() {
  if (Date.now() - startedAt < AUTO_APPLY_WINDOW_MS) return true;
  if (typeof document !== "undefined" && document.hidden) return true;

  try {
    const path = (window.location.pathname || "").toLowerCase();
    const isPublicPage =
      !path ||
      path === "/" ||
      path === "/login" ||
      path === "/register" ||
      path === "/forgot-password" ||
      path === "/reset-password";
    if (isPublicPage) return true;

    // Check if user is actively focused on an input element
    const active = document.activeElement;
    if (active) {
      const tag = (active.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable) {
        return false;
      }
    }
  } catch (_) {}

  return false;
}

/**
 * Performs a guarded reload to prevent infinite refresh cycles.
 */
function safeReload() {
  if (isReloading) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (last && Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch (_) {}
  isReloading = true;
  window.location.reload();
}

/**
 * Sends SKIP_WAITING to the waiting service worker.
 */
function activateWorker(worker) {
  const target = worker || waitingWorkerInstance;
  if (target) {
    try {
      target.postMessage({ type: "SKIP_WAITING" });
    } catch (_) {}
  }
}

/**
 * Renders a clean, accessible floating update banner when an update is ready during an active session.
 */
function showUpdateBanner(onUpdate) {
  if (document.getElementById("lsmis-update-banner")) return;

  const bar = document.createElement("div");
  bar.id = "lsmis-update-banner";
  bar.setAttribute("role", "alert");
  bar.setAttribute("aria-live", "polite");
  bar.style.cssText =
    "position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;" +
    "justify-content:space-between;gap:14px;padding:12px 18px;border-radius:12px;background:#0f172a;color:#ffffff;" +
    "font:600 13.5px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,0.12);max-width:540px;margin:0 auto;";

  const textWrap = document.createElement("div");
  textWrap.style.cssText = "display:flex;align-items:center;gap:10px;";

  const dot = document.createElement("span");
  dot.style.cssText =
    "width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;flex-shrink:0;box-shadow:0 0 8px #10b981;";

  const text = document.createElement("span");
  text.textContent = "A newer version of LSMIS is available.";
  textWrap.append(dot, text);

  const btnWrap = document.createElement("div");
  btnWrap.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Update Now";
  btn.style.cssText =
    "border:0;border-radius:8px;padding:8px 16px;background:#10b981;color:#ffffff;font:700 13px system-ui,sans-serif;" +
    "cursor:pointer;transition:background 0.15s ease;box-shadow:0 2px 6px rgba(16,185,129,0.35);";
  btn.addEventListener("mouseenter", () => (btn.style.background = "#059669"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#10b981"));
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Updating...";
    onUpdate();
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.setAttribute("aria-label", "Dismiss update notice");
  dismissBtn.innerHTML = "&times;";
  dismissBtn.style.cssText =
    "border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;";
  dismissBtn.addEventListener("click", () => {
    bar.remove();
  });

  btnWrap.append(btn, dismissBtn);
  bar.append(textWrap, btnWrap);
  document.body.appendChild(bar);
}

/**
 * Proactively polls /version.json to detect when a new build has deployed on the server.
 */
async function checkForNewVersionOnline(registration) {
  if (!RUNNING_BUILD_ID) return;
  try {
    const res = await fetch(`/version.json?_t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.buildId && data.buildId !== RUNNING_BUILD_ID) {
      console.log("[LSMIS PWA] Detected newer build deployed on server:", data.buildId, "vs current:", RUNNING_BUILD_ID);
      if (registration) {
        try {
          await registration.update();
        } catch (_) {}
      }
      if (waitingWorkerInstance) {
        activateWorker(waitingWorkerInstance);
      }
      if (isSafeToAutoReload()) {
        safeReload();
      } else {
        showUpdateBanner(() => {
          activateWorker(waitingWorkerInstance);
          safeReload();
        });
      }
    }
  } catch (_) {}
}

/**
 * Unregisters any active or stale service workers and deletes caches in development mode.
 */
export function cleanupDevEnvironment() {
  if (typeof window === "undefined") return;
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister().then((ok) => {
            if (ok) console.log("[LSMIS Dev] Unregistered service worker:", reg.scope);
          });
        }
      });
    }
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys
          .filter((k) => k.startsWith("lsmis-pwa-"))
          .forEach((k) => {
            caches.delete(k);
            console.log("[LSMIS Dev] Cleared cache:", k);
          });
      });
    }
  } catch (_) {}
}

/**
 * Main Service Worker registration & lifecycle manager.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  // 1. DEVELOPMENT MODE: strictly bypass SW & delete old localhost caches so HMR is 100% instant
  const isDev =
    import.meta.env.DEV ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isDev) {
    cleanupDevEnvironment();
    return;
  }

  // 2. CAPACITOR APK: native APK loads bundled assets locally; no PWA worker needed
  if (isCapacitorNativeApp()) return;

  // 3. SECURE CONTEXT CHECK
  const isSecure = window.isSecureContext || window.location.hostname === "localhost";
  if (!isSecure) return;

  let controlled = Boolean(navigator.serviceWorker.controller);

  // 4. CONTROLLER CHANGE: Triggered when a new service worker takes over clients
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      // First install: SW took control of the current page for the first time
      controlled = true;
      return;
    }
    // Subsequent update: reload to run the new application bundle
    safeReload();
  });

  // Listen for broadcast messages from SW
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SW_ACTIVATED") {
      if (event.data.buildId !== RUNNING_BUILD_ID) {
        safeReload();
      }
    }
  });

  const init = async () => {
    let registration;

    // Clean up any foreign / rogue service workers registered on other paths
    try {
      const allRegs = await navigator.serviceWorker.getRegistrations();
      for (const reg of allRegs) {
        const script =
          reg.active?.scriptURL ||
          reg.waiting?.scriptURL ||
          reg.installing?.scriptURL ||
          "";
        if (script && !script.endsWith("/sw.js")) {
          console.warn("[LSMIS PWA] Purging non-standard worker:", script);
          reg.unregister();
        }
      }
    } catch (_) {}

    try {
      registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    } catch (err) {
      console.warn("[LSMIS PWA] Service worker registration failed:", err);
      return;
    }

    const handleWaitingWorker = (worker) => {
      if (!worker) return;
      waitingWorkerInstance = worker;
      activateWorker(worker);
      if (isSafeToAutoReload()) {
        safeReload();
      } else {
        showUpdateBanner(() => {
          activateWorker(worker);
          safeReload();
        });
      }
    };

    if (registration.waiting) {
      handleWaitingWorker(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") {
          handleWaitingWorker(registration.waiting || installing);
        } else if (installing.state === "activated") {
          if (isSafeToAutoReload()) {
            safeReload();
          }
        }
      });
    });

    // Check for updates
    const triggerUpdateCheck = () => {
      registration.update().catch(() => {});
      checkForNewVersionOnline(registration);
    };

    // 1. Check on app visibility / foregrounding
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        triggerUpdateCheck();
        if (waitingWorkerInstance && isSafeToAutoReload()) {
          activateWorker(waitingWorkerInstance);
          safeReload();
        }
      }
    });

    // 2. Check on window focus (e.g. mobile app switched back to)
    window.addEventListener("focus", triggerUpdateCheck);

    // 3. Check when network comes back online
    window.addEventListener("online", triggerUpdateCheck);

    // 4. Periodic check every 60s
    window.setInterval(triggerUpdateCheck, UPDATE_CHECK_INTERVAL_MS);

    // Initial check on load
    triggerUpdateCheck();
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    window.addEventListener("DOMContentLoaded", init, { once: true });
    window.addEventListener("load", init, { once: true });
  }
}
