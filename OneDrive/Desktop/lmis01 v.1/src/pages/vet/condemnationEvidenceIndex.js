// Shared Condemnation Evidence derivation.
//
// SINGLE SOURCE OF TRUTH for "which condemnation evidence records belong to a stage"
// and "how many of them are actually displayed". The Condemnation Evidence page
// (EvidenceUpload) and the Ante-Mortem / Post-Mortem StatCard counts all build from
// this module, so a card count can never drift from the records shown on the page.

import { useMemo } from "react";
import {
  getCondemnationStage,
  matchesStage,
  isAnteCondemnedStatus,
  isPostCondemnedStatus,
  isPostWholeDecision,
} from "./condemnationStage";
import { CONDEMNED_PARTS_LIST } from "../../components/forms/InspectionForm";
import { today } from "../../utils/helpers";

const normTag = (v) => String(v == null ? "" : v).trim().toLowerCase();

// evidence_records.status defaults to 'Active'. Deletion in this app is a hard delete
// (vetService issues a real .delete()), so this only guards rows that were explicitly
// flagged as removed/archived.
const REMOVED_EVIDENCE_STATUSES = new Set([
  "deleted", "removed", "archived", "inactive", "void", "voided", "cancelled", "canceled",
]);

export const isActiveEvidenceRecord = (ev) => {
  if (!ev) return false;
  const s = String(ev.status || "").trim().toLowerCase();
  if (!s) return true; // legacy rows written before the status column existed
  return !REMOVED_EVIDENCE_STATUSES.has(s);
};

