import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, Button, Modal, AlertDialog, PageHeader, StatCard, EmptyState, Badge, Pagination } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { staffService } from "../../services/staffService";
import { formatDate, formatPhDateTime, formatPhTime, initials, today, formatSex } from "../../utils/helpers";
import { authService } from "../../services/authService";
import { ProcessHistoryTimeline } from "../../components/common/ProcessHistoryTimeline";
import { getCurrentActor } from "../../utils/processHistory";
import { getRemainingWeighingForOwner } from "../../services/modalLifecycleService";
import { scrollToFirstError } from "../../utils/formValidation";

// Theme-adaptive species style helper using native design tokens
const getSpeciesStyle = (species) => {
  switch (species) {
    case "Hog":
      return {
        bg: "var(--color-violet-bg)",
        text: "var(--color-violet)",
        border: "rgba(139, 92, 246, 0.35)"
      };
    case "Cattle":
      return {
        bg: "var(--color-info-bg)",
        text: "var(--color-info)",
        border: "rgba(14, 165, 233, 0.35)"
      };
    case "Carabao":
      return {
        bg: "var(--color-success-bg)",
        text: "var(--color-success)",
        border: "rgba(16, 185, 129, 0.35)"
      };
    case "Goat":
    default:
      return {
        bg: "var(--color-warning-bg)",
        text: "var(--color-warning)",
        border: "rgba(245, 158, 11, 0.35)"
      };
  }
};

export const formatCarcassBrandCode = (code, tag) => {
  const c = String(code || "").trim();
  if (c && c.startsWith("CAR-2026-") && c.length >= 10) return c;
  const numPart = String(c || tag || "").replace(/\D/g, "").padStart(3, "0");
  return numPart ? `CAR-2026-${numPart}` : `CAR-2026-001`;
};

export const formatSpeciesList = (list) => {
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

const isWithinDateRange = (dateStr, range) => {
  if (!dateStr || range === "all") return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") {
    return d >= startOfDay;
  }
  if (range === "week") {
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    return d >= startOfWeek;
  }
  if (range === "month") {
    const startOfMonth = new Date(startOfDay);
    startOfMonth.setDate(startOfMonth.getDate() - 30);
    return d >= startOfMonth;
  }
  return true;
};

// Copyable monospace tag badge that adapts natively to both light and dark mode
const TagBadge = ({ tag }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!tag) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(String(tag).trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy tag number"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 6,
        fontFamily: "monospace",
        fontWeight: 700,
        fontSize: 12.5,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        background: copied ? "var(--color-success-bg)" : "var(--color-bg)",
        color: copied ? "var(--color-success)" : "var(--color-text)",
        border: copied ? "1px solid var(--color-success)" : "1px solid var(--color-border)",
        cursor: "pointer",
        transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
      }}
    >
      <span>{tag}</span>
      {copied && (
        <Icon.Check size={12} color="var(--color-success)" style={{ flexShrink: 0 }} />
      )}
    </button>
  );
};

const calcNet = (item) => {
  if (!item) return null;
  const raw = item.net_weight ?? item.cold_weight ?? item.weightVal ?? item.weight ?? item.total_weight ?? item.hot_weight;
  const val = parseFloat(raw);
  return isNaN(val) ? null : val;
};

// Carcass Weighing display helper: normalizes partial condemnation results to "Passed"
const getCarcassDisplayVerdict = (decision) => {
  const d = String(decision || "").toLowerCase();
  if (d.includes("partial")) {
    return "Passed";
  }
  return decision || "Passed";
};

