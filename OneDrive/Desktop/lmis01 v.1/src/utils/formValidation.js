
export function getScrollParent(node) {
  if (!node || typeof window === "undefined") return window;
  let parent = node.parentElement;

  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY || "";
    const isScrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight;

    if (isScrollable) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return window;
}

function expandParentSections(el, onExpand) {
  if (!el || typeof el.closest !== "function") return;

  let details = el.closest("details");
  while (details) {
    if (!details.open) {
      details.open = true;
    }
    details = details.parentElement ? details.parentElement.closest("details") : null;
  }

  if (typeof onExpand === "function") {
    try {
      onExpand(el);
    } catch (_) {}
  }

  try {
    const collapsedCard = el.closest("[data-collapsed='true']");
    if (collapsedCard) {
      const trigger = collapsedCard.querySelector("[aria-expanded='false'], .accordion-toggle, .collapse-btn");
      if (trigger && typeof trigger.click === "function") {
        trigger.click();
      }
    }
  } catch (_) {}
}

export function focusAndPulseElement(el, options = {}) {
  if (!el) return;
  const {
    pulseClass = "field-error-pulse",
    pulseDuration = 2400,
    shouldFocus = true,
  } = options;

  const focusable =
    el.matches("input, select, textarea, button, [tabindex]")
      ? el
      : el.querySelector("input, select, textarea, button, [tabindex]");

  if (shouldFocus && focusable && typeof focusable.focus === "function") {
    try {
      focusable.focus({ preventScroll: true });
    } catch (_) {
      try {
        focusable.focus();
      } catch (_) {}
    }
  }

  const targetToPulse = focusable || el;
  targetToPulse.classList.add(pulseClass);

  const cleanup = () => {
    targetToPulse.classList.remove(pulseClass);
    targetToPulse.removeEventListener("input", cleanup);
    targetToPulse.removeEventListener("change", cleanup);
    targetToPulse.removeEventListener("click", cleanup);
  };

  targetToPulse.addEventListener("input", cleanup, { once: true });
  targetToPulse.addEventListener("change", cleanup, { once: true });
  targetToPulse.addEventListener("click", cleanup, { once: true });

  setTimeout(() => {
    targetToPulse.classList.remove(pulseClass);
  }, pulseDuration);
}

function resolveElement(target) {
  if (!target || typeof document === "undefined") return null;

  if (target instanceof HTMLElement) return target;

  if (target && target.current instanceof HTMLElement) return target.current;

  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveElement(item);
      if (resolved) return resolved;
    }
    return null;
  }

  if (typeof target === "string") {
    let el = document.getElementById(target);
    if (el) return el;

    el =
      document.querySelector(`[name="${target}"]`) ||
      document.querySelector(`[data-field="${target}"]`) ||
      document.querySelector(`[data-error-field="${target}"]`);
    if (el) return el;

    try {
      el = document.querySelector(target);
      if (el) return el;
    } catch (_) {}
  }

  return null;
}

export function scrollToFirstError(target, options = {}) {
  if (typeof window === "undefined" || !target) return null;

  const {
    offset = 85,
    delay = 90,
    focus = true,
    onExpand = null,
    pulseClass = "field-error-pulse",
  } = options;

  const performScroll = () => {
    const el = resolveElement(target);
    if (!el) return null;

    expandParentSections(el, onExpand);

    const scrollParent = getScrollParent(el);

    if (scrollParent === window || scrollParent === document.documentElement || scrollParent === document.body) {
      const rect = el.getBoundingClientRect();
      const targetY = rect.top + window.scrollY - offset;
      window.scrollTo({
        top: Math.max(0, targetY),
        behavior: "smooth",
      });
    } else {
      const containerRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top + scrollParent.scrollTop - (offset * 0.6);

      scrollParent.scrollTo({
        top: Math.max(0, relativeTop),
        behavior: "smooth",
      });
    }

    try {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (_) {}

    focusAndPulseElement(el, {
      pulseClass,
      shouldFocus: focus,
    });

    return el;
  };

  if (delay > 0) {
    setTimeout(performScroll, delay);
  } else {
    performScroll();
  }
}
