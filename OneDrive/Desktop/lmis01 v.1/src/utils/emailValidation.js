export const EMAIL_COM_ERROR = "Please enter a valid email address";

const COM_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.com$/i;

export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const isValidComEmail = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return COM_EMAIL_REGEX.test(trimmed);
};

export const validateComEmail = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "Email Address is required.";
  if (!COM_EMAIL_REGEX.test(trimmed)) return EMAIL_COM_ERROR;
  return "";
};
