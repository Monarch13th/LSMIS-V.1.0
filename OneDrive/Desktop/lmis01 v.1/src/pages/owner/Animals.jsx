import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatPhDateTime, formatSex, getManilaTodayDateString, isTodayInManila } from "../../utils/formatters";
import { getOwnerCondemnationDetails } from "../../utils/condemnationHelpers";
import { subscribeOwnerLiveRefresh, buildOwnerScope } from "../../utils/ownerLiveRefresh";
import { OwnerCondemnationModal } from "../../components/owner/OwnerCondemnationModal";


export const TRACKER_STAGES = [
  { id: 1, key: "registered", label: "Registered" },
  { id: 2, key: "marking", label: "Marked" },
  { id: 3, key: "ante_mortem", label: "Ante-Mortem" },
  { id: 4, key: "slaughter", label: "Slaughter" },
  { id: 5, key: "post_mortem", label: "Post-Mortem" },
  { id: 6, key: "weighing", label: "Weighing" },
  { id: 7, key: "permit", label: "Meat Permit" },
];

const SLAUGHTER_ACTIVITIES = [
  { key: "bathing", label: "Bathing", desc: "Pre-slaughter shower & cleanliness check" },
  { key: "stunning", label: "Stunning", desc: "Humane electrical or mechanical stunning" },
  { key: "sticking", label: "Sticking", desc: "Surgical carotid sticking incision" },
  { key: "bleeding", label: "Bleeding", desc: "NMIS-standard bleeding & blood collection" },
  { key: "scalding", label: "Scalding", desc: "Hot water scalding tank immersion" },
  { key: "dehairing", label: "Dehairing", desc: "Dehairing machine or sanitary scraping" },
  { key: "evisceration", label: "Evisceration", desc: "Internal organ removal for vet check" },
  { key: "intestine", label: "Intestine Cleaning", desc: "Sanitary intestine washing & separation" },
  { key: "washing", label: "Washing", desc: "Final clean potable water carcass wash" },
];

const parseAnimalHistory = (animal) => {
  const raw = animal?.process_history || animal?.history;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return [];
};

const findHistoryTimestamp = (history, keywords = []) => {
  if (!Array.isArray(history) || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const evt = history[i];
    const text = `${evt?.stage || ""} ${evt?.action || ""}`.toLowerCase();
    if (keywords.some((kw) => text.includes(kw))) {
      if (evt?.timestamp || evt?.created_at || evt?.date) {
        return evt.timestamp || evt.created_at || evt.date;
      }
    }
  }
  return null;
};

const findHistoryActor = (history, keywords = []) => {
  if (!Array.isArray(history) || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const evt = history[i];
    const text = `${evt?.stage || ""} ${evt?.action || ""}`.toLowerCase();
    if (keywords.some((kw) => text.includes(kw))) {
      if (evt?.user_name || evt?.actor_name || evt?.user) {
        return evt.user_name || evt.actor_name || evt.user;
      }
    }
  }
  return null;
};

