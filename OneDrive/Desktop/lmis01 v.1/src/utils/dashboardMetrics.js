// Dashboard-only metric helpers. Pure functions: no network, no side effects.
// Used by the Administrator, Veterinary and Staff dashboards so every number
// on screen is derived from real records instead of hard-coded placeholders.

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

export const isSameDay = (a, b) => !!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime();
export const isSameMonth = (a, b) =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** First usable date among the given candidate fields of a record. */
export const pickDate = (row, fields) => {
  for (const f of fields) {
    const d = toDate(row?.[f]);
    if (d) return d;
  }
  return null;
};

export const PAYMENT_DATE_FIELDS = ["paid_at", "date", "created_at"];
export const INSPECTION_DATE_FIELDS = ["inspected_at", "date", "created_at"];
export const LIVESTOCK_DATE_FIELDS = ["registered_at", "created_at", "received_date"];

/** A payment counts as collected revenue only when it is settled. */
export const isPaidPayment = (p) => {
  const s = String(p?.status || "Paid").toLowerCase();
  return s === "paid" || s === "completed" || s === "settled";
};

export const sumPaid = (payments) =>
  (payments || []).filter(isPaidPayment).reduce((s, p) => s + num(p.amount), 0);

/** Revenue (or any value) grouped by calendar month for the last `n` months. */
export const monthlySeries = (rows, dateFields, valueOf = () => 1, n = 6) => {
  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()], value: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  (rows || []).forEach((r) => {
    const d = pickDate(r, dateFields);
    if (!d) return;
    const i = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) buckets[i].value += valueOf(r);
  });
  return { labels: buckets.map((b) => b.label), values: buckets.map((b) => b.value) };
};

/** Count (or sum) grouped by day for the last `n` days, oldest first. */
export const dailySeries = (rows, dateFields, valueOf = () => 1, n = 7) => {
  const today = startOfDay();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    buckets.push({ time: d.getTime(), label: DAYS[d.getDay()], value: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.time, i]));
  (rows || []).forEach((r) => {
    const d = pickDate(r, dateFields);
    if (!d) return;
    const i = index.get(startOfDay(d).getTime());
    if (i !== undefined) buckets[i].value += valueOf(r);
  });
  return { labels: buckets.map((b) => b.label), values: buckets.map((b) => b.value) };
};

