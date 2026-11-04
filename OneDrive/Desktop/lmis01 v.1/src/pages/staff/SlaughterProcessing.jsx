import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Modal, AlertDialog, EmptyState, Badge, TagBadge } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { useAuth } from "../../hooks/useAuth";
import { TABLES, OPERATOR_TEAMS } from "../../utils/constants";
import { staffService } from "../../services/staffService";
import { formatDate, formatFullDate, formatTime, formatPhDateTime, formatPhDate, initials, today, isWaitingForSlaughter, isStepDone, getStepTimestamp, getStepUser, formatSex } from "../../utils/helpers";
import { ProcessHistoryTimeline } from "../../components/common/ProcessHistoryTimeline";
import { getCurrentActor } from "../../utils/processHistory";

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

const extractStepsFromHistory = (livestockItem) => {
  if (!livestockItem?.process_history) return null;
  const history = Array.isArray(livestockItem.process_history)
    ? livestockItem.process_history
    : (() => { try { return JSON.parse(livestockItem.process_history); } catch (_) { return []; } })();
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const evt = history[i];
    if (evt?.details?.steps && typeof evt.details.steps === "object") {
      return evt.details.steps;
    }
  }
  return null;
};


const isValidIsoTimestamp = (val) => {
  if (!val || val === "—") return false;
  const str = String(val).trim();
  if (!str.includes("T") && !str.includes(":") && !str.includes("Z")) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
};

const resolveStartedAt = (p, stepsObj, l, s) => {
  // 1. Direct explicit started_at fields
  if (isValidIsoTimestamp(p?.started_at)) return p.started_at;
  if (isValidIsoTimestamp(p?.slaughter_started_at)) return p.slaughter_started_at;
  if (isValidIsoTimestamp(stepsObj?.started_at)) return stepsObj.started_at;

  // 2. Earliest step completion timestamp
  if (stepsObj) {
    for (const step of STEPS) {
      const stepVal = stepsObj[step.key];
      if (stepVal && typeof stepVal === "object" && isValidIsoTimestamp(stepVal.completed_at)) {
        return stepVal.completed_at;
      }
    }
  }

  // 3. Livestock / Slaughter Record actual timestamps from Supabase
  if (isValidIsoTimestamp(l?.slaughter_started_at)) return l.slaughter_started_at;
  if (isValidIsoTimestamp(l?.marked_at)) return l.marked_at;
  if (isValidIsoTimestamp(p?.created_at)) return p.created_at;
  if (isValidIsoTimestamp(s?.created_at)) return s.created_at;
  if (isValidIsoTimestamp(l?.created_at)) return l.created_at;

  // 4. Date string fallback
  const fallbackDate = p?.slaughter_start_date || p?.date || l?.slaughter_start_date || l?.mark_date || l?.date;
  if (fallbackDate) return fallbackDate;

  return null;
};

const resolveCompletedAt = (p, stepsObj, l, s) => {
  // 1. Direct explicit completed_at fields
  if (isValidIsoTimestamp(p?.completed_at)) return p.completed_at;
  if (isValidIsoTimestamp(p?.slaughter_completed_at)) return p.slaughter_completed_at;
  if (isValidIsoTimestamp(stepsObj?.completed_at)) return stepsObj.completed_at;

  // 2. Latest step completion timestamp (e.g. final washing step)
  if (stepsObj) {
    for (let i = STEPS.length - 1; i >= 0; i--) {
      const stepVal = stepsObj[STEPS[i].key];
      if (stepVal && typeof stepVal === "object" && isValidIsoTimestamp(stepVal.completed_at)) {
        return stepVal.completed_at;
      }
    }
  }

  // 3. Livestock / Slaughter Record actual completion timestamps from Supabase
  if (isValidIsoTimestamp(l?.slaughter_completed_at)) return l.slaughter_completed_at;
  if (isValidIsoTimestamp(p?.updated_at)) return p.updated_at;
  if (isValidIsoTimestamp(s?.updated_at)) return s.updated_at;
  if (isValidIsoTimestamp(l?.updated_at)) return l.updated_at;

  // 4. Date string fallback
  const fallbackDate = p?.date || l?.slaughter_end_date || l?.slaughter_date || l?.date;
  if (fallbackDate) return fallbackDate;

  return null;
};