// Compile ALL animals/carcasses marked as condemned across all tables for one stage.
export const buildCondemnedList = ({
  type,
  ante = [],
  post = [],
  livestock = [],
  condemned = [],
  evidence = [],
}) => {
  const map = new Map();

  if (type === "Ante-Mortem") {
    // 1. Ante-Mortem inspections marked Condemned / Rejected
    (ante || []).forEach((i) => {
      const d = String(i.decision || "").trim().toLowerCase();
      const isApproved = d.includes("approv") || d.includes("pass") || d.includes("cleared");
      const isCond = !isApproved && (
        i.decision === "Rejected" || i.decision === "Condemned" ||
        d.includes("reject") || d.includes("condemn") ||
        (i.findings && (i.findings.toLowerCase().includes("condemn") || i.findings.toLowerCase().includes("unfit")))
      );
      if (isCond && i.tag_number) {
        const tag = String(i.tag_number).trim();
        const animal = livestock.find((l) => l.tag_number === tag);
        let cleanReason = i.reason || "";
        if (!cleanReason && i.findings) {
          const f = i.findings.trim();
          const tagEscaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = f.match(new RegExp(`${tagEscaped}\\s*\\(([^)]+)\\)`, "i"));
          if (m && m[1]) {
            cleanReason = m[1].trim();
          } else {
            cleanReason = f.replace(/^Ante-Mortem Condemned:\s*/i, "").replace(/^Condemned:\s*/i, "").trim();
          }
        }
        if (!cleanReason) cleanReason = i.remarks || "Unfit for slaughter";

        map.set(tag, {
          tag_number: tag,
          species: i.species || animal?.species || "Livestock",
          breed: animal?.breed || i.breed || animal?.species || i.species || "Livestock",
          owner_name: animal?.owner_name || "—",
          owner_id: animal?.owner_id || null,
          reason: cleanReason,
          inspector: i.inspector_name || "Dr. Dave",
          date: i.date || i.created_at || today(),
          source: "Ante-Mortem Inspection",
          decision: i.decision || "Condemned",
          condemnation_scope: "whole",
          parts_summary: "Live Animal",
        });
      }
    });

    // 2. Livestock records marked as Condemned or Rejected in registry/intake
    //    (post-mortem outcomes like "Partially Condemned" belong to Post-Mortem)
    (livestock || []).forEach((l) => {
      const isCond = isAnteCondemnedStatus(l.status) ||
        (!isPostCondemnedStatus(l.status) && l.remarks && l.remarks.toLowerCase().includes("condemn"));
      if (isCond && l.tag_number) {
        const tag = String(l.tag_number).trim();
        if (!map.has(tag)) {
          map.set(tag, {
            tag_number: tag,
            species: l.species || "Livestock",
            breed: l.breed || l.species || "Livestock",
            owner_name: l.owner_name || "—",
            owner_id: l.owner_id || null,
            reason: l.remarks || l.rejection_reason || "Marked as Condemned at Intake",
            inspector: "Dr. Dave",
            date: l.received_date || l.created_at || today(),
            source: "Livestock Registry",
            decision: l.status || "Condemned",
            condemnation_scope: "whole",
            parts_summary: "Live Animal",
          });
        }
      }
    });

    // 3. Condemnation records for live animals (stage decided by the record itself)
    (condemned || []).forEach((c) => {
      const stage = getCondemnationStage(c);
      const unmarked = !c.part && !c.inspection_type && !c.stage && !c.type;
      const isAnte = stage === "Ante-Mortem" ||
        (unmarked &&
          livestock.some((l) => String(l.tag_number || "").trim() === String(c.tag_number || "").trim() &&
            isAnteCondemnedStatus(l.status)));
      if (isAnte && c.tag_number) {
        const tag = String(c.tag_number).trim();
        const existing = map.get(tag);
        const animal = livestock.find((l) => l.tag_number === tag);
        let cleanReason = c.reason || existing?.reason || "";
        if (cleanReason) {
          cleanReason = cleanReason.replace(/^Ante-Mortem Condemned:\s*/i, "").replace(/^Condemned:\s*/i, "").trim();
        }
        map.set(tag, {
          tag_number: tag,
          species: c.species || animal?.species || existing?.species || "Livestock",
          breed: animal?.breed || c.breed || animal?.species || existing?.breed || existing?.species || "Livestock",
          owner_name: animal?.owner_name || existing?.owner_name || "—",
          owner_id: animal?.owner_id || existing?.owner_id || null,
          reason: cleanReason || "Unfit for slaughter",
          inspector: c.inspector || existing?.inspector || "Dr. Dave",
          date: c.date || existing?.date || today(),
          source: "Condemnation Record",
          decision: "Condemned",
          condemnation_scope: "whole",
          parts_summary: "Live Animal",
        });
      }
    });

    // 4. Any existing evidence records captured for Ante-Mortem inspection
    //    (untyped/legacy evidence is only attributed when its tag is not a post-mortem condemnation)
    const postCondTagsForEvidence = new Set();
    (condemned || []).forEach((c) => {
      if (c && c.tag_number && getCondemnationStage(c) === "Post-Mortem") {
        postCondTagsForEvidence.add(normTag(c.tag_number));
      }
    });
    (post || []).forEach((p) => {
      const d = String(p.decision || "").trim().toLowerCase();
      if (p && p.tag_number && (isPostWholeDecision(d) || d.includes("partial"))) {
        postCondTagsForEvidence.add(normTag(p.tag_number));
      }
    });
    (evidence || []).forEach((ev) => {
      const evStage = String(ev.inspection_type || "").trim();
      const evTagClean = normTag(ev.tag_number);
      const isAnteEvidence =
        evStage === "Ante-Mortem" ||
        (!evStage && !!evTagClean && !postCondTagsForEvidence.has(evTagClean));
      if (isAnteEvidence && ev.tag_number) {
        const tag = String(ev.tag_number).trim();
        if (!map.has(tag)) {
          const animal = livestock.find((l) => l.tag_number === tag);
          map.set(tag, {
            tag_number: tag,
            species: animal?.species || "Livestock",
            breed: animal?.breed || animal?.species || "Livestock",
            owner_name: animal?.owner_name || "—",
            owner_id: animal?.owner_id || null,
            reason: ev.notes || "Recorded Condemnation Evidence",
            inspector: "Dr. Dave",
            date: ev.date || ev.created_at || today(),
            source: "Evidence Record",
            decision: "Condemned",
            condemnation_scope: "whole",
            parts_summary: "Live Animal",
          });
        }
      }
    });
  } else {
    // Post-Mortem inspections & carcass condemnations
    (post || []).forEach((p) => {
      const d = String(p.decision || "").trim().toLowerCase();
      const isWholeCondemnedDecision =
        d === "condemned" ||
        d === "rejected" ||
        d === "whole carcass condemned" ||
        d === "totally condemned";

      const isPartialDecision =
        !isWholeCondemnedDecision && (
          d === "passed with partial condemnation" ||
          d === "partially condemned" ||
          d === "partial" ||
          d.includes("partial") ||
          (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0 && !p.condemned_parts.some((cp) => String(cp.part || "").toLowerCase().includes("whole")))
        );

      const isCond = isWholeCondemnedDecision || isPartialDecision;

      if (isCond && p.tag_number) {
        const tag = String(p.tag_number).trim();
        const animal = livestock.find((l) => l.tag_number === tag);

        const partsSummary = isWholeCondemnedDecision
          ? "Whole Carcass"
          : (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0
              ? p.condemned_parts.map((cp) => `${cp.part}${cp.weight_kg || cp.weight ? ` (${cp.weight_kg || cp.weight} kg)` : ""}`).join(", ")
              : (p.part || "Condemned Cut"));

        map.set(tag, {
          tag_number: tag,
          species: p.species || animal?.species || "Carcass",
          breed: animal?.breed || p.breed || animal?.species || p.species || "Carcass",
          owner_name: animal?.owner_name || "—",
          owner_id: animal?.owner_id || null,
          reason: p.findings || p.remarks || (isWholeCondemnedDecision ? "Whole Carcass Condemnation" : `Partial Condemnation: ${partsSummary}`),
          inspector: p.inspector_name || "Dr. Dave",
          date: p.date || p.created_at || today(),
          source: "Post-Mortem Inspection",
          decision: isWholeCondemnedDecision ? (p.decision || "Condemned") : "Passed with Partial Condemnation",
          condemnation_scope: isWholeCondemnedDecision ? "whole" : "partial",
          parts_summary: partsSummary,
        });
      }
    });

    (condemned || []).forEach((c) => {
      // Strict stage separation: only Post-Mortem condemnations feed this list
      if (getCondemnationStage(c) !== "Post-Mortem") return;

      if (c.tag_number) {
        const tag = String(c.tag_number).trim();
        const existing = map.get(tag);
        const animal = livestock.find((l) => l.tag_number === tag);

        const postInspection = (post || []).find((p) => String(p.tag_number).trim() === tag);
        const postIsWhole = postInspection && isPostWholeDecision(postInspection.decision);

        const isWhole =
          postIsWhole ||
          c.part === "Whole Carcass" ||
          c.part === "Entire Carcass" ||
          existing?.condemnation_scope === "whole";

        const scope = isWhole ? "whole" : (existing?.condemnation_scope || "partial");
        const partsSummary = isWhole ? "Whole Carcass" : (c.part || existing?.parts_summary || "Condemned Cut");

        map.set(tag, {
          tag_number: tag,
          species: c.species || animal?.species || existing?.species || "Carcass",
          breed: animal?.breed || c.breed || animal?.species || existing?.breed || existing?.species || "Carcass",
          owner_name: animal?.owner_name || existing?.owner_name || "—",
          owner_id: animal?.owner_id || existing?.owner_id || null,
          reason: c.reason || existing?.reason || (isWhole ? "Post-Mortem Whole Carcass Condemnation" : "Condemned Cut"),
          inspector: c.inspector || existing?.inspector || "Dr. Dave",
          date: c.date || existing?.date || today(),
          source: "Condemnation Record",
          decision: isWhole ? "Post-Mortem Whole Carcass Condemned" : "Passed with Partial Condemnation",
          condemnation_scope: scope,
          parts_summary: partsSummary,
        });
      }
    });
  }

  return Array.from(map.values()).map((item) => {
    const cleanTag = String(item.tag_number || "").trim();

    // 1. Condemnation records (sums all itemized cuts or recorded weights for this tag)
    //    Only records from the currently viewed inspection stage are counted.
    const matchingCondemned = (condemned || []).filter(
      (c) => String(c.tag_number || "").trim() === cleanTag && matchesStage(c, type)
    );
    let totalW = 0;
    if (matchingCondemned.length > 0) {
      totalW = matchingCondemned.reduce((sum, c) => {
        const val = parseFloat(c.weight_kg) ||
          parseFloat(c.weight) ||
          parseFloat(String(c.quantity || "").replace(/[^0-9.]/g, "")) || 0;
        return sum + val;
      }, 0);
    }

    // 2. Post-Mortem inspections (condemned_parts array)
    if (totalW <= 0) {
      const matchingPost = (post || []).filter(
        (p) => String(p.tag_number || "").trim() === cleanTag
      );
      for (const p of matchingPost) {
        if (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0) {
          const partsSum = p.condemned_parts.reduce((sum, cp) => {
            return sum + (parseFloat(cp.weight_kg) || parseFloat(cp.weight) || 0);
          }, 0);
          if (partsSum > 0) {
            totalW = partsSum;
            break;
          }
        }
      }
    }

    // 3. Ante-Mortem inspections (condemned_parts array)
    if (totalW <= 0) {
      const matchingAnte = (ante || []).filter(
        (a) => String(a.tag_number || "").trim() === cleanTag
      );
      for (const a of matchingAnte) {
        if (Array.isArray(a.condemned_parts) && a.condemned_parts.length > 0) {
          const partsSum = a.condemned_parts.reduce((sum, cp) => {
            return sum + (parseFloat(cp.weight_kg) || parseFloat(cp.weight) || 0);
          }, 0);
          if (partsSum > 0) {
            totalW = partsSum;
            break;
          }
        }
      }
    }

    // 4. Livestock registry (intake live weight or carcass weight)
    if (totalW <= 0) {
      const animal = (livestock || []).find(
        (l) => String(l.tag_number || "").trim() === cleanTag
      );
      if (animal) {
        totalW = parseFloat(animal.carcassWeight) ||
          parseFloat(animal.carcass_weight) ||
          parseFloat(animal.weight) ||
          parseFloat(animal.live_weight) || 0;
      }
    }

    return {
      ...item,
      total_weight: totalW,
    };
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
};

// Scope detector for evidence items
export const getEvidenceScope = (ev, type, allCondemnedList, post = [], condemned = []) => {
  if (!ev) return "whole";

  const cleanTag = String(ev.tag_number || "").trim();

  // 1. Match against allCondemnedList (primary source of truth for the active view)
  const match = allCondemnedList.find((c) => String(c.tag_number).trim() === cleanTag);
  if (match?.condemnation_scope) return match.condemnation_scope;

  // 2. Match against post-mortem inspections (Post-Mortem view only)
  const matchPost = type === "Post-Mortem"
    ? (post || []).find((p) => String(p.tag_number).trim() === cleanTag)
    : null;
  if (matchPost) {
    const d = String(matchPost.decision || "").trim().toLowerCase();
    if (d === "condemned" || d === "rejected" || d === "whole carcass condemned" || d === "totally condemned") {
      return "whole";
    }
    if (d === "passed with partial condemnation" || d === "partially condemned" || d === "partial" || d.includes("partial")) {
      return "partial";
    }
  }

  // 3. Match against condemnation_records of the currently viewed stage
  const matchCondemned = (condemned || []).filter(
    (c) => String(c.tag_number).trim() === cleanTag && matchesStage(c, type)
  );
  if (matchCondemned.some((c) => c.part === "Whole Carcass" || c.part === "Entire Carcass" || c.part === "Live Animal")) {
    return "whole";
  }
  if (matchCondemned.some((c) => c.part && c.part !== "Whole Carcass" && c.part !== "Entire Carcass" && c.part !== "Live Animal")) {
    return "partial";
  }

  // 4. Explicit scope property if present on record
  if (ev.scope === "whole" || ev.scope === "partial") return ev.scope;

  // 5. Check notes and filename for explicit whole cues
  const notes = `${ev.notes || ""} ${ev.file_name || ""}`.toLowerCase();
  if (notes.includes("whole carcass") || notes.includes("whole condemnation") || notes.includes("full carcass")) {
    return "whole";
  }

  // 6. Check notes and filename for explicit partial cues
  if (
    notes.includes("carcass passed") ||
    notes.includes("partial") ||
    notes.includes("cut:") ||
    notes.includes("condemned cut")
  ) {
    return "partial";
  }

  // Ante-Mortem condemnations are always whole (the live animal);
  // unclassified Post-Mortem evidence belongs to an excised cut (partial).
  return type === "Ante-Mortem" ? "whole" : "partial";
};

// Extract cut / organ name for partial evidence
export const getEvidencePartLabel = (ev, type, allCondemnedList, post = [], condemned = []) => {
  // Ante-Mortem condemnations always target the whole live animal
  if (type === "Ante-Mortem" && String(ev?.inspection_type || "").trim() !== "Post-Mortem") {
    return "Live Animal";
  }
  const notes = `${ev.notes || ""} ${ev.file_name || ""}`.toLowerCase();
  if (notes.includes("lung")) return "Lungs";
  if (notes.includes("liver")) return "Liver";
  if (notes.includes("head")) return "Head";
  if (notes.includes("kidney")) return "Kidney";
  if (notes.includes("heart")) return "Heart";
  if (notes.includes("shoulder")) return "Shoulder";
  if (notes.includes("flank")) return "Flank";
  if (notes.includes("foreleg") || notes.includes("fore leg")) return "Foreleg";
  if (notes.includes("hind leg") || notes.includes("hindleg")) return "Hind Leg";

  for (const p of CONDEMNED_PARTS_LIST) {
    if (p !== "Other" && new RegExp(`\\b${p}\\b`, "i").test(notes)) {
      return p;
    }
  }
  const match = allCondemnedList.find((c) => String(c.tag_number).trim() === String(ev.tag_number).trim());
  if (match?.parts_summary && match.parts_summary !== "Whole Carcass") {
    return match.parts_summary;
  }
  const matchPost = type === "Post-Mortem"
    ? (post || []).find((p) => String(p.tag_number).trim() === String(ev.tag_number).trim())
    : null;
  if (matchPost) {
    const pText = `${matchPost.findings || ""} ${matchPost.remarks || ""}`.toLowerCase();
    if (pText.includes("lung")) return "Lungs";
    if (pText.includes("liver")) return "Liver";
    if (pText.includes("head")) return "Head";
    if (pText.includes("kidney")) return "Kidney";
    if (pText.includes("heart")) return "Heart";
  }
  const matchCondemned = (condemned || []).find(
    (c) => String(c.tag_number).trim() === String(ev.tag_number).trim() && matchesStage(c, type)
  );
  if (matchCondemned?.part && matchCondemned.part !== "Whole Carcass" && matchCondemned.part !== "Live Animal") return matchCondemned.part;
  return "Excised Cut";
};

export const getEvidenceSpecies = (ev, allCondemnedList, livestock = []) => {
  if (ev.species) return ev.species;
  const match = allCondemnedList.find((c) => c.tag_number === ev.tag_number);
  if (match?.species) return match.species;
  const anim = (livestock || []).find((l) => l.tag_number === ev.tag_number);
  return anim?.species || "Livestock";
};

/**
 * Extracts complete, accurate condemnation parts and quantities for a record
 * directly from real Supabase data (condemnation_records, post_mortem_inspections, ante_mortem_inspections).
 * Distinguishes fully condemned from partially condemned records and preserves every individual rejected part.
 */
export const getCondemnationRecordParts = ({
  record,
  stage = "Post-Mortem",
  ante = [],
  post = [],
  livestock = [],
  condemned = [],
  postCuts = [],
}) => {
  const cleanTag = String(record?.tag_number || "").trim().toLowerCase();
  const cleanId = String(record?.livestock_id || "").trim();

  // Find source matches across tables
  const matchedAnimal = (livestock || []).find((l) => {
    const lId = String(l.id || "").trim();
    const lTag = String(l.tag_number || "").trim().toLowerCase();
    return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
  });
  const matchedAnte = (ante || []).find((a) => {
    const aTag = String(a.tag_number || "").trim().toLowerCase();
    const aId = String(a.livestock_id || "").trim();
    return (cleanTag && aTag === cleanTag) || (cleanId && aId === cleanId);
  });
  const matchedPost = (post || []).find((p) => {
    const pTag = String(p.tag_number || "").trim().toLowerCase();
    const pId = String(p.livestock_id || "").trim();
    return (cleanTag && pTag === cleanTag) || (cleanId && pId === cleanId);
  });

  const effStage =
    record?.inspection_type ||
    stage ||
    (matchedAnte && !matchedPost ? "Ante-Mortem" : "Post-Mortem");

  const matchedCondemnedRows = (condemned || []).filter((c) => {
    if (!cleanTag) return false;
    return (
      String(c.tag_number || "").trim().toLowerCase() === cleanTag &&
      matchesStage(c, effStage)
    );
  });

  // 1. Ante-Mortem condemnation: always Whole Animal
  const isAnte =
    effStage === "Ante-Mortem" ||
    (!matchedPost && matchedAnte) ||
    matchedCondemnedRows.some((c) => c.part === "Live Animal");

  if (isAnte) {
    const reason =
      matchedAnte?.reason ||
      matchedAnte?.findings ||
      matchedCondemnedRows[0]?.reason ||
      record?.reason ||
      record?.notes ||
      "Unfit for slaughter";
    const liveWeight =
      matchedAnte?.live_weight ||
      matchedAnimal?.live_weight ||
      matchedAnimal?.weight ||
      matchedCondemnedRows[0]?.weight_kg;
    const qtyStr = liveWeight ? `1 Head (${liveWeight} kg)` : "1 Head";

    return {
      scope: "whole",
      stage: "Ante-Mortem",
      scopeLabel: "Ante-Mortem · Whole Animal Condemnation",
      cardBadgeLabel: "Whole Animal Condemnation",
      totalParts: 1,
      isWhole: true,
      parts: [
        {
          id: matchedCondemnedRows[0]?.id || "ante-whole",
          part: "Live Animal (Whole)",
          location: matchedCondemnedRows[0]?.location || "",
          quantity: matchedCondemnedRows[0]?.quantity || qtyStr,
          weight: liveWeight ? `${liveWeight} kg` : "",
          reason: String(reason).replace(/^Condemned:\s*/i, "").trim(),
          disposition: "Condemned / Rendered",
        },
      ],
    };
  }

  // 2. Post-Mortem: check if Whole Carcass Condemnation
  const postDecision = String(matchedPost?.decision || "").trim().toLowerCase();
  const isWholeCarcass =
    postDecision.includes("whole") ||
    postDecision === "condemned" ||
    postDecision === "rejected" ||
    matchedCondemnedRows.some(
      (c) => c.part === "Whole Carcass" || c.part === "Entire Carcass"
    ) ||
    record?.part === "Whole Carcass" ||
    record?.part === "Entire Carcass";

  if (isWholeCarcass) {
    const carcassWeight =
      matchedPost?.carcass_weight ||
      matchedAnimal?.carcass_weight ||
      matchedCondemnedRows[0]?.weight_kg;
    const qtyStr = carcassWeight ? `${carcassWeight} kg` : "Whole Carcass";
    const reason =
      matchedPost?.findings ||
      matchedPost?.remarks ||
      matchedCondemnedRows[0]?.reason ||
      record?.reason ||
      record?.notes ||
      "Whole Carcass Condemnation";

    return {
      scope: "whole",
      stage: "Post-Mortem",
      scopeLabel: "Post-Mortem · Whole Carcass Condemnation",
      cardBadgeLabel: "Whole Carcass Condemnation",
      totalParts: 1,
      isWhole: true,
      parts: [
        {
          id: matchedCondemnedRows[0]?.id || "post-whole",
          part: "Whole Carcass",
          location: matchedCondemnedRows[0]?.location || "",
          quantity: matchedCondemnedRows[0]?.quantity || qtyStr,
          weight: carcassWeight ? `${carcassWeight} kg` : "",
          reason: String(reason).replace(/^Whole Carcass Condemned:\s*/i, "").trim(),
          disposition: "Condemned / Rendered",
        },
      ],
    };
  }

  // 3. Partial Condemnation: Extract EVERY individual rejected part separately
  const parts = [];

  // Source A: post_mortem_inspections.condemned_parts JSON array
  if (Array.isArray(matchedPost?.condemned_parts) && matchedPost.condemned_parts.length > 0) {
    matchedPost.condemned_parts.forEach((cp, idx) => {
      const pName = cp.part || cp.name || "Excised Cut";
      const loc = cp.specific_part || cp.location || cp.carcass_area || "";
      const wKg = parseFloat(cp.weight_kg ?? cp.weight);
      const wStr = !isNaN(wKg) && wKg > 0 ? (wKg % 1 === 0 ? `${wKg} kg` : `${wKg.toFixed(2)} kg`) : "";
      const qty = cp.quantity || wStr || "1 pc";
      const reason = cp.reason || cp.notes || "Condemned";
      parts.push({
        id: `cp-${idx}`,
        part: pName,
        location: loc,
        quantity: qty,
        weight: wStr,
        reason: String(reason).replace(/^Part:\s*[^·]+·\s*/i, "").trim(),
        disposition: cp.disposition || "Condemned / Rendered",
      });
    });
  } else if (matchedCondemnedRows.length > 0) {
    // Source B: condemnation_records matching rows
    matchedCondemnedRows.forEach((cr, idx) => {
      const pName = cr.part || "Excised Cut";
      const loc = cr.location || "";
      const wKg = parseFloat(cr.weight_kg);
      const wStr = !isNaN(wKg) && wKg > 0 ? (wKg % 1 === 0 ? `${wKg} kg` : `${wKg.toFixed(2)} kg`) : "";
      const qty = cr.quantity || wStr || "1 pc";
      const reason = cr.reason || cr.findings || cr.notes || "Condemned";
      parts.push({
        id: cr.id || `cr-${idx}`,
        part: pName,
        location: loc,
        quantity: qty,
        weight: wStr,
        reason: String(reason).replace(/^Part:\s*[^·]+·\s*/i, "").trim(),
        disposition: cr.disposition || "Condemned / Rendered",
      });
    });
  } else {
    // Source C: post_mortem_condemned_cuts
    const matchingCuts = (postCuts || []).filter(
      (cut) => cleanTag && String(cut?.tag_number || "").trim().toLowerCase() === cleanTag
    );
    if (matchingCuts.length > 0) {
      matchingCuts.forEach((cut, idx) => {
        const pName = cut.part || "Excised Cut";
        const loc = cut.location || "";
        const wKg = parseFloat(cut.weight_kg);
        const wStr = !isNaN(wKg) && wKg > 0 ? `${wKg} kg` : "";
        const qty = cut.quantity || wStr || "1 pc";
        parts.push({
          id: cut.id || `cut-${idx}`,
          part: pName,
          location: loc,
          quantity: qty,
          weight: wStr,
          reason: cut.reason || "Condemned",
          disposition: cut.disposition || "Condemned / Rendered",
        });
      });
    }
  }

  // Fallback if nothing matched
  if (parts.length === 0 && (record?.part || record?.notes)) {
    const pName = record.part || "Excised Cut";
    const loc = record.location || "";
    const wKg = parseFloat(record.weight_kg);
    const wStr = !isNaN(wKg) && wKg > 0 ? `${wKg} kg` : "";
    const qty = record.quantity || wStr || "1 pc";
    parts.push({
      id: record.id || "fallback-part",
      part: pName,
      location: loc,
      quantity: qty,
      weight: wStr,
      reason: record.reason || record.notes || "Condemned",
      disposition: "Condemned / Rendered",
    });
  }

  const count = parts.length;
  return {
    scope: "partial",
    stage: "Post-Mortem",
    scopeLabel: `Post-Mortem · Partial Condemnation (${count} ${count === 1 ? "Part" : "Parts"})`,
    cardBadgeLabel: `Partial · ${count} ${count === 1 ? "Part" : "Parts"} Condemned`,
    totalParts: count,
    isWhole: false,
    parts,
  };
};

/**
 * Builds the Condemnation Evidence repository for one inspection stage.
 *
 * Returns:
 *   repository - stage-scoped evidence rows, including a synthetic row for every
 *                condemnation whose photos live on the condemnation/inspection record
 *                instead of evidence_records. One synthetic row per tag, so a carcass
 *                carrying both partial-condemnation details and photos is still ONE record.
 *   display    - the rows actually rendered as cards: search/species/scope filters
 *                applied, then grouped one-per-tag so duplicate photos for the same
 *                condemnation never inflate the list. `display.length` is the number
 *                of records the user sees.
 */
export const buildEvidenceRepository = ({
  type,
  ante = [],
  post = [],
  livestock = [],
  condemned = [],
  evidence = [],
  allCondemnedList = [],
  allCondemnedTags = [],
  owners = [],
  filterSpecies = "all",
  searchEv = "",
  evidenceScopeFilter = "all",
  ownerIdFilter = "all",
}) => {
  const tagInStageList = (t) => {
    const key = normTag(t);
    if (!key) return false;
    return allCondemnedTags.some((x) => normTag(x) === key);
  };

  // Evidence explicitly captured for the other stage is never shown here.
  // Untyped/legacy evidence is attributed through this stage's condemned tags.
  const directEvidence = (evidence || [])
    .filter(isActiveEvidenceRecord)
    .filter((ev) => {
      if (ev.inspection_type && ev.inspection_type === type) return true;
      if (ev.inspection_type && ev.inspection_type !== type) return false;
      return tagInStageList(ev.tag_number);
    });

  const existingTags = new Set(
    directEvidence.map((ev) => normTag(ev.tag_number)).filter(Boolean)
  );

  const syntheticEntries = [];
  (allCondemnedList || []).forEach((c) => {
    const tagKey = normTag(c.tag_number);
    if (!tagKey) return;
    if (!existingTags.has(tagKey)) {
      const condRecs = (condemned || []).filter(
        (cr) => normTag(cr.tag_number) === tagKey && matchesStage(cr, type)
      );
      const postRec = type === "Post-Mortem"
        ? (post || []).find((p) => normTag(p.tag_number) === tagKey)
        : null;
      const anteRec = type === "Ante-Mortem"
        ? (ante || []).find((a) => normTag(a.tag_number) === tagKey)
        : null;

      let photos = [];
      condRecs.forEach((cr) => {
        if (Array.isArray(cr.photos) && cr.photos.length > 0) {
          photos.push(...cr.photos);
        } else if (cr.photo_url || cr.file_url) {
          photos.push({ url: cr.photo_url || cr.file_url, name: cr.part || "Condemnation Photo" });
        }
      });
      if (postRec) {
        if (Array.isArray(postRec.photos) && postRec.photos.length > 0) {
          photos.push(...postRec.photos);
        } else if (postRec.photo_url || postRec.file_url) {
          photos.push({ url: postRec.photo_url || postRec.file_url, name: "Inspection Photo" });
        }
      }
      if (anteRec) {
        if (Array.isArray(anteRec.photos) && anteRec.photos.length > 0) {
          photos.push(...anteRec.photos);
        } else if (anteRec.photo_url || anteRec.file_url) {
          photos.push({ url: anteRec.photo_url || anteRec.file_url, name: "Inspection Photo" });
        }
      }

      syntheticEntries.push({
        id: `synth-${c.tag_number}`,
        tag_number: c.tag_number,
        owner_id: c.owner_id,
        species: c.species,
        notes: c.reason || (c.condemnation_scope === "partial" ? `Partial Condemnation: ${c.parts_summary}` : "Whole Carcass Condemnation"),
        inspection_type: type,
        scope: c.condemnation_scope,
        date: c.date,
        created_at: c.date,
        photos: photos,
        file_url: photos[0]?.url || photos[0]?.preview || null,
        type: "Photo",
        is_synthetic: true
      });
    }
  });

  const repository = [...directEvidence, ...syntheticEntries];

  // One card per condemned tag - duplicate evidence rows/photos for the same
  // condemnation collapse into the single record the user sees.
  const groupByTag = (rows) => {
    const groupedMap = new Map();
    rows.forEach((ev) => {
      const key = normTag(ev.tag_number || ev.id || "");
      if (!key) {
        groupedMap.set(ev.id || Math.random(), ev);
        return;
      }
      if (!groupedMap.has(key)) {
        groupedMap.set(key, ev);
      }
    });
    return Array.from(groupedMap.values());
  };

  // Grouped but filter-free: the totals every filter dropdown offers against.
  const displayAll = groupByTag(repository);

  const rawList = repository.filter((ev) => {
    const cleanTag = normTag(ev.tag_number);
    const cleanId = String(ev.livestock_id || "").trim().toLowerCase();
    const animal = (livestock || []).find((l) => {
      const lId = String(l.id || "").trim().toLowerCase();
      const lTag = normTag(l.tag_number);
      return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
    });

    if (ownerIdFilter && ownerIdFilter !== "all") {
      const evOwnerId = String(animal?.owner_id || ev.owner_id || "").trim().toLowerCase();
      const targetOwnerId = String(ownerIdFilter).trim().toLowerCase();
      if (!evOwnerId || evOwnerId !== targetOwnerId) return false;
    }
    if (type === "Post-Mortem" && evidenceScopeFilter !== "all") {
      const scope = getEvidenceScope(ev, type, allCondemnedList, post, condemned);
      if (scope !== evidenceScopeFilter) return false;
    }
    const sp = getEvidenceSpecies(ev, allCondemnedList, livestock).toLowerCase();
    const targetSp = String(filterSpecies || "all").toLowerCase();
    const matchSpecies = targetSp === "all" ||
      ((targetSp === "carabao" || targetSp === "caraboa")
        ? (sp === "carabao" || sp === "caraboa")
        : sp === targetSp);

    const cItem = allCondemnedList.find((c) => normTag(c.tag_number) === cleanTag);
    const evOwnerId = String(animal?.owner_id || ev.owner_id || "").trim().toLowerCase();
    const matchedOwner = evOwnerId
      ? (owners || []).find((o) => {
          const oId = String(o?.id || "").trim().toLowerCase();
          const oOwnerId = String(o?.owner_id || "").trim().toLowerCase();
          const oTempId = String(o?.temp_reg_id || "").trim().toLowerCase();
          return oId === evOwnerId || oOwnerId === evOwnerId || oTempId === evOwnerId;
        })
      : null;
    const ownerName = String(matchedOwner?.name || animal?.owner_name || cItem?.owner_name || ev.owner_name || "").toLowerCase();

    const q = String(searchEv || "").trim().toLowerCase();
    const matchSearch = !q ||
      (ev.tag_number || "").toLowerCase().includes(q) ||
      (ev.notes || "").toLowerCase().includes(q) ||
      (ev.file_name || "").toLowerCase().includes(q) ||
      (ev.type || "").toLowerCase().includes(q) ||
      sp.includes(q) ||
      ownerName.includes(q);
    return matchSpecies && matchSearch;
  });

  return {
    repository,
    display: groupByTag(rawList),
    displayAll,
  };
};

/**
 * Hook wrapper so the page and the module cards derive counts from one dataset.
 * Call with no `filters` for the canonical (unfiltered) page view used by card counts.
 */
export const useCondemnationEvidenceIndex = (type, sources, filters) => {
  const {
    ante = [],
    post = [],
    livestock = [],
    condemned = [],
    evidence = [],
    owners = [],
  } = sources || {};

  const allCondemnedList = useMemo(
    () => buildCondemnedList({ type, ante, post, livestock, condemned, evidence }),
    [type, ante, post, livestock, condemned, evidence]
  );

  const allCondemnedTags = useMemo(() => allCondemnedList.map((c) => c.tag_number), [allCondemnedList]);

  const { repository, display, displayAll } = useMemo(
    () => buildEvidenceRepository({
      type, ante, post, livestock, condemned, evidence, owners,
      allCondemnedList, allCondemnedTags,
      ...(filters || {}),
    }),
    [type, ante, post, livestock, condemned, evidence, owners, allCondemnedList, allCondemnedTags, filters]
  );

  // Number of condemnation evidence records shown on the page for this stage.
  const evidenceCount = display.length;

  return {
    allCondemnedList,
    allCondemnedTags,
    repository,
    display,
    displayAll,
    evidenceCount,
  };
};