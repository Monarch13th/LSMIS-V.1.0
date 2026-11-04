// Service worker registration + update handling for the installed / browser PWA.
// - Not used in dev (no stale caches while developing) and not used inside the Capacitor APK
//   (the APK ships its own bundled assets).
// - Detects new deployments, activates the new worker and reloads exactly once.
import { isCapacitorNativeApp } from "./capacitor";

const RELOAD_GUARD_KEY = "lsmis_sw_reload_ts";
const RELOAD_GUARD_MS = 15000; // never reload twice within 15s -> prevents reload loops
const AUTO_APPLY_WINDOW_MS = 8000; // an update found this soon after launch is applied silently
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const startedAt = Date.now();
let reloading = false;

function safeReload() {
  if (reloading) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (last && Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch (_) {}
  reloading = true;
  window.location.reload();
}

function showUpdateBanner(onUpdate) {
  if (document.getElementById("lsmis-update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "lsmis-update-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;display:flex;align-items:center;" +
    "justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:#0f172a;color:#fff;" +
    "font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);";
  const text = document.createElement("span");
  text.textContent = "A new version of LSMIS is available.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Update";
  btn.style.cssText =
    "border:0;border-radius:8px;padding:8px 14px;background:#10b981;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Updating...";
    onUpdate();
  });
  bar.append(text, btn);
  document.body.appendChild(bar);
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  if (isCapacitorNativeApp()) return;
  const secure = window.isSecureContext || window.location.hostname === "localhost";
  if (!secure) return;

  let controlled = Boolean(navigator.serviceWorker.controller);

  // Reload once when a NEW worker takes control. The very first claim (first install, no previous
  // controller) is not an update, so it is ignored; any later controller change is.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    safeReload();
  });

  window.addEventListener("load", async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    } catch (err) {
      console.warn("LSMIS service worker registration failed:", err);
      return;
    }

    const activate = (worker) => worker && worker.postMessage({ type: "SKIP_WAITING" });

    const handleWaiting = (worker) => {
      if (!navigator.serviceWorker.controller) return; // first install, nothing to update
      if (Date.now() - startedAt < AUTO_APPLY_WINDOW_MS) {
        activate(worker); // just launched: safe to switch without losing user input
      } else {
        showUpdateBanner(() => activate(worker));
      }
    };

    if (registration.waiting) handleWaiting(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") handleWaiting(registration.waiting || installing);
      });
    });

    const check = () => registration.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    check();
  });
}
