const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();

const ANTE_PARTS = ["live animal"];
const WHOLE_PARTS = ["whole carcass", "entire carcass"];

// Derive which inspection stage a condemnation record / evidence item belongs to.
// Priority: explicit stage fields > part name > descriptive text > default Post-Mortem.
export const getCondemnationStage = (record) => {
  if (!record) return null;

  const explicit = `${norm(record.inspection_type)} ${norm(record.stage)} ${norm(record.type)}`;
  if (explicit.includes("ante")) return "Ante-Mortem";
  if (explicit.includes("post")) return "Post-Mortem";

  const part = norm(record.part);
  if (ANTE_PARTS.some((p) => part === p) || part.includes("live animal") || part.includes("ante")) return "Ante-Mortem";
  if (WHOLE_PARTS.some((p) => part.includes(p))) return "Post-Mortem";

  const text = `${norm(record.notes)} ${norm(record.reason)} ${norm(record.findings)} ${norm(record.quantity)} ${norm(record.disposition)}`;
  if (text.includes("ante-mortem") || text.includes("ante mortem") || text.includes("live animal") || text.includes("unfit for slaughter") || text.includes("rejected at intake")) {
    return "Ante-Mortem";
  }
  if (text.includes("post-mortem") || text.includes("post mortem")) return "Post-Mortem";

  return "Post-Mortem";
};

export const matchesStage = (record, stage) => getCondemnationStage(record) === stage;

// Livestock status that means the live animal was condemned/rejected AT INTAKE or
// during ANTE-MORTEM inspection. Post-mortem outcomes are explicitly excluded so
// partially / wholly condemned carcasses never surface in Ante-Mortem views.
export const isAnteCondemnedStatus = (status) => {
  const s = norm(status);
  if (!s) return false;
  if (
    s.includes("post-mortem") ||
    s.includes("post mortem") ||
    s.includes("partially condemned") ||
    s.includes("partial condemnation")
  ) {
    return false;
  }
  return s === "condemned" || s === "rejected" || s.includes("condemn") || s.includes("reject");
};

export const isPostCondemnedStatus = (status) => {
  const s = norm(status);
  if (!s) return false;
  if (s.includes("ante-mortem") || s.includes("ante mortem")) return false;
  return s.includes("post-mortem") || s.includes("partially condemned") || s.includes("condemn") || s.includes("reject");
};

// Ante-Mortem inspection decision that condemns/rejects the live animal.
export const isAnteCondemnedDecision = (decision) => {
  const d = norm(decision);
  if (!d) return false;
  return d.includes("reject") || d.includes("condemn");
};

export const isPostWholeDecision = (decision) => {
  const d = norm(decision);
  return d === "condemned" || d === "rejected" || d === "whole carcass condemned" || d === "totally condemned";
};

export const isPostPartialInspection = (inspection) => {
  if (!inspection) return false;
  const d = norm(inspection.decision);
  if (isPostWholeDecision(d)) return false;
  if (d.includes("partial")) return true;
  if (norm(inspection.raw_decision).includes("partial")) return true;
  const parts = Array.isArray(inspection.condemned_parts) ? inspection.condemned_parts : null;
  if (parts && parts.length > 0 && !parts.some((p) => norm(p.part).includes("whole"))) return true;
  return false;
};

// Single source of truth for how a Post-Mortem inspection outcome is displayed.
export const getPostOutcome = (inspection) => {
  if (!inspection) return { label: "-", status: "Pending", scope: "partial" };
  const d = norm(inspection.decision);
  if (isPostWholeDecision(d) || d === "whole carcass condemned") {
    return { label: "Whole Carcass Condemned", status: "Whole Carcass Condemned", scope: "whole" };
  }
  if (isPostPartialInspection(inspection)) {
    return { label: "Partially Condemned", status: "Partially Condemned", scope: "partial" };
  }
  if (d.includes("approv") || d.includes("pass") || d === "") {
    return { label: d ? inspection.decision : "Passed", status: "Approved", scope: "whole" };
  }
  return { label: inspection.decision, status: inspection.decision, scope: "whole" };
};

// Evidence rows only belong to a stage when they were tagged with it. Untyped
// (legacy) evidence is attributed through the tag's condemnation list instead.
export const evidenceMatchesStage = (ev, stage, tagInStageList) => {
  if (!ev) return false;
  const t = norm(ev.inspection_type);
  if (t.includes("ante")) return stage === "Ante-Mortem";
  if (t.includes("post")) return stage === "Post-Mortem";
  if (ev.condemnation_record_id && ev.condemnation_record_stage) {
    return norm(ev.condemnation_record_stage) === norm(stage);
  }
  return typeof tagInStageList === "function" ? !!tagInStageList(ev.tag_number) : false;
};

export const cleanTag = (tag) => String(tag == null ? "" : tag).trim().toLowerCase();