export const calculateLivestockProgress = (animal, milestones = {}) => {
  const tag = animal?.tag_number;
  const tagUpper = String(tag || "").trim().toUpperCase();
  const id = animal?.id;

  const history = parseAnimalHistory(animal);
  const regTimestamp =
    findHistoryTimestamp(history, ["registration", "registered", "receiving"]) ||
    animal?.registered_at ||
    animal?.created_at ||
    animal?.received_at ||
    animal?.received_date ||
    null;
  const regTimeMs = regTimestamp ? new Date(regTimestamp).getTime() : null;

  let ante = (milestones.ante && id && milestones.ante[id]) ||
    (milestones.ante && tag && (milestones.ante[tag] || milestones.ante[tagUpper])) || null;
  if (ante) {
    if (ante.livestock_id && id && String(ante.livestock_id).trim() !== String(id).trim()) {
      ante = null;
    } else if (regTimeMs && (ante.inspected_at || ante.date)) {
      const anteTimeMs = new Date(ante.inspected_at || ante.date).getTime();
      if (!isNaN(anteTimeMs) && anteTimeMs < regTimeMs - 86400000) {
        ante = null;
      }
    }
  }

  let post = (milestones.post && id && milestones.post[id]) ||
    (milestones.post && tag && (milestones.post[tag] || milestones.post[tagUpper])) || null;
  if (post) {
    if (post.livestock_id && id && String(post.livestock_id).trim() !== String(id).trim()) {
      post = null;
    } else if (regTimeMs && (post.inspected_at || post.date)) {
      const postTimeMs = new Date(post.inspected_at || post.date).getTime();
      if (!isNaN(postTimeMs) && postTimeMs < regTimeMs - 86400000) {
        post = null;
      }
    }
  }

  const rawCond = (milestones.condemnation && id && milestones.condemnation[id]) ||
    (milestones.condemnation && tag && (milestones.condemnation[tag] || milestones.condemnation[tagUpper])) || null;
  const rawCondList = Array.isArray(rawCond) ? rawCond : rawCond ? [rawCond] : [];
  const condListForAnimal = rawCondList.filter((c) => {
    if (c.livestock_id && id && String(c.livestock_id).trim() !== String(id).trim()) {
      return false;
    }
    if (regTimeMs && (c.created_at || c.date)) {
      const cTimeMs = new Date(c.created_at || c.date).getTime();
      if (!isNaN(cTimeMs) && cTimeMs < regTimeMs - 86400000) {
        return false;
      }
    }
    return true;
  });

  const slaughterProc = (milestones.slaughterProc && (milestones.slaughterProc[id] || (tag && (milestones.slaughterProc[tag] || milestones.slaughterProc[tagUpper])))) || null;
  const slaughterRec = (milestones.slaughterRec && (milestones.slaughterRec[id] || (tag && (milestones.slaughterRec[tag] || milestones.slaughterRec[tagUpper])))) || null;
  const carcass = (milestones.carcass && (milestones.carcass[id] || (tag && (milestones.carcass[tag] || milestones.carcass[tagUpper])))) || null;
  const dispatch =
    (milestones.dispatch && (milestones.dispatch[id] || (tag && (milestones.dispatch[tag] || milestones.dispatch[tagUpper])))) || null;
  const permit =
    (milestones.permits &&
      (milestones.permits[id] || (tag && (milestones.permits[tag] || milestones.permits[tagUpper])))) || null;

  const rawStatus = (animal?.status || "").trim();
  const rawStatusLower = rawStatus.toLowerCase();

  const anteDecision = String(ante?.decision || ante?.result || "").toLowerCase();
  const postDecision = String(post?.decision || post?.result || "").toLowerCase();
  const firstCond = condListForAnimal[0] || null;
  const condStage = String(firstCond?.stage || firstCond?.inspection_type || "").toLowerCase();

  const regActor =
    animal?.registered_by ||
    animal?.created_by ||
    findHistoryActor(history, ["registration", "registered", "receiving"]) ||
    "Staff Personnel";

  let rawMarkingHistory = [];
  if (Array.isArray(animal?.marking_history)) {
    rawMarkingHistory = animal.marking_history;
  } else if (typeof animal?.marking_history === "string") {
    try {
      rawMarkingHistory = JSON.parse(animal.marking_history) || [];
    } catch (_) {}
  }

  const isPastMarking =
    Boolean(ante) ||
    Boolean(slaughterProc) ||
    Boolean(slaughterRec) ||
    Boolean(carcass) ||
    Boolean(permit) ||
    Boolean(dispatch) ||
    rawStatusLower === "approved" ||
    rawStatusLower === "passed" ||
    rawStatusLower === "ante-mortem passed" ||
    rawStatusLower === "ready for slaughter" ||
    rawStatusLower === "slaughtering" ||
    rawStatusLower === "slaughtered" ||
    rawStatusLower === "in progress" ||
    rawStatusLower === "completed" ||
    rawStatusLower === "weighed" ||
    rawStatusLower === "permit issued" ||
    rawStatusLower === "released" ||
    rawStatusLower === "condemned" ||
    rawStatusLower === "rejected";

  const hasFallbackHistory = Boolean(animal?.fallback_at) || rawMarkingHistory.length > 0;

  const isReturnedToMarking =
    !isPastMarking &&
    (rawStatusLower === "returned to animal marking" ||
      rawStatusLower === "returned to marking" ||
      rawStatusLower.includes("returned to") ||
      rawStatusLower === "for re-marking" ||
      rawStatusLower === "awaiting re-marking");

  const hasReMarkHistory = rawMarkingHistory.length > 0;
  const isReMarked = hasFallbackHistory && !isReturnedToMarking;

  let initialMarkTimestamp = null;
  if (hasReMarkHistory) {
    const firstHist = rawMarkingHistory[0];
    initialMarkTimestamp =
      firstHist?.previous_marked_at ||
      firstHist?.previous_mark_date ||
      firstHist?.fallback_at ||
      firstHist?.marked_at ||
      firstHist?.created_at ||
      firstHist?.date ||
      firstHist?.timestamp;
  }
  if (!initialMarkTimestamp) {
    initialMarkTimestamp =
      findHistoryTimestamp(history, ["marking", "marked"]) ||
      animal?.marked_at ||
      animal?.mark_date ||
      animal?.marking_date ||
      null;
  }

  let reMarkTimestamp = null;
  if (isReturnedToMarking) {
    reMarkTimestamp =
      animal?.fallback_at ||
      animal?.fallback_date ||
      animal?.return_date ||
      animal?.returned_at ||
      findHistoryTimestamp(history, ["fallback", "returned to animal marking", "return", "re-marking", "remarking"]) ||
      animal?.updated_at;
  } else if (hasReMarkHistory) {
    const lastHist = rawMarkingHistory[rawMarkingHistory.length - 1];
    reMarkTimestamp =
      lastHist?.re_marked_at ||
      lastHist?.marked_at ||
      lastHist?.created_at ||
      lastHist?.date ||
      lastHist?.timestamp ||
      animal?.re_marked_at ||
      animal?.marked_at ||
      findHistoryTimestamp(history, ["re-marked", "re_marked", "re-mark"]);
  }

  const currentMarkTimestamp = isReturnedToMarking
    ? (reMarkTimestamp || animal?.fallback_at || animal?.fallback_date || animal?.updated_at || initialMarkTimestamp || animal?.marked_at || animal?.mark_date || animal?.marking_date || regTimestamp)
    : (reMarkTimestamp || animal?.marked_at || initialMarkTimestamp || animal?.mark_date || animal?.marking_date || animal?.fallback_at || animal?.updated_at || regTimestamp);

  const markTimestamp = currentMarkTimestamp;
  const markActor =
    animal?.marked_by ||
    findHistoryActor(history, ["marking", "marked"]) ||
    "Staff Personnel";

  const anteTimestamp =
    ante?.inspected_at ||
    ante?.created_at ||
    animal?.ante_inspected_at ||
    findHistoryTimestamp(history, ["ante-mortem", "ante_mortem", "antemortem"]) ||
    (condListForAnimal.find((c) => String(c?.stage || c?.inspection_type || c?.part || "").toLowerCase().includes("ante") || String(c?.part || "").toLowerCase() === "live animal")?.created_at) ||
    ante?.date ||
    null;
  const anteActor =
    ante?.inspector_name ||
    ante?.inspector ||
    animal?.ante_inspected_by ||
    findHistoryActor(history, ["ante"]) ||
    "City Veterinarian";

  let latestSlaughterStepTime = null;
  if (slaughterProc?.steps && typeof slaughterProc.steps === "object") {
    Object.values(slaughterProc.steps).forEach((s) => {
      const t = s?.completed_at;
      if (t && (!latestSlaughterStepTime || new Date(t) > new Date(latestSlaughterStepTime))) {
        latestSlaughterStepTime = t;
      }
    });
  }
  const slaughterTimestamp =
    slaughterProc?.completed_at ||
    latestSlaughterStepTime ||
    slaughterProc?.updated_at ||
    slaughterProc?.created_at ||
    slaughterRec?.completed_at ||
    slaughterRec?.created_at ||
    animal?.slaughtered_at ||
    findHistoryTimestamp(history, ["slaughter"]) ||
    slaughterProc?.date ||
    slaughterRec?.date ||
    null;
  const slaughterActor =
    slaughterProc?.operator ||
    slaughterRec?.operator ||
    slaughterRec?.butcher ||
    animal?.slaughtered_by ||
    findHistoryActor(history, ["slaughter"]) ||
    "Slaughterhouse Staff";

  const postTimestamp =
    post?.inspected_at ||
    post?.created_at ||
    animal?.post_inspected_at ||
    findHistoryTimestamp(history, ["post-mortem", "post_mortem", "postmortem"]) ||
    (condListForAnimal.find((c) => !String(c?.stage || c?.inspection_type || "").toLowerCase().includes("ante") && String(c?.part || "").toLowerCase() !== "live animal")?.created_at) ||
    post?.date ||
    null;
  const postActor =
    post?.inspector_name ||
    post?.inspector ||
    animal?.post_inspected_by ||
    findHistoryActor(history, ["post"]) ||
    "City Veterinarian";

  const weighTimestamp =
    carcass?.weighed_at ||
    carcass?.created_at ||
    animal?.weighed_at ||
    findHistoryTimestamp(history, ["weighing", "weighed", "carcass"]) ||
    carcass?.date ||
    null;
  const weighActor =
    carcass?.weighed_by ||
    carcass?.inspector_name ||
    animal?.weighed_by ||
    findHistoryActor(history, ["weigh"]) ||
    "City Veterinarian";

  const permitTimestamp =
    permit?.issued_at ||
    permit?.created_at ||
    animal?.permit_issued_at ||
    findHistoryTimestamp(history, ["permit", "dispatch", "release"]) ||
    dispatch?.released_at ||
    dispatch?.dispatched_at ||
    dispatch?.created_at ||
    permit?.date ||
    animal?.release_date ||
    null;
  const permitActor =
    permit?.issued_by ||
    animal?.permit_issued_by ||
    permit?.inspector ||
    findHistoryActor(history, ["permit"]) ||
    "Staff Personnel";

  const fmtTime = (ts) => (ts ? formatPhDateTime(ts) : null);

  const isAntePassed =
    Boolean(ante) &&
    (anteDecision.includes("approv") || anteDecision.includes("pass"));

  const isAnteRejected =
    rawStatusLower === "rejected" ||
    anteDecision.includes("reject");

  const isPostMortemReached =
    Boolean(carcass) ||
    Boolean(permit) ||
    Boolean(dispatch) ||
    rawStatusLower === "completed" ||
    rawStatusLower === "weighed" ||
    rawStatusLower === "slaughtered" ||
    rawStatusLower === "partially condemned" ||
    slaughterProc?.status === "Completed" ||
    slaughterRec?.status === "Completed" ||
    Boolean(post);

  const hasValidCondemnedCutsInPost =
    Boolean(post) &&
    Array.isArray(post.condemned_parts) &&
    post.condemned_parts.some(
      (p) => p && (p.part || p.carcass_area || p.specific_part) && !/whole|entire|live animal/i.test(String(p.part || ""))
    );

  const hasConfirmedPartialPostDecision =
    Boolean(post) &&
    (postDecision === "partial" ||
      postDecision === "partially condemned" ||
      postDecision === "passed with partial condemnation" ||
      postDecision.includes("partial") ||
      String(post.raw_decision || "").toLowerCase() === "partial");

  const hasConfirmedPartialCondRecord = condListForAnimal.some(
    (c) =>
      (c.type === "Partial" || (c.part && !/whole|entire|live animal/i.test(String(c.part)))) &&
      String(c.stage || c.inspection_type || "Post-Mortem").toLowerCase().includes("post")
  );

  const isPartialCondemned =
    isPostMortemReached &&
    !postDecision.includes("whole") &&
    !postDecision.includes("total") &&
    (
      (hasConfirmedPartialPostDecision && (hasValidCondemnedCutsInPost || hasConfirmedPartialCondRecord || rawStatusLower.includes("partial"))) ||
      hasValidCondemnedCutsInPost ||
      hasConfirmedPartialCondRecord ||
      (rawStatusLower === "partially condemned" && Boolean(post) && !postDecision.includes("approv") && !postDecision.includes("pass"))
    );

  const isPostCondemned =
    !isPartialCondemned &&
    ((post &&
      (postDecision === "condemned" ||
        postDecision === "rejected" ||
        postDecision.includes("whole") ||
        postDecision.includes("total") ||
        (postDecision.includes("condemn") && !postDecision.includes("partial")))) ||
      condListForAnimal.some((c) => c.type === "Total" || c.part === "Whole Carcass" || c.part === "Entire Carcass") ||
      (rawStatusLower === "condemned" && (isAntePassed || Boolean(post) || Boolean(slaughterProc) || Boolean(slaughterRec) || Boolean(carcass))));

  const isAnteCondemned =
    !isPostCondemned &&
    !isPartialCondemned &&
    ((ante && anteDecision.includes("condemn")) ||
      (condStage.includes("ante") && !condStage.includes("post")) ||
      condListForAnimal.some((c) => String(c.part || "").toLowerCase() === "live animal") ||
      (rawStatusLower === "condemned" && !isAntePassed && !post && !slaughterProc && !slaughterRec && !carcass));

  const buildMarkStep = (overrideState = null) => {
    const isStepDone =
      overrideState === "completed" ||
      (!isReturnedToMarking &&
        (isPastMarking ||
          rawStatusLower === "marked" ||
          rawStatusLower === "re-marked" ||
          animal?.marked === true ||
          animal?.marked === "true" ||
          animal?.marked === 1 ||
          Boolean(animal?.marked_at || animal?.re_marked_at || animal?.mark_date || animal?.marking_date) ||
          (Boolean(animal?.tag_number) && rawStatusLower !== "registered" && !rawStatusLower.includes("awaiting"))));

    const isStepCurr =
      overrideState === "current" ||
      (!isStepDone &&
        (isReturnedToMarking ||
          Boolean(initialMarkTimestamp || currentMarkTimestamp || animal?.tag_number || rawStatusLower.includes("marking"))));

    let markSublabel = "Awaiting Mark";
    if (isStepDone) {
      markSublabel = "Marked";
    } else if (isReturnedToMarking) {
      markSublabel = "Re-Marking";
    } else if (isStepCurr) {
      markSublabel = "Awaiting Mark";
    }

    const effectiveTimestamp =
      currentMarkTimestamp ||
      reMarkTimestamp ||
      initialMarkTimestamp ||
      animal?.fallback_at ||
      animal?.fallback_date ||
      animal?.marked_at ||
      animal?.mark_date ||
      animal?.marking_date ||
      animal?.re_marked_at ||
      animal?.updated_at ||
      (anteTimestamp && Boolean(ante) ? anteTimestamp : null) ||
      regTimestamp;

    return {
      id: 2,
      key: "marking",
      label: "Marked",
      sublabel: markSublabel,
      state: isStepDone ? "completed" : isStepCurr ? "current" : "pending",
      timestamp: effectiveTimestamp,
      timestampFormatted: fmtTime(effectiveTimestamp),
      initialMarkTimestamp: initialMarkTimestamp || effectiveTimestamp,
      initialMarkTimestampFormatted: fmtTime(initialMarkTimestamp || effectiveTimestamp),
      reMarkTimestamp: reMarkTimestamp || (isReturnedToMarking ? effectiveTimestamp : null),
      reMarkTimestampFormatted: fmtTime(reMarkTimestamp || (isReturnedToMarking ? effectiveTimestamp : null)),
      isReturnedToMarking,
      isReMarked,
      markingHistory: rawMarkingHistory,
      actor: markActor,
    };
  };

  if (isAnteCondemned || isAnteRejected) {
    return {
      statusLabel: "Condemned",
      statusCategory: "condemned",
      condemnationStage: "Ante-Mortem",
      condemnationTimestamp: anteTimestamp || regTimestamp,
      condemnationDateFormatted: fmtTime(anteTimestamp || regTimestamp),
      currentStageIndex: 3,
      isTerminated: true,
      terminationType: "condemned",
      reason: firstCond?.reason || ante?.findings || animal?.rejection_reason || "Whole animal condemned at Ante-Mortem",
      steps: [
        { id: 1, key: "registered", label: "Registered", sublabel: "Registered", state: "completed", timestamp: regTimestamp, timestampFormatted: fmtTime(regTimestamp), actor: regActor },
        buildMarkStep("completed"),
        { id: 3, key: "ante_mortem", label: "Ante-Mortem", sublabel: "Condemned", state: "condemned", timestamp: anteTimestamp, timestampFormatted: fmtTime(anteTimestamp), actor: anteActor },
        { id: 4, key: "slaughter", label: "Slaughter", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
        { id: 5, key: "post_mortem", label: "Post-Mortem", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
        { id: 6, key: "weighing", label: "Weighing", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
        { id: 7, key: "permit", label: "Meat Permit", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
      ],
    };
  }

  if (isPostCondemned) {
    return {
      statusLabel: "Condemned",
      statusCategory: "condemned",
      condemnationStage: "Post-Mortem",
      condemnationTimestamp: postTimestamp || slaughterTimestamp,
      condemnationDateFormatted: fmtTime(postTimestamp || slaughterTimestamp),
      currentStageIndex: 5,
      isTerminated: true,
      terminationType: "condemned",
      reason: firstCond?.reason || post?.findings || "Whole carcass condemned at Post-Mortem",
      steps: [
        { id: 1, key: "registered", label: "Registered", sublabel: "Registered", state: "completed", timestamp: regTimestamp, timestampFormatted: fmtTime(regTimestamp), actor: regActor },
        buildMarkStep("completed"),
        { id: 3, key: "ante_mortem", label: "Ante-Mortem", sublabel: "Approved", state: "completed", timestamp: anteTimestamp, timestampFormatted: fmtTime(anteTimestamp), actor: anteActor },
        { id: 4, key: "slaughter", label: "Slaughter", sublabel: "Completed", state: "completed", timestamp: slaughterTimestamp, timestampFormatted: fmtTime(slaughterTimestamp), actor: slaughterActor },
        { id: 5, key: "post_mortem", label: "Post-Mortem", sublabel: "Condemned", state: "condemned", timestamp: postTimestamp, timestampFormatted: fmtTime(postTimestamp), actor: postActor },
        { id: 6, key: "weighing", label: "Weighing", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
        { id: 7, key: "permit", label: "Meat Permit", sublabel: "Stopped", state: "pending", timestamp: null, timestampFormatted: null, actor: null },
      ],
    };
  }

  const isReleased =
    rawStatusLower === "released" ||
    rawStatusLower === "dispatched" ||
    (dispatch && (dispatch.status === "Released" || dispatch.status === "Dispatched")) ||
    Boolean(animal?.release_date || animal?.dispatched_at);

  const isPermitIssued =
    isReleased ||
    rawStatusLower === "permit issued" ||
    rawStatusLower === "ready for dispatch" ||
    rawStatusLower === "ready_for_dispatch" ||
    Boolean(permit && String(permit.status || "").toLowerCase() !== "revoked") ||
    Boolean(animal?.permit_no || animal?.permit_issued_at);

  const isWeighed =
    isPermitIssued ||
    rawStatusLower === "weighed" ||
    rawStatusLower === "carcass weighed" ||
    Boolean(
      carcass &&
        (parseFloat(carcass.total_weight || carcass.cold_weight || carcass.weight || 0) > 0 ||
          carcass.status === "Completed" ||
          carcass.status === "Weighed")
    );

  const postResult = String(post?.result || "").toLowerCase();
  const postStatus = String(post?.status || "").toLowerCase();
  const isPostApproved =
    Boolean(post) &&
    (postDecision.includes("approv") ||
      postDecision.includes("pass") ||
      postResult.includes("approv") ||
      postResult.includes("pass") ||
      postStatus.includes("approv") ||
      postStatus.includes("pass") ||
      postStatus.includes("complet") ||
      isPartialCondemned);

  const isPostMortemPassed = isWeighed || isPostApproved || isPartialCondemned;

  const isSlaughterCompleted =
    isWeighed ||
    isPostMortemPassed ||
    rawStatusLower === "completed" ||
    rawStatusLower === "slaughtered" ||
    slaughterProc?.status === "Completed" ||
    slaughterRec?.status === "Completed";

  const isPendingPostMortem =
    isSlaughterCompleted && !isPostMortemPassed && !isWeighed && !isPermitIssued;

  const isSlaughterInProcess =
    !isSlaughterCompleted &&
    (rawStatusLower === "in progress" ||
      rawStatusLower === "slaughtering" ||
      rawStatusLower === "bleeding" ||
      rawStatusLower === "evisceration" ||
      slaughterProc?.status === "In Progress" ||
      slaughterRec?.status === "In Progress" ||
      Boolean(latestSlaughterStepTime));

  const isReadyForSlaughter =
    !isSlaughterCompleted &&
    !isSlaughterInProcess &&
    (rawStatusLower === "ready for slaughter" ||
      slaughterRec?.status === "Scheduled" ||
      slaughterRec?.status === "Ready for Slaughter");

  const anteResult = String(ante?.result || "").toLowerCase();
  const anteStatus = String(ante?.status || "").toLowerCase();
  const isAnteApproved =
    Boolean(ante) &&
    (anteDecision.includes("approv") ||
      anteDecision.includes("pass") ||
      anteResult.includes("approv") ||
      anteResult.includes("pass") ||
      anteStatus.includes("approv") ||
      anteStatus.includes("pass"));

  const isAnteMortemApproved =
    isSlaughterCompleted ||
    isSlaughterInProcess ||
    isReadyForSlaughter ||
    isAnteApproved ||
    rawStatusLower === "approved" ||
    rawStatusLower === "passed" ||
    rawStatusLower === "ante-mortem passed";

  const isMarked =
    !isReturnedToMarking &&
    (isAnteMortemApproved ||
      Boolean(ante) ||
      rawStatusLower === "marked" ||
      animal?.marked === true ||
      animal?.marked === "true" ||
      animal?.marked === 1 ||
      Boolean(animal?.marked_at || animal?.marking_date || animal?.mark_date || animal?.mark_type));

  let statusLabel = "Registered";
  let statusCategory = "inspection";
  let currentStageIndex = 1;

  if (isPermitIssued) {
    statusLabel = "Permit Issued";
    statusCategory = "cleared";
    currentStageIndex = 7;
  } else if (isWeighed) {
    statusLabel = "Completed";
    statusCategory = "cleared";
    currentStageIndex = 6;
  } else if (isPostMortemPassed) {
    statusLabel = isPartialCondemned ? "Partially Condemned" : "Completed";
    statusCategory = isPartialCondemned ? "inspection" : "cleared";
    currentStageIndex = 5;
  } else if (isPendingPostMortem) {
    statusLabel = "Pending Post-Mortem Inspection";
    statusCategory = "processing";
    currentStageIndex = 5;
  } else if (isSlaughterInProcess) {
    statusLabel = "Slaughter In Process";
    statusCategory = "processing";
    currentStageIndex = 4;
  } else if (isReadyForSlaughter || isAnteMortemApproved) {
    statusLabel = isReadyForSlaughter ? "Ready for Slaughter" : "Ante-Mortem Approved";
    statusCategory = isReadyForSlaughter ? "processing" : "inspection";
    currentStageIndex = 4;
  } else if (isMarked) {
    statusLabel =
      ante?.decision === "Suspect" ? "Suspect (Under Observation)" : "Awaiting Ante-Mortem";
    statusCategory = "inspection";
    currentStageIndex = 3;
  } else {
    statusLabel = isReturnedToMarking ? "Returned to Marking" : "Registered (Awaiting Marking)";
    statusCategory = "inspection";
    currentStageIndex = 2;
  }

  const steps = [
    {
      id: 1,
      key: "registered",
      label: "Registered",
      sublabel: "Registered",
      state: "completed",
      timestamp: regTimestamp,
      timestampFormatted: fmtTime(regTimestamp),
      actor: regActor,
    },
    buildMarkStep(),
    {
      id: 3,
      key: "ante_mortem",
      label: "Ante-Mortem",
      sublabel: isAnteMortemApproved
        ? "Approved"
        : ante?.decision === "Suspect"
        ? "Suspect"
        : isMarked
        ? "Awaiting Exam"
        : "Pending",
      state: isAnteMortemApproved ? "completed" : isMarked ? "current" : "pending",
      timestamp: isAnteMortemApproved || Boolean(ante) ? anteTimestamp : null,
      timestampFormatted: isAnteMortemApproved || Boolean(ante) ? fmtTime(anteTimestamp) : null,
      actor: isAnteMortemApproved || Boolean(ante) ? anteActor : null,
    },
    {
      id: 4,
      key: "slaughter",
      label: "Slaughter",
      sublabel: isSlaughterCompleted
        ? "Completed"
        : isSlaughterInProcess
        ? "In Process"
        : isReadyForSlaughter || isAnteMortemApproved
        ? "Ready in Queue"
        : "Pending",
      state: isSlaughterCompleted
        ? "completed"
        : isSlaughterInProcess || isReadyForSlaughter || isAnteMortemApproved
        ? "current"
        : "pending",
      timestamp: isSlaughterCompleted || isSlaughterInProcess ? slaughterTimestamp : null,
      timestampFormatted: isSlaughterCompleted || isSlaughterInProcess ? fmtTime(slaughterTimestamp) : null,
      actor: isSlaughterCompleted || isSlaughterInProcess ? slaughterActor : null,
    },
    {
      id: 5,
      key: "post_mortem",
      label: "Post-Mortem",
      sublabel: isPostMortemPassed
        ? isPartialCondemned
          ? "Partial Cond."
          : "Approved"
        : isPendingPostMortem
        ? "In Inspection"
        : "Pending",
      state: isPostMortemPassed
        ? "completed"
        : isPendingPostMortem
        ? "current"
        : "pending",
      timestamp: isPostMortemPassed || Boolean(post) ? postTimestamp : null,
      timestampFormatted: isPostMortemPassed || Boolean(post) ? fmtTime(postTimestamp) : null,
      actor: isPostMortemPassed || Boolean(post) ? postActor : null,
    },
    {
      id: 6,
      key: "weighing",
      label: "Weighing",
      sublabel:
        carcass?.total_weight || carcass?.cold_weight
          ? `${carcass.total_weight || carcass.cold_weight} kg`
          : isWeighed
          ? "Weighed"
          : isPostMortemPassed && !isWeighed
          ? "Awaiting Scale"
          : "Pending",
      state: isWeighed ? "completed" : isPostMortemPassed ? "current" : "pending",
      timestamp: isWeighed ? weighTimestamp : null,
      timestampFormatted: isWeighed ? fmtTime(weighTimestamp) : null,
      actor: isWeighed ? weighActor : null,
    },
    {
      id: 7,
      key: "permit",
      label: "Meat Permit",
      sublabel: isPermitIssued
        ? permit?.permit_no || animal?.permit_no || "Permit Issued"
        : isWeighed
        ? "Awaiting Permit"
        : "Pending",
      state: isPermitIssued ? "completed" : isWeighed ? "current" : "pending",
      timestamp: isPermitIssued ? permitTimestamp : null,
      timestampFormatted: isPermitIssued ? fmtTime(permitTimestamp) : null,
      actor: isPermitIssued ? permitActor : null,
    },
  ];

  return {
    statusLabel,
    statusCategory,
    currentStageIndex,
    isTerminated: false,
    isPartialCondemned,
    isReturnedToMarking,
    isReMarked,
    markTimestamp: currentMarkTimestamp,
    markTimestampFormatted: fmtTime(currentMarkTimestamp),
    initialMarkTimestamp,
    initialMarkTimestampFormatted: fmtTime(initialMarkTimestamp),
    reMarkTimestamp,
    reMarkTimestampFormatted: fmtTime(reMarkTimestamp),
    markingHistory: rawMarkingHistory,
    steps,
  };
};

export const OwnerAnimals = () => {
  const { ownerId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const ownerScopeRef = useRef({ ownerId: null, tags: new Set(), ids: new Set() });

  const [animals, setAnimals] = useState([]);
  const [ownerInfo, setOwnerInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const [query, setQuery] = useState(searchParams.get("tag") || "");
  const initialFilter = searchParams.get("filter");
  const [statusFilter, setStatusFilter] = useState(
    initialFilter === "slaughter" ? "processing" : initialFilter || "all"
  );
  const [dateFilter, setDateFilter] = useState("");

  const [selectedAnimal, setSelectedAnimal] = useState(null);
  const [condemnationModalDetails, setCondemnationModalDetails] = useState(null);

  const [milestones, setMilestones] = useState({
    ante: {},
    post: {},
    condemnation: {},
    evidence: {},
    rawEvidenceList: [],
    slaughterProc: {},
    slaughterRec: {},
    carcass: {},
    dispatch: {},
  });

  const fetchData = useCallback(async (opts) => {
    const silent = opts && opts.silent === true;
    if (!silent) setLoading(true);
    setDbError(false);
    try {
      const { data: authUserRes, error: authErr } = await supabase.auth.getUser();
      if (authErr && !authUserRes?.user) {
        console.warn("Supabase auth session check failed:", authErr);
      }
      const email = authUserRes?.user?.email?.trim().toLowerCase();

      let targetOwnerId = null;
      let foundOwner = null;

      if (email) {
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .ilike("email", email)
          .maybeSingle();
        if (oData) {
          foundOwner = oData;
          targetOwnerId = oData.id;
        } else {
          const { data: uData } = await supabase
            .from(TABLES.USERS)
            .select("owner_id, full_name")
            .ilike("email", email)
            .maybeSingle();
          if (uData?.owner_id) {
            targetOwnerId = uData.owner_id;
            const { data: oByUserId } = await supabase
              .from(TABLES.OWNERS)
              .select("*")
              .eq("id", targetOwnerId)
              .maybeSingle();
            if (oByUserId) foundOwner = oByUserId;
          }
        }
      }

      if (!targetOwnerId && ownerId) {
        targetOwnerId = ownerId;
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", targetOwnerId)
          .maybeSingle();
        if (oData) foundOwner = oData;
      }

      setOwnerInfo(foundOwner);

      if (!targetOwnerId) {
        setAnimals([]);
        setLoading(false);
        return;
      }

      let liveList = [];
      try {
        const { data: lData, error: lError } = await supabase
          .from(TABLES.LIVESTOCK)
          .select("*")
          .eq("owner_id", targetOwnerId)
          .order("received_date", { ascending: false });

        if (!lError && lData) {
          liveList = lData;
        }
      } catch (_) {}
      setAnimals(liveList);
      ownerScopeRef.current = buildOwnerScope(targetOwnerId, liveList);

      const tagList = liveList.map((a) => a.tag_number).filter(Boolean);
      const idList = liveList.map((a) => a.id).filter(Boolean);

      const expandedTagList = Array.from(
        new Set([
          ...tagList,
          ...tagList.map((t) => t.toUpperCase()),
          ...tagList.map((t) => t.toLowerCase()),
          ...tagList.map((t) => `#${t}`),
          ...tagList.map((t) => t.replace(/^#/, "")),
        ])
      );

      let anteList = [];
      let postList = [];
      let condList = [];
      let evidenceList = [];
      let slaughterProcList = [];
      let slaughterRecList = [];
      let carcassList = [];
      let dispList = [];
      let permitList = [];

      if (expandedTagList.length > 0) {
        try {
          const [
            anteRes,
            postRes,
            condRes,
            evidenceRes,
            slaughterProcRes,
            slaughterRecRes,
            carcassRes,
            dispRes,
            permitsRes,
          ] = await Promise.all([
            supabase.from(TABLES.ANTE_MORTEM).select("*").in("tag_number", expandedTagList).order("date", { ascending: false }),
            supabase.from(TABLES.POST_MORTEM).select("*").in("tag_number", expandedTagList).order("date", { ascending: false }),
            supabase.from(TABLES.CONDEMNATION_RECORDS).select("*").in("tag_number", expandedTagList).order("date", { ascending: false }),
            supabase.from(TABLES.EVIDENCE_RECORDS || "evidence_records").select("*").in("tag_number", expandedTagList),
            supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*").in("tag_number", expandedTagList),
            supabase.from(TABLES.SLAUGHTER_RECORDS).select("*").in("tag_number", expandedTagList),
            supabase.from(TABLES.CARCASS).select("*").in("tag_number", expandedTagList),
        targetOwnerId
          ? supabase.from(TABLES.DISPATCH).select("*").eq("owner_id", targetOwnerId)
          : tagList.length
          ? supabase.from(TABLES.DISPATCH).select("*").contains("tags", tagList)
          : Promise.resolve({ data: [] }),
            supabase.from(TABLES.PERMITS).select("*").in("tag_number", expandedTagList),
          ]);

          anteList = anteRes.data || [];
          postList = postRes.data || [];
          condList = condRes.data || [];
          evidenceList = evidenceRes.data || [];
          slaughterProcList = slaughterProcRes.data || [];
          slaughterRecList = slaughterRecRes.data || [];
          carcassList = carcassRes.data || [];
          dispList = dispRes.data || [];
          permitList = permitsRes.data || [];
        } catch (fetchErr) {
          console.warn("Milestone query notice:", fetchErr);
        }

        const condemnedTagSet = new Set(
          [
            ...(condList || []).map((c) => String(c.tag_number || "").trim().toLowerCase()),
            ...(anteList || [])
              .filter((a) => /condemn|reject/i.test(`${a.decision || ""} ${a.result || ""}`))
              .map((a) => String(a.tag_number || "").trim().toLowerCase()),
            ...(postList || [])
              .filter((p) => /condemn|reject|partial/i.test(`${p.decision || ""} ${p.result || ""}`) || (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0))
              .map((p) => String(p.tag_number || "").trim().toLowerCase()),
            ...(liveList || [])
              .filter((l) => /condemn|reject|partial/i.test(String(l.status || "")))
              .map((l) => String(l.tag_number || "").trim().toLowerCase()),
          ].filter(Boolean)
        );

        for (const t of tagList) {
          if (!condemnedTagSet.has(String(t || "").trim().toLowerCase())) continue;
          try {
            const cleanTag = String(t).trim().replace(/^#/, "");
            const hasDbEvidence = (evidenceList || []).some(
              (e) => String(e.tag_number || "").trim().replace(/^#/, "").toLowerCase() === cleanTag.toLowerCase()
            );
            if (!hasDbEvidence) {
              const { data: stFiles } = await supabase.storage.from("evidence").list(`evidence/${cleanTag}`);
              if (stFiles && stFiles.length > 0) {
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://zwuoebmkapoywkpyaahw.supabase.co";
                const seenFileSigs = new Set();
                const uniqueStFiles = stFiles.filter((f) => {
                  if (!f.name || f.name.startsWith(".")) return false;
                  const eTag = f.metadata?.eTag;
                  const size = f.metadata?.size;
                  const sig = eTag ? `etag:${eTag}` : (size && size > 0 ? `size:${size}` : `name:${f.name}`);
                  if (seenFileSigs.has(sig)) return false;
                  seenFileSigs.add(sig);
                  return true;
                });
                const stPhotos = uniqueStFiles
                  .slice(0, 3)
                  .map((f, i) => {
                    const fullUrl = `${supabaseUrl}/storage/v1/object/public/evidence/evidence/${cleanTag}/${f.name}`;
                    return {
                      id: f.name,
                      url: fullUrl,
                      preview: fullUrl,
                      name: `Evidence Photo ${i + 1}`,
                      size: f.metadata?.size || 0,
                    };
                  });

                if (stPhotos.length > 0) {
                  evidenceList.push({
                    id: `storage-${cleanTag}`,
                    tag_number: t,
                    type: "Photo",
                    file_url: stPhotos[0].url,
                    file_preview: stPhotos[0].url,
                    photos: stPhotos,
                    file_urls: stPhotos.map((p) => p.url),
                    notes: "Veterinary condemnation evidence photo",
                    inspection_type: "Post-Mortem",
                  });
                }
              }
            }
          } catch (stErr) {
            console.warn("Storage check notice:", stErr);
          }
        }

      }

      const mergedEvidenceList = evidenceList;
      const mergedCondList = condList;
      const mergedPostList = postList;
      const mergedAnteList = anteList;
      const mergedCarcassList = carcassList;


      const anteMap = {};
      mergedAnteList.forEach((x) => {
        if (x.livestock_id) anteMap[x.livestock_id] = x;
        if (x.tag_number) {
          if (!anteMap[x.tag_number] || x.livestock_id) {
            anteMap[x.tag_number] = x;
            anteMap[String(x.tag_number).trim().toUpperCase()] = x;
          }
        }
      });

      const postMap = {};
      mergedPostList.forEach((x) => {
        if (x.livestock_id) postMap[x.livestock_id] = x;
        if (x.tag_number) {
          if (!postMap[x.tag_number] || x.livestock_id) {
            postMap[x.tag_number] = x;
            postMap[String(x.tag_number).trim().toUpperCase()] = x;
          }
        }
      });

      const condMap = {};
      mergedCondList.forEach((x) => {
        if (x.livestock_id) {
          if (!condMap[x.livestock_id]) condMap[x.livestock_id] = [];
          condMap[x.livestock_id].push(x);
        }
        if (x.tag_number) {
          const rawTag = x.tag_number;
          const upperTag = String(x.tag_number).trim().toUpperCase();
          if (!condMap[rawTag]) condMap[rawTag] = [];
          condMap[rawTag].push(x);
          if (upperTag !== rawTag) {
            if (!condMap[upperTag]) condMap[upperTag] = [];
            condMap[upperTag].push(x);
          }
        }
      });

      const evidenceMap = {};
      mergedEvidenceList.forEach((x) => {
        if (x.livestock_id) {
          if (!evidenceMap[x.livestock_id]) evidenceMap[x.livestock_id] = [];
          evidenceMap[x.livestock_id].push(x);
        }
        if (x.tag_number) {
          const rawTag = x.tag_number;
          const upperTag = String(x.tag_number).trim().toUpperCase();
          if (!evidenceMap[rawTag]) evidenceMap[rawTag] = [];
          evidenceMap[rawTag].push(x);
          if (upperTag !== rawTag) {
            if (!evidenceMap[upperTag]) evidenceMap[upperTag] = [];
            evidenceMap[upperTag].push(x);
          }
        }
      });

      const spMap = {};
      slaughterProcList.forEach((x) => {
        if (x.tag_number) {
          spMap[x.tag_number] = x;
          spMap[String(x.tag_number).trim().toUpperCase()] = x;
        }
      });

      const srMap = {};
      slaughterRecList.forEach((x) => {
        if (x.tag_number) {
          srMap[x.tag_number] = x;
          srMap[String(x.tag_number).trim().toUpperCase()] = x;
        }
      });

      const carcassMap = {};
      mergedCarcassList.forEach((x) => {
        if (x.tag_number) {
          carcassMap[x.tag_number] = x;
          carcassMap[String(x.tag_number).trim().toUpperCase()] = x;
        }
      });

      const permitMap = {};
      permitList.forEach((x) => {
        if (x.livestock_id) permitMap[x.livestock_id] = x;
        if (x.tag_number) {
          permitMap[x.tag_number] = x;
          permitMap[String(x.tag_number).trim().toUpperCase()] = x;
        }
      });

      const dispMap = {};
      dispList.forEach((x) => {
        if (x.livestock_id) dispMap[x.livestock_id] = x;
        if (x.tag_number) {
          dispMap[x.tag_number] = x;
          dispMap[String(x.tag_number).trim().toUpperCase()] = x;
        }
        const tagsArr = Array.isArray(x.tags)
          ? x.tags
          : typeof x.tags === "string"
          ? x.tags.split(",")
          : [];
        tagsArr.forEach((t) => {
          const cleanT = String(t).trim();
          if (cleanT) {
            dispMap[cleanT] = x;
            dispMap[cleanT.toUpperCase()] = x;
          }
        });
      });

      setMilestones({
        ante: anteMap,
        post: postMap,
        condemnation: condMap,
        evidence: evidenceMap,
        rawEvidenceList: mergedEvidenceList,
        slaughterProc: spMap,
        slaughterRec: srMap,
        carcass: carcassMap,
        dispatch: dispMap,
        permits: permitMap,
      });

      const queryTag = searchParamsRef.current.get("tag");
      if (queryTag && !silent) {
        const found = liveList.find((a) => a.tag_number === queryTag);
        if (found) {
          setSelectedAnimal(found);
        }
      }
    } catch (err) {
      console.error("Critical error loading owner animals:", err);
      setDbError(true);
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  const fetchRef = useRef(fetchData);
  useEffect(() => {
    fetchRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    return subscribeOwnerLiveRefresh({
      channelName: "owner-animals-live",
      tables: [
        TABLES.LIVESTOCK,
        TABLES.ANTE_MORTEM,
        TABLES.POST_MORTEM,
        TABLES.SLAUGHTER_PROCESSING,
        TABLES.CARCASS,
        TABLES.PAYMENTS,
        TABLES.DISPATCH,
        TABLES.EVIDENCE_RECORDS || "evidence_records",
        TABLES.CONDEMNATION_RECORDS,
      ],
      getScope: () => ownerScopeRef.current,
      getRefresh: () => () => fetchRef.current({ silent: true }),
    });
  }, []);

  const handleOpenCondemnationDetails = (animal, e) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    if (!animal) return;

    const tag = animal.tag_number;
    const tagUpper = String(tag || "").trim().toUpperCase();
    const aId = animal.id;
    const details = getOwnerCondemnationDetails({
      animal,
      ante: (aId && milestones.ante[aId]) || milestones.ante[tag] || milestones.ante[tagUpper],
      post: (aId && milestones.post[aId]) || milestones.post[tag] || milestones.post[tagUpper],
      condemnation: (aId && milestones.condemnation[aId]) || milestones.condemnation[tag] || milestones.condemnation[tagUpper],
      evidence: (aId && milestones.evidence[aId]) || milestones.evidence[tag] || milestones.evidence[tagUpper] || [],
    });
    setCondemnationModalDetails(details);
  };

  const enrichedAnimals = useMemo(() => {
    return animals.map((a) => {
      const progress = calculateLivestockProgress(a, milestones);
      const tag = a.tag_number;
      const tagUpper = String(tag || "").trim().toUpperCase();
      const aId = a.id;
      const hasCondemnationState =
        progress.isTerminated ||
        progress.isPartialCondemned ||
        progress.statusCategory === "condemned" ||
        progress.statusCategory === "rejected";

      const condemnationDetails = hasCondemnationState
        ? getOwnerCondemnationDetails({
            animal: a,
            ante: (aId && milestones.ante[aId]) || milestones.ante[tag] || milestones.ante[tagUpper],
            post: (aId && milestones.post[aId]) || milestones.post[tag] || milestones.post[tagUpper],
            condemnation: (aId && milestones.condemnation[aId]) || milestones.condemnation[tag] || milestones.condemnation[tagUpper],
            evidence: (aId && milestones.evidence[aId]) || milestones.evidence[tag] || milestones.evidence[tagUpper] || [],
          })
        : null;

      return {
        ...a,
        progress,
        condemnationDetails,
      };
    });
  }, [animals, milestones]);

  useEffect(() => {
    let lastManilaDate = getManilaTodayDateString();

    const checkDateChange = () => {
      const currentManilaDate = getManilaTodayDateString();
      if (currentManilaDate !== lastManilaDate) {
        lastManilaDate = currentManilaDate;
        fetchData({ silent: true });
      }
    };

    const interval = setInterval(checkDateChange, 30000);

    let midnightTimer = null;
    const scheduleNextMidnight = () => {
      try {
        const now = new Date();
        const manilaStr = now.toLocaleString("en-US", { timeZone: "Asia/Manila" });
        const manilaNow = new Date(manilaStr);
        const nextMidnight = new Date(manilaNow);
        nextMidnight.setHours(24, 0, 1, 0);
        const msUntilMidnight = nextMidnight.getTime() - manilaNow.getTime();
        if (msUntilMidnight > 0 && msUntilMidnight < 86400000) {
          midnightTimer = setTimeout(() => {
            checkDateChange();
            scheduleNextMidnight();
          }, msUntilMidnight);
        }
      } catch (_) {}
    };
    scheduleNextMidnight();

    return () => {
      clearInterval(interval);
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, [fetchData]);

  useEffect(() => {
    if (condemnationModalDetails?.tagNumber) {
      const activeTag = String(condemnationModalDetails.tagNumber).trim().toUpperCase();
      const matched = enrichedAnimals.find(
        (a) => String(a.tag_number || "").trim().toUpperCase() === activeTag
      );
      if (matched && matched.condemnationDetails) {
        setCondemnationModalDetails(matched.condemnationDetails);
      }
    }
  }, [enrichedAnimals]);

  useEffect(() => {
    if (selectedAnimal?.tag_number) {
      const activeTag = String(selectedAnimal.tag_number).trim().toUpperCase();
      const updated = animals.find(
        (a) => String(a.tag_number || "").trim().toUpperCase() === activeTag
      );
      if (updated && updated !== selectedAnimal) {
        setSelectedAnimal((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    }
  }, [animals]);

  useEffect(() => {
    if (!selectedAnimal || condemnationModalDetails) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCloseDetails();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAnimal, condemnationModalDetails]);

  const todayEnrichedAnimals = useMemo(() => {
    return enrichedAnimals.filter((a) => {
      if (ownerInfo?.id && String(a.owner_id || "").trim() !== String(ownerInfo.id).trim()) {
        return false;
      }
      const regTimestamp = a.registered_at || a.created_at || a.received_date;
      const isRegToday = isTodayInManila(regTimestamp);
      const isProcToday = isTodayInManila(a.marked_at) || isTodayInManila(a.slaughter_date);
      return isRegToday || isProcToday;
    });
  }, [enrichedAnimals, ownerInfo?.id]);

  const countAll = todayEnrichedAnimals.length > 0
    ? todayEnrichedAnimals.reduce((sum, a) => sum + (Number(a.quantity) || 1), 0)
    : 0;
  const countInspection = todayEnrichedAnimals.filter(
    (a) => a.progress.statusCategory === "inspection"
  ).length;
  const countProcessing = todayEnrichedAnimals.filter(
    (a) => a.progress.statusCategory === "processing"
  ).length;
  const countCleared = todayEnrichedAnimals.filter(
    (a) => a.progress.statusCategory === "cleared"
  ).length;

  const filteredAnimals = useMemo(() => {
    return todayEnrichedAnimals.filter((a) => {
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const tagMatch = (a.tag_number || "").toLowerCase().includes(q);
        const speciesMatch = (a.species || "").toLowerCase().includes(q);
        const breedMatch = (a.breed || "").toLowerCase().includes(q);
        const sexMatch = formatSex(a.sex || a.gender).toLowerCase().includes(q);
        if (!tagMatch && !speciesMatch && !breedMatch && !sexMatch) return false;
      }

      if (statusFilter === "inspection") {
        if (a.progress.statusCategory !== "inspection") return false;
      } else if (statusFilter === "processing") {
        if (a.progress.statusCategory !== "processing") return false;
      } else if (statusFilter === "cleared") {
        if (a.progress.statusCategory !== "cleared") return false;
      }

      return true;
    }).sort((a, b) => {
      const timeA = new Date(a.registered_at || a.created_at || a.received_date || 0).getTime();
      const timeB = new Date(b.registered_at || b.created_at || b.received_date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true });
    });
  }, [todayEnrichedAnimals, query, statusFilter]);

  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";

  const clearAllFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };

  const handleOpenDetails = (animal) => {
    if (animals.some((a) => a.id === animal.id && a.tag_number === animal.tag_number)) {
      setSelectedAnimal(animal);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tag", animal.tag_number);
          return next;
        },
        { replace: true }
      );
    }
  };

  const handleCloseDetails = () => {
    setSelectedAnimal(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("tag");
        return next;
      },
      { replace: true }
    );
  };

  return (
    <div
      className="owner-animals-page"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        className="owner-animals-sticky-header bg-white dark:bg-slate-900"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: -16,
          paddingTop: 16,
          paddingBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Icon.Calendar size={18} style={{ color: "var(--color-primary)" }} />
            <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "var(--color-text, #1A201C)", letterSpacing: "-0.01em" }}>
              Today's Livestock
            </h1>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(24, 122, 86, 0.12)",
                color: "#187A56",
              }}
            >
              {todayEnrichedAnimals.length} Today
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={fetchData}
              title="Refresh today's database records"
              style={{
                background: "var(--color-bg, #F9FAF8)",
                border: "1px solid var(--color-border, #E2E6E3)",
                borderRadius: 8,
                padding: "4px 9px",
                color: "var(--color-text-muted, #5D6660)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                height: 28,
              }}
            >
              <Icon.RefreshCw size={11} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div style={{ position: "relative", width: "100%" }}>
          <span
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#9BA49E",
              display: "flex",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            <Icon.Search size={14} />
          </span>
          <input
            type="text"
            placeholder="Search tag, species, breed..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              height: 35,
              paddingLeft: 34,
              paddingRight: query ? 32 : 12,
              borderRadius: 10,
              border: "1px solid var(--color-border, #E2E6E3)",
              background: "var(--color-bg, #F9FAF8)",
              color: "var(--color-text, #1A201C)",
              fontSize: 12,
              fontWeight: 500,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "#9BA49E",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon.X size={14} />
            </button>
          )}
        </div>
      </div>

      <div
        className="owner-animal-list-scroll-wrapper"
        style={{
          paddingRight: 2,
          paddingBottom: 24,
        }}
      >
        {dbError ? (
          <div className="owner-error-card">
            <Icon.AlertTriangle size={36} style={{ color: "#ef4444", marginBottom: 8 }} />
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 4px 0", color: "#dc2626" }}>
              Unable to load livestock records.
            </h3>
            <p style={{ fontSize: 12, color: "#9BA49E", margin: 0 }}>
              An unexpected error occurred while communicating with the server. Please try again.
            </p>
            <button type="button" onClick={fetchData} className="owner-btn-retry">
              <Icon.RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : loading ? (
          <div className="owner-section-card" style={{ textAlign: "center", padding: 36 }}>
            <Icon.RefreshCw size={28} className="animate-spin" style={{ color: "var(--color-primary)", marginBottom: 10 }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #1A201C)" }}>
              Loading livestock records...
            </div>
            <div style={{ fontSize: 11, color: "#9BA49E", marginTop: 4 }}>
              Retrieving today's registrations from database
            </div>
          </div>
        ) : filteredAnimals.length === 0 ? (
          <div className="owner-section-card" style={{ textAlign: "center", padding: "40px 16px" }}>
            <Icon.Inbox size={36} style={{ color: "var(--color-text-muted)", marginBottom: 10 }} />
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 6px 0", color: "var(--color-text, #1A201C)" }}>
              No livestock registered today.
            </h3>
            <p style={{ fontSize: 12, color: "#5D6660", margin: 0, maxWidth: 320, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
              Newly registered livestock by abattoir receiving staff will appear here.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#187A56",
                  background: "rgba(24, 122, 86, 0.1)",
                  border: "1px solid rgba(24, 122, 86, 0.25)",
                  padding: "6px 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div className="owner-animal-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredAnimals.map((animal) => {
              const progress = animal.progress;
              const isCleared = progress.statusCategory === "cleared";
              const isProcessing = progress.statusCategory === "processing";
              const isCondemnedOrRejected = progress.statusCategory === "condemned" || progress.statusCategory === "rejected";
              const isPartial = Boolean(progress.isPartialCondemned);
              const isCondemned = !isPartial && (isCondemnedOrRejected || /condemn|reject/i.test(`${progress.statusLabel || ""} ${animal.status || ""}`));

              const tag = animal.tag_number;
              const tagUpper = String(tag || "").trim().toUpperCase();
              const aId = animal.id;
              const condRec = (aId && milestones.condemnation?.[aId]) || milestones.condemnation?.[tag] || milestones.condemnation?.[tagUpper];
              const postRec = (aId && milestones.post?.[aId]) || milestones.post?.[tag] || milestones.post?.[tagUpper];
              const anteRec = (aId && milestones.ante?.[aId]) || milestones.ante?.[tag] || milestones.ante?.[tagUpper];
              const rejectedPartsStr =
                Array.isArray(animal.condemnationDetails?.condemnedParts) && animal.condemnationDetails.condemnedParts.length > 0
                  ? animal.condemnationDetails.condemnedParts.map(p => `${p.part}${p.quantityWeight ? ` (${p.quantityWeight})` : ''}`).join(", ")
                  : Array.isArray(postRec?.condemned_parts) && postRec.condemned_parts.length > 0
                  ? postRec.condemned_parts.filter(p => p && (p.part || p.specific_part)).map((p) => `${p.specific_part ? `${p.part} (${p.specific_part})` : (p.part || "Cut")}${p.weight || p.quantity || p.weight_kg ? ` (${p.weight || p.quantity || p.weight_kg} kg)` : ""}`).join(", ")
                  : Array.isArray(condRec) && condRec.length > 0
                  ? condRec.filter(c => c && c.part && !/whole|entire|live animal/i.test(c.part)).map((c) => `${c.part}${c.weight || c.weight_kg ? ` (${c.weight || c.weight_kg} kg)` : ""}`).join(", ")
                  : condRec?.part && !/whole|entire|live animal/i.test(condRec.part)
                  ? `${condRec.part}${condRec.weight || condRec.weight_kg ? ` (${condRec.weight || condRec.weight_kg} kg)` : ""}`
                  : "Pathological cuts removed";

              if (isCondemned) {
                const condStageName = progress.condemnationStage || (progress.currentStageIndex === 3 ? "Ante-Mortem" : "Post-Mortem");
                const condTimeFormatted =
                  progress.condemnationDateFormatted ||
                  formatPhDateTime(animal.registered_at || animal.created_at || animal.received_date);

                return (
                  <div
                    key={animal.id || animal.tag_number}
                    className="owner-animal-card owner-condemned-card"
                    onClick={() => handleOpenDetails(animal)}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 14,
                      border: "1.5px solid #fecaca",
                      background: "#ffffff",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 900, color: "#1A201C", fontFamily: "monospace" }}>
                          {animal.tag_number}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#5D6660" }}>
                          {animal.species}
                        </span>
                      </div>
                      <span
                        className="owner-status-pill rejected"
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#dc2626",
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          padding: "3px 9px",
                          borderRadius: 999,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          whiteSpace: "nowrap",
                          textTransform: "uppercase",
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#dc2626" }} />
                        CONDEMNED
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ color: "#5D6660", fontWeight: 600 }}>Stage:</span>
                        <span
                          style={{
                            fontWeight: 800,
                            color: "#dc2626",
                            background: "rgba(239, 68, 68, 0.08)",
                            padding: "2px 7px",
                            borderRadius: 6,
                            border: "1px solid rgba(239, 68, 68, 0.2)",
                          }}
                        >
                          {condStageName}
                        </span>
                      </div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#5D6660" }}>
                        <Icon.Clock size={12} style={{ color: "#dc2626" }} />
                        <span>{condTimeFormatted}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="owner-condemnation-view-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenCondemnationDetails(animal, e);
                      }}
                      style={{
                        marginTop: 2,
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        fontSize: 12.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        backgroundColor: "#fef2f2",
                        color: "#dc2626",
                        border: "1.5px solid #fecaca",
                        cursor: "pointer",
                      }}
                    >
                      <Icon.Eye size={14} />
                      <span>View Evidence</span>
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={animal.id || animal.tag_number}
                  className="owner-animal-card"
                  onClick={() => handleOpenDetails(animal)}
                  style={{ cursor: "pointer" }}
                  title="Tap to view official livestock record"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span
                      className="owner-animal-tag"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        letterSpacing: "0.02em",
                        color: "var(--color-text, #1A201C)",
                      }}
                    >
                      {animal.tag_number}
                    </span>

                    <span
                      className={`owner-status-pill ${
                        isCondemnedOrRejected
                          ? "rejected"
                          : isCleared
                          ? "released"
                          : isProcessing
                          ? "processing"
                          : "inspection"
                      }`}
                      style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: isCondemnedOrRejected
                            ? "#ef4444"
                            : isCleared
                            ? "#10b981"
                            : isProcessing
                            ? "#24966D"
                            : "#f59e0b",
                        }}
                      />
                      {progress.statusLabel}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--color-text-muted, #5D6660)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "var(--color-text-muted, #9BA49E)", fontWeight: 500 }}>Sex:</span>
                      <strong style={{ color: "var(--color-text, #444C47)", fontWeight: 700 }}>
                        {formatSex(animal.sex || animal.gender)}
                      </strong>
                    </span>

                    <span style={{ color: "var(--color-border, #C2CAC4)" }}>—</span>

                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon.Clock size={12} style={{ color: "#24966D", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>
                        {formatPhDateTime(animal.registered_at || animal.created_at || animal.received_date)}
                      </span>
                    </span>
                  </div>

                  {isPartial && (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        backgroundColor: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: 10,
                        padding: "7px 12px",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#92400e", minWidth: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#d97706", flexShrink: 0 }} />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <strong style={{ color: "#b45309" }}>Partially Condemned:</strong> {rejectedPartsStr}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCondemnationDetails(animal, e);
                        }}
                        style={{
                          padding: "3px 9px",
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: 700,
                          backgroundColor: "#f59e0b",
                          color: "#ffffff",
                          border: "none",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          flexShrink: 0,
                        }}
                        title="View Partial Condemnation Details"
                      >
                        <Icon.Eye size={12} />
                        <span>View</span>
                      </button>
                    </div>
                  )}

                <div
                  className="owner-tracker-wrap no-scrollbar"
                  style={{
                    backgroundColor: "rgba(0, 0, 0, 0.02)",
                    borderRadius: 14,
                    padding: "8px 6px",
                    marginTop: 12,
                  }}
                >
                  {progress.steps.map((st) => {
                    const isDone = st.state === "completed";
                    const isCurr = st.state === "current";
                    const isRej = st.state === "rejected" || st.state === "condemned";

                    return (
                      <div
                        key={st.id}
                        className={`owner-tracker-step ${st.state}`}
                        title={`${st.label}: ${st.sublabel}${st.timestampFormatted && st.timestampFormatted !== "—" ? ` (${st.timestampFormatted})` : ""}`}
                      >
                        <div className="owner-tracker-dot">
                          {isDone ? (
                            <Icon.Check size={13} strokeWidth={3} />
                          ) : isCurr ? (
                            <span style={{ fontSize: 8 }}>●</span>
                          ) : isRej ? (
                            <Icon.X size={12} strokeWidth={3} />
                          ) : (
                            <span style={{ fontSize: 9 }}>○</span>
                          )}
                        </div>
                        <span className="owner-tracker-title">{st.label}</span>
                        <span className="owner-tracker-sub">{st.sublabel}</span>
                        {st.timestampFormatted && st.timestampFormatted !== "—" && (
                          <span className="owner-tracker-time">{st.timestampFormatted}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="owner-card-footer">
                  <span>View Details</span>
                  <Icon.ChevronRight size={14} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {selectedAnimal && (
        <div
          className="owner-modal-backdrop owner-animal-detail-overlay"
          onClick={(e) => {
            e.stopPropagation();
            handleCloseDetails();
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(26, 32, 28, 0.75)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
          }}
        >
          <div className="owner-modal-sheet owner-animal-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-sheet-handle" />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div>
                  <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: "#187A56", letterSpacing: "0.04em" }}>
                    Verified Abattoir Record
                  </span>
                  <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0, fontFamily: "monospace", color: "var(--color-text, #1A201C)" }}>
                    {selectedAnimal.tag_number}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseDetails}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "#EFF2F0",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#5D6660",
                  cursor: "pointer",
                }}
                title="Close"
              >
                <Icon.X size={16} />
              </button>
            </div>

            {(() => {
              const prog = calculateLivestockProgress(selectedAnimal, milestones);
              const isCondemned = prog.statusCategory === "condemned" || prog.statusCategory === "rejected";
              const isCleared = prog.statusCategory === "cleared";

              return (
                <div
                  style={{
                    backgroundColor: isCondemned ? "#fef2f2" : isCleared ? "#ecfdf5" : "#f0f9ff",
                    border: `1px solid ${isCondemned ? "#fecaca" : isCleared ? "#a7f3d0" : "#bae6fd"}`,
                    borderRadius: 14,
                    padding: "10px 14px",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 800,
                          color: isCondemned ? "#dc2626" : isCleared ? "#059669" : "#136647",
                          textTransform: "uppercase",
                        }}
                      >
                        Status: {isCondemned ? "CONDEMNED" : prog.statusLabel}
                      </span>
                      {isCondemned && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#dc2626",
                            background: "rgba(239, 68, 68, 0.1)",
                            padding: "1px 6px",
                            borderRadius: 4,
                          }}
                        >
                          {prog.condemnationStage || (prog.currentStageIndex === 3 ? "Ante-Mortem" : "Post-Mortem")}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: isCondemned ? "#dc2626" : "#187A56" }}>
                      Stage {prog.currentStageIndex} of 7
                    </span>
                  </div>

                  <div
                    style={{
                      height: 5,
                      backgroundColor: isCondemned ? "#fee2e2" : "#e0f2fe",
                      borderRadius: 3,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${(prog.currentStageIndex / 7) * 100}%`,
                        backgroundColor: isCondemned ? "#ef4444" : isCleared ? "#10b981" : "#187A56",
                        borderRadius: 3,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            {(() => {
              const selTag = selectedAnimal.tag_number;
              const selTagUpper = String(selTag || "").trim().toUpperCase();
              const selId = selectedAnimal.id;
              const prog = calculateLivestockProgress(selectedAnimal, milestones);
              if (!prog.isPartialCondemned) return null;

              const postRec = (selId && milestones.post[selId]) || milestones.post[selTag] || milestones.post[selTagUpper] || null;
              const condRecList = (selId && milestones.condemnation[selId]) || milestones.condemnation[selTag] || milestones.condemnation[selTagUpper] || [];
              const condRec = Array.isArray(condRecList) ? condRecList[0] : condRecList;
              const modalRejectedPartsStr =
                Array.isArray(selectedAnimal.condemnationDetails?.condemnedParts) && selectedAnimal.condemnationDetails.condemnedParts.length > 0
                  ? selectedAnimal.condemnationDetails.condemnedParts.map(p => `${p.part}${p.quantityWeight ? ` (${p.quantityWeight})` : ''}`).join(", ")
                  : Array.isArray(postRec?.condemned_parts) && postRec.condemned_parts.length > 0
                  ? postRec.condemned_parts.filter(p => p && (p.part || p.specific_part)).map((p) => `${p.specific_part ? `${p.part} (${p.specific_part})` : (p.part || "Cut")}${p.weight || p.quantity || p.weight_kg ? ` (${p.weight || p.quantity || p.weight_kg} kg)` : ""}`).join(", ")
                  : Array.isArray(condRecList) && condRecList.length > 0
                  ? condRecList.filter(c => c && c.part && !/whole|entire|live animal/i.test(c.part)).map((c) => `${c.part}${c.weight || c.weight_kg ? ` (${c.weight || c.weight_kg} kg)` : ""}`).join(", ")
                  : condRec?.part && !/whole|entire|live animal/i.test(condRec.part)
                  ? `${condRec.part}${condRec.weight || condRec.weight_kg ? ` (${condRec.weight || condRec.weight_kg} kg)` : ""}`
                  : "Pathological cuts removed";

              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    backgroundColor: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#92400e", minWidth: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#d97706", flexShrink: 0 }} />
                    <span>
                      <strong style={{ color: "#b45309" }}>Partially Condemned:</strong> {modalRejectedPartsStr}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenCondemnationDetails(selectedAnimal, e);
                    }}
                    style={{
                      padding: "3px 9px",
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontWeight: 700,
                      backgroundColor: "#f59e0b",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                    title="View Partial Condemnation Details"
                  >
                    <Icon.Eye size={12} />
                    <span>View</span>
                  </button>
                </div>
              );
            })()}

            {(() => {
              const selTag = selectedAnimal.tag_number;
              const selTagUpper = String(selTag || "").trim().toUpperCase();
              const prog = calculateLivestockProgress(selectedAnimal, milestones);
              const stepMap = {};
              (prog.steps || []).forEach((s) => {
                stepMap[s.key] = s;
              });

              const anteRec = milestones.ante[selTag] || milestones.ante[selTagUpper] || null;
              const postRec = milestones.post[selTag] || milestones.post[selTagUpper] || null;
              const condRecList = milestones.condemnation[selTag] || milestones.condemnation[selTagUpper] || [];
              const condRec = Array.isArray(condRecList) ? condRecList[0] : condRecList;
              const spRec = milestones.slaughterProc[selTag] || milestones.slaughterProc[selTagUpper] || null;
              const srRec = milestones.slaughterRec[selTag] || milestones.slaughterRec[selTagUpper] || null;
              const carcassRec = milestones.carcass[selTag] || milestones.carcass[selTagUpper] || null;
              const permitRec =
                (milestones.permits &&
                  (milestones.permits[selectedAnimal.id] ||
                    milestones.permits[selTag] ||
                    milestones.permits[selTagUpper])) ||
                null;
              const dispRec =
                milestones.dispatch[selectedAnimal.id] ||
                milestones.dispatch[selTag] ||
                milestones.dispatch[selTagUpper] ||
                null;

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="owner-section-card" style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, color: "var(--color-text, #1A201C)" }}>
                        <Icon.Clock size={15} style={{ color: "#187A56" }} />
                        <span>Official Workflow Timeline</span>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5D6660" }}>
                        Date &amp; Time (PH)
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {prog.steps.map((st) => {
                        const isDone = st.state === "completed";
                        const isCurr = st.state === "current";
                        const isRej = st.state === "rejected" || st.state === "condemned";
                        const hasTime = Boolean(st.timestampFormatted && st.timestampFormatted !== "—");

                        return (
                          <div
                            key={st.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "9px 11px",
                              borderRadius: 12,
                              backgroundColor: isDone
                                ? "rgba(16, 185, 129, 0.06)"
                                : isCurr
                                ? "rgba(24, 122, 86, 0.08)"
                                : isRej
                                ? "rgba(239, 68, 68, 0.08)"
                                : "rgba(148, 163, 184, 0.06)",
                              border: `1px solid ${
                                isDone
                                  ? "rgba(16, 185, 129, 0.22)"
                                  : isCurr
                                  ? "rgba(24, 122, 86, 0.28)"
                                  : isRej
                                  ? "rgba(239, 68, 68, 0.28)"
                                  : "rgba(148, 163, 184, 0.16)"
                              }`,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                              <div
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  backgroundColor: isDone
                                    ? "#10b981"
                                    : isCurr
                                    ? "#187A56"
                                    : isRej
                                    ? "#ef4444"
                                    : "#E2E6E3",
                                  color: isDone || isCurr || isRej ? "#ffffff" : "#5D6660",
                                }}
                              >
                                {isDone ? (
                                  <Icon.Check size={12} strokeWidth={3} />
                                ) : isRej ? (
                                  <Icon.X size={12} strokeWidth={3} />
                                ) : (
                                  st.id
                                )}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text, #1A201C)" }}>
                                  {st.id}. {st.label}
                                </div>
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    color: isDone
                                      ? "#059669"
                                      : isCurr
                                      ? "#187A56"
                                      : isRej
                                      ? "#dc2626"
                                      : "#9BA49E",
                                  }}
                                >
                                  {st.sublabel}
                                  {st.actor ? ` • ${st.actor}` : ""}
                                </div>
                              </div>
                            </div>

                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    padding: "2px 8px",
                                    borderRadius: 6,
                                    background: isDone
                                      ? "rgba(16, 185, 129, 0.12)"
                                      : isRej
                                      ? "rgba(239, 68, 68, 0.12)"
                                      : isCurr
                                      ? "rgba(24, 122, 86, 0.12)"
                                      : "rgba(148, 163, 184, 0.12)",
                                    color: isDone ? "#10b981" : isRej ? "#dc2626" : isCurr ? "#24966D" : "#5D6660",
                                    border: isRej ? "1px solid rgba(239, 68, 68, 0.28)" : "none",
                                  }}
                                >
                                  {isRej ? "Condemned" : isDone ? "Completed" : isCurr ? "Active" : "Pending"}
                                </span>

                                {isRej && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenCondemnationDetails(selectedAnimal, e);
                                    }}
                                    style={{
                                      padding: "2px 8px",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      backgroundColor: "#dc2626",
                                      color: "#ffffff",
                                      border: "none",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3.5,
                                      lineHeight: 1.4,
                                      flexShrink: 0,
                                    }}
                                    title="View Condemnation Details"
                                  >
                                    <Icon.Eye size={11} />
                                    <span>View</span>
                                  </button>
                                )}

                                {st.id === 5 && prog.isPartialCondemned && !isRej && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenCondemnationDetails(selectedAnimal, e);
                                    }}
                                    style={{
                                      padding: "2px 8px",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      backgroundColor: "#f59e0b",
                                      color: "#ffffff",
                                      border: "none",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3.5,
                                      lineHeight: 1.4,
                                      flexShrink: 0,
                                    }}
                                    title="View Partial Condemnation Details"
                                  >
                                    <Icon.Eye size={11} />
                                    <span>View</span>
                                  </button>
                                )}
                              </div>

                              {hasTime ? (
                                <div
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: isRej ? "#dc2626" : "var(--color-text, #444C47)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    justifyContent: "flex-end",
                                    marginTop: 2,
                                  }}
                                >
                                  <Icon.Clock size={10} style={{ color: isRej ? "#dc2626" : "#187A56" }} />
                                  <span>{st.timestampFormatted}</span>
                                </div>
                              ) : (
                                <div style={{ fontSize: 10, fontWeight: 600, color: "#9BA49E", fontStyle: "italic", marginTop: 2 }}>
                                  {st.sublabel === "Stopped" ? "Stopped" : "Pending"}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={handleCloseDetails}
              style={{
                width: "100%",
                background: "#187A56",
                color: "#ffffff",
                border: "none",
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "12px 16px",
                marginTop: 16,
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Close Details
            </button>
          </div>
        </div>
      )}

      <OwnerCondemnationModal
        open={!!condemnationModalDetails}
        onClose={() => setCondemnationModalDetails(null)}
        details={condemnationModalDetails}
      />
    </div>
  );
};

export { OwnerAnimals as Animals };
export default OwnerAnimals;