const formatSpeciesList = (list) => {
  const arr = (list && list.length > 0 ? list : ["Livestock"]).filter(Boolean);
  const SPECIES_ORDER = ["Hog", "Carabao", "Cattle", "Goat"];
  const sorted = [...arr].sort((a, b) => {
    const idxA = SPECIES_ORDER.indexOf(a);
    const idxB = SPECIES_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
  return sorted.join(", ");
};

const getSpeciesStyle = (species) => {
  switch (species) {
    case "Hog":
      return { bg: "var(--color-violet-bg)", text: "var(--color-violet)", border: "rgba(139, 92, 246, 0.35)" };
    case "Cattle":
      return { bg: "var(--color-info-bg)", text: "var(--color-info)", border: "rgba(14, 165, 233, 0.35)" };
    case "Carabao":
      return { bg: "var(--color-success-bg)", text: "var(--color-success)", border: "rgba(16, 185, 129, 0.35)" };
    case "Goat":
    default:
      return { bg: "var(--color-warning-bg)", text: "var(--color-warning)", border: "rgba(245, 158, 11, 0.35)" };
  }
};

// The sequential steps of the slaughterhouse operation
const STEPS = [
  { key: "bathing", label: "Bathing", icon: <Icon.Droplet size={15} />, desc: "Clean hide & pre-slaughter shower" },
  { key: "stunning", label: "Stunning / Sticking", icon: <Icon.Activity size={15} />, desc: "Humane stunning & initial stick" },
  { key: "bleeding", label: "Bleeding", icon: <Icon.Drop size={15} />, desc: "Complete blood collection & drainage" },
  { key: "scalding", label: "Scalding", icon: <Icon.Droplet size={15} />, desc: "Hot water scalding tank immersion" },
  { key: "dehairing", label: "Dehairing / Skinning", icon: <Icon.Scissors size={15} />, desc: "Mechanical dehairing & scraping" },
  { key: "washing", label: "Final Carcass Wash", icon: <Icon.Droplet size={15} />, desc: "Sanitary wash & post-mortem handoff" },
];

const emptySteps = () => Object.fromEntries(STEPS.map((s) => [s.key, false]));
const countDone = (steps) => STEPS.filter((s) => isStepDone(steps, s.key)).length;

const getNextStepName = (steps) => {
  const next = STEPS.find((step) => !isStepDone(steps, step.key));
  return next?.label || "All Done";
};

const resolveSlaughterTime = (rec) => {
  if (!rec) return formatTime(new Date());
  const raw =
    rec.started_at ||
    rec.slaughter_started_at ||
    rec.steps?.started_at ||
    rec.slaughter_start_time ||
    rec.mark_time ||
    rec.time_marked ||
    rec.time;
  if (raw && raw !== "—") {
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime()) && String(raw).includes("T")) {
        return d.toLocaleTimeString("en-US", {
          timeZone: "Asia/Manila",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      }
    } catch (_) {}
    const formatted = formatTime(raw);
    if (formatted && formatted !== "—") return formatted;
  }
  return formatTime(new Date());
};

const CheckboxWithIndeterminate = ({ checked, indeterminate, onChange, style, id, disabled, title }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      id={id}
      type="checkbox"
      ref={ref}
      checked={Boolean(checked)}
      disabled={disabled}
      title={title}
      onChange={onChange}
      style={{
        width: 17,
        height: 17,
        accentColor: "var(--color-primary, #0284c7)",
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    />
  );
};

export const SlaughterProcessing = () => {
  const {
    data: processing = [],
    loading: loadingProcessing,
    error: errorProcessing,
    refresh: refreshProcessing,
  } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const {
    data: slaughter = [],
    loading: loadingSlaughter,
    error: errorSlaughter,
    refresh: refreshSlaughter,
  } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const {
    data: livestock = [],
    loading: loadingLivestock,
    error: errorLivestock,
    refresh: refreshLivestock,
  } = useSupabase(TABLES.LIVESTOCK);
  const { data: owners = [] } = useSupabase(TABLES.OWNERS);
  const { data: anteMortem = [] } = useSupabase(TABLES.ANTE_MORTEM);
  const currentUserIdentifier = getCurrentActor().name || session?.full_name || session?.name || username || userName || "Staff Personnel";

  const isRecordsLoading = (loadingProcessing || loadingSlaughter || loadingLivestock) &&
    (!slaughter?.length && !livestock?.length && !processing?.length);
  const recordsError = errorSlaughter || errorLivestock || errorProcessing;

  const refreshAll = () => {
    refreshProcessing?.();
    refreshSlaughter?.();
    refreshLivestock?.();
  };

  const { showToast } = useToast();
  const [startOpen, setStartOpen] = useState(false);
  const [active, setActive] = useState(null); // record being updated in 6-step modal
  const [startForm, setStartForm] = useState({ tag_number: "", operator: "Team A" });
  const [submittingStart, setSubmittingStart] = useState(false);
  const [updatingStep, setUpdatingStep] = useState(null);
  const [completionPopup, setCompletionPopup] = useState(null);
  const [assignSuccessData, setAssignSuccessData] = useState(null);
  const [assignConfirmData, setAssignConfirmData] = useState(null);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [targetTagsForModal, setTargetTagsForModal] = useState([]);
  const [modalSelectedTags, setModalSelectedTags] = useState(new Set());
  const [expandedModalOwnerKey, setExpandedModalOwnerKey] = useState(null);
  const [expandedReadyOwnerKey, setExpandedReadyOwnerKey] = useState(null);
  const [groupToMarkSlaughtered, setGroupToMarkSlaughtered] = useState(null);
  const [submittingGroupSlaughter, setSubmittingGroupSlaughter] = useState(false);
  const [singleToMarkDone, setSingleToMarkDone] = useState(null);
  const [submittingSingleId, setSubmittingSingleId] = useState(null);
  const [singleSuccessData, setSingleSuccessData] = useState(null);
  const [groupSuccessData, setGroupSuccessData] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const selectAllCheckboxRef = useRef(null);
  const shownCompletionRef = useRef(new Set());

  const COMPLETED_POPUP_STORAGE_KEY = "lsmis_slaughter_completed_popups_v1";

  const hasShownCompletionPopup = (completionKey) => {
    if (!completionKey) return false;
    if (shownCompletionRef.current.has(completionKey)) return true;
    try {
      const raw = sessionStorage.getItem(COMPLETED_POPUP_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.includes(completionKey)) return true;
      }
    } catch (_) {}
    return false;
  };

  const markCompletionPopupShown = (completionKey) => {
    if (!completionKey) return;
    shownCompletionRef.current.add(completionKey);
    try {
      const raw = sessionStorage.getItem(COMPLETED_POPUP_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      if (!list.includes(completionKey)) {
        list.push(completionKey);
        sessionStorage.setItem(COMPLETED_POPUP_STORAGE_KEY, JSON.stringify(list));
      }
    } catch (_) {}
  };

  const formatCompletionDisplayTag = (rec) => {
    const rawTag = String(rec?.tag_number || "").trim();
    const matchedAnimal = (livestock || []).find(
      (l) => String(l.tag_number || "").trim().toUpperCase() === rawTag.toUpperCase() || (l.id && l.id === rec?.id)
    );
    const rawSpecies = String(rec?.species || matchedAnimal?.species || "").trim();
    if (!rawTag) return rawSpecies ? rawSpecies.toUpperCase() : "Livestock";
    if (!rawSpecies) return rawTag;
    const upperTag = rawTag.toUpperCase();
    const upperSpecies = rawSpecies.toUpperCase();
    if (upperTag.endsWith(`-${upperSpecies}`) || upperTag.includes(upperSpecies)) {
      return rawTag;
    }
    return `${rawTag}-${upperSpecies}`;
  };

  const handleConfirmCompletionPopup = () => {
    setCompletionPopup(null);
    setActive(null);
    setUpdatingStep(null);
    setStartForm({ tag_number: "", operator: "Team A" });
    refreshAll();
  };

  // Default view is 'awaiting': 'awaiting' | 'active'
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "awaiting" || urlTab === "active") return urlTab;
    if (urlTab === "in-progress" || urlTab === "tracking") return "active";
    return "awaiting";
  });
  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSpecies, setFilterSpecies] = useState("all");

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "awaiting" || urlTab === "active") {
      setActiveTab(urlTab);
    } else if (urlTab === "in-progress" || urlTab === "tracking") {
      setActiveTab("active");
    }
    const q = searchParams.get("tag") || searchParams.get("search");
    if (q) {
      setSearch(q);
    }
  }, [searchParams]);

  // Pagination states for tables
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [search, filterSpecies, activeTab]);

  // Check and apply 24-hour marking fallback on load and periodically when active
  useEffect(() => {
    staffService.processMarking24hFallback()
      .then((res) => {
        if (res && (res.processed > 0 || res.processed_count > 0)) {
          refreshAll();
        }
      })
      .catch(() => {});

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      staffService.processMarking24hFallback()
        .then((res) => {
          if (res && (res.processed > 0 || res.processed_count > 0)) {
            refreshAll();
          }
        })
        .catch(() => {});
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  // Animals actively undergoing floor operations (In Progress / Active Floor Operations)
  // Merges processing table records and livestock/slaughter records with assigned operators or 'In Progress' status
  const inProgress = useMemo(() => {
    const map = new Map();

    // 1. From slaughter_processing
    (processing || []).forEach((p) => {
      const tagKey = String(p.tag_number || "").trim().toUpperCase();
      if (!tagKey) return;

      const fbAt = p.fallback_at || null;
      const reAt = p.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
      if (isFallback || p.status === "Pending Reassignment" || p.operator === "Unassigned") return;

      const l = (livestock || []).find((item) => String(item.tag_number || "").trim().toUpperCase() === tagKey);
      const lowerLSt = String(l?.status || "").trim().toLowerCase();
      if (
        lowerLSt === "completed" ||
        lowerLSt === "slaughtered" ||
        lowerLSt === "weighed" ||
        lowerLSt === "paid" ||
        lowerLSt === "dispatched" ||
        lowerLSt === "released" ||
        lowerLSt === "condemned" ||
        lowerLSt === "rejected" ||
        lowerLSt.includes("post-mortem") ||
        lowerLSt.includes("post mortem")
      ) {
        return;
      }

      const stepsObj = safeParseSteps(p.steps) || extractStepsFromHistory(l);
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      if (p.status === "Completed" || doneCount >= 6) {
        return;
      }

      if (p.status === "In Progress" || !p.status) {
        const startedAt = p.started_at || p.slaughter_started_at || stepsObj?.started_at || null;
        const matchingSlaughter = (slaughter || []).find((s) => String(s.tag_number || "").trim().toUpperCase() === tagKey);
        const resolvedSex = l?.sex || matchingSlaughter?.sex || p?.sex || "";
        map.set(tagKey, {
          ...(l || {}),
          ...p,
          id: l?.id || p?.id,
          livestock_id: l?.id || null,
          processing_id: p?.id || null,
          tag_number: l?.tag_number || p?.tag_number,
          sex: resolvedSex,
          species: l?.species || matchingSlaughter?.species || p?.species || "Livestock",
          owner_name: l?.owner_name || matchingSlaughter?.owner_name || p?.owner_name || resolveOwnerName(l) || "Unknown Owner",
          started_at: startedAt,
          slaughter_started_at: startedAt,
          steps: stepsObj || emptySteps(),
          status: "In Progress"
        });
      }
    });

    // 2. Synthesize from livestock table if status is "In Progress" or "Slaughtering" or if animal is assigned to an operator (and not fallback, and not downstream/finalized)
    (livestock || []).forEach((l) => {
      const tagKey = String(l.tag_number || "").trim().toUpperCase();
      if (!tagKey) return;
      const lowerSt = String(l.status || "").trim().toLowerCase();

      // Exclude downstream or finalized
      if (
        lowerSt === "completed" ||
        lowerSt === "slaughtered" ||
        lowerSt === "weighed" ||
        lowerSt === "paid" ||
        lowerSt === "dispatched" ||
        lowerSt === "released" ||
        lowerSt === "condemned" ||
        lowerSt === "rejected" ||
        lowerSt.includes("post-mortem") ||
        lowerSt.includes("post mortem")
      ) {
        return;
      }

      const fbAt = l.fallback_at || null;
      const reAt = l.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
      if (isFallback) return;

      const p = (processing || []).find((proc) => String(proc.tag_number || "").trim().toUpperCase() === tagKey);
      const stepsObj = safeParseSteps(p?.steps) || extractStepsFromHistory(l);
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      if (p?.status === "Completed" || doneCount >= 6) {
        return;
      }

      const assignedOp = (
        (l.operator && l.operator !== "Unassigned") ||
        (l.previous_operator && l.previous_operator !== "Unassigned")
      ) ? (l.operator && l.operator !== "Unassigned" ? l.operator : l.previous_operator) : null;

      const isInProgressStatus = lowerSt === "in progress" || lowerSt === "slaughtering" || lowerSt === "processing";
      const isAssigned = Boolean(assignedOp);

      if ((isInProgressStatus || isAssigned) && !map.has(tagKey)) {
        const startedAt = p?.started_at || p?.slaughter_started_at || stepsObj?.started_at || l.slaughter_started_at || l.reassigned_at || l.marked_at || l.received_date || null;
        map.set(tagKey, {
          id: l.id,
          livestock_id: l.id,
          processing_id: p?.id || null,
          tag_number: l.tag_number,
          species: l.species || "Livestock",
          sex: l.sex || p?.sex || "",
          owner_name: l.owner_name || resolveOwnerName(l) || "Unknown Owner",
          operator: p?.operator || assignedOp || l.operator || "Team A",
          date: l.slaughter_start_date || l.slaughter_date || l.mark_date || today(),
          slaughter_start_date: l.slaughter_start_date || l.slaughter_date || l.mark_date || today(),
          slaughter_start_time: l.slaughter_start_time || l.mark_time || (startedAt && startedAt.includes("T") ? startedAt.split("T")[1]?.slice(0, 8) : "") || "",
          slaughter_started_at: startedAt,
          started_at: startedAt,
          steps: stepsObj || emptySteps(),
          status: "In Progress",
          notes: p?.notes || ""
        });
      }
    });

    // 3. Also check slaughter records if assigned operator and not yet in map
    (slaughter || []).forEach((s) => {
      const tagKey = String(s.tag_number || "").trim().toUpperCase();
      if (!tagKey || map.has(tagKey)) return;
      const lowerSt = String(s.status || "").trim().toLowerCase();
      if (
        lowerSt === "completed" ||
        lowerSt === "slaughtered" ||
        lowerSt === "released" ||
        lowerSt === "dispatched"
      ) {
        return;
      }
      const fbAt = s.fallback_at || null;
      const reAt = s.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
      if (isFallback) return;

      const op = s.operator && s.operator !== "Unassigned" ? s.operator : null;
      if (op) {
        const l = (livestock || []).find((item) => String(item.tag_number || "").trim().toUpperCase() === tagKey);
        const p = (processing || []).find((proc) => String(proc.tag_number || "").trim().toUpperCase() === tagKey);
        const stepsObj = safeParseSteps(p?.steps) || extractStepsFromHistory(l);
        const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
        if (p?.status === "Completed" || s.status === "Completed" || doneCount >= 6) {
          return;
        }

        const startedAt = p?.started_at || p?.slaughter_started_at || stepsObj?.started_at || s.slaughter_date || s.reassigned_at || null;
        map.set(tagKey, {
          id: l?.id || s.livestock_id || s.id,
          livestock_id: l?.id || s.livestock_id || null,
          processing_id: p?.id || null,
          slaughter_id: s.id,
          tag_number: s.tag_number,
          species: s.species || l?.species || "Livestock",
          sex: s.sex || l?.sex || "",
          owner_name: s.owner_name || l?.owner_name || "Unknown Owner",
          operator: p?.operator || op,
          date: s.scheduled_date || s.slaughter_date || s.mark_date || today(),
          slaughter_start_date: s.scheduled_date || s.slaughter_date || s.mark_date || today(),
          slaughter_start_time: s.mark_time || (startedAt && startedAt.includes("T") ? startedAt.split("T")[1]?.slice(0, 8) : "") || "",
          slaughter_started_at: startedAt,
          started_at: startedAt,
          steps: stepsObj || emptySteps(),
          status: "In Progress",
          notes: p?.notes || ""
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const timeA = new Date(a.slaughter_started_at || a.started_at || a.created_at || 0).getTime();
      const timeB = new Date(b.slaughter_started_at || b.started_at || b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [processing, livestock, slaughter]);

  // Animals with completed slaughter line
  // Merges processing table records and falls back to livestock records with 'Completed' status
  const completed = useMemo(() => {
    const map = new Map();

    // 1. From slaughter_processing
    (processing || []).forEach((p) => {
      const tagKey = String(p.tag_number || "").trim().toUpperCase();
      if (!tagKey) return;
      const l = (livestock || []).find((live) => String(live.tag_number || "").trim().toUpperCase() === tagKey);
      const stepsObj = safeParseSteps(p.steps) || extractStepsFromHistory(l);
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      if (p.status === "Completed" || doneCount >= 6) {
        const startedAt = resolveStartedAt(p, stepsObj, l);
        const completedAt = resolveCompletedAt(p, stepsObj, l);

        map.set(tagKey, {
          ...p,
          started_at: startedAt,
          slaughter_started_at: startedAt,
          completed_at: completedAt,
          slaughter_completed_at: completedAt,
          steps: stepsObj || Object.fromEntries(STEPS.map((s) => [s.key, true])),
          status: "Completed",
        });
      }
    });

    // 2. Synthesize from livestock table if status is "Completed" or "Slaughtered"
    (livestock || []).forEach((l) => {
      const tagKey = String(l.tag_number || "").trim().toUpperCase();
      if (!tagKey) return;
      const lowerSt = String(l.status || "").trim().toLowerCase();
      if ((lowerSt === "completed" || lowerSt === "slaughtered") && !map.has(tagKey)) {
        const p = (processing || []).find((proc) => String(proc.tag_number || "").trim().toUpperCase() === tagKey);
        const stepsObj = safeParseSteps(p?.steps) || extractStepsFromHistory(l);
        const startedAt = resolveStartedAt(p, stepsObj, l);
        const completedAt = resolveCompletedAt(p, stepsObj, l);

        map.set(tagKey, {
          id: l.id,
          livestock_id: l.id,
          processing_id: p?.id || null,
          tag_number: l.tag_number,
          species: l.species || "Livestock",
          sex: l.sex || p?.sex || "",
          owner_name: l.owner_name || "Unknown Owner",
          operator: p?.operator || l.slaughtered_by || l.operator || l.previous_operator || "Team A",
          date: completedAt || l.slaughter_end_date || l.slaughter_date || l.mark_date || today(),
          slaughter_start_date: l.slaughter_start_date || l.mark_date || today(),
          slaughter_end_date: l.slaughter_end_date || l.slaughter_date || today(),
          slaughter_end_time: l.slaughter_end_time || "",
          started_at: startedAt,
          slaughter_started_at: startedAt,
          completed_at: completedAt,
          slaughter_completed_at: completedAt,
          steps: stepsObj || Object.fromEntries(STEPS.map((s) => [s.key, true])),
          status: "Completed",
          notes: p?.notes || ""
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const timeA = new Date(a.slaughter_completed_at || a.completed_at || a.date || a.created_at || 0).getTime();
      const timeB = new Date(b.slaughter_completed_at || b.completed_at || b.date || b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [processing, livestock]);

  // Animals marked & ready for slaughter but not yet in processing (sorted by Tag Number Ascending)
  const availableAnimals = useMemo(() => {
    // Exclude animals that are actively being processed OR have completed slaughter / downstream operations
    const unavailableTags = new Set();

    (inProgress || []).forEach((p) => {
      if (p.tag_number) unavailableTags.add(String(p.tag_number).trim().toUpperCase());
    });

    (processing || []).forEach((p) => {
      const fbAt = p.fallback_at || null;
      const reAt = p.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
      if (isFallback || p.status === "Pending Reassignment" || p.operator === "Unassigned") return;

      const st = String(p.status || "").trim().toLowerCase();
      if (st === "in progress" || st === "completed" || st === "slaughtered" || st === "done") {
        if (p.tag_number) unavailableTags.add(String(p.tag_number).trim().toUpperCase());
      }
    });

    (livestock || []).forEach((l) => {
      const fbAt = l.fallback_at || null;
      const reAt = l.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));

      const st = String(l.status || "").trim().toLowerCase();
      if (
        st === "completed" ||
        st === "slaughtered" ||
        st === "inspected" ||
        st.includes("post-mortem") ||
        st.includes("post mortem") ||
        st === "weighed" ||
        st === "weighing" ||
        st === "paid" ||
        st === "dispatched" ||
        st === "released" ||
        st === "condemned" ||
        st === "rejected"
      ) {
        if (l.tag_number) unavailableTags.add(String(l.tag_number).trim().toUpperCase());
      } else if (!isFallback && (st === "in progress" || st === "slaughtering" || st === "processing")) {
        if (l.tag_number) unavailableTags.add(String(l.tag_number).trim().toUpperCase());
      }
    });

    (slaughter || []).forEach((s) => {
      const fbAt = s.fallback_at || null;
      const reAt = s.reassigned_at || null;
      const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));

      const st = String(s.status || "").trim().toLowerCase();
      if (
        st === "completed" ||
        st === "slaughtered" ||
        st === "released" ||
        st === "dispatched"
      ) {
        if (s.tag_number) unavailableTags.add(String(s.tag_number).trim().toUpperCase());
      } else if (!isFallback && st === "in progress") {
        const matchingProc = (processing || []).find((p) => String(p.tag_number || "").trim().toUpperCase() === String(s.tag_number || "").trim().toUpperCase());
        const matchingLive = (livestock || []).find((l) => String(l.tag_number || "").trim().toUpperCase() === String(s.tag_number || "").trim().toUpperCase());
        const liveSt = String(matchingLive?.status || "").toLowerCase();
        if (matchingProc?.status === "In Progress" || liveSt === "in progress" || liveSt === "slaughtering") {
          if (s.tag_number) unavailableTags.add(String(s.tag_number).trim().toUpperCase());
        }
      }
    });

    const map = new Map();

    // 1. From slaughter_records
    (slaughter || []).forEach((s) => {
      const tagKey = String(s.tag_number || "").trim().toUpperCase();
      if (!tagKey || unavailableTags.has(tagKey)) return;
      if (isWaitingForSlaughter(s, unavailableTags) && !map.has(tagKey)) {
        const l = (livestock || []).find((item) => String(item.tag_number || "").trim().toUpperCase() === tagKey || item.id === s.livestock_id);
        const am = anteMortem.find((a) => String(a.tag_number || "").trim().toUpperCase() === tagKey || (l?.id && a.livestock_id === l.id) || (s?.livestock_id && a.livestock_id === s.livestock_id));
        if (am) {
          const dec = String(am.decision || "").toLowerCase();
          const st = String(am.status || "").toLowerCase();
          if (dec.includes("condemn") || dec.includes("reject") || dec.includes("suspect") || st.includes("condemn") || st.includes("reject") || st.includes("suspect")) return;
          if (!dec.includes("approv") && !dec.includes("pass") && !st.includes("approv") && !st.includes("pass")) return;
        } else {
          const lStatus = String(l?.status || s?.status || "").toLowerCase();
          if (!["approved", "ante-mortem passed", "ready for slaughter", "pending operator reassignment"].includes(lStatus)) return;
        }

        const fbAt = l?.fallback_at || s.fallback_at || null;
        const reAt = l?.reassigned_at || s.reassigned_at || null;
        const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
        const resolvedOp = isFallback ? "Unassigned" : (s.operator && s.operator !== "Unassigned" ? s.operator : (l?.operator || l?.previous_operator || "Unassigned"));

        map.set(tagKey, {
          id: s.id,
          livestock_id: l?.id || s.livestock_id,
          owner_id: s.owner_id || l?.owner_id || null,
          tag_number: s.tag_number,
          species: s.species || l?.species || "Livestock",
          breed: s.breed || l?.breed || "",
          sex: s.sex || l?.sex || "",
          age_months: s.age_months ?? l?.age_months ?? null,
          quantity: Number(s.quantity || s.head_count || l?.quantity || l?.head_count || 1) || 1,
          mark_type: s.mark_type || l?.mark_type || "",
          owner_name: s.owner_name || l?.owner_name || "Unknown Owner",
          operator: resolvedOp,
          previous_operator: l?.previous_operator || s.previous_operator || (resolvedOp && resolvedOp !== "Unassigned" ? resolvedOp : null),
          date: s.mark_date || s.scheduled_date || s.date || l?.mark_date || today(),
          scheduled_date: s.scheduled_date || s.mark_date || s.date || today(),
          mark_date: s.mark_date || s.scheduled_date || s.date || l?.mark_date || "",
          mark_time: s.mark_time || l?.mark_time || "",
          status: isFallback ? "Pending Operator Reassignment" : (s.status || l?.status || "Ready for Slaughter"),
          fallback_at: fbAt,
          fallback_reason: l?.fallback_reason || s.fallback_reason || null,
          reassigned_at: reAt,
          is_fallback: isFallback
        });
      }
    });

    // 2. From livestock table
    (livestock || []).forEach((l) => {
      const tagKey = String(l.tag_number || "").trim().toUpperCase();
      if (!tagKey || unavailableTags.has(tagKey)) return;
      if (isWaitingForSlaughter(l, unavailableTags)) {
        const am = anteMortem.find((a) => String(a.tag_number || "").trim().toUpperCase() === tagKey || a.livestock_id === l.id);
        if (am) {
          const dec = String(am.decision || "").toLowerCase();
          const st = String(am.status || "").toLowerCase();
          if (dec.includes("condemn") || dec.includes("reject") || dec.includes("suspect") || st.includes("condemn") || st.includes("reject") || st.includes("suspect")) return;
          if (!dec.includes("approv") && !dec.includes("pass") && !st.includes("approv") && !st.includes("pass")) return;
        } else {
          const lStatus = String(l.status || "").toLowerCase();
          if (!["approved", "ante-mortem passed", "ready for slaughter", "pending operator reassignment"].includes(lStatus)) return;
        }

        const fbAt = l.fallback_at || null;
        const reAt = l.reassigned_at || null;
        const isFallback = Boolean(fbAt && (!reAt || new Date(fbAt) > new Date(reAt)));
        const sRec = (slaughter || []).find((item) => String(item.tag_number || "").trim().toUpperCase() === tagKey || item.livestock_id === l.id);
        const resolvedOp = isFallback ? "Unassigned" : (sRec?.operator && sRec.operator !== "Unassigned" ? sRec.operator : (l.operator || l.previous_operator || "Unassigned"));

        if (!map.has(tagKey)) {
          map.set(tagKey, {
            id: l.id,
            livestock_id: l.id,
            owner_id: l.owner_id || null,
            tag_number: l.tag_number,
            species: l.species || "Livestock",
            breed: l.breed || "",
            sex: l.sex || "",
            age_months: l.age_months ?? null,
            quantity: Number(l.quantity || l.head_count || 1) || 1,
            mark_type: l.mark_type || "",
            owner_name: l.owner_name || "Unknown Owner",
            operator: resolvedOp,
            previous_operator: l.previous_operator || sRec?.previous_operator || (resolvedOp && resolvedOp !== "Unassigned" ? resolvedOp : null),
            date: l.mark_date || l.date_marked || today(),
            scheduled_date: l.mark_date || l.date_marked || today(),
            mark_date: l.mark_date || l.date_marked || today(),
            mark_time: l.mark_time || l.time_marked || "",
            status: isFallback ? "Pending Operator Reassignment" : (l.status || "Ready for Slaughter"),
            fallback_at: fbAt,
            fallback_reason: l.fallback_reason || null,
            reassigned_at: reAt,
            is_fallback: isFallback
          });
        } else {
          const existing = map.get(tagKey);
          const mergedFbAt = fbAt || existing.fallback_at;
          const mergedReAt = reAt || existing.reassigned_at;
          const mergedIsFallback = Boolean(mergedFbAt && (!mergedReAt || new Date(mergedFbAt) > new Date(mergedReAt)));
          const finalOp = mergedIsFallback ? "Unassigned" : (existing.operator && existing.operator !== "Unassigned" ? existing.operator : resolvedOp);
          map.set(tagKey, {
            ...existing,
            livestock_id: l.id || existing.livestock_id,
            owner_id: l.owner_id || existing.owner_id || null,
            breed: l.breed || existing.breed || "",
            sex: l.sex || existing.sex || "",
            age_months: l.age_months ?? existing.age_months ?? null,
            quantity: Number(l.quantity || l.head_count || existing.quantity || 1) || 1,
            mark_type: l.mark_type || existing.mark_type || "",
            fallback_at: mergedFbAt,
            fallback_reason: l.fallback_reason || existing.fallback_reason,
            reassigned_at: mergedReAt,
            previous_operator: l.previous_operator || existing.previous_operator,
            is_fallback: mergedIsFallback,
            status: mergedIsFallback ? "Pending Operator Reassignment" : existing.status,
            operator: finalOp
          });
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      // Prioritize active fallback cases requiring reassignment
      if (a.is_fallback && !b.is_fallback) return -1;
      if (!a.is_fallback && b.is_fallback) return 1;

      const timeA = new Date(a.mark_date || a.scheduled_date || a.date || a.created_at || 0).getTime();
      const timeB = new Date(b.mark_date || b.scheduled_date || b.date || b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [slaughter, livestock, processing, anteMortem, inProgress]);

  const isAnimalAssigned = (item) => {
    if (!item) return false;
    if (item.is_fallback) return false;
    const op = String(item.operator || "").trim();
    return Boolean(op && op !== "Unassigned" && op !== "—");
  };

  // 1. Unassigned / Fallback animals awaiting team operator assignment (Tab 1: Assign Team Operator)
  const unassignedAnimals = useMemo(() => {
    return availableAnimals.filter((s) => !isAnimalAssigned(s));
  }, [availableAnimals]);

  // 2. Assigned animals ready for slaughter floor execution (Tab 2: Ready for Slaughter)
  const readyForSlaughterAnimals = useMemo(() => {
    return inProgress;
  }, [inProgress]);

  const selectedAnimal = useMemo(() => {
    const targetTag = (targetTagsForModal.length === 1 ? targetTagsForModal[0] : null) || startForm.tag_number;
    return unassignedAnimals.find((s) => s.tag_number === targetTag) || availableAnimals.find((s) => s.tag_number === targetTag);
  }, [unassignedAnimals, availableAnimals, startForm.tag_number, targetTagsForModal]);

  const isAnimalOperatorAssigned = Boolean(
    selectedAnimal?.operator &&
    selectedAnimal.operator !== "Unassigned" &&
    !selectedAnimal?.is_fallback
  );

  const resolveOwnerId = (item) => {
    if (!item) return null;
    const directOwnerId = item.owner_id ? String(item.owner_id).trim() : null;
    if (directOwnerId) return directOwnerId;
    const animal = (livestock || []).find(
      (l) => (l.id && l.id === item.livestock_id) || (l.tag_number && l.tag_number === item.tag_number)
    );
    if (animal?.owner_id) return String(animal.owner_id).trim();
    const directName = (item.owner_name || animal?.owner_name || "").trim();
    if (directName && directName !== "Unknown Owner" && directName !== "—" && Array.isArray(owners)) {
      const match = owners.find((o) => o.name && o.name.toLowerCase().trim() === directName.toLowerCase());
      if (match?.id) return String(match.id).trim();
    }
    return null;
  };

  const resolveOwnerName = (item) => {
    if (!item) return "Unknown Owner";
    const ownerId = resolveOwnerId(item);
    if (ownerId && Array.isArray(owners)) {
      const cleanOId = String(ownerId).trim().toLowerCase();
      const match = owners.find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
        const oTempId = String(o.temp_reg_id || "").trim().toLowerCase();
        const oAuthId = String(o.auth_user_id || "").trim().toLowerCase();
        return oId === cleanOId || oOwnerId === cleanOId || oTempId === cleanOId || oAuthId === cleanOId;
      });
      if (match?.name) return match.name;
    }
    const direct = (item.owner_name || "").trim();
    if (direct && direct !== "Unknown Owner" && direct !== "—") {
      if (Array.isArray(owners)) {
        const match = owners.find((o) => (o.name || "").trim().toLowerCase() === direct.toLowerCase());
        if (match?.name) return match.name;
      }
      return direct;
    }
    const animal = (livestock || []).find(
      (l) => (l.id && l.id === item.livestock_id) || (l.tag_number && l.tag_number === item.tag_number)
    );
    if (animal?.owner_id && Array.isArray(owners)) {
      const cleanAnimalOId = String(animal.owner_id).trim().toLowerCase();
      const match = owners.find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
        return oId === cleanAnimalOId || oOwnerId === cleanAnimalOId;
      });
      if (match?.name) return match.name;
    }
    if (animal?.owner_name && animal.owner_name !== "Unknown Owner" && animal.owner_name !== "—") return animal.owner_name;
    return "Unknown Owner";
  };

  const resolveAnimalSex = (item) => {
    if (item?.sex && String(item.sex).trim() !== "") return String(item.sex).trim();
    const cleanTag = String(item?.tag_number || "").trim().toLowerCase();
    const cleanId = String(item?.livestock_id || item?.id || "").trim();
    const match = (livestock || []).find((l) => {
      if (cleanId && String(l.id || "").trim() === cleanId) return true;
      if (cleanTag && String(l.tag_number || "").trim().toLowerCase() === cleanTag) return true;
      return false;
    });
    if (match?.sex && String(match.sex).trim() !== "") return String(match.sex).trim();
    const sMatch = (slaughter || []).find((s) => {
      if (cleanTag && String(s.tag_number || "").trim().toLowerCase() === cleanTag) return true;
      return false;
    });
    return (sMatch?.sex && String(sMatch.sex).trim()) || "";
  };

  const getNormalizedSex = (item) => {
    const raw = String(resolveAnimalSex(item) || item?.sex || "").trim().toLowerCase();
    if (raw === "male" || raw === "m" || raw.startsWith("m")) return "male";
    if (raw === "female" || raw === "f" || raw.startsWith("f")) return "female";
    return "unspecified";
  };

  // Filter Active Operations (In Progress)
  const filteredInProgress = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inProgress
      .filter((p) => {
        const tag = (p.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(p).toLowerCase();
        const owner = (p.owner_name || "").toLowerCase();
        const species = (p.species || "").toLowerCase();
        const op = (p.operator || "").toLowerCase();
        const breed = (p.breed || "").toLowerCase();
        const id = String(p.id || "").toLowerCase();
        const matchesSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          owner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          op.includes(q) ||
          id.includes(q);
        const matchesSpecies = filterSpecies === "all" || p.species === filterSpecies;
        return matchesSearch && matchesSpecies;
      })
      .sort((a, b) => {
        const timeA = new Date(a.slaughter_started_at || a.started_at || a.created_at || 0).getTime();
        const timeB = new Date(b.slaughter_started_at || b.started_at || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [inProgress, livestock, owners, search, filterSpecies]);

  // Filter Awaiting Animals (Tab 1: Assign Team Operator) - strictly unassigned or fallback
  const filteredAwaiting = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unassignedAnimals
      .filter((s) => {
        const tag = (s.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(s).toLowerCase();
        const owner = (s.owner_name || "").toLowerCase();
        const species = (s.species || "").toLowerCase();
        const op = (s.operator || "").toLowerCase();
        const prevOp = (s.previous_operator || "").toLowerCase();
        const breed = (s.breed || "").toLowerCase();
        const sex = (s.sex || "").toLowerCase();
        const status = (s.status || "").toLowerCase();
        const id = String(s.id || "").toLowerCase();
        const matchesSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          owner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          sex.includes(q) ||
          status.includes(q) ||
          op.includes(q) ||
          prevOp.includes(q) ||
          (s.is_fallback && "fallback reassign".includes(q)) ||
          id.includes(q);
        const matchesSpecies = filterSpecies === "all" || s.species === filterSpecies;
        return matchesSearch && matchesSpecies;
      })
      .sort((a, b) => {
        if (a.is_fallback && !b.is_fallback) return -1;
        if (!a.is_fallback && b.is_fallback) return 1;
        const timeA = new Date(a.mark_date || a.scheduled_date || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.mark_date || b.scheduled_date || b.date || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [unassignedAnimals, livestock, owners, search, filterSpecies]);

  // Filter Ready for Slaughter Queue (Tab 2: Ready for Slaughter) - assigned animals awaiting floor processing start
  const filteredReady = useMemo(() => {
    const q = search.trim().toLowerCase();
    return readyForSlaughterAnimals
      .filter((s) => {
        const tag = (s.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(s).toLowerCase();
        const owner = (s.owner_name || "").toLowerCase();
        const species = (s.species || "").toLowerCase();
        const op = (s.operator || "").toLowerCase();
        const prevOp = (s.previous_operator || "").toLowerCase();
        const breed = (s.breed || "").toLowerCase();
        const sex = (s.sex || "").toLowerCase();
        const status = (s.status || "").toLowerCase();
        const id = String(s.id || "").toLowerCase();
        const matchesSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          owner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          sex.includes(q) ||
          status.includes(q) ||
          op.includes(q) ||
          prevOp.includes(q) ||
          id.includes(q);
        const matchesSpecies = filterSpecies === "all" || s.species === filterSpecies;
        return matchesSearch && matchesSpecies;
      })
      .sort((a, b) => {
        const timeA = new Date(a.mark_date || a.scheduled_date || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.mark_date || b.scheduled_date || b.date || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [readyForSlaughterAnimals, livestock, owners, search, filterSpecies]);

  // Filter Completed Operations
  const filteredCompleted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return completed
      .filter((c) => {
        const tag = (c.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(c).toLowerCase();
        const owner = (c.owner_name || "").toLowerCase();
        const species = (c.species || "").toLowerCase();
        const op = (c.operator || "").toLowerCase();
        const breed = (c.breed || "").toLowerCase();
        const id = String(c.id || "").toLowerCase();
        const matchesSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          owner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          op.includes(q) ||
          id.includes(q);
        const matchesSpecies = filterSpecies === "all" || c.species === filterSpecies;
        return matchesSearch && matchesSpecies;
      })
      .sort((a, b) => {
        const timeA = new Date(a.slaughter_completed_at || a.completed_at || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.slaughter_completed_at || b.completed_at || b.date || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [completed, livestock, owners, search, filterSpecies]);

  // Owner-Grouped datasets for all stages:
  // 1. Tab 1: Grouped Awaiting Animals (Assign Team Operator)
  const groupedAwaiting = useMemo(() => {
    const groups = new Map();
    (filteredAwaiting || []).forEach((item) => {
      const ownerId = resolveOwnerId(item);
      const ownerName = resolveOwnerName(item) || "Unknown Owner";
      const groupKey = ownerId ? `owner_${ownerId}` : `owner_${ownerName.toLowerCase().trim()}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          owner_id: ownerId,
          owner_name: ownerName,
          speciesList: [],
          items: [],
          hasFallback: false,
          latestTimestamp: 0,
        });
      }
      const grp = groups.get(groupKey);
      grp.items.push(item);
      const sp = (item.species || "Livestock").trim();
      if (!grp.speciesList.includes(sp)) grp.speciesList.push(sp);
      if (item.is_fallback) grp.hasFallback = true;

      const itemTime = new Date(item.mark_date || item.scheduled_date || item.date || item.created_at || 0).getTime();
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = item.mark_date || item.scheduled_date || item.date || item.created_at;
      }
    });

    return Array.from(groups.values()).map((g) => ({
      ...g,
      count: g.items.length,
      headCount: g.items.reduce((sum, i) => sum + (Number(i.quantity || i.head_count || 1) || 1), 0),
      items: [...g.items].sort((a, b) => {
        if (a.is_fallback && !b.is_fallback) return -1;
        if (!a.is_fallback && b.is_fallback) return 1;
        const timeA = new Date(a.mark_date || a.scheduled_date || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.mark_date || b.scheduled_date || b.date || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }),
    })).sort((a, b) => {
      if (a.hasFallback && !b.hasFallback) return -1;
      if (!a.hasFallback && b.hasFallback) return 1;
      if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
      return a.owner_name.localeCompare(b.owner_name);
    });
  }, [filteredAwaiting, livestock, owners]);

  // 2. Tab 2: Grouped In-Progress Operations (Ready for Slaughter / Active Floor Operations) - Grouped by Owner & Slaughter Date
  const groupedInProgress = useMemo(() => {
    const groups = new Map();
    (filteredInProgress || []).forEach((item) => {
      const ownerId = resolveOwnerId(item);
      const ownerName = resolveOwnerName(item) || "Unknown Owner";
      const itemDate = item.slaughter_start_date || item.slaughter_date || item.date || item.scheduled_date || item.mark_date || (item.slaughter_started_at ? item.slaughter_started_at.split("T")[0] : null) || (item.started_at ? item.started_at.split("T")[0] : null) || (item.created_at ? item.created_at.split("T")[0] : null) || "Unknown Date";
      const groupKey = `${ownerId ? `owner_${ownerId}` : `owner_${ownerName.toLowerCase().trim()}`}_${itemDate}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          owner_id: ownerId,
          owner_name: ownerName,
          slaughter_date: itemDate,
          speciesList: [],
          operatorList: [],
          items: [],
          maleCount: 0,
          femaleCount: 0,
          unspecifiedCount: 0,
          latestTimestamp: 0,
          earliestTimestamp: Infinity,
          started_at: null,
          rawDate: null,
        });
      }
      const grp = groups.get(groupKey);
      grp.items.push(item);
      const sp = (item.species || "Livestock").trim();
      if (!grp.speciesList.includes(sp)) grp.speciesList.push(sp);
      const op = (item.operator && item.operator !== "Unassigned" ? item.operator : "").trim();
      if (op && !grp.operatorList.includes(op)) grp.operatorList.push(op);

      const resolvedSex = resolveAnimalSex(item);
      item.sex = resolvedSex;
      const normSex = getNormalizedSex(item);
      if (normSex === "male") {
        grp.maleCount += 1;
      } else if (normSex === "female") {
        grp.femaleCount += 1;
      } else {
        grp.unspecifiedCount += 1;
      }

      const itemTime = new Date(item.slaughter_started_at || item.started_at || item.created_at || 0).getTime();
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = item.slaughter_started_at || item.started_at || item.created_at;
      }
      if (itemTime > 0 && itemTime < grp.earliestTimestamp) {
        grp.earliestTimestamp = itemTime;
        grp.started_at = item.slaughter_started_at || item.started_at || item.created_at;
      }
    });

    return Array.from(groups.values()).map((g) => ({
      ...g,
      operator: g.operatorList.length > 0 ? g.operatorList.join(", ") : "Team A",
      total: g.items.length,
      count: g.items.length,
      headCount: g.items.reduce((sum, i) => sum + (Number(i.quantity || i.head_count || 1) || 1), 0),
      items: [...g.items].sort((a, b) => {
        const timeA = new Date(a.slaughter_started_at || a.started_at || a.created_at || 0).getTime();
        const timeB = new Date(b.slaughter_started_at || b.started_at || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }),
    })).sort((a, b) => {
      if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
      return a.owner_name.localeCompare(b.owner_name);
    });
  }, [filteredInProgress, livestock, owners]);

  // 3. Tab 3: Grouped Completed Slaughter Records
  const groupedCompleted = useMemo(() => {
    const groups = new Map();
    (filteredCompleted || []).forEach((item) => {
      const ownerId = resolveOwnerId(item);
      const ownerName = resolveOwnerName(item) || item.owner_name || "Unknown Owner";
      const groupKey = ownerId ? `owner_${ownerId}` : `owner_${ownerName.toLowerCase().trim()}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          owner_id: ownerId,
          owner_name: ownerName,
          speciesList: [],
          items: [],
          latestTimestamp: 0,
        });
      }
      const grp = groups.get(groupKey);
      grp.items.push(item);
      const sp = (item.species || "Livestock").trim();
      if (!grp.speciesList.includes(sp)) grp.speciesList.push(sp);

      const rawTime = item.slaughter_completed_at || item.completed_at || item.date || item.created_at;
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = rawTime;
      }
    });

    return Array.from(groups.values()).map((g) => ({
      ...g,
      count: g.items.length,
      headCount: g.items.reduce((sum, i) => sum + (Number(i.quantity || i.head_count || 1) || 1), 0),
      items: [...g.items].sort((a, b) => {
        const timeA = new Date(a.slaughter_completed_at || a.completed_at || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.slaughter_completed_at || b.completed_at || b.date || b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }),
    })).sort((a, b) => {
      if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
      return (b.key || "").localeCompare(a.key || "");
    });
  }, [filteredCompleted, livestock, owners]);

  // Group eligible unassigned animals by owner for the Assign Team Operator modal
  const modalOwnerGroups = useMemo(() => {
    const groups = new Map();

    (unassignedAnimals || []).forEach((item) => {
      const ownerId = resolveOwnerId(item);
      const ownerName = resolveOwnerName(item) || "Unknown Owner";
      const groupKey = ownerId ? `owner_${ownerId}` : `owner_${ownerName.toLowerCase().trim()}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          owner_id: ownerId,
          owner_name: ownerName,
          items: [],
          speciesList: [],
          hasFallback: false,
          total: 0,
          maleCount: 0,
          femaleCount: 0,
          unspecifiedCount: 0,
          latestTimestamp: 0,
        });
      }

      const grp = groups.get(groupKey);
      grp.items.push(item);
      grp.total += 1;

      const normSex = getNormalizedSex(item);
      if (normSex === "male") {
        grp.maleCount += 1;
      } else if (normSex === "female") {
        grp.femaleCount += 1;
      } else {
        grp.unspecifiedCount += 1;
      }

      const sp = (item.species || "Livestock").trim();
      if (!grp.speciesList.includes(sp)) grp.speciesList.push(sp);
      if (item.is_fallback) grp.hasFallback = true;

      const itemTime = new Date(item.mark_date || item.scheduled_date || item.date || item.created_at || 0).getTime();
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
      }
    });

    return Array.from(groups.values()).map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) => {
        if (a.is_fallback && !b.is_fallback) return -1;
        if (!a.is_fallback && b.is_fallback) return 1;
        return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }),
    })).sort((a, b) => {
      if (a.hasFallback && !b.hasFallback) return -1;
      if (!a.hasFallback && b.hasFallback) return 1;
      if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
      return a.owner_name.localeCompare(b.owner_name, undefined, { sensitivity: "base" });
    });
  }, [unassignedAnimals, livestock, owners]);

  const filteredModalOwnerGroups = useMemo(() => {
    const q = modalSearch.trim().toLowerCase();
    if (!q) return modalOwnerGroups;
    return modalOwnerGroups
      .map((grp) => {
        const ownerMatches = grp.owner_name.toLowerCase().includes(q);
        const matchingItems = grp.items.filter((item) => {
          return (
            (item.tag_number || "").toLowerCase().includes(q) ||
            (item.species || "").toLowerCase().includes(q) ||
            (item.breed || "").toLowerCase().includes(q)
          );
        });
        if (ownerMatches) return grp;
        if (matchingItems.length > 0) {
          return {
            ...grp,
            items: matchingItems,
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [modalOwnerGroups, modalSearch]);

  const toggleOwnerSelection = (grp) => {
    const grpTags = grp.items.map((i) => i.tag_number);
    const allSelected = grpTags.length > 0 && grpTags.every((t) => modalSelectedTags.has(t));
    setModalSelectedTags((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        grpTags.forEach((t) => next.delete(t));
      } else {
        grpTags.forEach((t) => next.add(t));
      }
      return next;
    });
  };

  const toggleTagSelection = (tag) => {
    setModalSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const toggleOwnerExpanded = (groupKey) => {
    setExpandedModalOwnerKey((prev) => (prev === groupKey ? null : groupKey));
  };

  const toggleReadyOwnerExpanded = (groupKey) => {
    setExpandedReadyOwnerKey((prev) => (prev === groupKey ? null : groupKey));
  };

  // Collapsible Accordion State for Owner Groups (defaults to expanded)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const isGroupExpanded = (key) => !collapsedGroups.has(key);
  const toggleGroupExpand = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandAllGroups = () => setCollapsedGroups(new Set());
  const collapseAllGroups = (groupsList) => setCollapsedGroups(new Set((groupsList || []).map((g) => g.key)));

  // Selected Owner Dedicated View State across all stages (matches Condemnation pattern)
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);
  useEffect(() => {
    setSelectedOwnerKey(null);
    setSelectedTags(new Set());
    setTargetTagsForModal([]);
    setModalSelectedTags(new Set());
    setExpandedModalOwnerKey(null);
    setExpandedReadyOwnerKey(null);
    setGroupToMarkSlaughtered(null);
    setModalSearch("");
  }, [search, filterSpecies, activeTab]);

  const currentDataset = useMemo(() => {
    if (activeTab === "awaiting") return groupedAwaiting;
    return groupedInProgress;
  }, [activeTab, groupedAwaiting, groupedInProgress]);

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return (currentDataset || []).find((g) => g.key === selectedOwnerKey) || null;
  }, [currentDataset, selectedOwnerKey]);

  // View records pagination (10 per page default)
  const [ownerViewPage, setOwnerViewPage] = useState(1);
  const [ownerViewPageSize, setOwnerViewPageSize] = useState(10);

  useEffect(() => {
    setOwnerViewPage(1);
  }, [selectedOwnerKey, activeTab]);

  const paginatedOwnerItems = useMemo(() => {
    if (!selectedOwnerView?.items) return [];
    const start = (ownerViewPage - 1) * ownerViewPageSize;
    return selectedOwnerView.items.slice(start, start + ownerViewPageSize);
  }, [selectedOwnerView, ownerViewPage, ownerViewPageSize]);

  // Selection calculations for Assign Team Operator (Tab 1)
  const isAllSelected = useMemo(() => {
    if (!filteredAwaiting.length) return false;
    return filteredAwaiting.every((s) => selectedTags.has(s.tag_number));
  }, [filteredAwaiting, selectedTags]);

  const isSomeSelected = useMemo(() => {
    return selectedTags.size > 0 && !isAllSelected;
  }, [selectedTags, isAllSelected]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedTags(new Set());
    } else {
      const next = new Set();
      filteredAwaiting.forEach((s) => {
        if (s.tag_number) next.add(s.tag_number);
      });
      setSelectedTags(next);
    }
  };

  const toggleSelectTag = (tagNumber) => {
    if (!tagNumber) return;
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagNumber)) {
        next.delete(tagNumber);
      } else {
        next.add(tagNumber);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedTags(new Set());
  };

  const selectedAnimalsList = useMemo(() => {
    return unassignedAnimals.filter((s) => selectedTags.has(s.tag_number));
  }, [unassignedAnimals, selectedTags]);

  const selectedHeadsCount = useMemo(() => {
    return selectedAnimalsList.reduce((sum, s) => sum + (Number(s.quantity || s.head_count || 1) || 1), 0);
  }, [selectedAnimalsList]);

  // Per-Owner group selection helpers
  const isOwnerAllSelected = (ownerGroup) => {
    return ownerGroup.items.length > 0 && ownerGroup.items.every((item) => selectedTags.has(item.tag_number));
  };
  const isOwnerSomeSelected = (ownerGroup) => {
    const some = ownerGroup.items.some((item) => selectedTags.has(item.tag_number));
    return some && !isOwnerAllSelected(ownerGroup);
  };
  const toggleSelectOwnerGroup = (ownerGroup) => {
    const allSelected = isOwnerAllSelected(ownerGroup);
    setSelectedTags((prev) => {
      const next = new Set(prev);
      ownerGroup.items.forEach((item) => {
        if (allSelected) {
          next.delete(item.tag_number);
        } else {
          next.add(item.tag_number);
        }
      });
      return next;
    });
  };
  const handleOpenOwnerAssign = (ownerGroup) => {
    const tags = (ownerGroup?.items || []).map((i) => i.tag_number);
    if (tags.length === 0) return;
    const groupKey = ownerGroup.key || (ownerGroup.owner_id ? `owner_${ownerGroup.owner_id}` : `owner_${(ownerGroup.owner_name || "").toLowerCase().trim()}`);
    setTargetTagsForModal(tags);
    setModalSelectedTags(new Set(tags));
    setExpandedModalOwnerKey(groupKey);
    setModalSearch("");
    setStartForm((prev) => ({
      ...prev,
      tag_number: tags[0],
      operator: prev.operator || "Team A",
    }));
    setStartOpen(true);
  };

  // Pagination current length (operates on Owner Groups)
  const totalCount =
    activeTab === "awaiting"
      ? groupedAwaiting.length
      : groupedInProgress.length;

  const totalLivestockCount =
    activeTab === "awaiting"
      ? filteredAwaiting.length
      : filteredInProgress.length;

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const fromItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toItem = Math.min(currentPage * pageSize, totalCount);

  const paginatedGroupedAwaiting = groupedAwaiting.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginatedGroupedInProgress = groupedInProgress.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginatedGroupedCompleted = groupedCompleted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleTagChange = (tag) => {
    const animal = unassignedAnimals.find((s) => s.tag_number === tag) || availableAnimals.find((s) => s.tag_number === tag);
    const isFallback = Boolean(animal?.is_fallback);
    const existingOp = !isFallback && animal?.operator && animal.operator !== "Unassigned" ? animal.operator : "";
    setStartForm({
      tag_number: tag,
      operator: existingOp || "Team A"
    });
  };

  const handleOpenSingleAssign = (tag) => {
    const animal = unassignedAnimals.find((s) => s.tag_number === tag) || availableAnimals.find((s) => s.tag_number === tag);
    const ownerId = resolveOwnerId(animal);
    const ownerName = resolveOwnerName(animal);
    const groupKey = ownerId ? `owner_${ownerId}` : `owner_${(ownerName || "").toLowerCase().trim()}`;
    setTargetTagsForModal([tag]);
    setModalSelectedTags(new Set([tag]));
    setExpandedModalOwnerKey(groupKey);
    setModalSearch("");
    handleTagChange(tag);
    setStartOpen(true);
  };

  const handleOpenBatchAssign = () => {
    const tags = Array.from(selectedTags);
    if (tags.length === 0) return;
    const firstTag = tags[0];
    const firstAnimal = availableAnimals.find((s) => s.tag_number === firstTag);
    const firstOwnerId = resolveOwnerId(firstAnimal);
    const firstOwnerName = resolveOwnerName(firstAnimal);
    const firstKey = firstOwnerId ? `owner_${firstOwnerId}` : `owner_${(firstOwnerName || "").toLowerCase().trim()}`;

    setTargetTagsForModal(tags);
    setModalSelectedTags(new Set(tags));
    setExpandedModalOwnerKey(firstKey || null);
    setModalSearch("");
    setStartForm((prev) => ({
      ...prev,
      tag_number: tags[0],
      operator: prev.operator || "Team A",
    }));
    setStartOpen(true);
  };

  const handleAssignOperator = (e) => {
    if (e) e.preventDefault();
    const assignedOperator = startForm.operator;
    if (!assignedOperator) {
      showToast("Please select a slaughter team operator", "error");
      return;
    }

    const tagsToProcess = modalSelectedTags.size > 0
      ? Array.from(modalSelectedTags)
      : (targetTagsForModal.length > 0 ? targetTagsForModal : (startForm.tag_number ? [startForm.tag_number] : []));

    if (tagsToProcess.length === 0) {
      showToast("Please select at least one ready livestock record to assign", "error");
      return;
    }

    // Resolve target livestock record objects
    const targetAnimals = tagsToProcess.map((tag) => {
      return (
        unassignedAnimals.find((a) => a.tag_number === tag) ||
        availableAnimals.find((a) => a.tag_number === tag) ||
        { tag_number: tag }
      );
    });

    // Validate that all selected livestock are still eligible
    const ineligible = targetAnimals.filter((a) => {
      const st = String(a.status || "").toLowerCase();
      return (
        st.includes("condemn") ||
        st.includes("reject") ||
        ["completed", "slaughtered", "weighed", "paid", "released", "dispatched"].includes(st)
      );
    });

    if (ineligible.length > 0) {
      showToast(
        `Livestock record(s) [${ineligible.map((a) => a.tag_number).join(", ")}] are no longer eligible for operator assignment.`,
        "error"
      );
      return;
    }

    const totalHeads = targetAnimals.reduce((sum, a) => sum + (Number(a.quantity || a.head_count || 1) || 1), 0);

    // Open confirmation modal prior to saving
    setAssignConfirmData({
      operator: assignedOperator,
      tags: tagsToProcess,
      animals: targetAnimals,
      totalHeads,
    });
  };

  const handleCancelAssignmentConfirmation = () => {
    if (submittingStart) return;
    setAssignConfirmData(null);
  };

  const handleConfirmAssignOperator = async () => {
    if (!assignConfirmData || submittingStart) return;

    const { tags: tagsToProcess, operator: assignedOperator, animals: targetAnimals, totalHeads } = assignConfirmData;

    // Re-validate that selected livestock records remain eligible before database commit
    const currentAnimals = tagsToProcess.map((tag) => {
      return (
        unassignedAnimals.find((a) => a.tag_number === tag) ||
        availableAnimals.find((a) => a.tag_number === tag) ||
        { tag_number: tag }
      );
    });

    const stillIneligible = currentAnimals.filter((a) => {
      const st = String(a.status || "").toLowerCase();
      return (
        st.includes("condemn") ||
        st.includes("reject") ||
        ["completed", "slaughtered", "weighed", "paid", "released", "dispatched"].includes(st)
      );
    });

    if (stillIneligible.length > 0) {
      showToast(
        `Livestock record(s) [${stillIneligible.map((a) => a.tag_number).join(", ")}] are no longer eligible for operator assignment.`,
        "error"
      );
      setAssignConfirmData(null);
      return;
    }

    setSubmittingStart(true);
    try {
      const result = await staffService.assignSlaughterOperatorBatch({
        tag_numbers: tagsToProcess,
        operator: assignedOperator,
      });

      const isBatch = tagsToProcess.length > 1;

      // Close both confirmation dialog and assignment modal
      setAssignConfirmData(null);
      setStartOpen(false);
      setTargetTagsForModal([]);
      setModalSelectedTags(new Set());
      setExpandedModalOwnerKey(null);
      setModalSearch("");
      clearSelection();
      setStartForm({ tag_number: "", operator: "Team A" });
      refreshAll();

      if (result.failures && result.failures.length > 0) {
        if (result.successes && result.successes.length > 0) {
          showToast(`Assigned operator to ${result.successes.length} livestock. ${result.failures.length} failed.`, "warning");
        } else {
          showToast(`Failed to assign operator: ${result.failures.map((f) => `${f.tag_number}: ${f.reason}`).join(", ")}`, "error");
        }
      } else {
        showToast(
          isBatch
            ? `Successfully assigned ${assignedOperator} to ${result.total} livestock records.`
            : `Assigned ${assignedOperator} to ${tagsToProcess[0]}.`,
          "success"
        );
      }

      if (result.successes && result.successes.length > 0) {
        const cleanTagNumbers = result.successes.map((s) => (typeof s === "string" ? s : s.tag_number)).filter(Boolean);
        setAssignSuccessData({
          is_batch: isBatch,
          total_records: result.successes.length,
          total_heads: totalHeads,
          tag_numbers: cleanTagNumbers,
          failures: result.failures || [],
          operator: assignedOperator,
          tag_number: targetAnimals[0]?.tag_number || (typeof tagsToProcess[0] === "string" ? tagsToProcess[0] : tagsToProcess[0]?.tag_number) || cleanTagNumbers[0],
          owner_name: targetAnimals.length === 1 ? resolveOwnerName(targetAnimals[0]) : null,
          species: targetAnimals.length === 1 ? targetAnimals[0]?.species : null,
          sex: targetAnimals.length === 1 ? targetAnimals[0]?.sex : null,
          head_count: totalHeads,
        });
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to assign operator", "error");
    } finally {
      setSubmittingStart(false);
    }
  };

  const handleConfirmSingleSlaughter = async () => {
    if (!singleToMarkDone || submittingSingleId) return;
    const target = singleToMarkDone;
    const targetKey = target.livestock_id || target.id || target.tag_number;
    setSubmittingSingleId(targetKey);
    try {
      const res = await staffService.completeSlaughterSingle({
        livestock_id: target.livestock_id || target.id,
        tag_number: target.tag_number,
        operator: target.operator,
        owner_name: target.owner_name,
      });

      if (!res?.success) {
        throw new Error("Database did not confirm completion");
      }

      setSingleToMarkDone(null);
      refreshAll();
      setSingleSuccessData(target);
      showToast("Livestock successfully marked as done.", "success");
    } catch (err) {
      console.error("Single mark done error:", err);
      showToast(err.message || "Failed to mark livestock as done. Please try again.", "error");
    } finally {
      setSubmittingSingleId(null);
    }
  };

  const handleConfirmGroupSlaughter = async () => {
    if (!groupToMarkSlaughtered || submittingGroupSlaughter) return;
    setSubmittingGroupSlaughter(true);
    const ownerName = groupToMarkSlaughtered.owner_name;
    try {
      const items = groupToMarkSlaughtered.items || [];
      const tagNumbers = items.map((i) => i.tag_number).filter(Boolean);
      const res = await staffService.completeSlaughterGroup({
        owner_name: ownerName,
        group_key: groupToMarkSlaughtered.key,
        items,
        tag_numbers: tagNumbers,
        operator: groupToMarkSlaughtered.operator,
      });

      if (res?.failures && res.failures.length > 0) {
        showToast(
          `Some records failed: ${res.failures.map((f) => `${f.tag} (${f.reason})`).join(", ")}`,
          "error"
        );
      }

      if (res?.completed_count > 0) {
        const successMsg = "All eligible livestock have been successfully marked as done.";
        showToast(successMsg, "success");
        setGroupSuccessData(true);
      }

      setGroupToMarkSlaughtered(null);
      setSelectedOwnerKey(null);
      setExpandedReadyOwnerKey(null);
      refreshAll();
    } catch (err) {
      console.error("Group slaughter error:", err);
      showToast(err.message || "Failed to mark livestock as done. Please try again.", "error");
    } finally {
      setSubmittingGroupSlaughter(false);
    }
  };

  const handleStartSlaughter = async (animal) => {
    if (!animal?.tag_number) return;
    const operator = animal.operator && animal.operator !== "Unassigned" ? animal.operator : "Team A";
    const nowObj = new Date();
    const exactStartTime = nowObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const exactStartDate = nowObj.toISOString().split("T")[0];
    const exactStartedAt = nowObj.toISOString();

    try {
      const res = await staffService.createProcessing({
        tag_number: animal.tag_number,
        species: animal.species || "Livestock",
        owner_name: animal.owner_name || resolveOwnerName(animal) || "Unknown Owner",
        operator: operator,
        previous_operator: animal.previous_operator || null,
        reassigned_at: animal.reassigned_at || null,
        steps: {
          ...emptySteps(),
          started_at: exactStartedAt,
        },
        notes: "",
        date: exactStartDate,
        slaughter_start_date: exactStartDate,
        slaughter_start_time: exactStartTime,
        slaughter_started_at: exactStartedAt,
        started_at: exactStartedAt,
      });

      showToast(`Slaughter floor processing initiated for ${animal.tag_number}.`, "success");
      refreshAll();
      setActiveTab("active");
      const createdRecord = {
        id: res?.data?.id || animal.id,
        tag_number: animal.tag_number,
        species: animal.species || "Livestock",
        owner_name: animal.owner_name || resolveOwnerName(animal),
        operator: operator,
        date: exactStartDate,
        slaughter_start_date: exactStartDate,
        slaughter_start_time: exactStartTime,
        slaughter_started_at: exactStartedAt,
        started_at: exactStartedAt,
        steps: emptySteps(),
        status: "In Progress"
      };
      setActive(createdRecord);
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to start slaughter processing", "error");
    }
  };

  const toggleStep = async (record, stepKey) => {
    if (updatingStep) return;
    const nowTimestamp = new Date().toISOString();
    const currentSteps = record.steps || emptySteps();
    const wasAlreadyDone =
      String(record.status || "").trim().toLowerCase() === "completed" ||
      STEPS.every((s) => isStepDone(currentSteps, s.key));
    const isFinalStep = stepKey === STEPS[STEPS.length - 1].key;

    const existingStartedAt =
      record.started_at ||
      record.slaughter_started_at ||
      record.steps?.started_at ||
      currentSteps.started_at ||
      null;

    const isCurrentlyDone = isStepDone(currentSteps, stepKey);
    const newStatus = !isCurrentlyDone;

    const newStepObj = {
      done: newStatus,
      completed_at: newStatus ? nowTimestamp : null,
      completed_by: newStatus ? currentUserIdentifier : null,
    };

    const newSteps = {
      ...currentSteps,
      [stepKey]: newStepObj,
    };

    if (existingStartedAt) {
      newSteps.started_at = existingStartedAt;
    }

    const allDone = STEPS.every((s) => isStepDone(newSteps, s.key));

    if (allDone) {
      newSteps.completed_at = currentSteps.completed_at || record.completed_at || nowTimestamp;
    } else {
      delete newSteps.completed_at;
    }

    const patch = {
      steps: newSteps,
      status: allDone ? "Completed" : "In Progress",
    };

    if (allDone) {
      patch.completed_at = newSteps.completed_at;
    } else {
      patch.completed_at = null;
    }

    setUpdatingStep(stepKey);
    try {
      const saveRes = await staffService.updateProcessing(
        record.id,
        patch,
        record.tag_number,
        currentUserIdentifier
      );
      const savedData = saveRes?.data || patch;
      const savedFinalStepDone = isStepDone(savedData.steps || newSteps, STEPS[STEPS.length - 1].key);

      setActive((a) =>
        a && (a.id === record.id || a.tag_number === record.tag_number)
          ? {
              ...a,
              ...patch,
              started_at: existingStartedAt || a.started_at,
              slaughter_started_at: existingStartedAt || a.slaughter_started_at,
              completed_at: allDone ? newSteps.completed_at : null,
              slaughter_completed_at: allDone ? newSteps.completed_at : null,
            }
          : a
      );

      if (allDone && newStatus && !wasAlreadyDone) {
        const tagKey = String(record.tag_number || record.id || "").trim().toUpperCase();
        const completionKey = `${tagKey}::${newSteps.completed_at || "done"}`;
        if (!hasShownCompletionPopup(completionKey) && !hasShownCompletionPopup(tagKey)) {
          markCompletionPopupShown(completionKey);
          markCompletionPopupShown(tagKey);
          const displayTagWithSpecies = formatCompletionDisplayTag(record);
          setCompletionPopup({
            title: "Slaughter Processing Complete",
            message: `${displayTagWithSpecies} slaughter complete. Transferred to Post-Mortem Inspection.`,
            tag_number: record.tag_number,
            species: record.species,
          });
        }
        showToast(
          `🎉 ${record.tag_number} slaughter processing complete! Transferred to Post-Mortem Inspection.`,
          "success"
        );
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to update step status", "error");
    } finally {
      setUpdatingStep(null);
    }
  };

  const exportCSV = () => {


    if (completed.length === 0) {
      showToast("No completed slaughter records to export", "warning");
      return;
    }
    const headers = "Tag #,Species,Sex,Owner Name,Assigned Operator,Date,Steps Completed,Status";
    const rows = completed.map((c) => {
      const tag = c.tag_number || "—";
      const species = c.species || "—";
      const sex = formatSex(c.sex);
      const owner = c.owner_name ? c.owner_name.replace(/"/g, '""') : "—";
      const op = c.operator ? c.operator.replace(/"/g, '""') : "—";
      const date = c.date ? formatDate(c.date) : "—";
      const steps = `${countDone(c.steps)}/${STEPS.length}`;
      const status = c.status || "Completed";
      return `"${tag}","${species}","${sex}","${owner}","${op}","${date}","${steps}","${status}"`;
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `slaughter_processing_records_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Slaughter records exported successfully!", "success");
  };

  const renderNavTabs = () => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "var(--color-bg)",
        padding: "3px",
        borderRadius: 9,
        border: "1px solid var(--color-border)",
        gap: 4,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {[
        {
          id: "awaiting",
          label: "Assign Team Operator",
          count: unassignedAnimals.length,
          icon: <Icon.Users size={14} />,
          color: "#d97706",
          badgeBg: "rgba(217, 119, 6, 0.15)",
          badgeColor: "#d97706",
        },
        {
          id: "active",
          label: "Ready for Slaughter",
          count: inProgress.length,
          icon: <Icon.Activity size={14} />,
          color: "#0284c7",
          badgeBg: "rgba(2, 132, 199, 0.15)",
          badgeColor: "#0284c7",
        },
      ].map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
              cursor: "pointer",
              background: isActive ? "var(--color-surface)" : "transparent",
              color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
              boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.06)" : "none",
              transition: "all 140ms ease",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: isActive ? tab.color : "var(--color-text-muted)", display: "flex" }}>
              {tab.icon}
            </span>
            <span>{tab.label}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "1px 6px",
                borderRadius: 999,
                background: isActive ? tab.badgeBg : "var(--color-border-subtle, rgba(148, 163, 184, 0.15))",
                color: isActive ? tab.badgeColor : "var(--color-text-muted)",
                lineHeight: 1.1,
                minWidth: 18,
                textAlign: "center",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="slaughter-processing-page records-page-container" style={{ width: "100%", padding: 0 }}>

      <style>{`
        .assign-team-fixed-btn,
        .assign-team-fixed-btn:hover,
        .assign-team-fixed-btn:active,
        .assign-team-fixed-btn:focus,
        .assign-team-fixed-btn:focus-visible {
          transform: none !important;
          scale: 1 !important;
          box-sizing: border-box !important;
          flex-shrink: 0 !important;
          margin: 0 !important;
          transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease !important;
        }
        .awaiting-records-table th {
          padding: 12px 16px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.06em !important;
          color: var(--color-text-muted) !important;
          background: var(--color-bg) !important;
          border-bottom: 1.5px solid var(--color-border) !important;
          white-space: nowrap !important;
          vertical-align: middle !important;
        }
        .awaiting-records-table td {
          padding: 12px 16px !important;
          vertical-align: middle !important;
          border-bottom: 1px solid var(--color-border) !important;
          font-size: 13px !important;
          color: var(--color-text) !important;
        }
        .awaiting-records-table tbody tr {
          transition: background-color 140ms ease;
        }
        .awaiting-records-table tbody tr:hover td {
          background-color: rgba(2, 132, 199, 0.035);
        }
        .awaiting-records-table tbody tr.fallback-row td {
          background-color: rgba(254, 243, 199, 0.32);
        }
        .awaiting-records-table tbody tr.fallback-row:hover td {
          background-color: rgba(254, 243, 199, 0.5);
        }
      `}</style>

      {/* MAIN CONTAINER (BORDERLESS RECORD VIEW MATCHING REGISTERED OWNERS) */}
      <div style={{ background: "var(--color-surface)", borderRadius: 12, overflow: "hidden", border: "none", boxShadow: "none", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Swapped Toolbar: Segmented Tabs (Left) & Search + Filters (Right) */}
        <div
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "nowrap",
            overflowX: "auto",
            scrollbarWidth: "none",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            minHeight: 54,
            boxSizing: "border-box",
          }}
        >
          {/* Left: Swapped Navigation Tabs */}
          {renderNavTabs()}

          {/* Right: Search Bar beside Species Selector & Actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "nowrap",
              flexShrink: 0,
              justifyContent: "flex-end",
            }}
          >
            {/* Search Box */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, width: 220, minWidth: 140, maxWidth: 250, flexShrink: 1, position: "relative" }}>
              <input
                type="text"
                placeholder={
                  activeTab === "awaiting"
                    ? "Search by Tag #, Owner, Species..."
                    : "Search active by Tag #, Owner..."
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  paddingLeft: 36,
                  paddingRight: search ? 32 : 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 13,
                  outline: "none",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  transition: "all 0.15s ease",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--color-primary, #10b981)";
                  e.target.style.background = "var(--color-surface)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--color-border)";
                  e.target.style.background = "var(--color-bg)";
                }}
              />
              <Icon.Search
                size={16}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                  }}
                  title="Clear search"
                >
                  <Icon.X size={14} />
                </button>
              )}
            </div>

            {/* Species Filter */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <select
                value={filterSpecies}
                onChange={(e) => setFilterSpecies(e.target.value)}
                style={{
                  height: 34,
                  width: "auto",
                  minWidth: 110,
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  padding: "0 28px 0 10px",
                  cursor: "pointer",
                  outline: "none",
                  appearance: "none",
                  backgroundImage:
                    "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                  backgroundSize: "13px",
                }}
                title="Filter by species"
              >
                <option value="all">All Species</option>
                <option value="HOG">Hog / Swine</option>
                <option value="CATTLE">Cattle</option>
                <option value="CARABAO">Carabao</option>
                <option value="GOAT">Goat</option>
              </select>
            </div>

            {/* Right Action: Assign Team Operator Button (Only on awaiting tab) */}
            {activeTab === "awaiting" && (
              <Button
                onClick={() => {
                  if (selectedTags.size > 0) {
                    handleOpenBatchAssign();
                  } else if (unassignedAnimals.length > 0) {
                    const allTags = unassignedAnimals.map((a) => a.tag_number);
                    const firstAnimal = unassignedAnimals[0];
                    const ownerId = resolveOwnerId(firstAnimal);
                    const ownerName = resolveOwnerName(firstAnimal);
                    const firstGroupKey = ownerId ? `owner_${ownerId}` : `owner_${(ownerName || "").toLowerCase().trim()}`;
                    setTargetTagsForModal(allTags);
                    setModalSelectedTags(new Set(allTags));
                    setExpandedModalOwnerKey(firstGroupKey || null);
                    setModalSearch("");
                    setStartForm((prev) => ({
                      ...prev,
                      tag_number: firstAnimal.tag_number,
                      operator: prev.operator || "Team A",
                    }));
                    setStartOpen(true);
                  } else {
                    setTargetTagsForModal([]);
                    setModalSelectedTags(new Set());
                    setExpandedModalOwnerKey(null);
                    setModalSearch("");
                    setStartOpen(true);
                  }
                }}
                disabled={unassignedAnimals.length === 0 && selectedTags.size === 0}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  border: "none",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                  cursor: unassignedAnimals.length === 0 && selectedTags.size === 0 ? "not-allowed" : "pointer",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                title={
                  unassignedAnimals.length === 0 && selectedTags.size === 0
                    ? "No livestock awaiting operator assignment"
                    : selectedTags.size > 0
                    ? `Assign team operator to ${selectedTags.size} selected livestock`
                    : "Assign team operator"
                }
              >
                <Icon.Users size={15} />
                <span>{selectedTags.size > 0 ? "Assign Team" : "Assign Team Operator"}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Bulk Selection Action Bar for Assign Team Operator */}
        {activeTab === "awaiting" && selectedTags.size > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              padding: "10px 16px",
              background: "rgba(2, 132, 199, 0.08)",
              borderBottom: "1px solid rgba(2, 132, 199, 0.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  background: "var(--color-primary, #0284c7)",
                  color: "#ffffff",
                }}
              >
                <Icon.Check size={14} />
                {selectedTags.size} {selectedTags.size === 1 ? "Record" : "Records"} Selected
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                Total Head Count: <strong>{selectedHeadsCount} {selectedHeadsCount === 1 ? "Head" : "Heads"}</strong>
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                size="sm"
                variant="outline"
                onClick={clearSelection}
                className="assign-team-fixed-btn"
                style={{ height: 32, padding: "0 12px", fontSize: 12 }}
              >
                Clear Selection
              </Button>
              <Button
                size="sm"
                className="btn-primary assign-team-fixed-btn"
                onClick={handleOpenBatchAssign}
                style={{
                  height: 32,
                  padding: "0 14px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  color: "#ffffff",
                  border: "none",
                }}
              >
                <Icon.Users size={14} /> Assign Team
              </Button>
            </div>
          </div>
        )}

        {/* Tab 2: Ready for Slaughter (Active Floor Operations - Owner Grouped) */}
        {activeTab === "active" && (
          <div style={{ padding: 0 }}>
            {filteredInProgress.length === 0 ? (
              <div style={{ padding: "20px" }}>
                <EmptyState
                  title="No active floor operations"
                  message={
                    search || filterSpecies !== "all"
                      ? "No active operations match your current search or filter criteria."
                      : "Livestock assigned to a team operator will appear here as active floor operations ready for slaughter."
                  }
                  icon={<Icon.Activity size={36} />}
                />
              </div>
            ) : (
              /* Main Owner List Table (EXACT match with Assign Team Operator pattern) */
              <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Owner Name</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Started</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>Total Carcasses</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedInProgress.map((grp) => (
                      <tr
                        key={grp.key}
                        onClick={() => setSelectedOwnerKey(grp.key)}
                        style={{
                          transition: "background 140ms ease",
                          borderBottom: "1px solid var(--color-border)",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <td style={{ padding: "14px 18px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                                color: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                fontSize: 12,
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                                {grp.owner_name}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                {grp.count} carcass{grp.count > 1 ? "es" : ""} ready for slaughter
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#0284c7" }} />
                            <span>{grp.started_at ? formatPhDateTime(grp.started_at) : (grp.rawDate ? formatPhDateTime(grp.rawDate) : formatPhDate(grp.slaughter_date))}</span>
                          </div>
                        </td>
                        <td style={{ padding: "14px 18px" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                            {formatSpeciesList(grp.speciesList)}
                          </span>
                        </td>
                        <td style={{ padding: "14px 18px", textAlign: "center" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0284c7" }}>
                              {grp.count} {grp.count === 1 ? "carcass" : "carcasses"}
                            </span>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}>
                              <span style={{ color: "#1d4ed8" }}>♂ {grp.maleCount}</span>
                              <span style={{ color: "var(--color-text-muted)" }}>•</span>
                              <span style={{ color: "#be185d" }}>♀ {grp.femaleCount}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "14px 18px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#0284c7",
                            }}
                          >
                            <Icon.Activity size={13} /> Ready for Slaughter ({grp.count})
                          </span>
                        </td>
                        <td style={{ padding: "14px 18px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOwnerKey(grp.key);
                              }}
                              style={{
                                padding: "6px 14px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-text)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <Icon.Eye size={13} /> View
                            </Button>
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setGroupToMarkSlaughtered(grp);
                              }}
                              style={{
                                height: 32,
                                padding: "0 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                                color: "#ffffff",
                                borderRadius: 7,
                                border: "none",
                                whiteSpace: "nowrap",
                                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                              }}
                              title={`Mark all ${grp.items.length} livestock for ${grp.owner_name} as done`}
                            >
                              <Icon.CheckCircle size={13} />
                              <span>Mark All as Done</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Assign Team Operator Records Table */}
        {activeTab === "awaiting" && (
          <div style={{ padding: 0 }}>
            {recordsError && unassignedAnimals.length === 0 ? (
              <div
                style={{
                  padding: "36px 24px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "#dc2626",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon.AlertTriangle size={22} />
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text)" }}>
                  Unable to load livestock records
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", maxWidth: 420 }}>
                  {recordsError?.message || String(recordsError)}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshAll}
                  className="assign-team-fixed-btn"
                  style={{ height: 34, padding: "0 14px", marginTop: 4 }}
                >
                  <Icon.RefreshCw size={13} /> Retry
                </Button>
              </div>
            ) : isRecordsLoading ? (
              <div
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  color: "var(--color-text-muted)",
                }}
              >
                <span
                  className="spinner"
                  style={{
                    width: 24,
                    height: 24,
                    borderColor: "var(--color-border)",
                    borderTopColor: "var(--color-primary, #0284c7)",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Loading livestock records...</span>
              </div>
            ) : filteredAwaiting.length === 0 ? (
              <EmptyState
                title="No livestock awaiting operator assignment"
                message={
                  search || filterSpecies !== "all"
                    ? `No livestock records match your current search or filter criteria.`
                    : "Livestock passed in Ante-Mortem inspection and marked will appear here."
                }
                icon={<Icon.Users size={36} />}
              />
            ) : (
              /* Main Owner List Table (matches Condemnation pattern) */
              <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Owner Name</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Date Marked</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>Total Heads</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedAwaiting.map((grp) => {
                      return (
                        <tr
                          key={grp.key}
                          onClick={() => setSelectedOwnerKey(grp.key)}
                          style={{
                            transition: "background 140ms ease",
                            borderBottom: "1px solid var(--color-border)",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={{ padding: "14px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: "50%",
                                  background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
                                  color: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 700,
                                  fontSize: 12,
                                  flexShrink: 0,
                                }}
                              >
                                {initials(grp.owner_name)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                                  {grp.owner_name}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                  {grp.count} livestock record{grp.count > 1 ? "s" : ""} awaiting assignment
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#d97706" }} />
                              <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "—"}</span>
                            </div>
                          </td>
                          <td style={{ padding: "14px 18px" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                              {formatSpeciesList(grp.speciesList)}
                            </span>
                          </td>
                          <td style={{ padding: "14px 18px", textAlign: "center" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#d97706" }}>
                              {grp.count} {grp.count === 1 ? "head" : "heads"}
                            </span>
                          </td>
                          <td style={{ padding: "14px 18px" }}>
                            {grp.hasFallback ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 8px",
                                  borderRadius: 5,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  background: "rgba(245, 158, 11, 0.14)",
                                  color: "#b45309",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                }}
                              >
                                <Icon.AlertTriangle size={12} /> Re-Assign Needed
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 8px",
                                  borderRadius: 5,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  background: "rgba(217, 119, 6, 0.11)",
                                  color: "#b45309",
                                  border: "1px solid rgba(217, 119, 6, 0.28)",
                                }}
                              >
                                <Icon.Clock size={12} /> Awaiting Assignment
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "14px 18px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOwnerKey(grp.key);
                                }}
                                style={{
                                  padding: "6px 14px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  background: "var(--color-surface)",
                                  border: "1px solid var(--color-border)",
                                  color: "var(--color-text)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <Icon.Eye size={13} /> View
                              </Button>
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenOwnerAssign(grp);
                                }}
                                style={{
                                  height: 32,
                                  padding: "0 12px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  background: "linear-gradient(135deg, #d97706, #b45309)",
                                  color: "#ffffff",
                                  borderRadius: 7,
                                  border: "none",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <Icon.Users size={13} />
                                <span>Assign</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Standardized Dedicated Owner Records Modal */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => setSelectedOwnerKey(null)}
        title={
          activeTab === "awaiting"
            ? `Awaiting Team Assignment — ${selectedOwnerView?.owner_name || ""}`
            : `Ready for Slaughter — ${selectedOwnerView?.owner_name || ""}`
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {selectedOwnerView?.items?.length || 0} {activeTab === "awaiting" ? "head" : "carcass"}{selectedOwnerView?.items?.length === 1 ? "" : (activeTab === "awaiting" ? "s" : "es")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {(activeTab === "active" || activeTab === "in-progress") && selectedOwnerView && selectedOwnerView.items.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = selectedOwnerView;
                    setGroupToMarkSlaughtered(target);
                  }}
                  disabled={selectedOwnerView.items.length === 0}
                  style={{
                    height: 33,
                    padding: "0 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    color: "#ffffff",
                    borderRadius: 7,
                    border: "none",
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                  }}
                  title={`Mark all ${selectedOwnerView.items.length} livestock for ${selectedOwnerView.owner_name} as done`}
                >
                  <Icon.CheckCircle size={14} />
                  <span>Mark All as Done</span>
                </Button>
              )}
              {activeTab === "awaiting" && selectedOwnerView && selectedOwnerView.items.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = selectedOwnerView;
                    setSelectedOwnerKey(null);
                    handleOpenOwnerAssign(target);
                  }}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "linear-gradient(135deg, #d97706, #b45309)",
                    color: "#ffffff",
                    borderRadius: 7,
                    border: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon.Users size={13} />
                  <span>Assign All Animals</span>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSelectedOwnerKey(null)} style={{ minWidth: 80, fontWeight: 700 }}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        {selectedOwnerView && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(activeTab === "active" || activeTab === "in-progress") && (
              <div className="table-wrap" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", scrollbarWidth: "thin", border: "none", boxShadow: "none" }}>
                  <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                      <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Operator</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Started</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                        <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedOwnerView.items || []).map((rec) => (
                        <tr key={rec.id || rec.tag_number} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!rec.tag_number) return;
                                navigator.clipboard?.writeText(String(rec.tag_number).trim());
                                showToast(`Copied ${rec.tag_number}!`, "success");
                              }}
                              title="Click to copy tag number"
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              {rec.tag_number || "—"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>
                            {rec.species}
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>
                              Type of Marking: {rec.mark_type || "Ear Tag"}
                            </div>
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>
                            {formatSex(resolveAnimalSex(rec) || rec.sex)}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: 5,
                                background: rec.operator && rec.operator !== "Unassigned" ? "var(--color-success-bg)" : "var(--color-bg)",
                                color: rec.operator && rec.operator !== "Unassigned" ? "var(--color-success)" : "var(--color-text-muted)",
                                border: "1px solid var(--color-border)",
                              }}
                            >
                              {rec.operator || "Team A"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text)" }}>
                            {formatPhDateTime(rec.slaughter_started_at || rec.started_at || rec.created_at)}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "3px 8px",
                                borderRadius: 5,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: "rgba(16, 185, 129, 0.11)",
                                color: "#047857",
                                border: "1px solid rgba(16, 185, 129, 0.28)",
                              }}
                            >
                              <Icon.Check size={11} /> Ready for Slaughter
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <Button
                              size="sm"
                              disabled={Boolean(submittingSingleId) || submittingGroupSlaughter}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSingleToMarkDone(rec);
                              }}
                              style={{
                                height: 30,
                                padding: "0 12px",
                                fontSize: 11.5,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                                color: "#ffffff",
                                borderRadius: 6,
                                border: "none",
                                whiteSpace: "nowrap",
                                boxShadow: "0 2px 5px rgba(16, 185, 129, 0.25)",
                                cursor: Boolean(submittingSingleId) || submittingGroupSlaughter ? "not-allowed" : "pointer",
                                opacity: submittingSingleId === (rec.livestock_id || rec.id || rec.tag_number) ? 0.7 : 1,
                              }}
                              title={`Mark ${rec.tag_number || "livestock"} as done`}
                            >
                              {submittingSingleId === (rec.livestock_id || rec.id || rec.tag_number) ? (
                                <>
                                  <span className="spinner" style={{ width: 12, height: 12 }} />
                                  <span>Saving...</span>
                                </>
                              ) : (
                                <>
                                  <Icon.CheckCircle size={13} />
                                  <span>Mark as Done</span>
                                </>
                              )}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            )}

            {activeTab === "awaiting" && (
              <div className="table-wrap" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "55vh", scrollbarWidth: "thin", border: "none", boxShadow: "none" }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Age</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Date Marked</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Operator</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((s) => {
                      const isAssigned = s.operator && s.operator !== "Unassigned";
                      const isFallback = Boolean(s.is_fallback);

                      return (
                        <tr key={s.tag_number || s.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!s.tag_number) return;
                                navigator.clipboard?.writeText(String(s.tag_number).trim());
                                showToast(`Copied ${s.tag_number}!`, "success");
                              }}
                              title="Click to copy tag number"
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              {s.tag_number || "—"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{s.species}</td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{formatSex(s.sex)}</td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                            {s.age_months ? `${s.age_months} mos` : "—"}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text)" }}>
                            {formatPhDateTime(s.mark_date || s.scheduled_date || s.date || s.created_at)}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            {isFallback ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 8px",
                                  borderRadius: 5,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: "rgba(245, 158, 11, 0.14)",
                                  color: "#b45309",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                }}
                                title={s.fallback_reason || "Livestock exceeded 24 hours without slaughter intake. Reassign operator."}
                              >
                                <Icon.AlertTriangle size={11} />
                                <span>Fallback</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 8px",
                                  borderRadius: 5,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: "rgba(217, 119, 6, 0.11)",
                                  color: "#b45309",
                                  border: "1px solid rgba(217, 119, 6, 0.28)",
                                }}
                              >
                                <Icon.Clock size={11} />
                                <span>Awaiting Team Assignment</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            {isAssigned ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "2px 8px",
                                  borderRadius: 5,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  background: "rgba(2, 132, 199, 0.1)",
                                  color: "var(--color-primary, #0284c7)",
                                  border: "1px solid rgba(2, 132, 199, 0.25)",
                                }}
                              >
                                <Icon.Users size={11} />
                                <span>{s.operator}</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "2px 8px",
                                  borderRadius: 5,
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  background: "var(--color-bg)",
                                  color: "var(--color-text-muted)",
                                  border: "1px solid var(--color-border)",
                                }}
                              >
                                <Icon.User size={11} />
                                <span>Unassigned</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <Button
                              size="sm"
                              className="btn-primary"
                              onClick={() => {
                                setSelectedOwnerKey(null);
                                handleOpenSingleAssign(s.tag_number);
                              }}
                              style={{
                                height: 30,
                                padding: "0 10px",
                                fontSize: 11.5,
                                fontWeight: 600,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                ...(isFallback
                                  ? {
                                      background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                                      borderColor: "#d97706",
                                    }
                                  : {}),
                              }}
                            >
                              <Icon.User size={12} />
                              <span>{isFallback ? "Reassign" : "Assign"}</span>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Assign Team Operator Modal (Grouped by Owner with Summary Cards) */}
      <Modal
        open={startOpen}
        onClose={() => {
          setStartOpen(false);
          setTargetTagsForModal([]);
          setModalSelectedTags(new Set());
          setExpandedModalOwnerKey(null);
          setModalSearch("");
        }}
        size="lg"
        title="Assign Team Operator"
        hideCloseButton
      >
        <form onSubmit={handleAssignOperator} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Search filter within modal */}
          {modalOwnerGroups.length > 2 && (
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Search owner name or tag number..."
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 36,
                  padding: "6px 12px 6px 32px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  fontSize: 12.5,
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                }}
              />
              <Icon.Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                }}
              />
              {modalSearch && (
                <button
                  type="button"
                  onClick={() => setModalSearch("")}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <Icon.X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Owner-Based Summary Cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: 380,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {filteredModalOwnerGroups.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  color: "var(--color-text-muted)",
                  fontSize: 13,
                  background: "var(--color-bg)",
                  borderRadius: 8,
                  border: "1px dashed var(--color-border)",
                }}
              >
                {modalSearch
                  ? "No matching owners or livestock found."
                  : "No unassigned livestock currently eligible for operator assignment."}
              </div>
            ) : (
              filteredModalOwnerGroups.map((grp) => {
                const grpTags = grp.items.map((i) => i.tag_number);
                const selectedInGrp = grpTags.filter((t) => modalSelectedTags.has(t));
                const allSelected = grpTags.length > 0 && selectedInGrp.length === grpTags.length;
                const someSelected = selectedInGrp.length > 0 && !allSelected;
                const isExpanded = expandedModalOwnerKey === grp.key;

                return (
                  <div
                    key={grp.key}
                    style={{
                      border: selectedInGrp.length > 0 ? "1.5px solid var(--color-primary, #059669)" : "1px solid var(--color-border)",
                      borderRadius: 10,
                      background: "var(--color-surface)",
                      overflow: "hidden",
                      transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                      boxShadow: selectedInGrp.length > 0 ? "0 2px 8px rgba(5, 150, 105, 0.08)" : "none",
                    }}
                  >
                    {/* Owner Card Header */}
                    <div
                      style={{
                        padding: "12px 16px",
                        background: selectedInGrp.length > 0 ? "var(--color-primary-light, rgba(5, 150, 105, 0.08))" : "var(--color-surface)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 12,
                        cursor: "pointer",
                      }}
                      onClick={() => toggleOwnerExpanded(grp.key)}
                    >
                      {/* Left: Checkbox + Owner Name */}
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200, flex: "1 1 auto" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <CheckboxWithIndeterminate
                          checked={allSelected}
                          indeterminate={someSelected}
                          id={`modal-owner-check-${grp.key}`}
                          onChange={() => toggleOwnerSelection(grp)}
                          title={`Select/Deselect all livestock for ${grp.owner_name}`}
                        />
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span
                            style={{
                              fontSize: 14.5,
                              fontWeight: 700,
                              color: "var(--color-text)",
                              letterSpacing: "-0.01em",
                            }}
                          >
                            {grp.owner_name}
                          </span>
                          {grp.hasFallback && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "var(--color-warning, #d97706)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <Icon.AlertTriangle size={11} /> 24h Fallback Reassignment
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Summary Badges + Expand Toggle */}
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Total Count Badge */}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "var(--color-bg)",
                            color: "var(--color-text-muted)",
                            border: "1px solid var(--color-border)",
                          }}
                          title="Total eligible livestock for this owner"
                        >
                          Total: <strong>{grp.total}</strong>
                        </span>

                        {/* Male Count Badge */}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            border: "1px solid #bfdbfe",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                          title="Count of male livestock"
                        >
                          <span style={{ fontSize: 13 }}>♂</span> Male: <strong>{grp.maleCount}</strong>
                        </span>

                        {/* Female Count Badge */}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "#fdf2f8",
                            color: "#be185d",
                            border: "1px solid #fbcfe8",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                          title="Count of female livestock"
                        >
                          <span style={{ fontSize: 13 }}>♀</span> Female: <strong>{grp.femaleCount}</strong>
                        </span>

                        {/* Unspecified Sex (if any) */}
                        {grp.unspecifiedCount > 0 && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: "#f8fafc",
                              color: "#64748b",
                              border: "1px solid #cbd5e1",
                            }}
                            title="Livestock with unspecified or unknown sex"
                          >
                            Unspecified: <strong>{grp.unspecifiedCount}</strong>
                          </span>
                        )}

                        {/* Expand/Collapse Button */}
                        <button
                          type="button"
                          onClick={() => toggleOwnerExpanded(grp.key)}
                          style={{
                            background: "transparent",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: "#475569",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer",
                            marginLeft: 4,
                          }}
                        >
                          {isExpanded ? (
                            <>
                              Hide Tags <Icon.ChevronUp size={13} />
                            </>
                          ) : (
                            <>
                              View Tags <Icon.ChevronDown size={13} />
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Livestock List Under This Owner */}
                    {isExpanded && (
                      <div
                        style={{
                          borderTop: "1px solid #e2e8f0",
                          background: "#f8fafc",
                          padding: "10px 16px 12px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            Livestock Records ({selectedInGrp.length} of {grp.items.length} selected)
                          </span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setModalSelectedTags((prev) => {
                                  const next = new Set(prev);
                                  grpTags.forEach((t) => next.add(t));
                                  return next;
                                });
                              }}
                              style={{
                                background: "#ffffff",
                                border: "1px solid #cbd5e1",
                                borderRadius: 4,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#0369a1",
                                cursor: "pointer",
                              }}
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setModalSelectedTags((prev) => {
                                  const next = new Set(prev);
                                  grpTags.forEach((t) => next.delete(t));
                                  return next;
                                });
                              }}
                              style={{
                                background: "#ffffff",
                                border: "1px solid #cbd5e1",
                                borderRadius: 4,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#64748b",
                                cursor: "pointer",
                              }}
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        {/* List of Animals (Scrollable) */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                            gap: 8,
                            maxHeight: 180,
                            overflowY: "auto",
                            paddingRight: 4,
                            paddingBottom: 2,
                            scrollbarWidth: "thin",
                          }}
                        >
                          {grp.items.map((item) => {
                            const isSelected = modalSelectedTags.has(item.tag_number);
                            const nSex = getNormalizedSex(item);
                            const displaySex = nSex === "male" ? "Male" : nSex === "female" ? "Female" : (resolveAnimalSex(item) || "Not specified");

                            return (
                              <div
                                key={item.id || item.tag_number}
                                onClick={() => toggleTagSelection(item.tag_number)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "6px 10px",
                                  borderRadius: 6,
                                  background: "#ffffff",
                                  border: isSelected ? "1.5px solid #0284c7" : "1px solid #cbd5e1",
                                  boxShadow: isSelected ? "0 1px 3px rgba(2, 132, 199, 0.12)" : "none",
                                  cursor: "pointer",
                                  transition: "all 0.12s ease",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleTagSelection(item.tag_number);
                                    }}
                                    style={{
                                      width: 15,
                                      height: 15,
                                      accentColor: "#0284c7",
                                      cursor: "pointer",
                                    }}
                                  />
                                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                    <span style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                                      {item.tag_number}
                                    </span>
                                    <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {item.species || "Livestock"}{item.breed ? ` • ${item.breed}` : ""}
                                    </span>
                                  </div>
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                  {nSex === "male" ? (
                                    <span
                                      style={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        background: "#eff6ff",
                                        color: "#1d4ed8",
                                        border: "1px solid #bfdbfe",
                                      }}
                                    >
                                      ♂ Male
                                    </span>
                                  ) : nSex === "female" ? (
                                    <span
                                      style={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        background: "#fdf2f8",
                                        color: "#be185d",
                                        border: "1px solid #fbcfe8",
                                      }}
                                    >
                                      ♀ Female
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: 10.5,
                                        fontWeight: 500,
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        background: "#f1f5f9",
                                        color: "#64748b",
                                      }}
                                    >
                                      {displaySex}
                                    </span>
                                  )}

                                  {item.is_fallback && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: "1px 5px",
                                        borderRadius: 4,
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        border: "1px solid #fde68a",
                                      }}
                                      title="24h timeout reassignment required"
                                    >
                                      Fallback
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Any selected fallback warnings */}
          {Array.from(modalSelectedTags).some((tag) => {
            const an = unassignedAnimals.find((a) => a.tag_number === tag);
            return Boolean(an?.is_fallback);
          }) && (
            <div
              style={{
                background: "rgba(254, 243, 199, 0.55)",
                border: "1.5px solid #fde68a",
                borderRadius: 10,
                padding: "10px 14px",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Icon.AlertTriangle size={18} style={{ color: "#d97706", flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: "#92400e", lineHeight: 1.4 }}>
                <strong>Notice:</strong> One or more selected livestock are 24-hour fallback cases requiring line reassignment. Assigning a team will clear their fallback state and restart their slaughter processing window.
              </div>
            </div>
          )}

          {/* Operator Selection */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.UserCheck size={15} style={{ color: "var(--color-primary, #0284c7)" }} />
              Assign Line Operator Team <span className="req">*</span>
            </label>
            <select
              className="form-control"
              required
              value={startForm.operator}
              onChange={(e) => setStartForm({ ...startForm, operator: e.target.value })}
              style={{
                height: 44,
                background: "#ffffff",
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <option value="">-- Select Operator Team (Team A to C) --</option>
              {OPERATOR_TEAMS.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
              {startForm.operator && !OPERATOR_TEAMS.includes(startForm.operator) && (
                <option value={startForm.operator}>{startForm.operator}</option>
              )}
            </select>
          </div>

          {/* Modal Action Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStartOpen(false);
                setTargetTagsForModal([]);
                setModalSelectedTags(new Set());
                setExpandedModalOwnerKey(null);
                setModalSearch("");
              }}
              className="assign-team-fixed-btn"
              style={{
                width: 96,
                minWidth: 96,
                maxWidth: 96,
                height: 40,
                minHeight: 40,
                maxHeight: 40,
                padding: "0 16px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
                flexShrink: 0,
                transform: "none",
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submittingStart || modalSelectedTags.size === 0 || !startForm.operator}
              className="btn-primary assign-team-fixed-btn"
              style={{
                minWidth: 175,
                height: 40,
                minHeight: 40,
                maxHeight: 40,
                padding: "0 18px",
                fontSize: 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
                whiteSpace: "nowrap",
                flexShrink: 0,
                transform: "none",
              }}
            >
              {submittingStart ? (
                <><span className="spinner" style={{ width: 14, height: 14 }} /> Assigning Team...</>
              ) : modalSelectedTags.size > 0 ? (
                "Assign Team"
              ) : (
                "Select Livestock to Assign"
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Assign Team Operator Confirmation Modal */}
      <Modal
        open={Boolean(assignConfirmData)}
        onClose={handleCancelAssignmentConfirmation}
        size="sm"
        title="Assign Slaughter Team Operator"
        hideCloseButton
        backdropStyle={{ zIndex: 1100 }}
      >
        {assignConfirmData && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: "var(--color-text)",
                lineHeight: 1.5,
              }}
            >
              {assignConfirmData.tags.length === 1
                ? "Do you want to assign this livestock to the selected team operator?"
                : `Do you want to assign these ${assignConfirmData.tags.length} selected livestock records to the selected team operator?`}
            </p>

            {/* Modal Actions (strictly Cancel and Confirm only) */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 4,
                paddingTop: 14,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelAssignmentConfirmation}
                disabled={submittingStart}
                style={{
                  minWidth: 96,
                  height: 38,
                  fontWeight: 650,
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="btn-primary"
                onClick={handleConfirmAssignOperator}
                disabled={submittingStart}
                style={{
                  minWidth: 120,
                  height: 38,
                  fontWeight: 650,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  color: "#ffffff",
                  border: "none",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                }}
              >
                {submittingStart ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Assigning...
                  </span>
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Ready for Slaughter Success Notification Dialog */}
      <Modal
        open={Boolean(assignSuccessData)}
        onClose={() => setAssignSuccessData(null)}
        size="sm"
        title="Ready for Slaughter"
        hideCloseButton
        backdropStyle={{ zIndex: 1200 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              color: "var(--color-text)",
              lineHeight: 1.5,
            }}
          >
            Livestock is ready for slaughter.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
              paddingTop: 14,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Button
              type="button"
              className="btn-primary"
              onClick={() => setAssignSuccessData(null)}
              style={{
                minWidth: 96,
                height: 38,
                fontWeight: 650,
                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
              }}
            >
              OK
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mark Single Livestock as Done Confirmation Dialog */}
      <Modal
        open={Boolean(singleToMarkDone)}
        onClose={() => {
          if (!submittingSingleId) setSingleToMarkDone(null);
        }}
        size="sm"
        title="Mark Livestock as Done"
        hideCloseButton
        backdropStyle={{ zIndex: 1100 }}
      >
        {singleToMarkDone && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: "var(--color-text)",
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to mark livestock <b>{singleToMarkDone.tag_number}</b>{singleToMarkDone.species ? ` (${singleToMarkDone.species}${singleToMarkDone.sex ? `, ${formatSex(singleToMarkDone.sex)}` : ""})` : ""} belonging to <b>{singleToMarkDone.owner_name}</b> as done?
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 4,
                paddingTop: 14,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setSingleToMarkDone(null)}
                disabled={Boolean(submittingSingleId)}
                style={{
                  minWidth: 96,
                  height: 38,
                  fontWeight: 650,
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="btn-primary"
                onClick={handleConfirmSingleSlaughter}
                disabled={Boolean(submittingSingleId)}
                style={{
                  minWidth: 120,
                  height: 38,
                  fontWeight: 650,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  color: "#ffffff",
                  border: "none",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                }}
              >
                {submittingSingleId ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Processing...
                  </span>
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Mark Livestock as Done Success Notification Dialog */}
      <Modal
        open={Boolean(singleSuccessData)}
        onClose={() => setSingleSuccessData(null)}
        size="sm"
        title="Ready for Slaughter"
        hideCloseButton
        backdropStyle={{ zIndex: 1200 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              color: "var(--color-text)",
              lineHeight: 1.5,
            }}
          >
            Livestock successfully marked as done.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
              paddingTop: 14,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Button
              type="button"
              className="btn-primary"
              onClick={() => setSingleSuccessData(null)}
              style={{
                minWidth: 96,
                height: 38,
                fontWeight: 650,
                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
              }}
            >
              OK
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mark All as Done Success Notification Dialog */}
      <Modal
        open={Boolean(groupSuccessData)}
        onClose={() => setGroupSuccessData(false)}
        size="sm"
        title="Ready for Slaughter"
        hideCloseButton
        backdropStyle={{ zIndex: 1200 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              color: "var(--color-text)",
              lineHeight: 1.5,
            }}
          >
            All eligible livestock have been successfully marked as done.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
              paddingTop: 14,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Button
              type="button"
              className="btn-primary"
              onClick={() => setGroupSuccessData(false)}
              style={{
                minWidth: 96,
                height: 38,
                fontWeight: 650,
                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
              }}
            >
              OK
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mark All as Done Confirmation Dialog */}
      <Modal
        open={Boolean(groupToMarkSlaughtered)}
        onClose={() => {
          if (!submittingGroupSlaughter) setGroupToMarkSlaughtered(null);
        }}
        size="sm"
        title="Ready for Slaughter"
        hideCloseButton
        backdropStyle={{ zIndex: 1100 }}
      >
        {groupToMarkSlaughtered && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: "var(--color-text)",
                lineHeight: 1.5,
              }}
            >
              {groupToMarkSlaughtered.items.length === 1
                ? `Are you sure you want to mark livestock ${groupToMarkSlaughtered.items[0]?.tag_number ? `(${groupToMarkSlaughtered.items[0].tag_number}) ` : ""}belonging to ${groupToMarkSlaughtered.owner_name} as done?`
                : `Are you sure you want to mark all ${groupToMarkSlaughtered.items.length} eligible livestock records belonging to ${groupToMarkSlaughtered.owner_name} as done?`}
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 4,
                paddingTop: 14,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setGroupToMarkSlaughtered(null)}
                disabled={submittingGroupSlaughter}
                style={{
                  minWidth: 96,
                  height: 38,
                  fontWeight: 650,
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="btn-primary"
                onClick={handleConfirmGroupSlaughter}
                disabled={submittingGroupSlaughter}
                style={{
                  minWidth: 120,
                  height: 38,
                  fontWeight: 650,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  color: "#ffffff",
                  border: "none",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                }}
              >
                {submittingGroupSlaughter ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Processing...
                  </span>
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Sequential Interactive Checklist Modal */}
      <Modal
        open={!!active}
        onClose={() => {
          if (!completionPopup) {
            setActive(null);
            refreshAll();
          }
        }}
        title={active ? `Slaughter Line Execution — ${active.tag_number}` : ""}
        size="lg"
        hideCloseButton
        bodyStyle={{ overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}
        footer={
          <Button
            variant="outline"
            onClick={() => {
              setActive(null);
              refreshAll();
            }}
          >
            Close
          </Button>
        }
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {/* Header info banner */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 18px",
                background: "var(--color-bg)",
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                marginBottom: 16,
                flexShrink: 0
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "var(--color-text)" }}>
                  {active.tag_number}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>Owner: <b style={{ color: "var(--color-text)" }}>{active.owner_name}</b></span>
                  <span>·</span>
                  <span>Species: <b style={{ color: "var(--color-text)" }}>{active.species}</b></span>
                  <span>·</span>
                  <span>Sex: <b style={{ color: "var(--color-text)" }}>{formatSex(active.sex)}</b></span>
                  <span>·</span>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Operator:</span>
                    {active.operator && active.operator !== "Unassigned" ? (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "var(--color-success-bg)",
                          color: "var(--color-success)",
                          fontWeight: 700,
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          border: "1px solid rgba(16, 185, 129, 0.3)"
                        }}
                        title="Operator has been assigned and cannot be changed"
                      >
                        <Icon.Lock size={12} />
                        {active.operator} (Assigned & Locked)
                      </span>
                    ) : (
                      <select
                        value={active.operator || ""}
                        onChange={async (e) => {
                          const newOp = e.target.value;
                          if (!newOp) return;
                          try {
                            await staffService.updateProcessing(active.id, { operator: newOp }, active.tag_number);
                            setActive((prev) => ({ ...prev, operator: newOp }));
                            refreshAll();
                            showToast(`Assigned operator set to ${newOp}`, "success");
                          } catch (err) {
                            showToast("Failed to update operator", "error");
                          }
                        }}
                        style={{
                          height: 28,
                          padding: "0 8px",
                          fontSize: 12,
                          fontWeight: 700,
                          borderRadius: 6,
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-text)",
                          cursor: "pointer"
                        }}
                      >
                        <option value="">-- Select Operator --</option>
                        {OPERATOR_TEAMS.map((team) => (
                          <option key={team} value={team}>{team}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  {active.completed_at || active.steps?.completed_at ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--color-success)" }}>
                      <Icon.CheckCircle size={13} />
                      <span><strong>Completed At:</strong> {formatPhDateTime(active.completed_at || active.slaughter_completed_at || active.steps?.completed_at)}</span>
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--color-warning)" }}>
                      <Icon.Clock size={13} />
                      <span><strong>Status:</strong> Processing In-Progress</span>
                    </span>
                  )}
                </div>
              </div>
              <Badge status={active.status} />
            </div>

            <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 14px", flexShrink: 0 }}>
              Advance through the standard sequential slaughter procedure. Once all steps are marked complete, the carcass is automatically routed for Veterinary Post-Mortem Inspection.
            </p>

            {/* Scrollable step-by-step section */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
              {/* Step list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {STEPS.map((s, i) => {
                  const isChecked = isStepDone(active.steps, s.key);
                  const stepTimestamp = getStepTimestamp(active.steps, s.key);
                  const stepUser = getStepUser(active.steps, s.key);
                  const isUpdatingThis = updatingStep === s.key;
                  
                  // Enforce sequential execution
                  let isDisabled = active.status === "Completed" || Boolean(updatingStep);
                  if (!isDisabled) {
                    if (isChecked) {
                      const nextStep = STEPS[i + 1];
                      if (nextStep && isStepDone(active.steps, nextStep.key)) {
                        isDisabled = true;
                      }
                    } else {
                      if (i > 0) {
                        const prevStep = STEPS[i - 1];
                        if (!isStepDone(active.steps, prevStep.key)) {
                          isDisabled = true;
                        }
                      }
                    }
                  }

                  return (
                    <div
                      key={s.key}
                      onClick={() => {
                        if (!isDisabled) toggleStep(active, s.key);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        borderRadius: 10,
                        border: isChecked ? "1.5px solid var(--color-success)" : "1px solid var(--color-border)",
                        background: isChecked ? "var(--color-success-bg)" : isDisabled ? "var(--color-bg)" : "var(--color-surface)",
                        cursor: isDisabled ? "not-allowed" : "pointer",
                        opacity: isDisabled && !isChecked && !isUpdatingThis ? 0.5 : 1,
                        transition: "all 140ms ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: isChecked ? "var(--color-success)" : "var(--color-bg)",
                            color: isChecked ? "#ffffff" : "var(--color-text-muted)",
                            border: isChecked ? "none" : "1px solid var(--color-border)",
                            fontWeight: 800,
                            fontSize: 13,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                        >
                          {isUpdatingThis ? <Icon.RefreshCw className="animate-spin" size={14} /> : isChecked ? "✓" : i + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: isChecked ? "var(--color-success)" : "var(--color-text)" }}>
                            {s.label}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{s.desc}</div>
                          {isChecked && stepTimestamp && (
                            <div style={{ fontSize: 11, color: "var(--color-success)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                              <Icon.Clock size={11} />
                              <span>Completed: <b>{formatPhDateTime(stepTimestamp)}</b> by {stepUser || "Jenel Selgas"}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        {isUpdatingThis ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Icon.RefreshCw className="animate-spin" size={13} /> Saving...
                          </span>
                        ) : isChecked ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon.Check size={14} /> Completed
                          </span>
                        ) : isDisabled && i > 0 ? (
                          <span style={{ fontSize: 11.5, color: "var(--color-text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon.Lock size={12} /> Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={isDisabled}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isDisabled) toggleStep(active, s.key);
                            }}
                            style={{ padding: "5px 12px", fontSize: 12 }}
                          >
                            Mark Done
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Complete Traceability & Audit Timeline */}
              <div style={{ marginTop: 14 }}>
                <ProcessHistoryTimeline
                  livestock={(livestock || []).find((l) => (l.tag_number || "").trim().toLowerCase() === (active.tag_number || "").trim().toLowerCase()) || active}
                  title="Slaughter Floor & Process Audit Trail"
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Slaughter Completion Notification Modal (Matches Ante-Mortem and Post-Mortem) */}
      <AlertDialog
        open={!!completionPopup}
        onClose={handleConfirmCompletionPopup}
        title={completionPopup?.title || "Slaughter Processing Complete"}
        message={completionPopup?.message || ""}
        buttonText="OK"
        variant={completionPopup?.variant || "success"}
      />
    </div>
  );
};

export default SlaughterProcessing;
