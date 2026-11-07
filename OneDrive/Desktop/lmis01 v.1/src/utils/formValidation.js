/**
 * LSMIS Form Validation & Navigation Utilities
 * 
 * Provides unified, accessible auto-scrolling, field highlighting,
 * and error guidance across all LSMIS modules and forms.
 */

/**
 * Finds the nearest scrollable ancestor for a given DOM node.
 * Correctly identifies scrollable modal bodies, drawers, or the window.
 */
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

/**
 * Automatically expands any collapsed parent containers (<details>, accordions, collapsed tabs)
 * that may be hiding the target field.
 */
function expandParentSections(el, onExpand) {
  if (!el || typeof el.closest !== "function") return;

  // 1. Native HTML5 <details>
  let details = el.closest("details");
  while (details) {
    if (!details.open) {
      details.open = true;
    }
    details = details.parentElement ? details.parentElement.closest("details") : null;
  }

  // 2. Custom onExpand callback
  if (typeof onExpand === "function") {
    try {
      onExpand(el);
    } catch (_) {}
  }

  // 3. Aria-expanded collapsed triggers
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

/**
 * Highlights a field with a prominent pulse effect and cleans it up on user interaction.
 */
export function focusAndPulseElement(el, options = {}) {
  if (!el) return;
  const {
    pulseClass = "field-error-pulse",
    pulseDuration = 2400,
    shouldFocus = true,
  } = options;

  // Find inner focusable element if wrapper was passed
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

  // Auto-remove pulse on typing or click
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

/**
 * Resolves a target parameter into a concrete DOM element.
 * Supports: Element, RefObject, string ID, selector, or array of candidates.
 */
function resolveElement(target) {
  if (!target || typeof document === "undefined") return null;

  // 1. Direct DOM Element
  if (target instanceof HTMLElement) return target;

  // 2. React RefObject
  if (target && target.current instanceof HTMLElement) return target.current;

  // 3. Array of potential field IDs/selectors in form order
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveElement(item);
      if (resolved) return resolved;
    }
    return null;
  }

  // 4. String identifier
  if (typeof target === "string") {
    // Try getElementById first (fastest and most specific)
    let el = document.getElementById(target);
    if (el) return el;

    // Try name or data-field attributes
    el =
      document.querySelector(`[name="${target}"]`) ||
      document.querySelector(`[data-field="${target}"]`) ||
      document.querySelector(`[data-error-field="${target}"]`);
    if (el) return el;

    // Try querySelector if valid selector
    try {
      el = document.querySelector(target);
      if (el) return el;
    } catch (_) {}
  }

  return null;
}

/**
 * Scrolls to the first invalid field, accounting for sticky navigation,
 * modal dialog headers, and mobile viewport keyboards.
 *
 * @param {string|HTMLElement|React.RefObject|Array} target - Target field or list of fields
 * @param {Object} [options]
 * @param {number} [options.offset=85] - Top offset in px to preserve sticky header clearance
 * @param {number} [options.delay=90] - Delay in ms before scrolling (allows React re-render)
 * @param {boolean} [options.focus=true] - Whether to focus the field
 * @param {Function} [options.onExpand] - Custom expand callback for accordions
 * @param {string} [options.pulseClass="field-error-pulse"] - Class for pulse animation
 * @returns {HTMLElement|null} The resolved element that was scrolled to
 */
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

    // 1. Auto-expand any collapsed sections enclosing the element
    expandParentSections(el, onExpand);

    // 2. Compute scroll position with sticky header clearance
    const scrollParent = getScrollParent(el);

    if (scrollParent === window || scrollParent === document.documentElement || scrollParent === document.body) {
      const rect = el.getBoundingClientRect();
      const targetY = rect.top + window.scrollY - offset;
      window.scrollTo({
        top: Math.max(0, targetY),
        behavior: "smooth",
      });
    } else {
      // Inside a scrollable modal body or container
      const containerRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top + scrollParent.scrollTop - (offset * 0.6);

      scrollParent.scrollTo({
        top: Math.max(0, relativeTop),
        behavior: "smooth",
      });
    }

    // Secondary smooth center alignment for mobile webviews & PWAs
    try {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (_) {}

    // 3. Highlight with red pulse and focus
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
