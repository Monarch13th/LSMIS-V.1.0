/**
 * passwordValidation.js
 * Comprehensive 5-rule password security validation for LSMIS.
 */

export const PASSWORD_RULES = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (pw) => (pw ? pw.length >= 8 : false)
  },
  {
    id: "uppercase",
    label: "Uppercase letter (A-Z)",
    test: (pw) => /[A-Z]/.test(pw || "")
  },
  {
    id: "lowercase",
    label: "Lowercase letter (a-z)",
    test: (pw) => /[a-z]/.test(pw || "")
  },
  {
    id: "number",
    label: "Number (0-9)",
    test: (pw) => /[0-9]/.test(pw || "")
  },
  {
    id: "special",
    label: "Special character (!@#$%...)",
    test: (pw) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw || "")
  }
];

/**
 * Validates a password against all 5 rules.
 * @param {string} password 
 * @returns {{ isValid: boolean, rules: Array<{ id: string, label: string, satisfied: boolean }>, missingCount: number }}
 */
export const validatePassword = (password) => {
  const pw = password || "";
  const rules = PASSWORD_RULES.map((r) => ({
    id: r.id,
    label: r.label,
    satisfied: r.test(pw)
  }));

  const missingCount = rules.filter((r) => !r.satisfied).length;
  const isValid = missingCount === 0;

  return {
    isValid,
    rules,
    missingCount
  };
};

/**
 * Returns a user-friendly error message if the password fails any requirement.
 * @param {string} password 
 * @returns {string|null} Error string or null if valid
 */
export const getPasswordValidationError = (password) => {
  const result = validatePassword(password);
  if (result.isValid) return null;

  const missing = result.rules.filter((r) => !r.satisfied).map((r) => r.label);
  if (missing.length === 1) {
    return `Password requires: ${missing[0]}`;
  }
  return `Password must satisfy all security rules (${result.missingCount} requirement${result.missingCount > 1 ? "s" : ""} missing).`;
};
