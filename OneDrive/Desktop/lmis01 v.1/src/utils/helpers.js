// Generic helper functions (no formatting — see formatters.js)
export const uuid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const today = () => new Date().toISOString().split("T")[0];
export const now = () => new Date().toLocaleString();
export const dateOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

/** Get up to 2 uppercase initials from a full name */
export const initials = (name = "") =>
  name.trim().split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

export const classNames = (...args) => args.filter(Boolean).join(" ");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const downloadFile = (filename, content) => {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const sortByDate = (arr, key, asc = false) =>
  [...arr].sort((a, b) => (asc ? (a[key] || "").localeCompare(b[key] || "") : (b[key] || "").localeCompare(a[key] || "")));

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

export const isWaitingForSlaughter = (livestockItem, processingTagSet = new Set()) => {
  if (!livestockItem) return false;

  const tagNumber = String(livestockItem.tag_number || "").trim().toUpperCase();
  if (tagNumber && processingTagSet.size > 0) {
    const ucTagSet = new Set(Array.from(processingTagSet).map((t) => String(t || "").trim().toUpperCase()));
    if (ucTagSet.has(tagNumber)) return false;
  }

  const status = String(livestockItem.status || "").trim();
  const lowerStatus = status.toLowerCase();

  // Downstream or final statuses -> NEVER awaiting slaughter intake
  const nonAwaitingStatuses = [
    "in progress",
    "slaughtering",
    "completed",
    "inspected",
    "post-mortem inspection",
    "post mortem inspection",
    "weighed",
    "weighing",
    "carcass weighed",
    "paid",
    "payment",
    "dispatch",
    "dispatched",
    "released",
    "slaughtered",
    "condemned",
    "rejected",
    "returned to animal marking",
    "returned to marking"
  ];

  if (nonAwaitingStatuses.includes(lowerStatus)) {
    return false;
  }

  const isMarked = Boolean(
    (livestockItem.marked === true ||
      livestockItem.marked === "true" ||
      livestockItem.marked === "t" ||
      livestockItem.marked === 1 ||
      livestockItem.marked === "1" ||
      Boolean(livestockItem.mark_type) ||
      Boolean(livestockItem.mark_date) ||
      Boolean(livestockItem.marked_at)) &&
      livestockItem.marked !== "false" &&
      livestockItem.marked !== false
  );

  // Statuses that explicitly indicate slaughter readiness (post Ante-Mortem approval)
  if ([
    "ready for slaughter",
    "pending slaughter",
    "for slaughter",
    "pending operator reassignment",
  ].includes(lowerStatus)) {
    return true;
  }

  // Marked livestock that have passed Ante-Mortem inspection
  if (isMarked) {
    if (
      [
        "approved",
        "ante-mortem passed",
        "passed"
      ].includes(lowerStatus)
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Checks whether an animal has fully completed the slaughter & inspection workflow:
 * 1. Livestock processing completed
 * 2. Required inspections completed (Ante-Mortem & Post-Mortem)
 * 3. Required meat inspection decision completed (Passed / Approved / Partial Condemnation)
 * 4. Weighing completed (Carcass recorded with weight in TABLES.CARCASS)
 * 5. Not condemned, rejected, or in an incomplete/in-progress stage
 */
export const isLivestockWorkflowCompleted = (
  animal,
  { ante, post, cond, slaughterProc, slaughterRec, carcass } = {}
) => {
  if (!animal) return false;

  const rawStatus = String(animal.status || "").trim().toLowerCase();
  const anteDecision = String(ante?.decision || ante?.result || "").toLowerCase();
  const postDecision = String(post?.decision || post?.result || "").toLowerCase();
  const condType = String(cond?.type || "").toLowerCase();

  // 1. Condemned or Rejected animals NEVER qualify for permits
  const isCondemnedOrRejected =
    rawStatus === "condemned" ||
    rawStatus === "rejected" ||
    anteDecision === "condemned" ||
    anteDecision === "rejected" ||
    postDecision === "condemned" ||
    postDecision === "rejected" ||
    condType.includes("total") ||
    cond?.stage === "Ante-Mortem" ||
    cond?.stage === "Post-Mortem";

  if (isCondemnedOrRejected) return false;

  // 2. Reject incomplete/in-progress statuses explicitly
  const incompleteStatuses = [
    "pending",
    "received",
    "for marking",
    "ready for marking",
    "marked",
    "scheduled",
    "ready for slaughter",
    "in progress",
    "bleeding",
    "evisceration",
    "scalding",
    "dehairing",
    "washing",
    "awaiting inspection",
    "suspect",
  ];
  if (incompleteStatuses.includes(rawStatus)) {
    return false;
  }

  // 3. Livestock slaughter processing completed check
  // If slaughter processing is active/in progress in processing or records table, not completed
  if (slaughterProc?.status === "In Progress" || slaughterRec?.status === "In Progress") {
    return false;
  }

  const isSlaughterDone =
    slaughterProc?.status === "Completed" ||
    slaughterRec?.status === "Completed" ||
    rawStatus === "completed" ||
    rawStatus === "slaughtered" ||
    rawStatus === "weighed" ||
    rawStatus === "ready for dispatch" ||
    rawStatus === "permit issued" ||
    rawStatus === "released" ||
    rawStatus === "dispatched";

  if (!isSlaughterDone) return false;

  // 4. Required Ante-Mortem inspection completed:
  // If ante record exists, must be approved/passed (not suspect or pending)
  if (ante) {
    const isAnteApproved =
      anteDecision.includes("approv") ||
      anteDecision.includes("pass") ||
      ante.status === "Completed" ||
      ante.status === "Approved" ||
      ante.status === "Passed";
    if (!isAnteApproved) return false;
  }

  // 5. Required Post-Mortem inspection & Meat Inspection decision completed:
  // Post-Mortem record must exist and have a valid passing / approved decision
  if (!post) {
    if (rawStatus !== "released" && rawStatus !== "dispatched") {
      return false;
    }
  }

  if (post) {
    const isPartialCondemned =
      condType.includes("partial") ||
      postDecision.includes("partial") ||
      String(post.findings || "").toLowerCase().includes("partial");

    const isPostApproved =
      postDecision.includes("approv") ||
      postDecision.includes("pass") ||
      post.status === "Completed" ||
      post.status === "Approved" ||
      post.status === "Passed" ||
      isPartialCondemned;

    if (!isPostApproved) return false;
  }

  // 6. Weighing completed:
  // Carcass record must exist in TABLES.CARCASS with positive weight
  const carcassWeight = parseFloat(carcass?.total_weight || carcass?.cold_weight || 0);
  const isCarcassWeighed =
    Boolean(carcass) &&
    (carcassWeight > 0 ||
      carcass.status === "Completed" ||
      carcass.status === "Weighed" ||
      rawStatus === "weighed" ||
      rawStatus === "ready for dispatch" ||
      rawStatus === "permit issued" ||
      rawStatus === "released" ||
      rawStatus === "dispatched");

  if (!isCarcassWeighed) return false;

  return true;
};

export const isStepDone = (steps, stepKey) => {
  if (!steps) return false;
  const val = steps[stepKey];
  if (typeof val === "boolean") return val;
  if (val && typeof val === "object") return Boolean(val.done);
  return Boolean(val);
};

export const getStepTimestamp = (steps, stepKey) => {
  if (!steps) return null;
  const val = steps[stepKey];
  if (val && typeof val === "object" && val.completed_at) return val.completed_at;
  return null;
};

export const getStepUser = (steps, stepKey) => {
  if (!steps) return null;
  const val = steps[stepKey];
  if (val && typeof val === "object") {
    return val.completed_by || (val.completed_at ? "Jenel Selgas" : null);
  }
  if (val === true) return "Jenel Selgas";
  return null;
};

// Re-exports for backward compatibility (canonical home is formatters.js)
export { formatCurrency, formatDate, formatDateTime, formatPhDateTime, formatCertDateTime, formatPhDate, formatPhTime, formatLongDate, formatFullDate, formatNumber, formatTime, truncate, formatSex } from "./formatters.js";