export const CarcassWeighing = () => {
  const { data = [], loading: loadingCarcass, refresh } = useSupabase(TABLES.CARCASS);
  const { data: slaughter = [], loading: loadingSlaughter, refresh: refreshSlaughter } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: livestock = [], loading: loadingLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: postMortem = [], loading: loadingPostMortem, refresh: refreshPostMortem } = useSupabase(TABLES.POST_MORTEM);
  const { data: processing = [], loading: loadingProcessing, refresh: refreshProcessing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: owners = [], loading: loadingOwners, refresh: refreshOwners } = useSupabase(TABLES.OWNERS);

  const isRecordsLoading =
    (loadingCarcass && (!data || data.length === 0)) ||
    (loadingLivestock && (!livestock || livestock.length === 0)) ||
    (loadingPostMortem && (!postMortem || postMortem.length === 0)) ||
    (loadingOwners && (!owners || owners.length === 0));

  const [modalOpen, setModalOpen] = useState(false);
  const [confirmBatchModalOpen, setConfirmBatchModalOpen] = useState(false);
  const [batchToConfirm, setBatchToConfirm] = useState(null);
  const [modalSuccessAlert, setModalSuccessAlert] = useState(null);
  const [inAppAlert, setInAppAlert] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { showToast } = useToast();

  // Selected carcass for Dossier View Modal
  const [selectedCarcass, setSelectedCarcass] = useState(null);

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "awaiting" || urlTab === "weighed") return urlTab;
    return "awaiting";
  });
  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest"); // 'newest' | 'oldest' | 'weight_high' | 'weight_low' | 'tag_asc'

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "awaiting" || urlTab === "weighed") {
      setActiveTab(urlTab);
    }
    const q = searchParams.get("tag") || searchParams.get("search");
    if (q) setSearch(q);
  }, [searchParams]);

  const [selectedOwner, setSelectedOwner] = useState("");
  const [singleAnimal, setSingleAnimal] = useState(null);
  const [weights, setWeights] = useState({});
  const [brandCodes, setBrandCodes] = useState({});
  const [brandMethods, setBrandMethods] = useState({});
  const [brandingStatus, setBrandingStatus] = useState({});

  // Editing / Correction Modal States (Authorized Veterinary Personnel only)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCarcass, setEditingCarcass] = useState(null);
  const [editWeight, setEditWeight] = useState("");
  const [editGrade, setEditGrade] = useState("A");
  const [editBrandCode, setEditBrandCode] = useState("");
  const [editBrandMethod, setEditBrandMethod] = useState("Official Meat Inspection Stamp (Food-Grade Ink)");
  const [editSaving, setEditSaving] = useState(false);

  // Veterinary Authorization verification
  const currentActor = getCurrentActor();
  const isAuthorizedVet = currentActor.role === "vet" || currentActor.role === "admin";

  const getNowTimeStr = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };
  const [weighTime, setWeighTime] = useState(getNowTimeStr);

  // Pagination states
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [weighedViewMode, setWeighedViewMode] = useState("grouped"); // 'grouped' | 'individual'

  const toggleGroupExpand = (groupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  useEffect(() => {
    setPage(1);
    setExpandedGroups(new Set());
  }, [search, filterSpecies, dateFilter, sortBy, activeTab, weighedViewMode]);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refresh(),
        refreshSlaughter?.(),
        refreshLivestock?.(),
        refreshPostMortem?.(),
        refreshProcessing?.(),
        refreshOwners?.(),
      ]);
      showToast("Carcass records and scale logs synchronized", "info");
    } catch {
      showToast("Sync completed", "info");
    } finally {
      setTimeout(() => setIsRefreshing(false), 450);
    }
  };

  // Robust owner resolution querying TABLES.OWNERS
  const resolveOwner = (animal, item) => {
    const ownerId = item?.owner_id || animal?.owner_id;
    if (ownerId && Array.isArray(owners) && owners.length > 0) {
      const cleanOId = String(ownerId).trim().toLowerCase();
      const matchedOwner = owners.find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
        const oTempId = String(o.temp_reg_id || "").trim().toLowerCase();
        const oAuthId = String(o.auth_user_id || "").trim().toLowerCase();
        return oId === cleanOId || oOwnerId === cleanOId || oTempId === cleanOId || oAuthId === cleanOId;
      });
      if (matchedOwner?.name) {
        return {
          id: matchedOwner.id || ownerId,
          name: matchedOwner.name,
          contact: matchedOwner.contact || matchedOwner.phone || item?.owner_contact || animal?.owner_contact || "—",
          address: matchedOwner.address || item?.owner_address || animal?.address || "—",
        };
      }
    }

    const directName = item?.owner_name || item?.owner;
    if (directName && directName !== "Unknown" && directName !== "—") {
      const matchedOwner = (owners || []).find(
        (o) => (o.name || "").trim().toLowerCase() === String(directName).trim().toLowerCase()
      );
      return {
        name: matchedOwner?.name || directName,
        contact: matchedOwner?.contact || matchedOwner?.phone || item?.owner_contact || item?.contact_number || "—",
        address: matchedOwner?.address || item?.owner_address || "—",
      };
    }

    if (animal?.owner_name && animal.owner_name !== "Unknown" && animal.owner_name !== "—") {
      const matchedOwner = (owners || []).find(
        (o) => (o.name || "").trim().toLowerCase() === String(animal.owner_name).trim().toLowerCase()
      );
      return {
        name: matchedOwner?.name || animal.owner_name,
        contact: matchedOwner?.contact || matchedOwner?.phone || animal.owner_contact || animal.contact_number || "—",
        address: matchedOwner?.address || animal.address || "—",
      };
    }

    return {
      name: "Unknown Owner",
      contact: "—",
      address: "—",
    };
  };

  const weighedTagSet = useMemo(() => {
    const set = new Set();
    (data || []).forEach((c) => {
      if (c.tag_number) {
        String(c.tag_number).split(",").forEach((t) => {
          const clean = t.trim().toLowerCase();
          if (clean) set.add(clean);
        });
      }
    });
    // Also include any animals in livestock already recorded as weighed/completed/etc.
    (livestock || []).forEach((l) => {
      const s = String(l.status || "").trim().toLowerCase();
      const ws = String(l.workflow_status || "").trim().toUpperCase();
      if (s === "weighed" || s === "completed" || s === "paid" || s === "dispatched" || ws === "WEIGHED") {
        const clean = String(l.tag_number || "").trim().toLowerCase();
        if (clean) set.add(clean);
      }
    });
    return set;
  }, [data, livestock]);

  // Animals eligible to be weighed:
  // Must satisfy:
  // 1. MUST have passed Post-Mortem Inspection by the Veterinarian (Approved / Passed / Partial)
  // 2. Not yet weighed, not released, not condemned
  const eligibleToWeigh = useMemo(() => {
    // If core records are still loading, do not prematurely evaluate the queue with partial data
    if (isRecordsLoading) return [];

    const list = [];
    const seenTags = new Set();

    const candidateMap = new Map();
    (livestock || []).forEach((l) => {
      const tag = (l.tag_number || "").trim();
      if (tag) candidateMap.set(tag.toLowerCase(), { ...l });
    });
    (processing || []).forEach((p) => {
      const tag = (p.tag_number || "").trim();
      if (tag) {
        const clean = tag.toLowerCase();
        const existing = candidateMap.get(clean) || {};
        candidateMap.set(clean, {
          ...existing,
          tag_number: tag,
          species: existing.species || p.species || "Hog",
          sex: existing.sex || p.sex || "",
          owner_name: existing.owner_name || p.owner_name || "Unknown Owner",
          operator: existing.operator || p.operator || "Assigned Operator",
        });
      }
    });
    (slaughter || []).forEach((s) => {
      const tag = (s.tag_number || "").trim();
      if (tag) {
        const clean = tag.toLowerCase();
        const existing = candidateMap.get(clean) || {};
        candidateMap.set(clean, {
          ...existing,
          tag_number: tag,
          species: existing.species || s.species || "Hog",
          sex: existing.sex || s.sex || "",
          owner_name: existing.owner_name || s.owner_name || "Unknown Owner",
          operator: existing.operator || s.operator || "Assigned Operator",
        });
      }
    });
    (postMortem || []).forEach((pm) => {
      const tag = (pm.tag_number || "").trim();
      if (tag) {
        String(tag).split(",").forEach((t) => {
          const clean = t.trim().toLowerCase();
          if (clean && !candidateMap.has(clean)) {
            const l = (livestock || []).find((item) => (item.tag_number || "").trim().toLowerCase() === clean);
            candidateMap.set(clean, {
              ...l,
              id: l?.id || pm.id,
              tag_number: t.trim(),
              species: l?.species || pm.species || "Hog",
              sex: l?.sex || pm.sex || "",
              owner_name: l?.owner_name || pm.owner_name || "Unknown Owner",
              operator: l?.operator || pm.operator || "Assigned Operator",
              status: l?.status || pm.status || "Approved",
            });
          }
        });
      }
    });

    candidateMap.forEach((animal, cleanTag) => {
      if (seenTags.has(cleanTag)) return;

      if (weighedTagSet.has(cleanTag)) return;
      if (animal.status === "Released") return;

      const lowerAnimalStatus = String(animal.status || "").trim().toLowerCase();
      if (
        lowerAnimalStatus === "weighed" ||
        lowerAnimalStatus === "completed" ||
        lowerAnimalStatus === "paid" ||
        lowerAnimalStatus === "dispatched" ||
        lowerAnimalStatus === "released" ||
        lowerAnimalStatus === "condemned" ||
        lowerAnimalStatus === "rejected" ||
        String(animal.workflow_status || "").trim().toUpperCase() === "WEIGHED"
      ) {
        return;
      }

      const matchingPms = (postMortem || [])
        .filter((p) => {
          if (!p.tag_number) return false;
          const tags = String(p.tag_number).split(",").map((t) => t.trim().toLowerCase());
          return tags.includes(cleanTag);
        })
        .sort((a, b) => {
          const dateA = a.created_at || a.date || "";
          const dateB = b.created_at || b.date || "";
          return dateB.localeCompare(dateA);
        });

      if (matchingPms.length === 0) return;

      const latestPm = matchingPms[0];

      const animalStatus = String(animal.status || "").toLowerCase();
      const animalPmDec = String(animal.post_mortem_decision || "").toLowerCase();

      const isPartial =
        animalStatus.includes("partial") ||
        animalPmDec.includes("partial") ||
        latestPm.decision === "Partial" ||
        latestPm.decision === "Passed with Partial Condemnation" ||
        latestPm.status === "Partial" ||
        (latestPm.decision && latestPm.decision.toLowerCase().includes("partial"));

      const isWholeCondemned =
        !isPartial &&
        (latestPm.decision === "Condemned" ||
         latestPm.decision === "Rejected" ||
         latestPm.decision === "Whole Carcass Condemned" ||
         latestPm.status === "Condemned" ||
         latestPm.status === "Rejected" ||
         (latestPm.decision && (latestPm.decision.toLowerCase().includes("condemn") || latestPm.decision.toLowerCase().includes("reject"))));

      if (isWholeCondemned) return;

      const isApprovedOrPartial =
        isPartial ||
        latestPm.decision === "Approved" ||
        latestPm.decision === "Passed" ||
        latestPm.status === "Approved" ||
        latestPm.status === "Passed" ||
        (latestPm.decision && (latestPm.decision.toLowerCase().includes("approv") || latestPm.decision.toLowerCase().includes("pass")));

      if (!isApprovedOrPartial) return;

      if (!isPartial && (animal.status === "Condemned" || animal.status === "Rejected")) return;

      const activeProc = (processing || []).find((p) => (p.tag_number || "").trim().toLowerCase() === cleanTag);
      const activeProcDone = activeProc?.steps ? Object.values(activeProc.steps).filter((v) => v === true || v?.done === true).length : 0;
      if (activeProc && activeProc.status === "In Progress" && activeProcDone < 6) {
        return;
      }

      seenTags.add(cleanTag);
      const ownerInfo = resolveOwner(animal, animal);
      list.push({
        ...animal,
        owner_name: ownerInfo.name,
        owner_contact: ownerInfo.contact,
        owner_address: ownerInfo.address,
        inspectionDecision: isPartial ? "Passed with Partial Condemnation" : (latestPm.decision || "Approved"),
        isPartialCondemned: isPartial,
        postMortemRecord: latestPm,
      });
    });

    return list.sort((a, b) => {
      const timeA = new Date(a.created_at || a.received_date || 0).getTime();
      const timeB = new Date(b.created_at || b.received_date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [isRecordsLoading, livestock, weighedTagSet, slaughter, processing, postMortem, owners]);

  const uniqueOwners = useMemo(() => {
    return Array.from(new Set(eligibleToWeigh.map((l) => l.owner_name))).filter(Boolean);
  }, [eligibleToWeigh]);

  const ownerAnimals = useMemo(() => {
    return selectedOwner
      ? eligibleToWeigh.filter((l) => l.owner_name === selectedOwner)
      : [];
  }, [selectedOwner, eligibleToWeigh]);

  const handleOwnerChange = (ownerName) => {
    setSelectedOwner(ownerName);
    setSingleAnimal(null);
    const initialWeights = {};
    const initialBrandCodes = {};
    const initialBrandMethods = {};
    const initialBrandingStatus = {};
    eligibleToWeigh
      .filter((l) => l.owner_name === ownerName)
      .forEach((l) => {
        const numPart = String(l.tag_number || "").replace(/\D/g, "").padStart(3, "0");
        initialWeights[l.tag_number] = "";
        initialBrandCodes[l.tag_number] = numPart ? `CAR-2026-${numPart}` : `CAR-2026-${l.tag_number}`;
        initialBrandMethods[l.tag_number] = "Official Meat Inspection Stamp (Food-Grade Ink)";
        initialBrandingStatus[l.tag_number] = "Branded";
      });
    setWeights(initialWeights);
    setBrandCodes(initialBrandCodes);
    setBrandMethods(initialBrandMethods);
    setBrandingStatus(initialBrandingStatus);
  };

  const handleOpenSingle = (animalInput) => {
    if (!isAuthorizedVet) {
      showToast("Only authorized Veterinary Personnel can record carcass weights and branding.", "error");
      return;
    }

    // Resolve target carcass record whether passed as an object or tag string
    const targetTag = typeof animalInput === "string" ? animalInput.trim().toLowerCase() : (animalInput?.tag_number || "").trim().toLowerCase();
    const candidate = typeof animalInput === "object" && animalInput?.tag_number
      ? animalInput
      : eligibleToWeigh.find((l) => (l.tag_number || "").trim().toLowerCase() === targetTag);

    if (!candidate || !candidate.tag_number) {
      showToast("Selected carcass record is missing or could not be found. Please refresh and try again.", "error");
      return;
    }

    // Verify Post-Mortem inspection completion
    const cleanTag = candidate.tag_number.trim().toLowerCase();
    const pmRecord = candidate.postMortemRecord || (postMortem || []).find((p) => {
      if (candidate.id && p.livestock_id && p.livestock_id === candidate.id) return true;
      if (!p.tag_number) return false;
      return String(p.tag_number).split(",").map((t) => t.trim().toLowerCase()).includes(cleanTag);
    });

    const isPmCompleted =
      Boolean(pmRecord) ||
      Boolean(candidate.post_inspected_at) ||
      Boolean(candidate.post_inspected_by) ||
      candidate.status === "Approved" ||
      candidate.status === "Partially Condemned";

    if (!isPmCompleted) {
      showToast(`Cannot proceed to weighing: Carcass ${candidate.tag_number} has not completed Post-Mortem inspection.`, "error");
      return;
    }

    const pmDecision = String(pmRecord?.decision || candidate.inspectionDecision || candidate.status || "").toLowerCase();
    if (pmDecision.includes("condemn") && !pmDecision.includes("partial")) {
      showToast(`Cannot weigh ${candidate.tag_number}: This carcass was condemned during Post-Mortem inspection.`, "error");
      return;
    }

    const ownerInfo = resolveOwner(candidate, candidate);
    const resolvedOwnerName =
      ownerInfo?.name && ownerInfo.name !== "Unknown Owner"
        ? ownerInfo.name
        : candidate.owner_name || "Owner";

    const numPart = String(candidate.tag_number || "").replace(/\D/g, "").padStart(3, "0");
    const autoBrand = numPart ? `CAR-2026-${numPart}` : `CAR-2026-${candidate.tag_number}`;
    const existingWeight = candidate.cold_weight || candidate.net_weight || candidate.weightVal || candidate.weight || candidate.hot_weight || "";

    setSelectedOwnerKey(null); // Dismiss owner queue modal
    setModalSuccessAlert(null);
    setSingleAnimal({
      ...candidate,
      owner_name: resolvedOwnerName,
      owner_contact: candidate.owner_contact || ownerInfo.contact,
      owner_address: candidate.owner_address || ownerInfo.address,
      species: candidate.species || "Hog",
    });
    setSelectedOwner(resolvedOwnerName);
    setWeights({ [candidate.tag_number]: existingWeight ? String(existingWeight) : "" });
    setBrandCodes({ [candidate.tag_number]: autoBrand });
    setBrandMethods({ [candidate.tag_number]: "Official Meat Inspection Stamp (Food-Grade Ink)" });
    setBrandingStatus({ [candidate.tag_number]: "Branded" });
    setWeighTime(getNowTimeStr());
    setModalOpen(true);
  };

  const handleOpenBatch = () => {
    if (!isAuthorizedVet) {
      showToast("Only authorized Veterinary Personnel can record carcass weights and branding.", "error");
      return;
    }
    setModalSuccessAlert(null);
    setSingleAnimal(null);
    setSelectedOwner("");
    setWeights({});
    setBrandCodes({});
    setBrandMethods({});
    setBrandingStatus({});
    setWeighTime(getNowTimeStr());
    setModalOpen(true);
  };

  const handleOpenOwnerBatch = (group) => {
    if (!isAuthorizedVet) {
      showToast("Only authorized Veterinary Personnel can record carcass weights and branding.", "error");
      return;
    }
    setSelectedOwnerKey(null);
    setModalSuccessAlert(null);
    setSingleAnimal(null);
    const ownerName = typeof group === "string" ? group : group?.owner_name;
    setSelectedOwner(ownerName);
    const initialWeights = {};
    const initialBrandCodes = {};
    const initialBrandMethods = {};
    const initialBrandingStatus = {};
    if (group?.items) {
      group.items.forEach((l) => {
        const numPart = String(l.tag_number || "").replace(/\D/g, "").padStart(3, "0");
        initialWeights[l.tag_number] = "";
        initialBrandCodes[l.tag_number] = numPart ? `CAR-2026-${numPart}` : `CAR-2026-${l.tag_number}`;
        initialBrandMethods[l.tag_number] = "Official Meat Inspection Stamp (Food-Grade Ink)";
        initialBrandingStatus[l.tag_number] = "Branded";
      });
    }
    eligibleToWeigh
      .filter((l) => l.owner_name === ownerName)
      .forEach((l) => {
        if (!(l.tag_number in initialWeights)) {
          const numPart = String(l.tag_number || "").replace(/\D/g, "").padStart(3, "0");
          initialWeights[l.tag_number] = "";
          initialBrandCodes[l.tag_number] = numPart ? `CAR-2026-${numPart}` : `CAR-2026-${l.tag_number}`;
          initialBrandMethods[l.tag_number] = "Official Meat Inspection Stamp (Food-Grade Ink)";
          initialBrandingStatus[l.tag_number] = "Branded";
        }
      });
    setWeights(initialWeights);
    setBrandCodes(initialBrandCodes);
    setBrandMethods(initialBrandMethods);
    setBrandingStatus(initialBrandingStatus);
    setWeighTime(getNowTimeStr());
    setModalOpen(true);
  };

  const handleOpenEdit = (carcass) => {
    if (!isAuthorizedVet) {
      showToast("Only authorized Veterinary Personnel can edit carcass weighing details.", "error");
      return;
    }
    setEditingCarcass(carcass);
    setEditWeight(String(carcass.weightVal || carcass.weight || carcass.total_weight || ""));
    setEditGrade(carcass.grade || "A");
    setEditBrandCode(formatCarcassBrandCode(carcass.brand_code, carcass.tag_number));
    setEditBrandMethod(carcass.brand_method || "Official Meat Inspection Stamp (Food-Grade Ink)");
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingCarcass) return;
    const wVal = parseFloat(editWeight);
    if (isNaN(wVal) || wVal <= 0) {
      showToast("Please enter a valid scale weight (greater than 0kg).", "error");
      scrollToFirstError("edit-carcass-weight", { offset: 90 });
      return;
    }
    setEditSaving(true);
    try {
      await staffService.updateCarcass(editingCarcass.id, {
        total_weight: wVal,
        cold_weight: wVal,
        hot_weight: wVal,
        grade: editGrade || "A",
        brand_code: formatCarcassBrandCode(editBrandCode, editingCarcass.tag_number),
        branding_status: "Branded",
        brand_method: editBrandMethod,
        tag_number: editingCarcass.tag_number,
      });

      showToast(`Carcass ${editingCarcass.tag_number} weighing and branding details updated successfully!`, "success");
      setEditModalOpen(false);
      setEditingCarcass(null);
      await Promise.all([refresh(), refreshLivestock?.()]);
    } catch (err) {
      console.error("Failed to update carcass:", err);
      showToast(`Failed to update carcass weighing: ${err?.message || "Unknown error"}`, "error");
    } finally {
      setEditSaving(false);
    }
  };

  const displayedAnimals = useMemo(() => {
    if (singleAnimal) return [singleAnimal];
    return ownerAnimals;
  }, [singleAnimal, ownerAnimals]);

  const isGroupMode = !singleAnimal && ownerAnimals.length > 1;

  const missingCount = useMemo(() => {
    return displayedAnimals.filter((a) => {
      const w = parseFloat(weights[a.tag_number]);
      return isNaN(w) || w <= 0;
    }).length;
  }, [displayedAnimals, weights]);

  const isAllFilled = displayedAnimals.length > 0 && missingCount === 0;

  const handleWeightChange = (tag, val) => {
    setWeights((prev) => ({
      ...prev,
      [tag]: val,
    }));
  };

  const adjustWeight = (tag, delta) => {
    setWeights((prev) => {
      const current = parseFloat(prev[tag]) || 0;
      const next = Math.max(0, parseFloat((current + delta).toFixed(2)));
      return {
        ...prev,
        [tag]: next > 0 ? next.toString() : "",
      };
    });
  };

  const totalModalWeight = useMemo(() => {
    return displayedAnimals.reduce((sum, a) => {
      const w = parseFloat(weights[a.tag_number]) || 0;
      return sum + w;
    }, 0);
  }, [displayedAnimals, weights]);

  const avgModalWeight = useMemo(() => {
    const validCount = displayedAnimals.filter((a) => (parseFloat(weights[a.tag_number]) || 0) > 0).length;
    if (validCount === 0) return "0.00";
    return (totalModalWeight / validCount).toFixed(2);
  }, [displayedAnimals, weights, totalModalWeight]);

  const handlePreSave = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedOwner) {
      showToast("Please select a livestock owner first.", "error");
      return;
    }

    if (displayedAnimals.length === 0) {
      showToast("No eligible carcasses found for the selected owner.", "error");
      return;
    }

    // Comprehensive numeric scale weight validation
    const invalidAnimals = displayedAnimals.filter((a) => {
      const raw = weights[a.tag_number];
      if (raw === undefined || raw === null || String(raw).trim() === "") return true;
      const w = parseFloat(raw);
      return isNaN(w) || w <= 0;
    });

    if (invalidAnimals.length > 0) {
      const invalidTags = invalidAnimals.map((a) => a.tag_number).join(", ");
      showToast(
        `Cannot save weighing: All ${displayedAnimals.length} carcass${displayedAnimals.length > 1 ? "es" : ""} must have a valid scale weight greater than 0 kg. Missing or invalid (${invalidAnimals.length}): ${invalidTags}`,
        "error"
      );
      scrollToFirstError(`input-weight-${invalidAnimals[0].tag_number}`, { offset: 110 });
      return;
    }

    // Group selected carcasses by owner
    const grouped = {};
    displayedAnimals.forEach((animal) => {
      const owner = animal.owner_name || selectedOwner || "Unknown Owner";
      if (!grouped[owner]) grouped[owner] = [];
      grouped[owner].push({
        ...animal,
        weight: parseFloat(weights[animal.tag_number]),
      });
    });

    setBatchToConfirm({
      items: displayedAnimals.map((a) => ({
        tag_number: a.tag_number,
        weight: parseFloat(weights[a.tag_number]),
        species: a.species,
        owner_name: a.owner_name || selectedOwner,
      })),
      groupedByOwner: grouped,
      count: displayedAnimals.length,
    });
    setConfirmBatchModalOpen(true);
  };

  const executeBatchSave = async () => {
    setConfirmBatchModalOpen(false);

    if (displayedAnimals.length === 0) {
      showToast("No eligible carcasses found for the selected owner.", "error");
      return;
    }

    // Comprehensive numeric scale weight validation
    const invalidAnimals = displayedAnimals.filter((a) => {
      const raw = weights[a.tag_number];
      if (raw === undefined || raw === null || String(raw).trim() === "") return true;
      const w = parseFloat(raw);
      return isNaN(w) || w <= 0;
    });

    if (invalidAnimals.length > 0) {
      const invalidTags = invalidAnimals.map((a) => a.tag_number).join(", ");
      showToast(
        `Cannot save weighing: All ${displayedAnimals.length} carcass${displayedAnimals.length > 1 ? "es" : ""} must have a valid scale weight greater than 0 kg. Missing or invalid (${invalidAnimals.length}): ${invalidTags}`,
        "error"
      );
      scrollToFirstError(`input-weight-${invalidAnimals[0].tag_number}`, { offset: 110 });
      return;
    }

    const tagsToSave = displayedAnimals.map((a) => a.tag_number);

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const savedTags = [];
    const failed = [];
    try {
      const actor = getCurrentActor();
      const currentUser = actor.name || "Dr. Dave";
      const nowDt = new Date();
      if (weighTime) {
        const [hh, mm] = weighTime.split(":").map(Number);
        if (!isNaN(hh) && !isNaN(mm)) {
          nowDt.setHours(hh, mm, 0, 0);
        }
      }
      const weighingIso = nowDt.toISOString();

      await Promise.allSettled(
        tagsToSave.map(async (tag) => {
          const cleanTag = tag.trim().toLowerCase();
          const animal =
            (livestock || []).find((l) => (l.tag_number || "").trim().toLowerCase() === cleanTag) ||
            (processing || []).find((p) => (p.tag_number || "").trim().toLowerCase() === cleanTag) ||
            (slaughter || []).find((s) => (s.tag_number || "").trim().toLowerCase() === cleanTag);
          const match = slaughter.find((s) => (s.tag_number || "").trim().toLowerCase() === cleanTag);
          const slaughter_id = match ? match.id : "SL000";
          const wVal = parseFloat(weights[tag]) || 0;
          const numPart = String(tag || "").replace(/\D/g, "").padStart(3, "0");
          const defaultBrand = numPart ? `CAR-2026-${numPart}` : `CAR-2026-${tag}`;
          const bCode = brandCodes[tag] || defaultBrand;
          const bMethod = brandMethods[tag] || "Official Meat Inspection Stamp (Food-Grade Ink)";
          const bStatus = brandingStatus[tag] || "Branded";

          try {
            await staffService.createCarcass({
              livestock_id: animal?.id || animal?.livestock_id || null,
              tag_number: tag,
              species: animal?.species || "Hog",
              owner_name: animal?.owner_name || selectedOwner || "Unknown Owner",
              owner_id: animal?.owner_id || "",
              quantity: 1,
              total_weight: wVal,
              hot_weight: wVal,
              cold_weight: wVal,
              grade: "A",
              brand_code: bCode,
              branding_status: bStatus,
              brand_method: bMethod,
              slaughter_id,
              operator: currentUser,
              weighed_by: currentUser,
              weighed_by_user_id: actor.id,
              weighed_by_role: "vet",
              date: today(),
              weighed_at: weighingIso,
              created_at: weighingIso,
            });
            savedTags.push(tag);
          } catch (err) {
            console.error(`Carcass save failed for ${tag}:`, err);
            failed.push({ tag, message: err?.message || "Unknown error" });
          }
        })
      );

      if (failed.length === 0) {
        const successMsg = singleAnimal
          ? `Weighed, branded, and certified carcass ${tagsToSave[0]} (${brandCodes[tagsToSave[0]] || "Official Stamp"}) successfully! Proceeded to Fee Management.`
          : `Weighed, branded, and certified all ${savedTags.length} carcasses in group successfully! Proceeded to Fee Management.`;

        setInAppAlert({ title: "Carcass Weighed & Branded", message: successMsg });
        showToast(successMsg, "success");
        setModalSuccessAlert(successMsg);

        const targetOwner = selectedOwner || singleAnimal?.owner_name;
        if (targetOwner && targetOwner !== "—" && targetOwner !== "Unknown Owner") {
          const remaining = await getRemainingWeighingForOwner(targetOwner);
          if (Array.isArray(remaining)) {
            const savedSet = new Set(savedTags.map((t) => String(t).trim().toLowerCase()));
            const stillPending = remaining.filter((r) => !savedSet.has(String(r.tag_number || "").trim().toLowerCase()));

            if (stillPending.length > 0) {
              if (singleAnimal) {
                const nextAnimal = stillPending[0];
                setSelectedOwner(targetOwner);
                setSingleAnimal(nextAnimal);
                setWeights({ [nextAnimal.tag_number]: "" });
              } else {
                setSelectedOwner(targetOwner);
                setSingleAnimal(null);
                const nextWeights = {};
                stillPending.forEach((a) => {
                  nextWeights[a.tag_number] = "";
                });
                setWeights(nextWeights);
              }
              setModalOpen(true);
              return;
            } else {
              setModalOpen(false);
              setSelectedOwner("");
              setSingleAnimal(null);
              setWeights({});
              setModalSuccessAlert(null);
              return;
            }
          }
          // If query errored or returned null, do not close modal
          return;
        }

        setModalOpen(false);
        setSelectedOwner("");
        setSingleAnimal(null);
        setWeights({});
        setModalSuccessAlert(null);
      } else {
        // Keep entered weights for failed tags so user can retry without data loss
        if (savedTags.length > 0) {
          setWeights((prev) => {
            const next = {};
            failed.forEach((f) => { next[f.tag] = prev[f.tag]; });
            return next;
          });
        }
        showToast(
          failed.length === 1
            ? `Failed to save ${failed[0].tag}: ${failed[0].message}`
            : `Only ${savedTags.length} of ${tagsToSave.length} carcasses saved. Failed: ${failed.map((f) => `${f.tag} (${f.message})`).join("; ")}`,
          "error"
        );
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      // Fast targeted background refresh for carcass & livestock state
      Promise.allSettled([
        typeof refresh === "function" ? refresh() : Promise.resolve(),
        typeof refreshLivestock === "function" ? refreshLivestock() : Promise.resolve(),
      ]).catch(() => {});
    }
  };

  // Enriched Weighed Carcasses
  const enrichedCarcasses = useMemo(() => {
    return (data || []).map((c) => {
      const cleanTag = (c.tag_number || "").trim().toLowerCase();
      const animal =
        (livestock || []).find((l) => (c.livestock_id && l.id === c.livestock_id) || ((l.tag_number || "").trim().toLowerCase() === cleanTag)) ||
        (processing || []).find((p) => (c.livestock_id && p.livestock_id === c.livestock_id) || ((p.tag_number || "").trim().toLowerCase() === cleanTag)) ||
        (slaughter || []).find((s) => (c.livestock_id && s.livestock_id === c.livestock_id) || ((s.tag_number || "").trim().toLowerCase() === cleanTag));
      const pm = (postMortem || []).find((p) => {
        if (c.livestock_id && p.livestock_id === c.livestock_id) return true;
        if (animal?.id && p.livestock_id === animal.id) return true;
        if (!p.tag_number) return false;
        const tags = String(p.tag_number).split(",").map((t) => t.trim().toLowerCase());
        return tags.includes(cleanTag);
      });
      const weightVal = Number(c.cold_weight) || Number(c.total_weight) || Number(c.hot_weight) || Number(c.weightVal) || Number(c.weight) || 0;
      const ownerInfo = resolveOwner(animal, c);

      return {
        ...c,
        animal,
        species: animal?.species || c.species || "Hog",
        owner_name: ownerInfo.name,
        owner_id: ownerInfo.id || animal?.owner_id || c.owner_id || "",
        owner_contact: ownerInfo.contact,
        owner_address: ownerInfo.address,
        weightVal,
        hot_weight: Number(c.hot_weight) || weightVal,
        cold_weight: Number(c.cold_weight) || weightVal,
        grade: c.grade || "A",
        brand_code: formatCarcassBrandCode(c.brand_code, c.tag_number),
        branding_status: c.branding_status || "Branded",
        brand_method: c.brand_method || "Official Meat Inspection Stamp (Food-Grade Ink)",
        operator: c.weighed_by || c.operator || "Dr. Dave",
        weighed_by: c.weighed_by || c.operator || "Dr. Dave",
        slaughter_id: c.slaughter_id || animal?.slaughter_id || "SL-REC",
        sex: animal?.sex || c.sex || "—",
        inspector: pm?.inspector_name || animal?.post_inspected_by || "Dr. Dave",
        inspectionDecision: pm?.decision || (animal?.status === "Partially Condemned" ? "Partially Condemned" : "Approved"),
        postMortemDate: pm?.date || pm?.created_at || animal?.post_inspected_at || c.date || today(),
        weighed_at: c.weighed_at || c.created_at || null,
      };
    });
  }, [data, livestock, processing, slaughter, postMortem, owners]);

  // Filter & Sort Weighed Carcasses
  const filteredCarcasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = enrichedCarcasses.filter((c) => {
      const tag = (c.tag_number || "").toLowerCase();
      const species = (c.species || "").toLowerCase();
      const owner = (c.owner_name || "").toLowerCase();
      const inspector = (c.inspector || "").toLowerCase();
      const weightStr = String(c.weightVal || c.cold_weight || c.hot_weight || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      const breed = (c.breed || "").toLowerCase();

      const matchesSearch =
        !q ||
        tag.includes(q) ||
        species.includes(q) ||
        owner.includes(q) ||
        inspector.includes(q) ||
        weightStr.includes(q) ||
        id.includes(q) ||
        breed.includes(q);
      const matchesSpecies = filterSpecies === "all" || c.species === filterSpecies;
      const matchesDate = isWithinDateRange(c.date, dateFilter);
      return matchesSearch && matchesSpecies && matchesDate;
    });

    result.sort((a, b) => {
      if (sortBy === "oldest") {
        const timeA = new Date(a.weighed_at || a.created_at || a.date || 0).getTime();
        const timeB = new Date(b.weighed_at || b.created_at || b.date || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true });
      }
      if (sortBy === "weight_high") {
        return (b.weightVal || 0) - (a.weightVal || 0);
      }
      if (sortBy === "weight_low") {
        return (a.weightVal || 0) - (b.weightVal || 0);
      }
      if (sortBy === "tag_asc") {
        return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true });
      }
      const timeA = new Date(a.weighed_at || a.created_at || a.date || 0).getTime();
      const timeB = new Date(b.weighed_at || b.created_at || b.date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true });
    });

    return result;
  }, [enrichedCarcasses, search, filterSpecies, dateFilter, sortBy]);

  // Filter & Sort Awaiting Animals
  const filteredAwaiting = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = eligibleToWeigh.filter((l) => {
      const tag = (l.tag_number || "").toLowerCase();
      const species = (l.species || "").toLowerCase();
      const owner = (l.owner_name || "").toLowerCase();
      const breed = (l.breed || "").toLowerCase();
      const id = String(l.id || "").toLowerCase();

      const matchesSearch =
        !q ||
        tag.includes(q) ||
        species.includes(q) ||
        owner.includes(q) ||
        breed.includes(q) ||
        id.includes(q);
      const matchesSpecies = filterSpecies === "all" || l.species === filterSpecies;
      const matchesDate = isWithinDateRange(l.created_at || l.date || l.received_date, dateFilter);
      return matchesSearch && matchesSpecies && matchesDate;
    });

    result.sort((a, b) => {
      if (sortBy === "oldest") {
        return (a.created_at || a.date || "").localeCompare(b.created_at || b.date || "");
      }
      const timeA = new Date(a.created_at || a.received_date || a.date || 0).getTime();
      const timeB = new Date(b.created_at || b.received_date || b.date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true });
    });

    return result;
  }, [eligibleToWeigh, search, filterSpecies, dateFilter, sortBy]);

  // Grouped dataset for "Awaiting Weighing Queue" tab (grouped strictly by actual registered owner)
  const groupedAwaiting = useMemo(() => {
    const groups = new Map();
    (filteredAwaiting || []).forEach((item) => {
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = item.owner_name || "Unknown Owner";
      const ownerId = item.owner_id;

      const key = ownerId ? `owner_${String(ownerId).toLowerCase().trim()}` : `owner_${owner.toLowerCase().trim()}`;
      const rawTime = item.completed_at || item.slaughter_completed_at || item.created_at || item.received_date || item.slaughter_date || item.date;
      const dateStr = rawTime ? String(rawTime).split("T")[0] : "";
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      const species = (item.species || "Unknown Species").trim();

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          owner_id: ownerId,
          owner_name: owner,
          owner_contact: item.owner_contact || "",
          owner_address: item.owner_address || "",
          date: dateStr,
          rawDate: rawTime || null,
          latestTimestamp: itemTime,
          species: species,
          speciesList: [],
          items: [],
          hasPartial: false,
        });
      }
      const grp = groups.get(key);
      if (item.isPartialCondemned) {
        grp.hasPartial = true;
      }
      grp.items.push(item);
      if (species && !grp.speciesList.includes(species)) {
        grp.speciesList.push(species);
      }
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = rawTime;
        grp.date = dateStr;
      }
    });

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        count: g.items.length,
        items: [...g.items].sort((a, b) => {
          const timeA = new Date(a.completed_at || a.slaughter_completed_at || a.created_at || a.received_date || a.slaughter_date || a.date || 0).getTime();
          const timeB = new Date(b.completed_at || b.slaughter_completed_at || b.created_at || b.received_date || b.slaughter_date || b.date || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        }),
      }))
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return (a.owner_name || "").localeCompare(b.owner_name || "");
      });
  }, [filteredAwaiting]);

  // Grouped dataset for "Weighed Carcasses" tab (grouped strictly by actual registered owner)
  const groupedWeighed = useMemo(() => {
    const groups = new Map();
    (filteredCarcasses || []).forEach((item) => {
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = item.owner_name || "Unknown Owner";
      const ownerId = item.owner_id;

      const key = ownerId ? `owner_${String(ownerId).toLowerCase().trim()}` : `owner_${owner.toLowerCase().trim()}`;
      const rawTime = item.weighed_at || item.created_at || item.date;
      const dateStr = rawTime ? String(rawTime).split("T")[0] : (item.date || "");
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      const species = (item.species || "Unknown Species").trim();

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          owner_id: ownerId,
          owner_name: owner,
          owner_contact: item.owner_contact || "",
          owner_address: item.owner_address || "",
          date: dateStr,
          rawDate: rawTime || item.date || null,
          latestTimestamp: itemTime,
          species: species,
          speciesList: [],
          items: [],
          totalWeight: 0,
          hasPartial: false,
          weighed_by: item.weighed_by || item.operator || "Jenel Selgas",
        });
      }
      const grp = groups.get(key);
      if (item.isPartialCondemned || String(item.inspectionDecision || "").toLowerCase().includes("partial")) {
        grp.hasPartial = true;
      }
      grp.items.push(item);
      const w = parseFloat(item.weightVal || item.weight || item.cold_weight || item.hot_weight || 0) || 0;
      grp.totalWeight += w;
      if (species && !grp.speciesList.includes(species)) {
        grp.speciesList.push(species);
      }
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = rawTime;
        grp.date = dateStr;
      }
    });

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        count: g.items.length,
        totalWeightFormatted: g.totalWeight > 0 ? `${g.totalWeight.toFixed(2)} kg` : "—",
        items: [...g.items].sort((a, b) => {
          const timeA = new Date(a.weighed_at || a.created_at || a.date || 0).getTime();
          const timeB = new Date(b.weighed_at || b.created_at || b.date || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        }),
      }))
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return (a.owner_name || "").localeCompare(b.owner_name || "");
      });
  }, [filteredCarcasses]);

  // Selected Owner Dedicated View State across all tabs (matches Condemnation pattern)
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);
  useEffect(() => {
    setSelectedOwnerKey(null);
  }, [search, filterSpecies, dateFilter, sortBy, activeTab, weighedViewMode]);

  const currentDataset = useMemo(() => {
    return activeTab === "awaiting" ? groupedAwaiting : groupedWeighed;
  }, [activeTab, groupedAwaiting, groupedWeighed]);

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return (currentDataset || []).find((g) => g.key === selectedOwnerKey) || null;
  }, [currentDataset, selectedOwnerKey]);

  // View records pagination (10 per page default)
  const [ownerViewPage, setOwnerViewPage] = useState(1);
  const [ownerViewPageSize, setOwnerViewPageSize] = useState(10);

  useEffect(() => {
    setOwnerViewPage(1);
  }, [selectedOwnerKey, activeTab, weighedViewMode]);

  const paginatedOwnerItems = useMemo(() => {
    if (!selectedOwnerView?.items) return [];
    const start = (ownerViewPage - 1) * ownerViewPageSize;
    return selectedOwnerView.items.slice(start, start + ownerViewPageSize);
  }, [selectedOwnerView, ownerViewPage, ownerViewPageSize]);

  const currentDatasetLength =
    activeTab === "awaiting"
      ? groupedAwaiting.length
      : weighedViewMode === "grouped"
      ? groupedWeighed.length
      : filteredCarcasses.length;
  const totalPages = Math.ceil(currentDatasetLength / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);

  const paginatedCarcasses = filteredCarcasses.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginatedGroupedWeighed = groupedWeighed.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const paginatedGroupedAwaiting = groupedAwaiting.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Overall KPI metrics
  const totalMassKg = (data || []).reduce((sum, c) => sum + (c.total_weight || c.cold_weight || c.hot_weight || 0), 0);
  const avgCarcassWeight = data && data.length > 0 ? (totalMassKg / data.length).toFixed(1) : "0.0";

  const activeFiltersCount =
    (search ? 1 : 0) +
    (filterSpecies !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0) +
    (sortBy !== "newest" ? 1 : 0);

  const clearAllFilters = () => {
    setSearch("");
    setFilterSpecies("all");
    setDateFilter("all");
    setSortBy("newest");
  };

  return (
    <div className="carcass-weighing-page records-page-container" style={{ width: "100%", padding: 0 }}>
      {/* Main Container */}
      <div style={{ background: "var(--color-surface)", borderRadius: 12, overflow: "hidden", border: "none", boxShadow: "none", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Unified Single-Line Toolbar */}
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
            minHeight: 54,
          }}
        >
          {/* Segmented Nav Tabs */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "var(--color-bg)",
              padding: 3,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              flexShrink: 0,
            }}
          >
            {[
              {
                id: "awaiting",
                label: "Awaiting Weighing Queue",
                count: eligibleToWeigh.length,
                icon: <Icon.Clock size={14} />,
              },
              {
                id: "weighed",
                label: "Weighed Carcasses Records",
                count: (data || []).length,
                icon: <Icon.Scale size={14} />,
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
                    gap: 6,
                    padding: "5px 10px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 600,
                    border: "none",
                    cursor: "pointer",
                    background: isActive ? "var(--color-surface)" : "transparent",
                    color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                    boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    transition: "all 140ms ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "flex", opacity: isActive ? 1 : 0.7 }}>{tab.icon}</span>
                  <span>{tab.label}</span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 800,
                      background: isActive ? "rgba(16, 185, 129, 0.15)" : "var(--color-border)",
                      color: isActive ? "#10b981" : "var(--color-text-muted)",
                    }}
                  >
                    {isRecordsLoading ? "..." : tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Toolbar Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* Search Input */}
            <div style={{ position: "relative", width: 220 }}>
              <input
                type="text"
                placeholder={activeTab === "weighed" ? "Search Tag, Owner, Species..." : "Search Tag or Owner in Queue..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  paddingLeft: 32,
                  paddingRight: search ? 28 : 10,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12.5,
                  outline: "none",
                  background: "var(--color-bg)",
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
                  pointerEvents: "none",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 8,
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
                  <Icon.X size={13} />
                </button>
              )}
            </div>

            {/* Species Dropdown */}
            <select
              value={filterSpecies}
              onChange={(e) => {
                setFilterSpecies(e.target.value);
                setPage(1);
              }}
              style={{
                height: 34,
                minWidth: 125,
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                padding: "0 28px 0 10px",
                cursor: "pointer",
                outline: "none",
                appearance: "none",
                backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
                backgroundSize: "12px",
              }}
            >
              <option value="all">All Species</option>
              <option value="Hog">Hog</option>
              <option value="Cattle">Cattle</option>
              <option value="Carabao">Carabao</option>
              <option value="Goat">Goat</option>
            </select>


            {/* View Mode Selector (Weighed tab) */}
            {activeTab === "weighed" && (
              <select
                value={weighedViewMode}
                onChange={(e) => {
                  setWeighedViewMode(e.target.value);
                  setPage(1);
                }}
                style={{
                  height: 34,
                  minWidth: 140,
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  padding: "0 26px 0 10px",
                  cursor: "pointer",
                  outline: "none",
                  appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                  backgroundSize: "12px",
                }}
              >
                <option value="grouped">Group by Owners</option>
                <option value="individual">Individual</option>
              </select>
            )}
          </div>
        </div>

        {/* Tab 1: Weighed Carcasses Records Table */}
        {activeTab === "weighed" && (
          <div style={{ width: "100%" }}>
            {isRecordsLoading ? (
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
                <span style={{ fontSize: 13, fontWeight: 600 }}>Loading carcass records...</span>
              </div>
            ) : filteredCarcasses.length === 0 ? (
              <EmptyState
                title="No carcass weighing records found"
                message={
                  search || filterSpecies !== "all" || dateFilter !== "all"
                    ? "No records match the active search and filter criteria."
                    : eligibleToWeigh.length > 0
                    ? "Click 'Record Weight' above to weigh eligible carcasses waiting in queue."
                    : "No carcass records found."
                }
                icon={<Icon.Scale size={36} />}
              />
            ) : weighedViewMode === "grouped" ? (
              <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
                <table
                  className="table awaiting-records-table"
                  style={{
                    width: "100%",
                    minWidth: 960,
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    margin: 0,
                  }}
                >
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                        Owner / Raiser
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                        Date Weighed
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                        Species
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>
                        Total Carcasses
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>
                        Total Mass
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                        Status
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "right", background: "var(--color-bg)" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedWeighed.map((grp) => (
                      <tr
                        key={grp.key}
                        onClick={() => {
                          if (grp.items?.length === 1) {
                            setSelectedCarcass(grp.items[0]);
                          } else {
                            setSelectedOwnerKey(grp.key);
                          }
                        }}
                        style={{
                          transition: "background 140ms ease",
                          borderBottom: "1px solid var(--color-border)",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {/* Owner Name */}
                        <td style={{ padding: "14px 18px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                                color: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                fontSize: 11.5,
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                                {grp.owner_name}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{grp.count} carcass{grp.count > 1 ? "es" : ""} in batch</span>
                                {grp.owner_contact && grp.owner_contact !== "—" && (
                                  <>
                                    <span>•</span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                      <Icon.Phone size={10} style={{ opacity: 0.7 }} />
                                      {grp.owner_contact}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Date Weighed */}
                        <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Icon.Calendar size={13} style={{ opacity: 0.7, color: "var(--color-primary, #0284c7)" }} />
                            <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "—"}</span>
                          </div>
                        </td>

                        {/* Species */}
                        <td style={{ padding: "14px 18px" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                            {formatSpeciesList(grp.speciesList || [grp.species])}
                          </span>
                        </td>

                        {/* Total Carcasses */}
                        <td style={{ padding: "14px 18px", textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: "var(--color-text)",
                            }}
                          >
                            {grp.count} carcass{grp.count > 1 ? "es" : ""}
                          </span>
                        </td>

                        {/* Total Weight */}
                        <td style={{ padding: "14px 18px", textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 800,
                              color: "#059669",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {grp.totalWeightFormatted}
                          </span>
                        </td>

                        {/* Status */}
                        <td style={{ padding: "14px 18px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: "var(--color-success)",
                            }}
                          >
                            <Icon.Check size={12} /> Weighed &amp; Certified
                          </span>
                        </td>

                        {/* Action: View Records */}
                        <td style={{ padding: "14px 18px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (grp.items?.length === 1) {
                                setSelectedCarcass(grp.items[0]);
                              } else {
                                setSelectedOwnerKey(grp.key);
                              }
                            }}
                            style={{
                              height: 32,
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
                            title={grp.items?.length === 1 ? "View Carcass Scale Dossier & Certificate" : "View Owner Carcass Records"}
                          >
                            <Icon.Eye size={13} /> View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
                <table
                  className="table awaiting-records-table"
                  style={{
                    width: "100%",
                    minWidth: 940,
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    margin: 0,
                  }}
                >
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ width: "16%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Tag Number</th>
                      <th style={{ width: "12%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Species</th>
                      <th style={{ width: "20%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Owner / Raiser</th>
                      <th style={{ width: "13%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>Scale Weight</th>
                      <th style={{ width: "16%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Post-Mortem</th>
                      <th style={{ width: "15%", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Date &amp; Time Weighed</th>
                      <th style={{ width: 112, padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "right", background: "var(--color-bg)" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCarcasses.map((c) => {
                      const ownerDisplay = c.owner_name || "Registered Raiser";
                      const ownerInitial = ownerDisplay && ownerDisplay !== "—" ? ownerDisplay.trim().charAt(0).toUpperCase() : "R";
                      const isPartialVerdict = String(c.inspectionDecision || "").toLowerCase().includes("partial");
                      const weighedTimeStr = c.weighed_at || c.created_at ? formatPhTime(c.weighed_at || c.created_at) : "—";

                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCarcass(c)}
                          style={{
                            cursor: "pointer",
                            transition: "background 140ms ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          {/* 1. Tag Number & Brand Code */}
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                              <TagBadge tag={c.tag_number} />
                              {c.brand_code && (
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontFamily: "monospace",
                                    fontWeight: 700,
                                    color: "var(--color-primary, #0284c7)",
                                    background: "rgba(2, 132, 199, 0.08)",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    border: "1px solid rgba(2, 132, 199, 0.2)",
                                    lineHeight: 1.2,
                                  }}
                                  title="Official Carcass Brand Code"
                                >
                                  🏷️ {formatCarcassBrandCode(c.brand_code, c.tag_number)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 2. Species */}
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "var(--color-text)",
                                  lineHeight: 1.25,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span>{c.species}</span>
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--color-text-muted)",
                                  lineHeight: 1.2,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {c.sex ? `Sex: ${formatSex(c.sex)}` : "Certified Carcass"}
                              </span>
                            </div>
                          </td>

                          {/* 3. Owner / Raiser */}
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: 7,
                                  background: "rgba(2, 132, 199, 0.1)",
                                  border: "1px solid rgba(2, 132, 199, 0.22)",
                                  color: "var(--color-primary, #0284c7)",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {ownerInitial}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: "var(--color-text)",
                                    fontSize: 13,
                                    lineHeight: 1.25,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    maxWidth: 195,
                                  }}
                                  title={ownerDisplay}
                                >
                                  {ownerDisplay}
                                </span>
                                <span
                                  style={{
                                    fontSize: 11.5,
                                    color: "var(--color-text-muted)",
                                    lineHeight: 1.2,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  {c.owner_contact && c.owner_contact !== "—" ? (
                                    <>
                                      <Icon.Phone size={10.5} style={{ opacity: 0.7, flexShrink: 0 }} />
                                      <span>{c.owner_contact}</span>
                                    </>
                                  ) : c.owner_address && c.owner_address !== "—" ? (
                                    <>
                                      <Icon.MapPin size={10.5} style={{ opacity: 0.7, flexShrink: 0 }} />
                                      <span>{c.owner_address}</span>
                                    </>
                                  ) : (
                                    "Registered Raiser"
                                  )}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 4. Scale Weight */}
                          <td style={{ textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "4px 11px",
                                borderRadius: 6,
                                fontSize: 13,
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                                background: "rgba(16, 185, 129, 0.11)",
                                color: "#047857",
                                border: "1px solid rgba(16, 185, 129, 0.28)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {Number(c.weightVal).toFixed(2)} kg
                            </span>
                          </td>

                          {/* 5. Post-Mortem */}
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <div
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: "50%",
                                  background: "rgba(2, 132, 199, 0.12)",
                                  border: "1px solid rgba(2, 132, 199, 0.28)",
                                  color: "#0284c7",
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {initials(c.inspector)}
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: "var(--color-text)",
                                    fontSize: 12.5,
                                    lineHeight: 1.25,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {c.inspector}
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    color: "#047857",
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <Icon.Check size={11} style={{ flexShrink: 0 }} />
                                  <span>{getCarcassDisplayVerdict(c.inspectionDecision)}</span>
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 6. Date & Time Weighed */}
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 12.5,
                                  color: "var(--color-text)",
                                  fontWeight: 600,
                                  lineHeight: 1.25,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <Icon.Calendar size={12.5} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                                <span>{formatDate(c.date)}</span>
                                <span style={{ color: "var(--color-border)" }}>•</span>
                                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-muted)" }}>
                                  {weighedTimeStr}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: 11.5,
                                  color: "var(--color-text-muted)",
                                  paddingLeft: 18,
                                  lineHeight: 1.2,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                By: <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{c.weighed_by || c.operator || "Jenel Selgas"}</span>
                              </div>
                            </div>
                          </td>

                          {/* 7. Actions */}
                          <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedCarcass(c)}
                              className="assign-team-fixed-btn"
                              style={{
                                width: 92,
                                minWidth: 92,
                                maxWidth: 92,
                                height: 32,
                                minHeight: 32,
                                maxHeight: 32,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                                padding: "0 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: 7,
                                color: "var(--color-primary, #0284c7)",
                                borderColor: "rgba(2, 132, 199, 0.3)",
                                background: "rgba(2, 132, 199, 0.06)",
                                boxSizing: "border-box",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                                transform: "none",
                              }}
                              title="View Carcass Scale Dossier & Certificate"
                            >
                              <Icon.Eye size={13} style={{ flexShrink: 0 }} />
                              <span>View</span>
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

        {/* Tab 2: Awaiting Weighing Queue - Grouped Batch View (Matching Condemnation UI) */}
        {activeTab === "awaiting" && (
          isRecordsLoading ? (
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
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loading awaiting weighing queue...</span>
            </div>
          ) : groupedAwaiting.length === 0 ? (
            <EmptyState
              title="No carcasses awaiting weighing"
              message={
                search || filterSpecies !== "all" || dateFilter !== "all"
                  ? `No queued animals match the search and filter criteria.`
                  : "All slaughtered carcasses have been weighed and recorded."
              }
              icon={<Icon.Check size={36} />}
            />
          ) : (
            <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
              <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Owner Name</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Date Slaughtered</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Species</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>Total Carcasses</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Status</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "right", background: "var(--color-bg)" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedAwaiting.map((grp) => (
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
                              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
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
                              {grp.count} carcass{grp.count > 1 ? "es" : ""} awaiting scale weighing
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#10b981" }} />
                          <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Undated Batch"}</span>
                        </div>
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          {formatSpeciesList(grp.speciesList || [grp.species])}
                        </span>
                      </td>

                      <td style={{ padding: "14px 18px", textAlign: "center" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#059669" }}>
                          {grp.count} {grp.count === 1 ? "carcass" : "carcasses"}
                        </span>
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--color-success)" }}>
                          <Icon.Check size={12} /> Post-Mortem Passed
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
                              height: 32,
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
                            className="btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenOwnerBatch(grp);
                            }}
                            style={{
                              height: 32,
                              padding: "6px 14px",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <Icon.Scale size={13} /> Weigh Batch
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Pagination Toolbar */}
        {false && currentDatasetLength > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 20px",
              borderTop: "1px solid var(--color-border)",
              flexWrap: "wrap",
              gap: 12,
              background: "var(--color-surface)"
            }}
          >
            {/* Info and Page Size Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13, color: "var(--color-text-muted)" }}>
              <span>
                Showing <b>{(currentPage - 1) * pageSize + 1}</b> to <b>{Math.min(currentPage * pageSize, currentDatasetLength)}</b> of <b>{currentDatasetLength}</b> {activeTab === "awaiting" || weighedViewMode === "grouped" ? "batches" : "carcasses"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12 }}>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    outline: "none",
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            {/* Pagination Number Buttons */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    color: currentPage === 1 ? "var(--color-text-subtle)" : "var(--color-text)",
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  <Icon.ChevronLeft size={14} /> Prev
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, idx, arr) => {
                    const prevP = arr[idx - 1];
                    const showEllipsis = prevP && p - prevP > 1;
                    return (
                      <span key={p} style={{ display: "inline-flex", alignItems: "center" }}>
                        {showEllipsis && <span style={{ padding: "0 4px", color: "var(--color-text-subtle)" }}>...</span>}
                        <button
                          type="button"
                          onClick={() => setPage(p)}
                          style={{
                            minWidth: 34,
                            height: 34,
                            padding: "0 8px",
                            borderRadius: 8,
                            fontSize: 12.5,
                            fontWeight: 700,
                            border: "1px solid",
                            borderColor: p === currentPage ? "var(--color-primary)" : "var(--color-border)",
                            background: p === currentPage ? "linear-gradient(135deg, #10b981, #047857)" : "var(--color-bg)",
                            color: p === currentPage ? "#ffffff" : "var(--color-text)",
                            cursor: "pointer",
                            transition: "all 140ms ease"
                          }}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    color: currentPage === totalPages ? "var(--color-text-subtle)" : "var(--color-text)",
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  Next <Icon.ChevronRight size={14} />
                </button>
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
          activeTab === "weighed"
            ? `Weighed Carcass Records — ${selectedOwnerView?.owner_name || ""}`
            : `Awaiting Carcass Weighing — ${selectedOwnerView?.owner_name || ""}`
        }
        size={activeTab === "weighed" ? "lg" : "xl"}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {selectedOwnerView?.items?.length || 0} carcass{selectedOwnerView?.items?.length === 1 ? "" : "es"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {activeTab === "awaiting" && selectedOwnerView && selectedOwnerView.items.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = selectedOwnerView;
                    setSelectedOwnerKey(null);
                    handleOpenOwnerBatch(target);
                  }}
                  style={{
                    height: 32,
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    color: "#ffffff",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon.Scale size={14} /> Weigh All Carcasses ({selectedOwnerView.items.length})
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSelectedOwnerKey(null)} style={{ height: 32, minWidth: 80, fontWeight: 700 }}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        {selectedOwnerView && (
          <div>
            {activeTab === "weighed" ? (
              <div className="table-wrap" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "55vh", scrollbarWidth: "thin", border: "none", boxShadow: "none" }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none", tableLayout: "fixed" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ width: "26%", padding: "12px 16px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                      <th style={{ width: "18%", padding: "12px 16px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ width: "16%", padding: "12px 16px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                      <th style={{ width: "24%", padding: "12px 16px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Weighed Time</th>
                      <th style={{ width: "16%", padding: "12px 16px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Cold Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((item) => {
                      const coldVal = item.cold_weight ? parseFloat(item.cold_weight) : (item.weightVal ? parseFloat(item.weightVal) : (item.weight ? parseFloat(item.weight) : null));

                      return (
                        <tr
                          key={item.id || item.tag_number}
                          style={{
                            borderBottom: "1px solid var(--color-border)",
                            transition: "background 140ms ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={{ padding: "12px 16px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!item.tag_number) return;
                                navigator.clipboard?.writeText(String(item.tag_number).trim());
                                showToast(`Copied ${item.tag_number}!`, "success");
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
                              {item.tag_number || "—"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, fontWeight: 600 }}>{item.species}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, fontWeight: 600 }}>{formatSex(item.sex)}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text)", whiteSpace: "nowrap" }}>
                            {formatPhDateTime(item.weighed_at || item.created_at)}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--color-text)" }}>
                            {coldVal != null ? `${coldVal.toFixed(2)} kg` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-wrap" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "55vh", scrollbarWidth: "thin", border: "none", boxShadow: "none" }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Operator</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Completed Time</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Processing Status</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((item) => (
                      <tr
                        key={item.id || item.tag_number}
                        onClick={() => handleOpenSingle(item)}
                        style={{
                          borderBottom: "1px solid var(--color-border)",
                          cursor: "pointer",
                          transition: "background 140ms ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!item.tag_number) return;
                              navigator.clipboard?.writeText(String(item.tag_number).trim());
                              showToast(`Copied ${item.tag_number}!`, "success");
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
                            {item.tag_number || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{item.species}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{formatSex(item.sex)}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>{item.operator || "—"}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text)" }}>
                          {formatPhDateTime(item.completed_at || item.slaughter_date || item.created_at)}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#10b981", background: "rgba(16, 185, 129, 0.1)", padding: "3px 8px", borderRadius: 4 }}>
                            Ready for Weighing
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            onClick={() => handleOpenSingle(item)}
                            style={{
                              height: 32,
                              padding: "5px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              background: "linear-gradient(135deg, #10b981, #059669)",
                              color: "#ffffff",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                            title={`Record Carcass Weight for ${item.tag_number}`}
                          >
                            <Icon.Scale size={13} /> Record Weight
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

{/* Record Weight Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSingleAnimal(null);
          setSelectedOwner("");
          setWeights({});
          setModalSuccessAlert(null);
        }}
        title={
          singleAnimal
            ? `Record Carcass Weight (${singleAnimal.tag_number})`
            : isGroupMode
            ? `Record Carcass Weights (Group — ${ownerAnimals.length} Heads)`
            : "Record Carcass Weights"
        }
        size="lg"
        alert={modalSuccessAlert}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", width: "100%", alignItems: "center" }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalOpen(false);
                setSingleAnimal(null);
                setSelectedOwner("");
                setWeights({});
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              className="btn-primary"
              onClick={(e) => handlePreSave(e)}
              style={{
                padding: "10px 22px",
                opacity: saving ? 0.7 : 1,
                cursor: saving ? "not-allowed" : "pointer"
              }}
              title={saving ? "Saving carcass records to database..." : "Save Carcass Weights & Branding"}
            >
              {saving ? (
                <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving Records...</>
              ) : (
                <><Icon.Check size={16} /> Save Carcass Weights &amp; Branding</>
              )}
            </Button>
          </div>
        }
      >
        <form onSubmit={handlePreSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 0,
            }}
          >
            <label
              htmlFor="selectOwnerDropdown"
              style={{
                fontWeight: 700,
                fontSize: 13,
                margin: 0,
                color: "var(--color-text)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              Select Livestock Owner <span className="req">*</span>
            </label>
            {singleAnimal && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--color-info)",
                  background: "var(--color-info-bg)",
                  padding: "1px 6px",
                  borderRadius: 5,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                Single Carcass Mode
              </span>
            )}
            <select
              id="selectOwnerDropdown"
              className="form-control"
              required
              value={selectedOwner}
              onChange={(e) => handleOwnerChange(e.target.value)}
              style={{
                flex: 1,
                height: 34,
                padding: "3px 10px",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                borderColor: "var(--color-border)",
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <option value="">-- Choose Owner --</option>
              {uniqueOwners.map((ownerName) => {
                const count = eligibleToWeigh.filter((l) => l.owner_name === ownerName).length;
                return (
                  <option key={ownerName} value={ownerName}>
                    {ownerName} ({count} head{count > 1 ? "s" : ""} eligible)
                  </option>
                );
              })}
              {selectedOwner && !uniqueOwners.includes(selectedOwner) && (
                <option value={selectedOwner}>{selectedOwner}</option>
              )}
            </select>
          </div>

          {(selectedOwner || singleAnimal) && displayedAnimals.length > 0 && (
            <div>
              {/* Single Animal Mode Banner */}
              {singleAnimal && ownerAnimals.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--color-info-bg)",
                    border: "1px solid rgba(14, 165, 233, 0.35)",
                    color: "var(--color-info)",
                    fontSize: 12.5,
                    marginBottom: 10
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <Icon.Scale size={15} /> Weighing single carcass: <b>{singleAnimal.tag_number}</b> (exempt from group requirement)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSingleAnimal(null);
                      handleOwnerChange(selectedOwner);
                    }}
                    style={{
                      background: "var(--color-primary)",
                      color: "#ffffff",
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    Switch to Group ({ownerAnimals.length} heads)
                  </button>
                </div>
              )}

              {/* Column Header for Carcasses - borderless outer */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 1.4fr 1.1fr",
                  alignItems: "center",
                  padding: "8px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--color-text-muted)",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <span>Carcass Branding</span>
                <span>Carcass Tag &amp; Status</span>
                <span style={{ textAlign: "right", paddingRight: 4 }}>Scale Weight</span>
              </div>

              {/* Scrollable Carcass List - borderless outer */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  maxHeight: 380,
                  overflowY: "auto",
                  padding: "8px 0",
                  background: "transparent",
                  border: "none",
                }}
              >
                {displayedAnimals.map((animal) => {
                  const val = parseFloat(weights[animal.tag_number]);
                  const hasValid = !isNaN(val) && val > 0;
                  const currentBrand = formatCarcassBrandCode(brandCodes[animal.tag_number], animal.tag_number);
                  const normSex = String(animal.sex || "").trim().toLowerCase();
                  const isFemale = normSex === "female" || normSex.startsWith("f");
                  const isMale = normSex === "male" || normSex.startsWith("m");

                  return (
                    <div
                      key={animal.tag_number}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.3fr 1.4fr 1.1fr",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        background: "var(--color-surface)",
                        borderRadius: 8,
                        border: isGroupMode && !hasValid
                          ? "1.5px solid rgba(239, 68, 68, 0.45)"
                          : "1px solid var(--color-border)",
                        boxShadow: isGroupMode && !hasValid
                          ? "0 1px 3px rgba(239, 68, 68, 0.08)"
                          : "none",
                        transition: "all 140ms ease"
                      }}
                    >
                      {/* 1. Official Carcass Branding */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 12px",
                            borderRadius: 6,
                            background: "rgba(2, 132, 199, 0.08)",
                            border: "1px solid rgba(2, 132, 199, 0.25)",
                            color: "var(--color-primary, #0284c7)",
                            fontFamily: "monospace",
                            fontSize: 12.5,
                            fontWeight: 800,
                            letterSpacing: "0.02em",
                            userSelect: "none",
                          }}
                          title="System-assigned official carcass identification brand (Protected from manual typing errors)"
                        >
                          <Icon.Award size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
                          <span>{currentBrand}</span>
                        </div>
                      </div>

                      {/* 2. Carcass Tag & Status & Sex */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: "var(--color-text)" }}>
                            {animal.tag_number}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#059669" }}>
                            Passed
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginTop: 3 }}>
                          {isFemale ? (
                            <span style={{ color: "#be185d", fontWeight: 700 }}>♀ Female</span>
                          ) : isMale ? (
                            <span style={{ color: "#1d4ed8", fontWeight: 700 }}>♂ Male</span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>Sex: {formatSex(animal.sex)}</span>
                          )}
                          <span style={{ color: "var(--color-border)" }}>•</span>
                          <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{animal.species || "Hog"}</span>
                        </div>
                      </div>

                      {/* 3. Scale Weight */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                          <input
                            id={`input-weight-${animal.tag_number}`}
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="0.00"
                            className="form-control"
                            style={{
                              width: 95,
                              height: 36,
                              background: "var(--color-bg)",
                              color: "var(--color-text)",
                              fontSize: 13,
                              fontWeight: 800,
                              textAlign: "center",
                              paddingRight: 22,
                              borderRadius: 6,
                              borderColor: isGroupMode && !hasValid ? "var(--color-danger)" : "var(--color-border)",
                            }}
                            value={weights[animal.tag_number] ?? ""}
                            onChange={(e) => handleWeightChange(animal.tag_number, e.target.value)}
                          />
                          <span style={{ position: "absolute", right: 7, fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", pointerEvents: "none" }}>
                            kg
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* Batch Weighing Confirmation Modal */}
      <Modal
        open={confirmBatchModalOpen}
        onClose={() => {
          if (!saving) {
            setConfirmBatchModalOpen(false);
          }
        }}
        title="Confirm Carcass Weighing"
        size="md"
        backdropStyle={{ zIndex: 1250 }}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", width: "100%", alignItems: "center" }}>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmBatchModalOpen(false)}
              style={{ minWidth: 96, height: 38, fontWeight: 650 }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={executeBatchSave}
              style={{
                minWidth: 120,
                height: 38,
                fontWeight: 650,
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
              }}
            >
              {saving ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Processing...
                </span>
              ) : (
                "Confirm"
              )}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "rgba(16, 185, 129, 0.12)",
                color: "#059669",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <Icon.Scale size={20} />
            </div>
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14.5,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  lineHeight: 1.45,
                }}
              >
                Are you sure you want to record the weights for the selected carcasses?
              </p>
              <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--color-text-muted)" }}>
                Total Selected: <strong>{batchToConfirm?.count || 0} carcass{(batchToConfirm?.count || 0) === 1 ? "" : "es"}</strong>
              </p>
            </div>
          </div>
        </div>
      </Modal>

      {/* Scale Dossier View Details Modal */}
      <Modal
        open={!!selectedCarcass}
        onClose={() => setSelectedCarcass(null)}
        title="Official Carcass Scale Dossier & Certification"
        size="lg"
        backdropStyle={{ zIndex: 1200 }}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", width: "100%", alignItems: "center" }}>
            <Button
              variant="outline"
              onClick={() => setSelectedCarcass(null)}
              className="assign-team-fixed-btn"
              style={{
                width: 96,
                minWidth: 96,
                maxWidth: 96,
                height: 36,
                minHeight: 36,
                maxHeight: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 600,
                boxSizing: "border-box",
                transform: "none",
              }}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedCarcass && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* 1. Dossier Identification Header Banner */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 18px",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 9,
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    color: "#059669",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Scale size={19} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Scale Ticket #
                    </span>
                    <TagBadge tag={selectedCarcass.tag_number} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      marginTop: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    <Icon.Calendar size={12.5} style={{ opacity: 0.75 }} />
                    <span>
                      Weighed:{" "}
                      <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>
                        {selectedCarcass.weighed_at || selectedCarcass.created_at
                          ? formatPhDateTime(selectedCarcass.weighed_at || selectedCarcass.created_at)
                          : formatDate(selectedCarcass.date)}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 12px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    background: "rgba(16, 185, 129, 0.11)",
                    color: "#047857",
                    border: "1px solid rgba(16, 185, 129, 0.28)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon.Check size={13} style={{ flexShrink: 0 }} />
                  <span>Certified Weighed</span>
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "5px 12px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {Number(selectedCarcass.weightVal || selectedCarcass.cold_weight || selectedCarcass.hot_weight || selectedCarcass.weight || 0).toFixed(2)} kg
                </span>
              </div>
            </div>

            {/* 2. Structured 2x2 Dossier Information Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              {/* Card 1: Livestock Owner & Producer */}
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    background: "var(--color-bg)",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--color-text)",
                  }}
                >
                  <Icon.User size={14} style={{ color: "var(--color-primary, #0284c7)", flexShrink: 0 }} />
                  <span>Livestock Owner &amp; Producer</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Registered Name</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)", textAlign: "right" }}>
                      {selectedCarcass.owner_name}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Contact Phone</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)", textAlign: "right" }}>
                      {selectedCarcass.owner_contact}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      padding: "9px 16px",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Address</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)", textAlign: "right", lineHeight: 1.4 }}>
                      {selectedCarcass.owner_address}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Animal & Carcass Specifications */}
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    background: "var(--color-bg)",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--color-text)",
                  }}
                >
                  <Icon.Cow size={14} style={{ color: "#059669", flexShrink: 0 }} />
                  <span>Animal &amp; Carcass Specifications</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Species</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)", textAlign: "right" }}>
                      {selectedCarcass.species}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Sex</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)", textAlign: "right" }}>
                      {formatSex(selectedCarcass.sex)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Scale Weight</span>
                    <span style={{ fontWeight: 800, color: "#047857", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                      {Number(selectedCarcass.weightVal || selectedCarcass.cold_weight || selectedCarcass.hot_weight || selectedCarcass.weight || 0).toFixed(2)} kg
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Veterinary Clearance */}
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    background: "var(--color-bg)",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--color-text)",
                  }}
                >
                  <Icon.Stethoscope size={14} style={{ color: "var(--color-primary, #0284c7)", flexShrink: 0 }} />
                  <span>Veterinary Clearance</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Examining Veterinarian</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)", textAlign: "right" }}>
                      {selectedCarcass.inspector || "Dr. Dave"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Post-Mortem Verdict</span>
                    <Badge status={getCarcassDisplayVerdict(selectedCarcass.inspectionDecision)} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Inspection Date</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)", textAlign: "right" }}>
                      {formatDate(selectedCarcass.postMortemDate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Scale Station Audit Trail */}
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    background: "var(--color-bg)",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--color-text)",
                  }}
                >
                  <Icon.Award size={14} style={{ color: "#d97706", flexShrink: 0 }} />
                  <span>Scale Station &amp; Branding Audit</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Certifying Veterinarian</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)", textAlign: "right" }}>
                      {selectedCarcass.weighed_by || selectedCarcass.operator || "Dr. Dave"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Official Brand / Stamp</span>
                    <span
                      style={{
                        fontWeight: 700,
                        fontFamily: "monospace",
                        color: "#0284c7",
                        background: "rgba(14, 165, 233, 0.10)",
                        padding: "2px 8px",
                        borderRadius: 5,
                        border: "1px solid rgba(14, 165, 233, 0.25)",
                        textAlign: "right",
                      }}
                    >
                      {formatCarcassBrandCode(selectedCarcass.brand_code, selectedCarcass.tag_number)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 16px",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>Weighed &amp; Branded Time</span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--color-text)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        textAlign: "right",
                      }}
                    >
                      <span>{formatDate(selectedCarcass.date)}</span>
                      <span style={{ color: "var(--color-border)" }}>•</span>
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {selectedCarcass.weighed_at || selectedCarcass.created_at
                          ? formatPhTime(selectedCarcass.weighed_at || selectedCarcass.created_at)
                          : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Full-Width Carcass Traceability & Process Audit Trail */}
            <div>
              <ProcessHistoryTimeline
                record={
                  selectedCarcass.animal ||
                  (livestock || []).find(
                    (l) =>
                      (selectedCarcass.livestock_id && l.id === selectedCarcass.livestock_id) ||
                      (l.tag_number || "").trim().toLowerCase() ===
                      (selectedCarcass.tag_number || "").trim().toLowerCase()
                  ) ||
                  selectedCarcass
                }
                title="Carcass Traceability & Process Audit Trail"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Weight & Branding Modal (Authorized Veterinary Personnel only) */}
      <Modal
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditingCarcass(null);
        }}
        title="Edit Carcass Weight & Official Branding"
        size="md"
      >
        {editingCarcass && (
          <form onSubmit={handleSaveEdit}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--color-bg)",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                    Carcass Tag Number
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: "var(--color-text)", marginTop: 2 }}>
                    {editingCarcass.tag_number}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                    Owner
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginTop: 2 }}>
                    {editingCarcass.owner_name}
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                  Scale Weight (kg) <span className="req">*</span>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="edit-carcass-weight"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    className="form-control"
                    value={editWeight}
                    onChange={(e) => setEditWeight(e.target.value)}
                    style={{
                      height: 42,
                      fontSize: 14,
                      fontWeight: 700,
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-muted)" }}>kg</span>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                  Carcass Grade
                </label>
                <select
                  className="form-control"
                  value={editGrade}
                  onChange={(e) => setEditGrade(e.target.value)}
                  style={{
                    height: 42,
                    fontSize: 13.5,
                    fontWeight: 600,
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                  }}
                >
                  <option value="A">Grade A (Prime / Premium)</option>
                  <option value="B">Grade B (Standard Choice)</option>
                  <option value="C">Grade C (Commercial)</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                  Official Inspection Brand / Stamp Code
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="text"
                    readOnly
                    className="form-control"
                    value={editBrandCode}
                    style={{
                      height: 42,
                      fontSize: 13.5,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      background: "rgba(2, 132, 199, 0.06)",
                      borderColor: "rgba(2, 132, 199, 0.25)",
                      color: "var(--color-primary, #0284c7)",
                      cursor: "not-allowed",
                    }}
                    title="System-assigned official carcass identification brand (Read-only)"
                  />
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 6,
                      background: "rgba(2, 132, 199, 0.1)",
                      color: "var(--color-primary, #0284c7)",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Icon.Award size={13} />
                    <span>Locked</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                  Branding Method
                </label>
                <select
                  className="form-control"
                  value={editBrandMethod}
                  onChange={(e) => setEditBrandMethod(e.target.value)}
                  style={{
                    height: 42,
                    fontSize: 13.5,
                    fontWeight: 600,
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                  }}
                >
                  <option value="Official Meat Inspection Stamp (Food-Grade Ink)">Official Meat Inspection Stamp (Food-Grade Ink)</option>
                  <option value="Hot Brand">Hot Brand</option>
                  <option value="Cold Brand">Cold Brand</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditModalOpen(false);
                    setEditingCarcass(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editSaving || !parseFloat(editWeight)}
                  className="btn-primary"
                  style={{
                    padding: "10px 20px",
                    fontWeight: 700,
                  }}
                >
                  {editSaving ? (
                    <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
                  ) : (
                    <><Icon.Check size={16} /> Save Changes</>
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Clean In-App Alert Dialog (replaces native window.alert to provide polished in-app UX) */}
      <AlertDialog
        open={!!inAppAlert}
        onClose={() => setInAppAlert(null)}
        title={inAppAlert?.title || "Notification"}
        message={inAppAlert?.message}
        buttonText="OK"
        variant="success"
      />
    </div>
  );
};

export default CarcassWeighing;
