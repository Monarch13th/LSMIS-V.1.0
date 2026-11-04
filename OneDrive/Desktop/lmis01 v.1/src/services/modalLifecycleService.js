import { supabase } from "./supabaseClient";
import { TABLES } from "../utils/constants";

const safeParseSteps = (steps) => {
  if (!steps) return {};
  if (typeof steps === "string") {
    try {
      return JSON.parse(steps);
    } catch (_) {
      return {};
    }
  }
  return steps;
};

/**
 * Re-queries Supabase directly to get remaining live animals for a specific owner
 * that still require Ante-Mortem Inspection.
 * Returns Array of remaining records on confirmed success, or null if query errored.
 */
export const getRemainingAnteMortemForOwner = async (ownerName) => {
  if (!ownerName || typeof ownerName !== "string") return [];
  const cleanOwner = ownerName.trim();
  if (!cleanOwner) return [];

  try {
    const [liveRes, anteRes, postRes] = await Promise.all([
      supabase.from(TABLES.LIVESTOCK).select("*").ilike("owner_name", cleanOwner),
      supabase.from(TABLES.ANTE_MORTEM).select("tag_number, livestock_id"),
      supabase.from(TABLES.POST_MORTEM).select("tag_number, livestock_id"),
    ]);

    if (liveRes.error) throw liveRes.error;

    const anteTags = new Set(
      (anteRes.data || []).map((a) => String(a.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const anteIds = new Set(
      (anteRes.data || []).map((a) => String(a.livestock_id || "").trim()).filter(Boolean)
    );
    const postTags = new Set(
      (postRes.data || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const postIds = new Set(
      (postRes.data || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)
    );

    const TERMINAL_STATUSES = new Set([
      "approved", "passed", "ante-mortem passed", "condemned", "rejected",
      "ready for slaughter", "pending slaughter", "for slaughter", "slaughtering", "slaughtered",
      "in progress", "post-mortem inspection", "post mortem inspection",
      "carcass weighed", "weighing", "weighed", "payment", "paid",
      "dispatch", "dispatched", "ready for dispatch", "permit issued", "released", "completed"
    ]);

    const remaining = (liveRes.data || []).filter((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (!tag) return false;
      const s = String(l.status || "").trim().toLowerCase();

      // Animals awaiting marking or returned to marking must not qualify for Ante-Mortem
      if (
        s === "pending marking" ||
        s === "for marking" ||
        s === "ready for marking" ||
        s === "received" ||
        s === "returned to animal marking" ||
        s === "returned to marking" ||
        Boolean(l.fallback_at)
      ) return false;

      if (TERMINAL_STATUSES.has(s) || s.includes("condemn") || s.includes("reject")) return false;
      if (l.id && (anteIds.has(String(l.id).trim()) || postIds.has(String(l.id).trim()))) return false;
      if (anteTags.has(tag) || postTags.has(tag)) return false;

      // Animal MUST be marked to await Ante-Mortem inspection
      const isMarked = Boolean(
        (l.marked === true || l.marked === "true" || l.marked === 1 || l.marked === "1" || l.marked === "t") &&
        l.marked !== "false" &&
        l.marked !== false &&
        (Boolean(l.mark_type) || Boolean(l.mark_date) || Boolean(l.marked_at) || s === "marked")
      );
      if (!isMarked) return false;
      return true;
    });

    return remaining.sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  } catch (err) {
    console.error("Error in getRemainingAnteMortemForOwner:", err);
    return null;
  }
};

/**
 * Re-queries Supabase directly to get remaining carcasses for a specific owner
 * that still require Post-Mortem Inspection.
 * Returns Array of remaining records on confirmed success, or null if query errored.
 */
export const getRemainingPostMortemForOwner = async (ownerName) => {
  if (!ownerName || typeof ownerName !== "string") return [];
  const cleanOwner = ownerName.trim();
  if (!cleanOwner) return [];

  try {
    const [procRes, slRes, liveRes, postRes] = await Promise.all([
      supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*").ilike("owner_name", cleanOwner),
      supabase.from(TABLES.SLAUGHTER_RECORDS).select("*").ilike("owner_name", cleanOwner),
      supabase.from(TABLES.LIVESTOCK).select("*").ilike("owner_name", cleanOwner),
      supabase.from(TABLES.POST_MORTEM).select("tag_number, livestock_id"),
    ]);

    if (procRes.error && slRes.error && liveRes.error) {
      throw procRes.error || slRes.error || liveRes.error;
    }

    const inspectedTags = new Set(
      (postRes.data || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const inspectedIds = new Set(
      (postRes.data || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)
    );

    const livestockMap = new Map();
    (liveRes.data || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (tag) livestockMap.set(tag, l);
    });

    const candidateMap = new Map();

    // 1. From slaughter_processing
    (procRes.data || []).forEach((p) => {
      const tag = String(p.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || inspectedTags.has(cleanTag)) return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedIds.has(String(l.id).trim())) return;

      const stepsObj = safeParseSteps(p.steps);
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      const isCompleted = p.status === "Completed" || doneCount >= 6;
      if (isCompleted) {
        candidateMap.set(cleanTag, {
          ...(l || {}),
          ...p,
          tag_number: tag,
          owner_name: p.owner_name || l?.owner_name || cleanOwner,
          status: "Slaughter Completed"
        });
      }
    });

    // 2. From slaughter_records
    (slRes.data || []).forEach((s) => {
      const tag = String(s.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || candidateMap.has(cleanTag) || inspectedTags.has(cleanTag)) return;
      if (s.status !== "Completed") return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedIds.has(String(l.id).trim())) return;

      candidateMap.set(cleanTag, {
        ...(l || {}),
        ...s,
        tag_number: tag,
        owner_name: s.owner_name || l?.owner_name || cleanOwner,
        status: "Slaughter Completed"
      });
    });

    // 3. From livestock
    (liveRes.data || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || inspectedTags.has(cleanTag)) return;
      if (l.id && inspectedIds.has(String(l.id).trim())) return;
      if (l.status === "Condemned" || l.status === "Rejected") return;

      const st = String(l.status || "").toLowerCase();
      if ((st === "completed" || st === "slaughtered") && !candidateMap.has(cleanTag)) {
        candidateMap.set(cleanTag, { ...l, tag_number: tag, status: "Slaughter Completed" });
      }
    });

    return Array.from(candidateMap.values()).sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  } catch (err) {
    console.error("Error in getRemainingPostMortemForOwner:", err);
    return null;
  }
};

/**
 * Re-queries Supabase directly to get all remaining live animals across ALL owners
 * that still require Ante-Mortem Inspection.
 * Returns Array of remaining records on confirmed success, or null if query errored.
 */
export const getAllRemainingAnteMortem = async () => {
  try {
    const [liveRes, anteRes, postRes] = await Promise.all([
      supabase.from(TABLES.LIVESTOCK).select("*"),
      supabase.from(TABLES.ANTE_MORTEM).select("tag_number, livestock_id"),
      supabase.from(TABLES.POST_MORTEM).select("tag_number, livestock_id"),
    ]);

    if (liveRes.error) throw liveRes.error;

    const anteTags = new Set(
      (anteRes.data || []).map((a) => String(a.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const anteIds = new Set(
      (anteRes.data || []).map((a) => String(a.livestock_id || "").trim()).filter(Boolean)
    );
    const postTags = new Set(
      (postRes.data || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const postIds = new Set(
      (postRes.data || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)
    );

    const TERMINAL_STATUSES = new Set([
      "approved", "passed", "ante-mortem passed", "condemned", "rejected",
      "ready for slaughter", "pending slaughter", "for slaughter", "slaughtering", "slaughtered",
      "in progress", "post-mortem inspection", "post mortem inspection",
      "carcass weighed", "weighing", "weighed", "payment", "paid",
      "dispatch", "dispatched", "ready for dispatch", "permit issued", "released", "completed"
    ]);

    const remaining = (liveRes.data || []).filter((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (!tag) return false;
      const s = String(l.status || "").trim().toLowerCase();

      // Animals awaiting marking or returned to marking must not qualify for Ante-Mortem
      if (
        s === "pending marking" ||
        s === "for marking" ||
        s === "ready for marking" ||
        s === "received" ||
        s === "returned to animal marking" ||
        s === "returned to marking" ||
        Boolean(l.fallback_at)
      ) return false;

      if (TERMINAL_STATUSES.has(s) || s.includes("condemn") || s.includes("reject")) return false;
      if (l.id && (anteIds.has(String(l.id).trim()) || postIds.has(String(l.id).trim()))) return false;
      if (anteTags.has(tag) || postTags.has(tag)) return false;

      // Animal MUST be marked to await Ante-Mortem inspection
      const isMarked = Boolean(
        (l.marked === true || l.marked === "true" || l.marked === 1 || l.marked === "1" || l.marked === "t") &&
        l.marked !== "false" &&
        l.marked !== false &&
        (Boolean(l.mark_type) || Boolean(l.mark_date) || Boolean(l.marked_at) || s === "marked")
      );
      if (!isMarked) return false;
      return true;
    });

    return remaining.sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  } catch (err) {
    console.error("Error in getAllRemainingAnteMortem:", err);
    return null;
  }
};

/**
 * Re-queries Supabase directly to get all remaining carcasses across ALL owners
 * that still require Post-Mortem Inspection.
 * Returns Array of remaining records on confirmed success, or null if query errored.
 */
export const getAllRemainingPostMortem = async () => {
  try {
    const [procRes, slRes, liveRes, postRes] = await Promise.all([
      supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*"),
      supabase.from(TABLES.SLAUGHTER_RECORDS).select("*"),
      supabase.from(TABLES.LIVESTOCK).select("*"),
      supabase.from(TABLES.POST_MORTEM).select("tag_number, livestock_id"),
    ]);

    if (procRes.error && slRes.error && liveRes.error) {
      throw procRes.error || slRes.error || liveRes.error;
    }

    const inspectedTags = new Set(
      (postRes.data || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const inspectedIds = new Set(
      (postRes.data || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)
    );

    const candidateMap = new Map();

    const livestockMap = new Map();
    (liveRes.data || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (tag) livestockMap.set(tag, l);
    });

    // 1. From slaughter_processing
    (procRes.data || []).forEach((p) => {
      const tag = String(p.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || inspectedTags.has(cleanTag)) return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedIds.has(String(l.id).trim())) return;

      const stepsObj = safeParseSteps(p.steps);
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      const isCompleted = p.status === "Completed" || doneCount >= 6;
      if (isCompleted) {
        candidateMap.set(cleanTag, {
          ...(l || {}),
          ...p,
          tag_number: tag,
          owner_name: p.owner_name || l?.owner_name || "Unknown Owner",
          status: "Slaughter Completed",
        });
      }
    });

    // 2. From slaughter_records
    (slRes.data || []).forEach((s) => {
      const tag = String(s.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || candidateMap.has(cleanTag) || inspectedTags.has(cleanTag)) return;
      if (s.status !== "Completed") return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedIds.has(String(l.id).trim())) return;

      candidateMap.set(cleanTag, {
        ...(l || {}),
        ...s,
        tag_number: tag,
        owner_name: s.owner_name || l?.owner_name || "Unknown Owner",
        status: "Slaughter Completed",
      });
    });

    // 3. From livestock
    (liveRes.data || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || candidateMap.has(cleanTag) || inspectedTags.has(cleanTag)) return;
      if (l.id && inspectedIds.has(String(l.id).trim())) return;
      if (l.status === "Condemned" || l.status === "Rejected") return;

      const st = String(l.status || "").toLowerCase();
      if (st === "completed" || st === "slaughtered") {
        candidateMap.set(cleanTag, {
          ...l,
          tag_number: tag,
          owner_name: l.owner_name || "Unknown Owner",
          status: "Slaughter Completed",
        });
      }
    });

    return Array.from(candidateMap.values()).sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  } catch (err) {
    console.error("Error in getAllRemainingPostMortem:", err);
    return null;
  }
};

/**
 * Re-queries Supabase directly to get remaining carcasses for a specific owner
 * that have passed Post-Mortem Inspection and are ready for Carcass Weighing.
 * Returns Array of remaining records on confirmed success, or null if query errored.
 */
export const getRemainingWeighingForOwner = async (ownerName) => {
  if (!ownerName || typeof ownerName !== "string") return [];
  const cleanOwner = ownerName.trim();
  if (!cleanOwner) return [];

  try {
    const [carcassRes, postRes, liveRes] = await Promise.all([
      supabase.from(TABLES.CARCASS).select("tag_number"),
      supabase.from(TABLES.POST_MORTEM).select("*").ilike("owner_name", cleanOwner),
      supabase.from(TABLES.LIVESTOCK).select("*").ilike("owner_name", cleanOwner),
    ]);

    if (carcassRes.error) throw carcassRes.error;

    const weighedTags = new Set(
      (carcassRes.data || []).flatMap((c) =>
        String(c.tag_number || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
      )
    );

    const candidateMap = new Map();

    (postRes.data || []).forEach((pm) => {
      const rawTags = String(pm.tag_number || "").split(",").map((t) => t.trim()).filter(Boolean);
      rawTags.forEach((tag) => {
        const clean = tag.toLowerCase();
        if (weighedTags.has(clean)) return;

        const dec = String(pm.decision || "").toLowerCase();
        const isApprovedOrPartial =
          dec === "approved" ||
          dec === "passed" ||
          dec.includes("partial") ||
          dec.includes("passed with partial");

        if (isApprovedOrPartial && !dec.includes("whole") && dec !== "condemned" && dec !== "rejected") {
          const l = (liveRes.data || []).find((item) => (item.tag_number || "").trim().toLowerCase() === clean);
          candidateMap.set(clean, {
            ...l,
            tag_number: tag,
            owner_name: pm.owner_name || l?.owner_name || cleanOwner,
            species: pm.species || l?.species || "Livestock",
            postMortemRecord: pm,
            inspectionDecision: pm.decision,
            isPartialCondemned: dec.includes("partial"),
          });
        }
      });
    });

    return Array.from(candidateMap.values()).sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  } catch (err) {
    console.error("Error in getRemainingWeighingForOwner:", err);
    return null;
  }
};