/** "+12%" style delta text. Returns null when there is nothing to compare. */
export const deltaText = (current, previous, suffix = "vs last month") => {
  if (!previous) return current > 0 ? `New this period` : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% ${suffix}`;
};

const norm = (v) => String(v || "").trim().toLowerCase();

/** Normalises the many decision labels used across ante/post-mortem records. */
export const decisionBucket = (decision) => {
  const d = norm(decision);
  if (!d) return "pending";
  if (d.includes("partial")) return "partial";
  if (d.includes("condemn")) return "condemned";
  if (d.includes("reject")) return "rejected";
  if (d.includes("approv") || d.includes("pass")) return "approved";
  if (d.includes("pend") || d.includes("await")) return "pending";
  return "pending";
};

export const countDecisions = (rows) => {
  const out = { approved: 0, partial: 0, rejected: 0, condemned: 0, pending: 0 };
  (rows || []).forEach((r) => {
    out[decisionBucket(r.decision)] += 1;
  });
  return out;
};

const truthy = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "t";

/** Where a livestock record currently sits in the slaughterhouse workflow. */
export const livestockStage = (l) => {
  const s = norm(l?.status);
  if (s.includes("condemn") || s.includes("reject")) return "condemned";
  if (s === "released" || s === "dispatched" || s.includes("dispatch") || l?.dispatched_at || l?.released_at) return "dispatched";
  if (s === "completed" || s.includes("slaughter completed") || s === "slaughtered" || s === "weighed" || s === "paid") return "slaughtered";
  if (s.includes("slaughtering") || s === "in progress") return "slaughtering";
  if (truthy(l?.marked) || s === "marked" || s.includes("ready for slaughter")) return "marked";
  return "awaiting";
};

export const STAGE_LABELS = {
  awaiting: "Awaiting Inspection / Marking",
  marked: "Marked & Ready",
  slaughtering: "On Slaughter Line",
  slaughtered: "Processed",
  dispatched: "Dispatched",
  condemned: "Condemned / Rejected",
};

export const countStages = (livestock) => {
  const out = { awaiting: 0, marked: 0, slaughtering: 0, slaughtered: 0, dispatched: 0, condemned: 0 };
  (livestock || []).forEach((l) => {
    out[livestockStage(l)] += 1;
  });
  return out;
};

/** Best-effort sort key (ms) for "most recent first" lists. */
export const recency = (row, fields) => pickDate(row, fields)?.getTime() || 0;

/**
 * Computes inspection counts across the 4 primary categories for Admin Dashboard:
 * - Ante-Mortem
 * - Post-Mortem
 * - Condemnation
 * - Partially Condemned
 */
export const calculateInspectionCategoryCounts = ({
  ante = [],
  post = [],
  livestock = [],
  condemned = [],
} = {}) => {
  const normTag = (v) => String(v == null ? "" : v).trim().toLowerCase();

  // 1. Antemortem count
  const anteList = (ante || []).map((a) => normTag(a.tag_number));
  (livestock || [])
    .filter((l) => l.status === "Condemned" || l.status === "Rejected")
    .forEach((l) => {
      const tag = normTag(l.tag_number);
      if (tag && !anteList.includes(tag)) anteList.push(tag);
    });
  const antemortem = Math.max((ante || []).length, anteList.length);

  // Condemned/Partial tags for wholesome separation
  const condOrPartTags = new Set((condemned || []).map((c) => normTag(c.tag_number)).filter(Boolean));

  // 2. Postmortem wholesome count
  const pmList = [];
  (post || []).forEach((p) => {
    const cleanTag = normTag(p.tag_number);
    if (!cleanTag) return;
    const animal = (livestock || []).find((l) => normTag(l.tag_number) === cleanTag);
    const d = String(p.decision || "").toLowerCase();
    const isWhole =
      d === "condemned" ||
      d === "rejected" ||
      d === "whole carcass condemned" ||
      animal?.status === "Condemned";
    const isPartial =
      !isWhole &&
      (d.includes("partial") ||
        (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0) ||
        condOrPartTags.has(cleanTag));
    if (!isWhole && !isPartial) pmList.push(cleanTag);
  });
  (livestock || [])
    .filter((l) => (l.status === "Released" || l.status === "Approved") && !condOrPartTags.has(normTag(l.tag_number)))
    .forEach((l) => {
      const cleanTag = normTag(l.tag_number);
      if (cleanTag && !pmList.includes(cleanTag)) pmList.push(cleanTag);
    });
  const postmortem = pmList.length > 0 ? pmList.length : (post || []).filter((p) => {
    const d = String(p.decision || "").toLowerCase();
    return !d.includes("condemn") && !d.includes("reject") && !d.includes("partial");
  }).length;

  // 3. Partially Condemned count
  const pmCond = (condemned || []).filter((c) => {
    const isLive = c.part === "Live Animal" || (c.notes && c.notes.toLowerCase().includes("ante")) || c.stage === "Ante-Mortem";
    return !isLive;
  });
  const partialCuts = pmCond.filter((c) => c.part !== "Whole Carcass" && c.part !== "Entire Carcass");
  const partialMap = new Set();
  partialCuts.forEach((c) => {
    const cleanTag = normTag(c.tag_number);
    if (cleanTag) partialMap.add(cleanTag);
  });
  (post || []).forEach((p) => {
    const d = String(p.decision || "").toLowerCase();
    const hasParts = Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0;
    if (d.includes("partial") || hasParts) {
      const cleanTag = normTag(p.tag_number);
      if (cleanTag) partialMap.add(cleanTag);
    }
  });
  const partial = partialMap.size > 0 ? partialMap.size : (post || []).filter((p) => String(p.decision || "").toLowerCase().includes("partial")).length;

  // 4. Condemnation count
  const condList = [];
  (ante || []).filter((a) => a.decision === "Rejected" || a.decision === "Condemned").forEach((a) => {
    condList.push({ tag: normTag(a.tag_number), stage: "Ante-Mortem Screening" });
  });
  (post || []).filter((p) => p.decision === "Rejected" || p.decision === "Condemned" || (p.decision && p.decision.toLowerCase().includes("partial"))).forEach((p) => {
    condList.push({ tag: normTag(p.tag_number), stage: "Post-Mortem Carcass Check" });
  });
  (condemned || []).forEach((c) => {
    const cleanTag = normTag(c.tag_number);
    const isAnte = c.part === "Live Animal" || (c.notes && c.notes.toLowerCase().includes("ante")) || c.stage === "Ante-Mortem";
    const stageName = isAnte ? "Ante-Mortem Screening" : "Post-Mortem Carcass Check";
    if (!condList.some((item) => item.tag === cleanTag && item.stage === stageName)) {
      condList.push({ tag: cleanTag, stage: stageName });
    }
  });
  (livestock || [])
    .filter((l) => l.status === "Condemned" || l.status === "Rejected")
    .forEach((l) => {
      const cleanTag = normTag(l.tag_number);
      if (!condList.some((item) => item.tag === cleanTag)) {
        condList.push({ tag: cleanTag, stage: "Livestock Condemned" });
      }
    });
  const condemnation = condList.length > 0 ? condList.length : (
    (ante || []).filter((a) => String(a.decision || "").toLowerCase().includes("condemn") || String(a.decision || "").toLowerCase().includes("reject")).length +
    (post || []).filter((p) => String(p.decision || "").toLowerCase().includes("condemn") || String(p.decision || "").toLowerCase().includes("reject")).length
  );

  return { antemortem, postmortem, partial, condemnation };
};
