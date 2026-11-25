import { useEffect } from "react";


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
const seen = new WeakMap();

const isScrollable = (el) => {
  const { overflowY } = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight;
};

const getTopInset = (el) => {
  if (el.closest(".modal-backdrop, [role='dialog']")) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--header-height");
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 68;
};

const isFullyVisible = (el, topInset) => {
  const rect = el.getBoundingClientRect();
  let top = topInset + EDGE_GAP;
  let bottom = (window.visualViewport?.height || window.innerHeight) - EDGE_GAP;
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
  if (rect.width === 0 || rect.height === 0) return;

  const signature = (el.textContent || "").trim();
  if (!signature) return;
  if (seen.get(el) === signature) return;
  seen.set(el, signature);

  const topInset = getTopInset(el);
  if (isFullyVisible(el, topInset)) return;

  const viewportH = window.visualViewport?.height || window.innerHeight;
  const tallerThanView = rect.height > viewportH - topInset - EDGE_GAP * 2;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const prevMargin = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${topInset + EDGE_GAP + 4}px`;
  el.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: tallerThanView ? "start" : "center",
    inline: "nearest",
  });
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
      for (const el of items) {
        const before = seen.get(el);
        scrollToAlert(el);
        if (seen.get(el) !== before) {
          const rect = el.getBoundingClientRect();
          if (rect.width && rect.height) break;
        }
      }
    };

    const queue = (el) => {
      pending.add(el);
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
          const host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          const alertEl = host?.closest?.(ALERT_SELECTOR);
          if (alertEl) queue(alertEl);
        } else if (m.type === "characterData") {
          const alertEl = m.target.parentElement?.closest?.(ALERT_SELECTOR);
          if (alertEl) queue(alertEl);
        } else if (m.type === "attributes") {
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

