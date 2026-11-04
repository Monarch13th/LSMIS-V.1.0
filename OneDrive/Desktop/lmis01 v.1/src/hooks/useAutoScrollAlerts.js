import { useEffect } from "react";

/**
 * Global, reusable auto-scroll for alerts.
 *
 * Watches the DOM for error / warning / validation alerts that appear (or whose
 * message text changes) and smoothly scrolls them into view if they are not
 * already fully visible. Existing alert markup, styling and text are untouched.
 *
 * - Works for dynamically rendered and delayed alerts (MutationObserver).
 * - Works inside modals / scrollable containers (scrollIntoView handles ancestors).
 * - Skips alerts that are already fully visible.
 * - Scrolls once per alert element per message (no repeat for the same alert).
 * - Respects prefers-reduced-motion.
 * - Success alerts are intentionally not matched.
 */

export const ALERT_SELECTOR = [
  ".alert-error",
  ".alert-danger",
  ".alert-warning",
  '[role="alert"]:not(.alert-success):not(.alert-info)',
  ".error-text",
  ".field-error",
  ".form-error",
  ".invalid-feedback",
].join(",");

const EDGE_GAP = 12;
const seen = new WeakMap(); // element -> last message signature we scrolled for

const isScrollable = (el) => {
  const { overflowY } = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight;
};

const getTopInset = (el) => {
  // Modals render above the app header, so no inset is needed inside them.
  if (el.closest(".modal-backdrop, [role='dialog']")) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--header-height");
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 68;
};

const isFullyVisible = (el, topInset) => {
  const rect = el.getBoundingClientRect();
  let top = topInset + EDGE_GAP;
  let bottom = (window.visualViewport?.height || window.innerHeight) - EDGE_GAP;
  // Also clip against scrollable ancestors (e.g. modal body, app-main).
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (isScrollable(p)) {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      bottom = Math.min(bottom, pr.bottom);
    }
  }
  return rect.top >= top && rect.bottom <= bottom;
};

const scrollToAlert = (el) => {
  if (!el.isConnected) return;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // hidden

  const signature = (el.textContent || "").trim();
  if (!signature) return;
  if (seen.get(el) === signature) return; // same alert, same message
  seen.set(el, signature);

  const topInset = getTopInset(el);
  if (isFullyVisible(el, topInset)) return;

  const viewportH = window.visualViewport?.height || window.innerHeight;
  const tallerThanView = rect.height > viewportH - topInset - EDGE_GAP * 2;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Keep alert clear of fixed header / navigation.
  const prevMargin = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${topInset + EDGE_GAP + 4}px`;
  el.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: tallerThanView ? "start" : "center",
    inline: "nearest",
  });
  // Restore after the scroll has been computed.
  setTimeout(() => {
    el.style.scrollMarginTop = prevMargin;
  }, 0);
};

export const useAutoScrollAlerts = () => {
  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined") return undefined;

    const pending = new Set();
    let timer = null;

    const flush = () => {
      timer = null;
      const items = Array.from(pending);
      pending.clear();
      // Scroll only to the first newly appeared alert to avoid competing scrolls.
      for (const el of items) {
        const before = seen.get(el);
        scrollToAlert(el);
        if (seen.get(el) !== before) {
          // handled (scrolled or already visible) — stop at first fresh alert
          const rect = el.getBoundingClientRect();
          if (rect.width && rect.height) break;
        }
      }
    };

    const queue = (el) => {
      pending.add(el);
      // Small delay lets layout settle (animations, modal mount, delayed validation).
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => requestAnimationFrame(flush), 80);
    };

    const collect = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.matches?.(ALERT_SELECTOR)) queue(node);
      node.querySelectorAll?.(ALERT_SELECTOR).forEach(queue);
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          m.addedNodes.forEach(collect);
          // Message text swapped inside an existing alert
          const host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          const alertEl = host?.closest?.(ALERT_SELECTOR);
          if (alertEl) queue(alertEl);
        } else if (m.type === "characterData") {
          const alertEl = m.target.parentElement?.closest?.(ALERT_SELECTOR);
          if (alertEl) queue(alertEl);
        } else if (m.type === "attributes") {
          // class toggled to become an alert, or hidden -> shown
          collect(m.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
};

export default useAutoScrollAlerts;

