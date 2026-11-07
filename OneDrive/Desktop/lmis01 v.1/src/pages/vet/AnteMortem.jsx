import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, Button, Modal, ConfirmDialog, AlertDialog, PageHeader, StatCard, EmptyState, Badge, Pagination } from "../../components/ui";
import { TagBadge } from "../../components/ui/TagBadge";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { vetService } from "../../services/vetService";
import { InspectionForm } from "../../components/forms/InspectionForm";
import { formatDate, formatPhDateTime, initials, today, formatSex } from "../../utils/helpers";
import { CondemnedMeatRecords, EvidenceUpload } from "./VetExtra";
import { getCondemnationStage, matchesStage, isAnteCondemnedStatus } from "./condemnationStage";
import { useCondemnationEvidenceIndex } from "./condemnationEvidenceIndex";
import { ProcessHistoryTimeline } from "../../components/common/ProcessHistoryTimeline";
import { getRemainingAnteMortemForOwner, getAllRemainingAnteMortem } from "../../services/modalLifecycleService";

export const AnteMortem = ({ initialTab = "awaiting" }) => {
  const { data: data = [], loading: loadingAnte, refresh: refreshData } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: livestock = [], loading: loadingLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: condemnedRecords = [], refresh: refreshCondemned } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: evidenceRecords = [], refresh: refreshEvidence } = useSupabase(TABLES.EVIDENCE_RECORDS || "evidence_records");
  // Needed by the shared condemnation evidence index: a live animal condemned at
  // Ante-Mortem must never be attributed to a Post-Mortem carcass record.
  const { data: postMortemRecords = [], refresh: refreshPostMortem } = useSupabase(TABLES.POST_MORTEM);
  const { data: owners = [], refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  const [loading, setLoading] = useState(true);
  const [inAppAlert, setInAppAlert] = useState(null);

  const isQueueLoading = loadingLivestock || loadingAnte;

  const normalizeTab = (t) => {
    // "All Inspection Records" tab removed: legacy links (log/inspected/records) open the default tab.
    if (t === "queue" || t === "awaiting") return "awaiting";
    if (t === "condemned" || t === "evidence") return "evidence";
    return "awaiting";
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

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) return normalizeTab(urlTab);
    return normalizeTab(initialTab);
  });
  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [dateRange, setDateRange] = useState("all"); // 'all' | 'today' | 'week' | 'month'

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) {
      setActiveTab(normalizeTab(urlTab));
    } else {
      setActiveTab(normalizeTab(initialTab));
    }
    const q = searchParams.get("tag") || searchParams.get("search");
    if (q) setSearch(q);
  }, [initialTab, searchParams]);

  const [modalOpen, setModalOpen] = useState(false);
  const [targetTagForModal, setTargetTagForModal] = useState("");
  const [anteDecision, setAnteDecision] = useState("Approved");
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { showToast } = useToast();

  // Collapsible accordion state for grouped owner batches (matching Animal Marking)
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const toggleGroupExpand = (groupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };
  const expandAllGroups = (list) => setExpandedGroups(new Set((list || []).map((g) => g.key)));
  const collapseAllGroups = () => setExpandedGroups(new Set());

  // Per-group and individual selection for Awaiting Inspection queue
  const [selectedQueueTags, setSelectedQueueTags] = useState(new Set());
  const toggleSelectQueueTag = (tag) => {
    if (!tag) return;
    setSelectedQueueTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };
  const isOwnerAllSelected = (grp) => grp.items.length > 0 && grp.items.every((i) => selectedQueueTags.has(i.tag_number));
  const isOwnerSomeSelected = (grp) => grp.items.some((i) => selectedQueueTags.has(i.tag_number)) && !isOwnerAllSelected(grp);
  const toggleSelectOwnerGroup = (grp) => {
    const allSel = isOwnerAllSelected(grp);
    setSelectedQueueTags((prev) => {
      const next = new Set(prev);
      grp.items.forEach((i) => {
        if (allSel) next.delete(i.tag_number);
        else next.add(i.tag_number);
      });
      return next;
    });
  };

  // Pagination states
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Dedicated view state for selected owner (matching Condemnation view)
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);

  useEffect(() => {
    setPage(1);
    setSelectedOwnerKey(null);
    setSelectedQueueTags(new Set());
  }, [search, filterSpecies, dateRange, activeTab]);

  useEffect(() => {
    setLoading(false);
  }, [data, livestock]);

  // All condemned live animal tags (across inspections, livestock status, and condemnation records)
  const allCondemnedAnteTags = useMemo(() => {
    const set = new Set();
    (data || []).forEach((i) => {
      const isCond = i.decision === "Rejected" || i.decision === "Condemned" ||
        (i.decision && (i.decision.toLowerCase().includes("reject") || i.decision.toLowerCase().includes("condemn")));
      if (isCond && i.tag_number) set.add(String(i.tag_number).trim());
    });
    (livestock || []).forEach((l) => {
      // Post-mortem outcomes (Partially / Post-Mortem Whole Carcass Condemned) are NOT ante-mortem condemnations
      const isCond = isAnteCondemnedStatus(l.status);
      if (isCond && l.tag_number) set.add(String(l.tag_number).trim());
    });
    (condemnedRecords || []).forEach((c) => {
      // Stage is derived from the condemnation record itself, never from "does this tag have any inspection"
      if (matchesStage(c, "Ante-Mortem") && c.tag_number) set.add(String(c.tag_number).trim());
    });
    return set;
  }, [data, livestock, condemnedRecords]);

  const totalCondemnedCount = allCondemnedAnteTags.size;

  // Condemnation Evidence card count.
  // Derived from the exact same dataset the Ante-Mortem Condemnation Evidence page
  // renders (see condemnationEvidenceIndex), so the card always equals the number of
  // records shown on the page: same stage filter, same deleted-status filter, and the
  // same one-record-per-condemnation grouping that stops duplicate photos from
  // inflating the count.
  const { evidenceCount: anteEvidenceCount } = useCondemnationEvidenceIndex(
    "Ante-Mortem",
    {
      ante: data,
      post: postMortemRecords,
      livestock,
      condemned: condemnedRecords,
      evidence: evidenceRecords,
    }
  );

  // Awaiting inspection live animals:
  // Identified if this specific livestock entry has not yet been inspected in ante-mortem
  // and has not been condemned/rejected/completed/released/approved.
  const anteLivestockIds = useMemo(() => new Set((data || []).map((i) => String(i.livestock_id || "").trim()).filter(Boolean)), [data]);
  const anteTags = useMemo(() => new Set((data || []).map((i) => String(i.tag_number || "").trim().toLowerCase()).filter(Boolean)), [data]);
  const awaitingLivestock = useMemo(() => {
    if (isQueueLoading && (!livestock || livestock.length === 0)) return [];

    // An animal that has reached any later stage must never sit in the Ante-Mortem
    // queue. Post-Mortem rows are used as a downstream "already moved on" signal.
    const postMortemTags = new Set(
      (postMortemRecords || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)
    );
    const postMortemIds = new Set(
      (postMortemRecords || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)
    );

    return (livestock || []).filter((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (!tag) return false;
      const s = String(l.status || "").toLowerCase();

      // STRICT WORKFLOW REQUIREMENT:
      // Livestock that are newly registered, awaiting marking, or returned to marking
      // must NEVER appear in Ante-Mortem inspection until Animal Marking is completed.
      if (
        s === "pending marking" ||
        s === "for marking" ||
        s === "ready for marking" ||
        s === "received" ||
        s === "returned to animal marking" ||
        s === "returned to marking" ||
        Boolean(l.fallback_at)
      ) {
        return false;
      }

      // Condemned/Rejected (any stage) is a final decision, and every downstream /
      // terminal status clears the animal out of the Awaiting Inspection queue.
      if (
        s.includes("condemn") ||
        s.includes("reject") ||
        s === "completed" ||
        s === "released" ||
        s === "approved" ||
        s === "passed" ||
        s === "ante-mortem passed" ||
        s === "ready for slaughter" ||
        s === "pending slaughter" ||
        s === "for slaughter" ||
        s === "slaughtering" ||
        s === "slaughtered" ||
        s === "in progress" ||
        s === "post-mortem inspection" ||
        s === "post mortem inspection" ||
        s === "carcass weighed" ||
        s === "weighing" ||
        s === "weighed" ||
        s === "payment" ||
        s === "paid" ||
        s === "dispatch" ||
        s === "dispatched" ||
        s === "ready for dispatch" ||
        s === "permit issued"
      ) return false;

      // Already inspected at Ante-Mortem (any decision) - the inspection table is the
      // source of truth, not the livestock status field.
      if (l.id && anteLivestockIds.has(String(l.id).trim())) return false;
      if (anteTags.has(tag)) return false;

      // STRICT WORKFLOW REQUIREMENT:
      // Livestock MUST have a completed and valid Animal Marking record before entering the Ante-Mortem queue.
      // Unmarked animals cannot enter Ante-Mortem inspection.
      const isMarked = Boolean(
        (l.marked === true || l.marked === "true" || l.marked === 1 || l.marked === "1" || l.marked === "t") &&
        l.marked !== "false" &&
        l.marked !== false &&
        (Boolean(l.mark_type) || Boolean(l.mark_date) || Boolean(l.marked_at) || s === "marked")
      );
      if (!isMarked) return false;

      // Already carried into Post-Mortem - it has moved past Ante-Mortem entirely.
      if (postMortemTags.has(tag)) return false;
      if (l.id && postMortemIds.has(String(l.id).trim())) return false;

      return true;
    });
  }, [isQueueLoading, livestock, anteLivestockIds, anteTags, postMortemRecords]);

  // Date range filter helper
  const isDateInRange = (dateStr) => {
    if (!dateStr || dateRange === "all") return true;
    const itemDate = new Date(dateStr);
    const now = new Date();
    if (dateRange === "today") {
      return itemDate.toDateString() === now.toDateString();
    }
    if (dateRange === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      return itemDate >= weekAgo;
    }
    if (dateRange === "month") {
      return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
    }
    return true;
  };

  // Comprehensive, multi-source owner name resolver with deep fallbacks
  const resolveOwnerName = (insp) => {
    if (!insp) return "—";

    const isValid = (name) => {
      if (!name || typeof name !== "string") return false;
      const clean = name.trim();
      return (
        clean !== "" &&
        clean !== "—" &&
        clean !== "-" &&
        clean.toLowerCase() !== "unknown" &&
        clean.toLowerCase() !== "unknown owner" &&
        clean.toLowerCase() !== "n/a"
      );
    };

    // Helper: look up owner name by owner_id in owners table
    const getOwnerNameById = (ownerId) => {
      if (!ownerId) return null;
      const cleanOId = String(ownerId).trim().toLowerCase();
      const found = (owners || []).find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
        const oTempId = String(o.temp_reg_id || "").trim().toLowerCase();
        const oAuthId = String(o.auth_user_id || "").trim().toLowerCase();
        return oId === cleanOId || oOwnerId === cleanOId || oTempId === cleanOId || oAuthId === cleanOId;
      });
      if (found && isValid(found.name)) return found.name.trim();
      return null;
    };

    // 0. Primary Master Directory lookup by owner ID
    const directOwnerId = insp.owner_id || insp.animal?.owner_id;
    if (directOwnerId) {
      const fromMaster = getOwnerNameById(directOwnerId);
      if (fromMaster) return fromMaster;
    }

    // Normalized tags and IDs
    const rawTag = String(insp.tag_number || "").trim();
    const cleanTag = rawTag.toLowerCase();
    const livestockId = String(insp.livestock_id || insp.id || "").trim();
    const baseTag = cleanTag.replace(/[-_][0-9a-z]$/i, "");
    
    // Tag digits (e.g. "010" from "TAG-010-HOG")
    const numMatch = cleanTag.match(/\b\d{2,4}\b/) || cleanTag.match(/tag-(\d+)/i) || cleanTag.match(/(\d{2,})/);
    const tagNum = numMatch ? numMatch[1] : null;

    // 1. Search in livestock collection prioritizing master owner_id
    if (livestock && livestock.length > 0) {
      // Exact tag or livestock_id
      const l = livestock.find((item) => {
        const iTag = String(item.tag_number || "").trim().toLowerCase();
        const iId = String(item.id || "").trim();
        return (cleanTag && iTag === cleanTag) || (livestockId && iId === livestockId);
      });
      if (l) {
        const fromOwner = getOwnerNameById(l.owner_id);
        if (fromOwner) return fromOwner;
        if (isValid(l.owner_name)) return l.owner_name.trim();
      }

      // Base tag match
      if (baseTag && baseTag !== cleanTag) {
        const lBase = livestock.find((item) => {
          const iTag = String(item.tag_number || "").trim().toLowerCase();
          return iTag === baseTag || iTag.startsWith(baseTag);
        });
        if (lBase) {
          const fromOwner = getOwnerNameById(lBase.owner_id);
          if (fromOwner) return fromOwner;
          if (isValid(lBase.owner_name)) return lBase.owner_name.trim();
        }
      }

      // Tag number sequence + species match
      if (tagNum) {
        const lNum = livestock.find((item) => {
          const iTag = String(item.tag_number || "").trim().toLowerCase();
          const matchesNum = iTag.includes(tagNum);
          const matchesSpecies = !insp.species || (item.species && item.species.toLowerCase() === String(insp.species).toLowerCase());
          return matchesNum && matchesSpecies;
        });
        if (lNum) {
          const fromOwner = getOwnerNameById(lNum.owner_id);
          if (fromOwner) return fromOwner;
          if (isValid(lNum.owner_name)) return lNum.owner_name.trim();
        }
      }
    }

    // 2. Direct inspection fields fallback
    if (isValid(insp.owner_name)) return insp.owner_name.trim();
    if (isValid(insp.animal?.owner_name)) return insp.animal.owner_name.trim();

    // 3. Search in awaiting queue
    if (typeof awaitingLivestock !== "undefined" && awaitingLivestock && awaitingLivestock.length > 0) {
      const a = awaitingLivestock.find((al) => {
        const alTag = String(al.tag_number || "").trim().toLowerCase();
        return cleanTag && alTag === cleanTag;
      });
      if (a && isValid(a.owner_name)) return a.owner_name.trim();
    }

    // 4. Search in condemned records
    if (condemnedRecords && condemnedRecords.length > 0) {
      const c = condemnedRecords.find((cr) => {
        const crTag = String(cr.tag_number || "").trim().toLowerCase();
        return cleanTag && crTag === cleanTag;
      });
      if (c && isValid(c.owner_name)) return c.owner_name.trim();
    }

    // 5. If exactly 1 approved owner exists in the system, safely infer as default owner
    const approvedOwners = (owners || []).filter((o) => (!o.status || o.status === "Approved") && isValid(o.name));
    if (approvedOwners.length === 1) {
      return approvedOwners[0].name.trim();
    }

    // 6. If all other inspected records in Ante-Mortem share a single unique owner name, safely infer
    const otherResolvedOwners = new Set();
    (data || []).forEach((other) => {
      if (other.tag_number !== insp.tag_number) {
        const otherExact = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === String(other.tag_number || "").trim().toLowerCase());
        if (otherExact && isValid(otherExact.owner_name)) {
          otherResolvedOwners.add(otherExact.owner_name.trim());
        }
      }
    });
    if (otherResolvedOwners.size === 1) {
      return Array.from(otherResolvedOwners)[0];
    }

    return "—";
  };

  const resolveOwnerId = (insp) => {
    if (!insp) return "";
    if (insp.owner_id) return String(insp.owner_id).trim();
    if (insp.animal?.owner_id) return String(insp.animal.owner_id).trim();

    const cleanTag = String(insp.tag_number || "").trim().toLowerCase();
    const livestockId = String(insp.livestock_id || insp.id || "").trim();
    const l = (livestock || []).find((item) => {
      const iTag = String(item.tag_number || "").trim().toLowerCase();
      const iId = String(item.id || "").trim();
      return (cleanTag && iTag === cleanTag) || (livestockId && iId === livestockId);
    });
    if (l?.owner_id) return String(l.owner_id).trim();

    const ownerName = resolveOwnerName(insp);
    if (ownerName && ownerName !== "—") {
      const found = (owners || []).find(
        (o) => (o.name || "").trim().toLowerCase() === ownerName.trim().toLowerCase()
      );
      if (found?.id) return String(found.id).trim();
    }
    return "";
  };

  // Helper to resolve full animal object with normalized owner and species
  const resolveAnimal = (insp) => {
    if (!insp) return null;
    const cleanTag = String(insp.tag_number || "").trim().toLowerCase();
    // Only the livestock foreign key is a real animal id (insp.id is the inspection id)
    const livestockId = String(insp.livestock_id || "").trim();

    let l = null;
    if (livestockId) {
      l = (livestock || []).find((a) => String(a.id || "").trim() === livestockId) || null;
    }
    if (!l && cleanTag) {
      const exact = (livestock || []).filter((a) => String(a.tag_number || "").trim().toLowerCase() === cleanTag);
      if (exact.length > 0) l = exact[0];
    }
    if (!l && cleanTag) {
      // Suffix-tolerant match only when it resolves to exactly one animal (never guess)
      const baseTag = cleanTag.replace(/[-_][0-9a-z]$/i, "");
      if (baseTag && baseTag !== cleanTag) {
        const baseMatches = (livestock || []).filter((a) => String(a.tag_number || "").trim().toLowerCase() === baseTag);
        if (baseMatches.length === 1) l = baseMatches[0];
      }
    }
    const resolvedOwner = resolveOwnerName(insp);
    const baseAnimal = l || insp.animal || {};
    return {
      ...baseAnimal,
      tag_number: insp.tag_number || baseAnimal.tag_number,
      species: insp.species || baseAnimal.species || "Unknown",
      owner_name: resolvedOwner !== "—" ? resolvedOwner : (baseAnimal.owner_name || "—"),
    };
  };

  // Filtered inspection log records
  const filteredLog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || [])
      .filter((i) => {
        const tag = (i.tag_number || "").toLowerCase();
        const findings = (i.findings || "").toLowerCase();
        const inspector = (i.inspector_name || "").toLowerCase();
        const remarks = (i.remarks || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(i);
        const animal = resolveAnimal(i);
        const owner = resolvedOwner.toLowerCase();
        const rawOwner = (i.owner_name || animal?.owner_name || "").toLowerCase();
        const itemSpecies = (i.species || animal?.species || "").toLowerCase();
        const breed = (i.breed || animal?.breed || "").toLowerCase();
        const recordId = String(i.id || i.inspection_id || "").toLowerCase();
        const decision = (i.decision || i.status || "").toLowerCase();

        const matchSearch =
          !q ||
          tag.includes(q) ||
          findings.includes(q) ||
          inspector.includes(q) ||
          remarks.includes(q) ||
          owner.includes(q) ||
          rawOwner.includes(q) ||
          itemSpecies.includes(q) ||
          breed.includes(q) ||
          recordId.includes(q) ||
          decision.includes(q);
        const matchSpecies = filterSpecies === "all" || itemSpecies === filterSpecies.toLowerCase();
        const matchDate = isDateInRange(i.date || i.created_at);

        return matchSearch && matchSpecies && matchDate;
      })
      .sort((a, b) => {
        const timeA = new Date(a.action_timestamp || a.created_at || a.date || 0).getTime();
        const timeB = new Date(b.action_timestamp || b.created_at || b.date || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [data, livestock, owners, condemnedRecords, search, filterSpecies, dateRange]);

  // Filtered queue records
  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (awaitingLivestock || [])
      .filter((l) => {
        const tag = (l.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(l).toLowerCase();
        const rawOwner = (l.owner_name || "").toLowerCase();
        const species = (l.species || "").toLowerCase();
        const breed = (l.breed || "").toLowerCase();
        const markingCode = (l.marking_code || "").toLowerCase();
        const recordId = String(l.id || "").toLowerCase();
        const matchSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          rawOwner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          markingCode.includes(q) ||
          recordId.includes(q);
        const matchSpecies = filterSpecies === "all" || species === filterSpecies.toLowerCase();
        return matchSearch && matchSpecies;
      })
      .sort((a, b) => {
        const timeA = new Date(a.created_at || a.received_date || 0).getTime();
        const timeB = new Date(b.created_at || b.received_date || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [awaitingLivestock, owners, search, filterSpecies]);

  // Grouped dataset for "Awaiting Inspection" tab (grouped strictly by actual registered owner)
  const groupedQueue = useMemo(() => {
    const groups = new Map();
    (filteredQueue || []).forEach((item) => {
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = resolveOwnerName(item);
      const ownerId = resolveOwnerId(item);
      const key = ownerId ? `owner_${ownerId}` : `owner_${owner.toLowerCase().trim()}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          owner_id: ownerId,
          owner_name: owner,
          speciesList: [],
          items: [],
          latestTimestamp: 0,
          rawDate: null,
          date: "",
        });
      }
      const grp = groups.get(key);
      grp.items.push(item);
      const species = (item.species || "Unknown Species").trim();
      if (!grp.speciesList.includes(species)) {
        grp.speciesList.push(species);
      }
      const rawTime = item.created_at || item.registered_at || item.received_date || item.date;
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = rawTime;
        grp.date = rawTime ? String(rawTime).split("T")[0] : "";
      }
    });

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        count: g.items.length,
        items: [...g.items].sort((a, b) => {
          const timeA = new Date(a.created_at || a.received_date || 0).getTime();
          const timeB = new Date(b.created_at || b.received_date || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        }),
      }))
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredQueue, owners, livestock]);

  // Grouped dataset for "All Inspected Livestock" tab (grouped strictly by actual registered owner)
  const groupedInspected = useMemo(() => {
    const groups = new Map();

    (filteredLog || []).forEach((item) => {
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = resolveOwnerName(item);
      const ownerId = resolveOwnerId(item);
      const key = ownerId ? `owner_${ownerId}` : `owner_${owner.toLowerCase().trim()}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          owner_id: ownerId,
          owner_name: owner,
          speciesList: [],
          items: [],
          latestTimestamp: 0,
          rawDate: null,
          date: "",
        });
      }

      const grp = groups.get(key);
      grp.items.push(item);
      const species = (item.species || resolveAnimal(item)?.species || "Unknown Species").trim();
      if (species && species !== "—" && species !== "Unknown Species" && !grp.speciesList.includes(species)) {
        grp.speciesList.push(species);
      }
      const rawTime = item.action_timestamp || item.inspected_at || item.created_at || item.date;
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      if (itemTime > grp.latestTimestamp) {
        grp.latestTimestamp = itemTime;
        grp.rawDate = rawTime;
        grp.date = rawTime ? String(rawTime).split("T")[0] : "";
      }
    });

    return Array.from(groups.values())
      .map((g) => {
        const sortedItems = [...g.items].sort((a, b) => {
          const tA = new Date(a.action_timestamp || a.inspected_at || a.created_at || a.date || 0).getTime();
          const tB = new Date(b.action_timestamp || b.inspected_at || b.created_at || b.date || 0).getTime();
          if (tB !== tA) return tB - tA;
          return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        });

        const approvedCount = sortedItems.filter((i) => i.decision === "Approved" || i.decision === "Passed").length;
        const condemnedCount = sortedItems.filter((i) => {
          const d = String(i.decision || "").toLowerCase();
          return d.includes("condemn") || d.includes("reject");
        }).length;
        const suspectCount = sortedItems.filter((i) => String(i.decision || "").toLowerCase().includes("suspect")).length;

        return {
          ...g,
          items: sortedItems,
          count: sortedItems.length,
          approvedCount,
          condemnedCount,
          suspectCount,
        };
      })
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredLog, owners, livestock]);

  const currentDataset = activeTab === "inspected" ? groupedInspected : groupedQueue;

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return (currentDataset || []).find((g) => g.key === selectedOwnerKey) || null;
  }, [selectedOwnerKey, currentDataset]);

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
  const totalPages = Math.ceil(currentDataset.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedData = currentDataset.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Metrics
  const approvedCount = data.filter((i) => i.decision === "Approved" || i.decision === "Passed").length;
  const condemnedCount = totalCondemnedCount;
  const passRate = data.length > 0 ? Math.round((approvedCount / data.length) * 100) : 100;

  const handleOpenModal = (tag = "") => {
    if (!tag && awaitingLivestock.length === 0) {
      showToast("No live animals currently require ante-mortem inspection or approval.", "info");
      return;
    }
    setAnteDecision("Approved");
    setTargetTagForModal(tag);
    setModalOpen(true);
  };

  const save = async (payload) => {
    try {
      const records = Array.isArray(payload)
        ? payload
        : payload?.records && Array.isArray(payload.records)
        ? payload.records
        : null;

      const succeededTags = [];
      const failedTags = [];

      if (records && records.length > 0) {
        const enrichedRecords = records.map((item) => {
          const tag = item.tag_number;
          const resolvedOwner = item.owner_name || resolveOwnerName({ tag_number: tag, livestock_id: item.livestock_id });
          const animal = resolveAnimal({ tag_number: tag, livestock_id: item.livestock_id });
          return {
            ...item,
            tag_number: tag,
            livestock_id: animal?.id || item.livestock_id || "",
            species: animal?.species || item.species || "Unknown",
            owner_name: resolvedOwner !== "—" ? resolvedOwner : (animal?.owner_name || item.owner_name || ""),
            animal,
          };
        });

        const batchRes = await vetService.createInspectionsBatch("Ante-Mortem", enrichedRecords);
        succeededTags.push(...batchRes.succeededTags);
        failedTags.push(...batchRes.failedTags);

        const approvedCount = batchRes.approvedCount || 0;
        const condemnedCount = batchRes.condemnedCount || 0;
        const failedCount = batchRes.failedTags.length;

        if (succeededTags.length === 0 && failedCount > 0) {
          const errMsg = `Failed to record Ante-Mortem inspection for ${failedCount} livestock (${failedTags.join(", ")}). Please try again.`;
          showToast(errMsg, "error");
          throw new Error(errMsg);
        }

        let successMsg = "";
        if (approvedCount > 0 && condemnedCount === 0 && failedCount === 0) {
          successMsg = records.length === 1
            ? `Ante-mortem inspection saved (${records[0].tag_number})`
            : "Livestock approved successfully.";
        } else if (condemnedCount > 0 && approvedCount === 0 && failedCount === 0) {
          successMsg = records.length === 1
            ? `Livestock condemned (${records[0].tag_number})`
            : "Livestock condemned successfully.";
        } else {
          const parts = [];
          if (approvedCount > 0) parts.push(`${approvedCount} Approved`);
          if (condemnedCount > 0) parts.push(`${condemnedCount} Condemned`);
          if (failedCount > 0) parts.push(`${failedCount} Failed`);
          successMsg = `Recorded Ante-Mortem inspection (${parts.join(", ") || `${succeededTags.length} head(s)`})!`;
        }

        if (failedCount > 0) {
          showToast(`Partial save: ${succeededTags.length} livestock updated, but ${failedCount} failed (${failedTags.join(", ")}).`, "warning");
        } else {
          showToast(successMsg, "success");
          setInAppAlert({
            title: "Ante-Mortem Inspection Certified",
            message: successMsg,
            variant: condemnedCount > 0 ? "warning" : "success",
          });
        }
      } else {
        const tags = (payload.tag_number || "").split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) {
          showToast("No animal tags found", "error");
          return;
        }

        const enrichedRecords = tags.map((tag) => {
          const resolvedOwner = resolveOwnerName({ tag_number: tag });
          const animal = resolveAnimal({ tag_number: tag });
          return {
            ...payload,
            tag_number: tag,
            livestock_id: animal?.id || "",
            species: animal?.species || "Unknown",
            owner_name: resolvedOwner !== "—" ? resolvedOwner : (animal?.owner_name || payload.owner_name || ""),
            animal,
          };
        });

        const batchRes = await vetService.createInspectionsBatch("Ante-Mortem", enrichedRecords);
        succeededTags.push(...batchRes.succeededTags);
        failedTags.push(...batchRes.failedTags);

        if (succeededTags.length === 0 && batchRes.failedTags.length > 0) {
          const errMsg = `Failed to record Ante-Mortem inspection for ${batchRes.failedTags.length} livestock (${batchRes.failedTags.join(", ")}). Please try again.`;
          showToast(errMsg, "error");
          throw new Error(errMsg);
        }

        let successMsg = "";
        if (payload.decision === "Approved" || payload.decision === "Passed") {
          successMsg = "Livestock approved successfully.";
        } else if (payload.decision === "Condemned" || payload.decision === "Suspect") {
          successMsg = "Livestock condemned successfully.";
        } else {
          successMsg = `Recorded Ante-Mortem inspection for ${succeededTags.length} head(s)!`;
        }

        if (batchRes.failedTags.length > 0) {
          showToast(`Partial save: ${succeededTags.length} livestock updated, but ${batchRes.failedTags.length} failed (${batchRes.failedTags.join(", ")}).`, "warning");
        } else {
          showToast(successMsg, "success");
          setInAppAlert({
            title: "Ante-Mortem Inspection Certified",
            message: successMsg,
            variant: payload.decision === "Condemned" ? "warning" : "success",
          });
        }
      }

      // RealtimeSync automatically debounces and coordinates dependent table reloads
      // without firing duplicate un-cached network requests.

      if (failedTags.length > 0) {
        const err = new Error(`Partial save: ${succeededTags.length} succeeded, but ${failedTags.length} livestock failed (${failedTags.join(", ")}).`);
        err.succeededTags = succeededTags;
        err.failedTags = failedTags;
        throw err;
      }

      // Keep the user on the currently inspected record; do NOT automatically switch to another tag.
      return { succeededTags, failedTags };
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to record Ante-Mortem inspection", "error");
      throw err;
    }
  };

  const del = async () => {
    if (!confirmDel || isDeleting) return;
    setIsDeleting(true);
    try {
      const targetTag = confirmDel.tag_number || confirmDel.animal?.tag_number;
      const targetLivestockId = confirmDel.livestock_id || confirmDel.animal?.id;
      await vetService.deleteInspection("Ante-Mortem", confirmDel.id, targetTag, targetLivestockId);
      showToast("Inspection record deleted successfully. Animal returned to Awaiting Livestock.", "success");
      setConfirmDel(null);
      setActiveTab("awaiting");
      await Promise.all([
        refreshData?.(),
        refreshLivestock?.(),
        refreshCondemned?.(),
        refreshEvidence?.(),
        refreshPostMortem?.(),
      ]);
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to delete inspection record", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const exportCSV = () => {
    if (data.length === 0) {
      showToast("No inspection records to export", "warning");
      return;
    }
    const headers = "Inspection ID,Tag #,Species,Sex,Owner,Inspection Date,Inspector,Decision,Findings,Remarks";
    const rows = data.map((i) => {
      const animal = resolveAnimal(i);
      const id = i.id || "—";
      const tag = i.tag_number || "—";
      const species = i.species || animal?.species || "—";
      const sex = formatSex(i.sex || animal?.sex);
      const owner = resolveOwnerName(i).replace(/"/g, '""');
      const date = i.date ? formatDate(i.date) : "—";
      const inspector = (i.inspector_name || "Dr. Dave").replace(/"/g, '""');
      const decision = i.decision || "Approved";
      const findings = (i.findings || "").replace(/"/g, '""');
      const remarks = (i.remarks || "").replace(/"/g, '""');
      return `"${id}","${tag}","${species}","${sex}","${owner}","${date}","${inspector}","${decision}","${findings}","${remarks}"`;
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `antemortem_inspection_records_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Ante-Mortem records exported successfully!", "success");
  };

  return (
    <div className="antemortem-page records-page-container" style={{ width: "100%", padding: 0 }}>
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
                label: "Awaiting Livestock",
                count: awaitingLivestock.length,
                icon: <Icon.Clock size={14} />,
              },
              {
                id: "evidence",
                label: "Condemnation Evidence",
                count: anteEvidenceCount,
                icon: <Icon.Upload size={14} />,
              },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSelectedOwnerKey(null);
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
                      background: isActive ? "var(--color-primary-light, rgba(2,132,199,0.12))" : "var(--color-border)",
                      color: isActive ? "var(--color-primary, #0284c7)" : "var(--color-text-muted)",
                    }}
                  >
                    {tab.count}
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
                placeholder={activeTab === "inspected" ? "Search Tag, Inspector, Owner..." : "Search Tag, Species, Owner..."}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
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
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
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


            {/* Conduct Inspection Button if Awaiting */}
            {activeTab === "awaiting" && (
              <Button
                size="sm"
                onClick={() => handleOpenModal()}
                disabled={awaitingLivestock.length === 0}
                style={{
                  height: 34,
                  padding: "0 14px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                <Icon.Stethoscope size={14} /> Conduct Inspection
              </Button>
            )}

          </div>
        </div>

        {/* Evidence & Photos / Condemnation Evidence Tab */}
        {activeTab === "evidence" && (
          <div className="records-scrollable-content" style={{ padding: 0, border: "none", flex: 1, minHeight: 0, overflowY: "auto" }}>
            <EvidenceUpload type="Ante-Mortem" hideHeader hideStats search={search} filterSpecies={filterSpecies} />
          </div>
        )}

        {/* Tab 1: Inspected Livestock Table (Owner-grouped with dedicated record view matching Condemnation) */}
        {activeTab === "inspected" && (
          groupedInspected.length === 0 ? (
            <EmptyState
              title="No Ante-Mortem inspections found"
              message={
                search || filterSpecies !== "all" || dateRange !== "all"
                  ? "Try clearing filters to see more inspection records."
                  : "No Ante-Mortem inspections recorded yet. Click 'Conduct Inspection' to certify incoming animals."
              }
              icon={<Icon.Stethoscope size={42} />}
            />
          ) : (
            /* Owner-Grouped List View */
            <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", border: "none", boxShadow: "none", flex: 1, minHeight: 0 }}>
              <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Owner Name</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Date Inspected</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Species</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>Total Heads</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Result / Decision</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "right", background: "var(--color-bg)" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedInspected.map((grp) => (
                    <tr
                      key={grp.key}
                      onClick={() => setSelectedOwnerKey(grp.key)}
                      style={{
                        cursor: "pointer",
                        transition: "background 140ms ease",
                        borderBottom: "1px solid var(--color-border)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(2, 132, 199, 0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                              {grp.count} animal{grp.count > 1 ? "s" : ""} inspected
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date Inspected */}
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#0284c7" }} />
                          <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Undated Inspection"}</span>
                        </div>
                      </td>

                      {/* Species */}
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          {formatSpeciesList(grp.speciesList || [grp.species])}
                        </span>
                      </td>

                      {/* Total Heads */}
                      <td style={{ padding: "14px 18px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#0284c7",
                          }}
                        >
                          {grp.count} head{grp.count > 1 ? "s" : ""}
                        </span>
                      </td>

                      {/* Result / Decision */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {grp.approvedCount > 0 && (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                background: "rgba(16, 185, 129, 0.12)",
                                color: "#10b981",
                                border: "1px solid rgba(16, 185, 129, 0.25)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {grp.approvedCount === grp.count ? "All Approved" : `${grp.approvedCount} Approved`}
                            </span>
                          )}
                          {grp.condemnedCount > 0 && (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                background: "rgba(220, 38, 38, 0.12)",
                                color: "#dc2626",
                                border: "1px solid rgba(220, 38, 38, 0.25)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {grp.condemnedCount} Condemned
                            </span>
                          )}
                          {grp.suspectCount > 0 && (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                background: "rgba(245, 158, 11, 0.12)",
                                color: "#d97706",
                                border: "1px solid rgba(245, 158, 11, 0.25)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {grp.suspectCount} Suspect
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Action */}
                      <td style={{ padding: "14px 18px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedOwnerKey(grp.key)}
                          style={{
                            height: 32,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <Icon.Eye size={13} /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Tab 2: Awaiting Queue Table (Owner-Grouped with Dedicated Owner View, matching Condemnation) */}
        {activeTab === "awaiting" && (
          groupedQueue.length === 0 ? (
            <EmptyState
              title="Queue is completely clear!"
              message="All incoming live animals have successfully undergone Ante-Mortem inspection."
              icon={<Icon.Check size={42} />}
            />
          ) : (
            /* Main Owner List View for Awaiting Queue */

            <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", border: "none", boxShadow: "none", flex: 1, minHeight: 0 }}>
              <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Owner Name</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Date Received</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Species</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>Total Heads</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>Status</th>
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "right", background: "var(--color-bg)" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedQueue.map((grp) => {
                    const allTags = grp.items.map((i) => i.tag_number).filter(Boolean).join(", ");

                    return (
                      <tr
                        key={grp.key}
                        onClick={() => setSelectedOwnerKey(grp.key)}
                        style={{
                          cursor: "pointer",
                          transition: "background 140ms ease",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(2, 132, 199, 0.04)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                {grp.count} animal{grp.count > 1 ? "s" : ""} awaiting inspection
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Date Received */}
                        <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#0284c7" }} />
                            <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Undated Intake"}</span>
                          </div>
                        </td>

                        {/* Species */}
                        <td style={{ padding: "14px 18px" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                            {formatSpeciesList(grp.speciesList || [grp.species])}
                          </span>
                        </td>

                        {/* Total Heads */}
                        <td style={{ padding: "14px 18px", textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: "#0284c7",
                            }}
                          >
                            {grp.count} head{grp.count > 1 ? "s" : ""}
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
                              color: "#d97706",
                            }}
                          >
                            <Icon.Clock size={13} /> Awaiting Ante-Mortem
                          </span>
                        </td>

                        {/* Action */}
                        <td style={{ padding: "14px 18px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedOwnerKey(grp.key)}
                              style={{
                                height: 32,
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-text)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <Icon.Eye size={13} /> View
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleOpenModal(allTags)}
                              style={{
                                height: 32,
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "linear-gradient(135deg, #0284c7, #0369a1)",
                                color: "#ffffff",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <Icon.Stethoscope size={13} /> Inspect Batch
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
        
        {/* Pagination Footer */}
        {false && currentDataset.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 20px",
              borderTop: "1px solid var(--color-border)",
              fontSize: 13.5,
              color: "var(--color-text-muted)",
              background: "var(--color-surface)",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              Showing <b>{Math.min((currentPage - 1) * pageSize + 1, currentDataset.length)}</b> to{" "}
              <b>{Math.min(currentPage * pageSize, currentDataset.length)}</b> of <b>{currentDataset.length}</b> {activeTab === "inspected" ? `owner groups (${filteredLog.length} inspections)` : `owner groups (${filteredQueue.length} heads)`}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{
                  height: 34,
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: 8,
                  padding: "0 22px 0 10px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  width: "auto",
                  appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center",
                  backgroundSize: "12px",
                }}
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>

              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: currentPage === 1 ? "var(--color-text-muted)" : "var(--color-text)",
                  cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                <Icon.ChevronLeft size={14} /> Prev
              </button>

              <span style={{ fontSize: 13, fontWeight: 700, padding: "0 8px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", color: "var(--color-text)" }}>
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: currentPage === totalPages ? "var(--color-text-muted)" : "var(--color-text)",
                  cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                Next <Icon.ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Ante-Mortem Inspection Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setTargetTagForModal(""); }}
        title="Conduct Ante-Mortem Inspection"
        headerRight={
          <div
            role="tablist"
            aria-label="Ante-mortem inspection outcome"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 4px",
              background: "var(--color-bg, #f1f5f9)",
              borderRadius: 8,
              border: "1px solid var(--color-border, #e2e8f0)",
              position: "relative",
              zIndex: 10,
              flexShrink: 0,
            }}
          >
            {/* 1. Fit for Slaughter (Approved) */}
            <button
              type="button"
              role="tab"
              aria-selected={anteDecision === "Approved"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAnteDecision("Approved");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: anteDecision === "Approved" ? 750 : 600,
                cursor: "pointer",
                transition: "all 140ms ease",
                border: anteDecision === "Approved" ? "1.5px solid var(--color-success, #10b981)" : "1.5px solid transparent",
                background: anteDecision === "Approved" ? "var(--color-surface)" : "transparent",
                color: anteDecision === "Approved" ? "var(--color-success, #10b981)" : "var(--color-text-muted)",
                boxShadow: anteDecision === "Approved" ? "0 2px 6px rgba(16, 185, 129, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05)" : "none",
                pointerEvents: "auto",
                userSelect: "none",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
              title="Livestock is approved and fit for slaughter"
            >
              <Icon.Check size={13} style={{ color: "var(--color-success, #10b981)", pointerEvents: "none" }} />
              <span style={{ pointerEvents: "none" }}>Fit for Slaughter</span>
            </button>

            {/* 2. Condemned */}
            <button
              type="button"
              role="tab"
              aria-selected={anteDecision === "Condemned"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAnteDecision("Condemned");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: anteDecision === "Condemned" ? 750 : 600,
                cursor: "pointer",
                transition: "all 140ms ease",
                border: anteDecision === "Condemned" ? "1.5px solid var(--color-danger, #ef4444)" : "1.5px solid transparent",
                background: anteDecision === "Condemned" ? "var(--color-surface)" : "transparent",
                color: anteDecision === "Condemned" ? "var(--color-danger, #ef4444)" : "var(--color-text-muted)",
                boxShadow: anteDecision === "Condemned" ? "0 2px 6px rgba(239, 68, 68, 0.25), 0 1px 2px rgba(0, 0, 0, 0.05)" : "none",
                pointerEvents: "auto",
                userSelect: "none",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
              title="Livestock shows severe pathology / moribund symptoms and is rejected/condemned"
            >
              <Icon.AlertTriangle size={13} style={{ color: "var(--color-danger, #ef4444)", pointerEvents: "none" }} />
              <span style={{ pointerEvents: "none" }}>Condemned</span>
            </button>
          </div>
        }
        size="lg"
        dialogStyle={{
          maxWidth: 820,
          width: "95vw",
          height: "82vh",
          maxHeight: 700,
          minHeight: 520,
          display: "flex",
          flexDirection: "column",
        }}
        headerStyle={{ padding: "14px 20px", flexWrap: "nowrap", gap: 12, flexShrink: 0 }}
        bodyStyle={{
          padding: "18px 20px 0 20px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
        hideCloseButton={true}
      >
        <InspectionForm
          key={targetTagForModal || "ante-modal"}
          type="Ante-Mortem"
          decision={anteDecision}
          onDecisionChange={setAnteDecision}
          livestock={awaitingLivestock}
          initialTag={targetTagForModal}
          onSubmit={save}
          onCancel={() => { setModalOpen(false); setTargetTagForModal(""); }}
        />
      </Modal>

      {/* Standardized Dedicated Owner Records Modal */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => setSelectedOwnerKey(null)}
        title={
          activeTab === "inspected"
            ? `Ante-Mortem Inspection Records — ${selectedOwnerView?.owner_name || ""}`
            : `Awaiting Ante-Mortem Inspection — ${selectedOwnerView?.owner_name || ""}`
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {selectedOwnerView?.items?.length || 0} {activeTab === "inspected" ? "inspected record" : "live animal"}{selectedOwnerView?.items?.length === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {activeTab === "awaiting" && selectedOwnerView && selectedOwnerView.items.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const allTags = selectedOwnerView.items.map((i) => i.tag_number).filter(Boolean).join(", ");
                    setSelectedOwnerKey(null);
                    handleOpenModal(allTags);
                  }}
                  style={{
                    padding: "7px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: "linear-gradient(135deg, #0284c7, #0369a1)",
                    color: "#ffffff",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon.Stethoscope size={14} /> Inspect All Animals
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
          <div>
            {activeTab === "inspected" ? (
              <div className="table-wrap" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "55vh", scrollbarWidth: "thin", border: "none", boxShadow: "none" }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Date Inspected</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Clinical Findings</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Inspector</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Decision</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((i) => {
                      const resolvedOwner = resolveOwnerName(i);
                      const animal = resolveAnimal(i);
                      return (
                        <tr key={i.id || i.tag_number + (i.date || "")} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!i.tag_number) return;
                                navigator.clipboard?.writeText(String(i.tag_number).trim());
                                showToast(`Copied ${i.tag_number}!`, "success");
                              }}
                              title="Click to copy Tag Number"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                cursor: "pointer",
                              }}
                            >
                              <span>{i.tag_number}</span>
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                            {i.species || animal?.species || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5, color: "var(--color-text)" }}>
                            {formatSex(i.sex || animal?.sex)}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {formatPhDateTime(i.inspected_at || i.action_timestamp || i.created_at || i.date)}
                          </td>
                          <td style={{ padding: "12px 14px" }} title={i.findings || "No clinical abnormalities detected"}>
                            <div style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                              {i.findings || "No clinical abnormalities detected"}
                            </div>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", fontSize: 12 }}>
                              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(2, 132, 199, 0.18)", color: "#0284c7", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                V
                              </span>
                              <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }} title={i.inspector_name || i.created_by || "Dr. Dave"}>
                                {i.inspector_name || i.created_by || "Dr. Dave"}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <Badge status={i.decision || "Approved"} />
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div className="actions" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => setSelectedInspection({ ...i, animal, owner_name: resolvedOwner })}
                                title="View Details"
                                aria-label="View Details"
                                style={{ width: 32, height: 32, borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "#0284c7", cursor: "pointer" }}
                              >
                                <Icon.Eye size={14} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => setConfirmDel(i)}
                                title="Delete record"
                                aria-label="Delete"
                                style={{ width: 32, height: 32, borderRadius: 7, cursor: "pointer" }}
                              >
                                <Icon.Trash size={13} />
                              </button>
                            </div>
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
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Age</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Date Received</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Intake Status</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((item) => {
                      const rawAge = item.age_months ?? item.age;
                      const formattedAge = !rawAge && rawAge !== 0
                        ? "—"
                        : /months?|mos|years?|yrs|days?/i.test(String(rawAge))
                        ? String(rawAge)
                        : `${rawAge} mos`;

                      return (
                        <tr key={item.id || item.tag_number} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!item.tag_number) return;
                                navigator.clipboard?.writeText(String(item.tag_number).trim());
                                showToast(`Copied ${item.tag_number}!`, "success");
                              }}
                              title="Click to copy Tag Number"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                cursor: "pointer",
                              }}
                            >
                              <span>{item.tag_number}</span>
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                            {item.species || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5, color: "var(--color-text)" }}>
                            {formatSex(item.sex)}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                            {formattedAge}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {item.created_at || item.received_date || item.date ? formatPhDateTime(item.created_at || item.received_date || item.date) : "—"}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <Badge status={item.status || "Pending"} />
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedOwnerKey(null);
                                handleOpenModal(item.tag_number);
                              }}
                              style={{
                                height: 32,
                                padding: "5px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "linear-gradient(135deg, #0284c7, #0369a1)",
                                color: "#ffffff",
                              }}
                            >
                              <Icon.Stethoscope size={13} /> Inspect Now
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

      {/* Inspection Slip / Certificate View Modal */}
      <Modal
        open={!!selectedInspection}
        onClose={() => setSelectedInspection(null)}
        title="Official Ante-Mortem Clinical Inspection Record"
        size="lg"
      >
        {selectedInspection && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Header Box */}
            <div
              style={{
                padding: "18px 20px",
                background: "var(--color-bg)",
                borderRadius: 12,
                border: "1.5px solid var(--color-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0284c7", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Republic of the Philippines · City Veterinary Office
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", marginTop: 2 }}>
                  Ante-Mortem Inspection Certificate
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                  Record ID: #{selectedInspection.id || "00001"} · Date: {formatPhDateTime(selectedInspection.inspected_at || selectedInspection.created_at || selectedInspection.date)}
                </div>
              </div>
              <Badge status={selectedInspection.decision || "Approved"} />
            </div>

            {/* Animal Details Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Animal Tag #</div>
                <div style={{ marginTop: 4 }}>
                  <TagBadge tag={selectedInspection.tag_number} />
                </div>
              </div>
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Species & Sex</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginTop: 4 }}>
                  {selectedInspection.species || selectedInspection.animal?.species || resolveAnimal(selectedInspection)?.species || "—"} · {formatSex(selectedInspection.sex || selectedInspection.animal?.sex || resolveAnimal(selectedInspection)?.sex)}
                </div>
              </div>
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Livestock Owner</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginTop: 4 }}>
                  {resolveOwnerName(selectedInspection)}
                </div>
              </div>
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Inspector / Vet</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginTop: 4 }}>
                  {selectedInspection.inspector_name || "Dr. Dave"}
                </div>
              </div>
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Type of Marking</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginTop: 4 }}>
                  {selectedInspection.mark_type || selectedInspection.animal?.mark_type || resolveAnimal(selectedInspection)?.mark_type || "Ear Tag"}
                </div>
              </div>
            </div>

            {/* Clinical Observations */}
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text)", textTransform: "uppercase", marginBottom: 6 }}>
                Clinical Findings & Vital Observations
              </div>
              <div style={{ fontSize: 14, color: "var(--color-text)", lineHeight: 1.5, background: "var(--color-bg)", padding: "12px 14px", borderRadius: 8 }}>
                {selectedInspection.findings || "No clinical symptoms or pathological defects observed."}
              </div>
            </div>

            {/* Remarks */}
            {selectedInspection.remarks && (
              <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text)", textTransform: "uppercase", marginBottom: 6 }}>
                  Veterinary Instructions / Remarks
                </div>
                <div style={{ fontSize: 14, color: "var(--color-text)", lineHeight: 1.5, background: "var(--color-bg)", padding: "12px 14px", borderRadius: 8 }}>
                  {selectedInspection.remarks}
                </div>
              </div>
            )}

            {/* Audit Trail & Process Timeline */}
            <div style={{ marginTop: 4 }}>
              <ProcessHistoryTimeline
                livestock={selectedInspection.animal || (livestock || []).find((l) => (l.id && l.id === selectedInspection.livestock_id) || l.tag_number === selectedInspection.tag_number) || selectedInspection}
                title="Livestock Intake & Inspection Audit Trail"
              />
            </div>

            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  const target = selectedInspection;
                  setSelectedInspection(null);
                  setConfirmDel(target);
                }}
              >
                <Icon.Trash size={14} /> Delete Inspection
              </Button>
              <Button onClick={() => setSelectedInspection(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        open={!!confirmDel}
        onConfirm={del}
        onCancel={() => {
          if (!isDeleting) setConfirmDel(null);
        }}
        title="Confirm Deletion"
        message="Are you sure you want to delete this inspection record? This will reset the livestock status to Pending and return it to Awaiting Livestock."
        confirmText="Confirm Delete"
        confirmVariant="danger"
        loading={isDeleting}
      />

      {/* Clean In-App Alert Dialog (replaces window.alert, matches Post-Mortem) */}
      <AlertDialog
        open={!!inAppAlert}
        onClose={() => setInAppAlert(null)}
        title={inAppAlert?.title || "Notification"}
        message={inAppAlert?.message}
        buttonText="OK"
        variant={inAppAlert?.variant || "success"}
      />
    </div>
  );
};
