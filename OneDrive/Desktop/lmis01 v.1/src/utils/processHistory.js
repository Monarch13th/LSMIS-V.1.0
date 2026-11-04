import { authService } from "../services/authService";
import { formatPhDateTime } from "./helpers";

/**
 * Returns the currently authenticated user's identity from session storage
 * with safe fallbacks according to active role.
 */
export const getCurrentActor = () => {
  const session = authService.getSession();
  const role = session?.role || "staff";
  let fallbackName = "Jenel Selgas";
  if (role === "vet") fallbackName = "Dr. Dave";
  else if (role === "admin") fallbackName = "System Administrator";

  const name = session?.name || session?.full_name || fallbackName;
  const id = session?.user_id || session?.id || session?.user?.id || null;
  const email = session?.email || null;

  return { id, name, role, email };
};

/**
 * Normalizes any history representation (JSON array, stringified JSON, or null)
 * into a valid JavaScript Array.
 */
export const parseHistory = (history) => {
  if (Array.isArray(history)) return [...history];
  if (typeof history === "string") {
    try {
      const parsed = JSON.parse(history);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return [];
};

/**
 * Appends a new chronological process event to an existing process history array.
 * Preserves all earlier history immutably.
 */
export const appendProcessEvent = (existingHistory, { stage, action, details = {}, actor = null }) => {
  const history = parseHistory(existingHistory);
  const currentActor = actor || getCurrentActor();

  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    stage: stage || "General",
    action: action || "Updated",
    user_name: currentActor.name || "Jenel Selgas",
    user_id: currentActor.id || null,
    role: currentActor.role || "staff",
    timestamp: new Date().toISOString(),
    details: details || {},
  };

  return [...history, event];
};

/**
 * Returns a display-safe attribution name.
 * Falls back to "Jenel Selgas" for historical staff records that lack creator or processor information,
 * while preserving actual authenticated user names.
 */
export const getAttributionName = (userName, fallback = "Jenel Selgas") => {
  if (!userName || userName === "Unknown" || userName === "N/A" || userName === "Not recorded" || userName === "Unassigned" || userName === "Staff") {
    return fallback;
  }
  return userName;
};

/**
 * Formats a user attribution string for UI display.
 * Returns default "Jenel Selgas" for legacy/empty records where user was not recorded.
 */
export const formatAttribution = (userName, timestamp = null, fallback = "Jenel Selgas") => {
  const resolvedName = getAttributionName(userName, fallback);
  if (!timestamp) return resolvedName;
  return `${resolvedName} (${formatPhDateTime(timestamp)})`;
};

/**
 * Stage labels and icons definition for display across portals.
 */
export const PROCESS_STAGES = [
  { key: "registration", label: "Livestock Registration", userField: "registered_by", timeField: "registered_at" },
  { key: "receiving", label: "Receiving Records", userField: "received_by", timeField: "received_at" },
  { key: "marking", label: "Animal Marking", userField: "marked_by", timeField: "marked_at" },
  { key: "ante_mortem", label: "Ante-Mortem Inspection", userField: "ante_inspected_by", timeField: "ante_inspected_at" },
  { key: "slaughter", label: "Slaughter Processing", userField: "slaughtered_by", timeField: "slaughtered_at" },
  { key: "post_mortem", label: "Post-Mortem Inspection", userField: "post_inspected_by", timeField: "post_inspected_at" },
  { key: "weighing", label: "Carcass Weighing & Branding", userField: "weighed_by", timeField: "weighed_at" },
  { key: "payment", label: "Payment Processing", userField: "paid_by_staff", timeField: "paid_at" },
  { key: "permit", label: "Permit Issuance", userField: "permit_issued_by", timeField: "permit_issued_at" },
  { key: "dispatch", label: "Meat Dispatch", userField: "dispatched_by", timeField: "dispatched_at" },
];
