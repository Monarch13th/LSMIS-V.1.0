/**
 * phoneValidation.js
 * Authoritative Philippine mobile number validation for LSMIS.
 *
 * Requirements:
 * - Networks: TM, TNT, Smart, Globe
 * - Starts with '09'
 * - Digits only (no spaces, letters, or symbols)
 * - Exactly 11 digits (e.g. 09171234567)
 */

// Official Globe and Touch Mobile (TM) 4-digit prefixes
export const GLOBE_TM_PREFIXES = new Set([
  "0905", "0906", "0915", "0916", "0917", "0926", "0927", "0935", "0936", "0937",
  "0945", "0953", "0954", "0955", "0956", "0965", "0966", "0967", "0975", "0976",
  "0977", "0978", "0979", "0995", "0996", "0997"
]);

// Official Smart, Talk 'N Text (TNT), and Sun Cellular 4-digit prefixes
export const SMART_TNT_PREFIXES = new Set([
  "0907", "0908", "0909", "0910", "0911", "0912", "0913", "0914", "0918", "0919",
  "0920", "0921", "0922", "0923", "0924", "0925", "0928", "0929", "0930", "0931",
  "0932", "0933", "0934", "0938", "0939", "0940", "0941", "0942", "0943", "0946",
  "0947", "0948", "0949", "0950", "0951", "0961", "0963", "0968", "0969", "0970",
  "0971", "0981", "0982", "0985", "0989", "0998", "0999"
]);

/**
 * Returns the network name for a given contact prefix, or null if unrecognized
 * @param {string} contact
 * @returns {"Globe / TM" | "Smart / TNT" | null}
 */
export const getPhilippineMobileNetwork = (contact) => {
  if (!contact || typeof contact !== "string") return null;
  const digits = contact.replace(/\D/g, "");
  if (digits.length < 4) return null;
  const prefix = digits.slice(0, 4);
  if (GLOBE_TM_PREFIXES.has(prefix)) return "Globe / TM";
  if (SMART_TNT_PREFIXES.has(prefix)) return "Smart / TNT";
  return null;
};

/**
 * Validates a Philippine mobile number strictly:
 * - Must contain only digits
 * - Must start with '09'
 * - Must be exactly 11 digits
 * - Must belong to TM, TNT, Smart, or Globe networks
 *
 * @param {string} contact
 * @returns {{ isValid: boolean, error: string | null, network: string | null, digits: string }}
 */
export const validatePhilippineMobileNumber = (contact) => {
  if (!contact || typeof contact !== "string" || !contact.trim()) {
    return {
      isValid: false,
      error: "Contact number is required.",
      network: null,
      digits: "",
    };
  }

  const trimmed = contact.trim();

  // 1. Check for letters, spaces, or special characters
  if (/\D/.test(trimmed)) {
    return {
      isValid: false,
      error: "Contact number must contain digits only. Letters, spaces, and special characters are not allowed.",
      network: null,
      digits: trimmed.replace(/\D/g, ""),
    };
  }

  // 2. Must start with '09'
  if (!trimmed.startsWith("09")) {
    return {
      isValid: false,
      error: "Contact number must start with '09' (e.g. 09171234567).",
      network: null,
      digits: trimmed,
    };
  }

  // 3. Must be exactly 11 digits
  if (trimmed.length !== 11) {
    return {
      isValid: false,
      error: `Contact number must be exactly 11 digits (currently ${trimmed.length} digits).`,
      network: null,
      digits: trimmed,
    };
  }

  // 4. Must belong to Globe, TM, Smart, or TNT
  const prefix = trimmed.slice(0, 4);
  const isGlobeTM = GLOBE_TM_PREFIXES.has(prefix);
  const isSmartTNT = SMART_TNT_PREFIXES.has(prefix);

  if (!isGlobeTM && !isSmartTNT) {
    return {
      isValid: false,
      error: `The prefix '${prefix}' is not a recognized Globe, TM, Smart, or TNT mobile prefix. Only Philippine mobile numbers from these networks are accepted.`,
      network: null,
      digits: trimmed,
    };
  }

  return {
    isValid: true,
    error: null,
    network: isGlobeTM ? "Globe / TM" : "Smart / TNT",
    digits: trimmed,
  };
};

/**
 * Sanitizes input in real-time to allow ONLY digits and maximum 11 characters
 * @param {string} val
 * @returns {string}
 */
export const sanitizePhilippineMobileInput = (val) => {
  if (!val) return "";
  // Strip all non-digits immediately
  const digits = String(val).replace(/\D/g, "");
  // Cap at 11 characters
  return digits.slice(0, 11);
};

