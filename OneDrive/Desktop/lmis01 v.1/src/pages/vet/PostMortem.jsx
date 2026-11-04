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
import { matchesStage, getPostOutcome, isPostWholeDecision, isPostPartialInspection } from "./condemnationStage";
import { useCondemnationEvidenceIndex } from "./condemnationEvidenceIndex";
import { ProcessHistoryTimeline } from "../../components/common/ProcessHistoryTimeline";
import { getRemainingPostMortemForOwner, getAllRemainingPostMortem } from "../../services/modalLifecycleService";

export const PostMortem = ({ initialTab = "awaiting" }) => {
  const { data: data = [], loading: loadingPost, refresh: refreshData } = useSupabase(TABLES.POST_MORTEM);
  const { data: livestock = [], loading: loadingLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: processing = [], loading: loadingProcessing, refresh: refreshProcessing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: slaughter = [], refresh: refreshSlaughter } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: condemnedRecords = [], refresh: refreshCondemned } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  // Post-Mortem evidence is Supabase-only: the localStorage mock store must not
  // add or override rows here, or a photo can appear in the UI that is not in the
  // database (and disappear again after a refresh).
  const { data: evidenceRecords = [], refresh: refreshEvidence } = useSupabase(
    TABLES.EVIDENCE_RECORDS || "evidence_records",
    [],
    { mockStore: false }
  );
  const { data: owners = [], refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  const { data: anteMortem = [], refresh: refreshAnte } = useSupabase(TABLES.ANTE_MORTEM);

  const isQueueLoading = loadingPost || loadingLivestock || loadingProcessing;

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
  const [postDecision, setPostDecision] = useState("Approved");
  const [modalSuccessAlert, setModalSuccessAlert] = useState(null);
  const [inAppAlert, setInAppAlert] = useState(null);
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

  // Per-group and individual selection for Awaiting Carcasses queue
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

  const refresh = () => {
    refreshData();
    refreshLivestock();
    refreshCondemned();
  };

  // Breakdown of Post-Mortem condemnations into Partial vs Whole.
  // COUNTING RULE: each unique condemned carcass (tag) counts ONCE per outcome -
  // multiple condemned parts of one carcass = ONE "Partially Condemned" count,
  // and a carcass can never be counted in both buckets. Evidence photos are never counted.
  const { postPartialCondemnedCount, postWholeCondemnedCount, postCondemnedTagCount } = useMemo(() => {
    const partialTags = new Set();
    const wholeTags = new Set();

    (condemnedRecords || []).forEach((c) => {
      if (!matchesStage(c, "Post-Mortem")) return;
      const raw = String(c.tag_number || "").trim();
      if (!raw) return;
      const part = String(c.part || "").trim().toLowerCase();
      const isWhole =
        part === "whole carcass" ||
        part === "entire carcass" ||
        String(c.quantity || "").toLowerCase().includes("whole");
      raw.split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => {
        if (isWhole) wholeTags.add(t);
        else partialTags.add(t);
      });
    });

    (data || []).forEach((p) => {
      const outcome = getPostOutcome(p);
      const raw = String(p.tag_number || "").trim();
      if (!raw) return;
      const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
      const isWhole = isPostWholeDecision(p.decision) || outcome.label === "Whole Carcass Condemned";
      const isPartial = !isWhole && (outcome.label === "Partially Condemned" || isPostPartialInspection(p));
      tags.forEach((t) => {
        if (isWhole) wholeTags.add(t);
        else if (isPartial) partialTags.add(t);
      });
    });

    // A whole-carcass condemnation always wins; never count the same tag twice
    partialTags.forEach((t) => { if (wholeTags.has(t)) partialTags.delete(t); });
    const allTags = new Set([...partialTags, ...wholeTags]);

    return {
      postPartialCondemnedCount: partialTags.size,
      postWholeCondemnedCount: wholeTags.size,
      postCondemnedTagCount: allTags.size,
    };
  }, [condemnedRecords, data]);

  // Count of condemned records/cuts for Post-Mortem
  const postCondemnedRecords = useMemo(() => {
    return (condemnedRecords || []).filter((c) => matchesStage(c, "Post-Mortem"));
  }, [condemnedRecords]);
  const condemnedCount = postCondemnedTagCount || postCondemnedRecords.length || postPartialCondemnedCount;

  // Condemnation Evidence card count.
  // Derived from the exact same dataset the Post-Mortem Condemnation Evidence page
  // renders (see condemnationEvidenceIndex), so the card always equals the number of
  // records shown on the page. Partial and Whole Carcass condemnations both count as
  // one record each, and a condemnation carrying both condemned-cut details and
  // evidence photos is never counted twice.
  const { evidenceCount: postEvidenceCount } = useCondemnationEvidenceIndex(
    "Post-Mortem",
    {
      ante: anteMortem,
      post: data,
      livestock,
      condemned: condemnedRecords,
      evidence: evidenceRecords,
    }
  );

  // Slaughtered carcasses awaiting post-mortem inspection
  const inspectedPostMortemTags = useMemo(() => {
    const tags = new Set();
    (data || []).forEach((i) => {
      if (i.tag_number) {
        String(i.tag_number)
          .split(",")
          .forEach((t) => {
            const clean = t.trim().toLowerCase();
            if (clean) tags.add(clean);
          });
      }
    });
    return tags;
  }, [data]);

  const inspectedPostMortemIds = useMemo(() => {
    return new Set((data || []).map((i) => String(i.livestock_id || "").trim()).filter(Boolean));
  }, [data]);

  const awaitingCarcasses = useMemo(() => {
    if (isQueueLoading && (!livestock || livestock.length === 0)) return [];
    const list = [];
    const seenTags = new Set();

    // Map existing livestock records by clean tag for quick lookup of metadata
    const livestockMap = new Map();
    (livestock || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      if (tag) livestockMap.set(tag.toLowerCase(), l);
    });

    // 1. Animals from slaughter_processing (where status is Completed or all 6 steps are done)
    (processing || []).forEach((p) => {
      const tag = String(p.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || seenTags.has(cleanTag)) return;

      const stepsObj = typeof p.steps === "string" ? (() => { try { return JSON.parse(p.steps); } catch (_) { return null; } })() : p.steps;
      const doneCount = stepsObj ? Object.values(stepsObj).filter((v) => v === true || v?.done === true).length : 0;
      const isCompleted = p.status === "Completed" || doneCount >= 6;
      if (!isCompleted) return;

      if (inspectedPostMortemTags.has(cleanTag)) return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedPostMortemIds.has(String(l.id).trim())) return;

      seenTags.add(cleanTag);
      list.push({
        ...(l || {}),
        ...(p || {}),
        id: l?.id || p.id,
        tag_number: p.tag_number || l?.tag_number,
        species: p.species || l?.species || "Hog",
        sex: l?.sex || p?.sex || "",
        owner_name: p.owner_name || l?.owner_name || "Unknown Owner",
        operator: p.operator || p.processed_by || l?.slaughtered_by || l?.operator || "Jenel Selgas",
        received_date: l?.received_date || p.date || today(),
        registered_at: l?.registered_at || null,
        created_at: p.created_at || l?.created_at || null,
        completed_at: p.completed_at || p.updated_at || null,
        marked_at: l?.marked_at || null,
        status: "Slaughter Completed"
      });
    });

    // 2. Animals from slaughter_records (where status is Completed)
    (slaughter || []).forEach((s) => {
      const tag = String(s.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || seenTags.has(cleanTag)) return;

      if (s.status !== "Completed") return;

      // If active in-progress processing exists with < 6 steps, not completed
      const activeProc = (processing || []).find((p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag);
      const activeProcSteps = typeof activeProc?.steps === "string" ? (() => { try { return JSON.parse(activeProc.steps); } catch (_) { return null; } })() : activeProc?.steps;
      const activeProcDone = activeProcSteps ? Object.values(activeProcSteps).filter((v) => v === true || v?.done === true).length : 0;
      if (activeProc && activeProc.status === "In Progress" && activeProcDone < 6) {
        return;
      }

      if (inspectedPostMortemTags.has(cleanTag)) return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedPostMortemIds.has(String(l.id).trim())) return;

      seenTags.add(cleanTag);
      list.push({
        ...(l || {}),
        ...(s || {}),
        id: l?.id || s.id,
        tag_number: s.tag_number || l?.tag_number,
        species: s.species || l?.species || "Hog",
        sex: l?.sex || s?.sex || "",
        owner_name: s.owner_name || l?.owner_name || "Unknown Owner",
        operator: s.operator || activeProc?.operator || activeProc?.processed_by || l?.slaughtered_by || l?.operator || "Jenel Selgas",
        received_date: l?.received_date || s.scheduled_date || today(),
        registered_at: l?.registered_at || null,
        created_at: s.created_at || l?.created_at || null,
        completed_at: s.completed_at || s.updated_at || null,
        marked_at: l?.marked_at || null,
        status: "Slaughter Completed"
      });
    });

    // 3. Animals from livestock (where status is Completed or marked completed in slaughter)
    (livestock || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || seenTags.has(cleanTag)) return;
      if (l.status === "Condemned" || l.status === "Rejected") return;
      if (l.id && inspectedPostMortemIds.has(String(l.id).trim())) return;
      if (inspectedPostMortemTags.has(cleanTag)) return;

      const matchedProc = (processing || []).find((p) => (p.tag_number || "").trim().toLowerCase() === cleanTag);
      const matchedSlaughter = (slaughter || []).find((s) => (s.tag_number || "").trim().toLowerCase() === cleanTag);

      const isSlaughtered =
        (matchedProc && (matchedProc.status === "Completed" || (matchedProc.steps && Object.values(matchedProc.steps).filter((v) => v === true || v?.done === true).length >= 6))) ||
        (matchedSlaughter && matchedSlaughter.status === "Completed") ||
        String(l.status || "").toLowerCase() === "completed" ||
        String(l.status || "").toLowerCase() === "slaughtered";

      if (isSlaughtered) {
        seenTags.add(cleanTag);
        const resolvedOperator = matchedProc?.operator || matchedProc?.processed_by || matchedSlaughter?.operator || l.slaughtered_by || l.operator || "Jenel Selgas";
        list.push({
          ...(l || {}),
          id: l.id,
          tag_number: l.tag_number,
          species: l.species || "Hog",
          sex: l.sex || "",
          owner_name: l.owner_name || "Unknown Owner",
          operator: resolvedOperator,
          received_date: l.received_date || today(),
          registered_at: l.registered_at || null,
          created_at: l.created_at || null,
          marked_at: l.marked_at || null,
          status: "Slaughter Completed"
        });
      }
    });

    return list.sort((a, b) => {
      const timeA = new Date(a.received_date || a.created_at || 0).getTime();
      const timeB = new Date(b.received_date || b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [isQueueLoading, livestock, processing, slaughter, inspectedPostMortemIds, inspectedPostMortemTags]);

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
    if (!insp) return "Ã¢â‚¬â€";

    const isValid = (name) => {
      if (!name || typeof name !== "string") return false;
      const clean = name.trim();
      return (
        clean !== "" &&
        clean !== "Ã¢â‚¬â€" &&
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

      // Base tag match (e.g. sub-tag or batch prefix)
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

    // 3. Search in slaughter_processing collection
    if (processing && processing.length > 0) {
      const p = processing.find((pr) => {
        const prTag = String(pr.tag_number || "").trim().toLowerCase();
        const prId = String(pr.id || "").trim();
        return (cleanTag && prTag === cleanTag) || (livestockId && prId === livestockId) || (baseTag && prTag === baseTag);
      });
      if (p) {
        if (isValid(p.owner_name)) return p.owner_name.trim();
        const fromOwner = getOwnerNameById(p.owner_id);
        if (fromOwner) return fromOwner;
      }
    }

    // 4. Search in slaughter_records collection
    if (slaughter && slaughter.length > 0) {
      const s = slaughter.find((sr) => {
        const srTag = String(sr.tag_number || "").trim().toLowerCase();
        const srId = String(sr.id || sr.livestock_id || "").trim();
        return (cleanTag && srTag === cleanTag) || (livestockId && srId === livestockId) || (baseTag && srTag === baseTag);
      });
      if (s) {
        if (isValid(s.owner_name)) return s.owner_name.trim();
        const fromOwner = getOwnerNameById(s.owner_id);
        if (fromOwner) return fromOwner;
      }
    }

    // 5. Search in awaiting carcasses queue
    if (typeof awaitingCarcasses !== "undefined" && awaitingCarcasses && awaitingCarcasses.length > 0) {
      const a = awaitingCarcasses.find((ac) => {
        const acTag = String(ac.tag_number || "").trim().toLowerCase();
        return cleanTag && acTag === cleanTag;
      });
      if (a && isValid(a.owner_name)) return a.owner_name.trim();
    }

    // 6. Search in ante-mortem inspections
    if (anteMortem && anteMortem.length > 0) {
      const am = anteMortem.find((amItem) => {
        const amTag = String(amItem.tag_number || "").trim().toLowerCase();
        const amId = String(amItem.livestock_id || "").trim();
        return (cleanTag && amTag === cleanTag) || (livestockId && amId === livestockId);
      });
      if (am) {
        if (isValid(am.owner_name)) return am.owner_name.trim();
        if (isValid(am.animal?.owner_name)) return am.animal.owner_name.trim();
      }
    }

    // 7. Search in condemned records
    if (condemnedRecords && condemnedRecords.length > 0) {
      const c = condemnedRecords.find((cr) => {
        const crTag = String(cr.tag_number || "").trim().toLowerCase();
        return cleanTag && crTag === cleanTag;
      });
      if (c && isValid(c.owner_name)) return c.owner_name.trim();
    }

    // 8. If exactly 1 approved owner exists in the system, safely infer as default owner
    const approvedOwners = (owners || []).filter((o) => (!o.status || o.status === "Approved") && isValid(o.name));
    if (approvedOwners.length === 1) {
      return approvedOwners[0].name.trim();
    }

    // 9. If all other inspected records in Post-Mortem share a single unique owner name, safely infer
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

    return "Ã¢â‚¬â€";
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

    const p = (processing || []).find((item) => {
      const iTag = String(item.tag_number || "").trim().toLowerCase();
      const iId = String(item.id || "").trim();
      return (cleanTag && iTag === cleanTag) || (livestockId && iId === livestockId);
    });
    if (p?.owner_id) return String(p.owner_id).trim();

    const ownerName = resolveOwnerName(insp);
    if (ownerName && ownerName !== "Ã¢â‚¬â€") {
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
    const livestockId = String(insp.livestock_id || insp.id || "").trim();
    const baseTag = cleanTag.replace(/[-_][0-9a-z]$/i, "");

    const l = (livestock || []).find(
      (a) => (cleanTag && String(a.tag_number || "").trim().toLowerCase() === cleanTag) ||
             (livestockId && String(a.id || "").trim() === livestockId) ||
             (baseTag && String(a.tag_number || "").trim().toLowerCase() === baseTag)
    );
    const p = (processing || []).find(
      (a) => (cleanTag && String(a.tag_number || "").trim().toLowerCase() === cleanTag) ||
             (livestockId && String(a.id || "").trim() === livestockId)
    );
    const s = (slaughter || []).find(
      (a) => (cleanTag && String(a.tag_number || "").trim().toLowerCase() === cleanTag) ||
             (livestockId && String(a.id || a.livestock_id || "").trim() === livestockId)
    );
    const resolvedOwner = resolveOwnerName(insp);
    const baseAnimal = l || p || s || insp.animal || {};
    return {
      ...baseAnimal,
      tag_number: insp.tag_number || baseAnimal.tag_number,
      species: insp.species || baseAnimal.species || "Unknown",
      owner_name: resolvedOwner !== "Ã¢â‚¬â€" ? resolvedOwner : (baseAnimal.owner_name || "Ã¢â‚¬â€"),
    };
  };

  // Filtered log dataset
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
  }, [data, livestock, processing, slaughter, owners, anteMortem, condemnedRecords, search, filterSpecies, dateRange]);

  // Filtered queue dataset
  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (awaitingCarcasses || [])
      .filter((l) => {
        const tag = (l.tag_number || "").toLowerCase();
        const resolvedOwner = resolveOwnerName(l).toLowerCase();
        const rawOwner = (l.owner_name || "").toLowerCase();
        const species = (l.species || "").toLowerCase();
        const breed = (l.breed || "").toLowerCase();
        const recordId = String(l.id || "").toLowerCase();
        const matchSearch =
          !q ||
          tag.includes(q) ||
          resolvedOwner.includes(q) ||
          rawOwner.includes(q) ||
          species.includes(q) ||
          breed.includes(q) ||
          recordId.includes(q);
        const matchSpecies = filterSpecies === "all" || species === filterSpecies.toLowerCase();
        return matchSearch && matchSpecies;
      })
      .sort((a, b) => {
        const timeA = new Date(a.registered_at || a.created_at || a.completed_at || a.received_date || 0).getTime();
        const timeB = new Date(b.registered_at || b.created_at || b.completed_at || b.received_date || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });
  }, [awaitingCarcasses, owners, search, filterSpecies]);

  // Grouped dataset for "Awaiting Inspection" carcasses (grouped strictly by actual registered owner)
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

      const candidates = [
        item.completed_at,
        item.updated_at,
        item.marked_at,
        item.registered_at,
        item.created_at,
        item.received_date,
        item.date,
        item.slaughter_date,
      ];
      const timeCandidate = candidates.find(
        (c) => c && typeof c === "string" && (c.includes("T") || c.includes(":"))
      );
      const rawTime = timeCandidate || candidates.find(Boolean) || null;
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
          const timeA = new Date(a.registered_at || a.created_at || a.completed_at || a.received_date || 0).getTime();
          const timeB = new Date(b.registered_at || b.created_at || b.completed_at || b.received_date || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        }),
      }))
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredQueue, owners, livestock]);

  // Grouped dataset for "All Inspected Carcasses" tab (grouped strictly by actual registered owner)
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
      if (species && species !== "Ã¢â‚¬â€" && species !== "Unknown Species" && !grp.speciesList.includes(species)) {
        grp.speciesList.push(species);
      }

      const candidates = [
        item.inspected_at,
        item.action_timestamp,
        item.created_at,
        item.date,
      ];
      const timeCandidate = candidates.find(
        (c) => c && typeof c === "string" && (c.includes("T") || c.includes(":"))
      );
      const rawTime = timeCandidate || candidates.find(Boolean) || null;
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
          const tA = new Date(a.inspected_at || a.action_timestamp || a.created_at || a.date || 0).getTime();
          const tB = new Date(b.inspected_at || b.action_timestamp || b.created_at || b.date || 0).getTime();
          if (tB !== tA) return tB - tA;
          return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        });

        let approvedCount = 0;
        let partialCount = 0;
        let wholeCount = 0;

        sortedItems.forEach((i) => {
          const outcome = getPostOutcome(i);
          if (outcome.label === "Partially Condemned" || outcome.status === "Partial") {
            partialCount += 1;
          } else if (outcome.label === "Condemned" || outcome.status === "Condemned" || outcome.status === "Rejected") {
            wholeCount += 1;
          } else {
            approvedCount += 1;
          }
        });

        return {
          ...g,
          items: sortedItems,
          count: sortedItems.length,
          approvedCount,
          partialCount,
          wholeCount,
        };
      })
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredLog, owners, livestock, processing, slaughter]);

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
  const approvedCount = data.filter((i) => {
    const d = (i.decision || "").toLowerCase();
    return d.includes("approv") || d.includes("pass");
  }).length;
  const suspectCount = data.filter((i) => i.decision === "Suspect" || i.decision === "Pending").length;
  const passRate = data.length > 0 ? Math.round((approvedCount / data.length) * 100) : 100;

  const handleOpenModal = (tag = "") => {
    if (!tag && awaitingCarcasses.length === 0) {
      showToast("No carcasses currently require post-mortem inspection or approval.", "info");
      return;
    }
    setModalSuccessAlert(null);
    setPostDecision("Approved");
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

      const failedTags = [];
      const succeededTags = [];

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
            owner_name: resolvedOwner !== "Ã¢â‚¬â€" ? resolvedOwner : (animal?.owner_name || item.owner_name || ""),
            animal,
          };
        });

        const batchRes = await vetService.createInspectionsBatch("Post-Mortem", enrichedRecords);
        succeededTags.push(...batchRes.succeededTags);
        failedTags.push(...batchRes.failedTags);

        const appCount = batchRes.approvedCount || 0;
        const condCount = batchRes.condemnedCount || 0;
        const partCount = batchRes.partialCount || 0;
        const failedCount = batchRes.failedTags.length;

        if (succeededTags.length === 0 && failedCount > 0) {
          const errMsg = `Failed to record Post-Mortem inspection for ${failedCount} carcass(es) (${failedTags.join(", ")}). Please try again.`;
          showToast(errMsg, "error");
          throw new Error(errMsg);
        }

        let successMsg = "";
        if (condCount > 0 && appCount === 0 && partCount === 0) {
          successMsg = "Carcass condemned successfully.";
        } else if (appCount > 0 && condCount === 0 && partCount === 0) {
          successMsg = "Carcass approved successfully.";
        } else if (partCount > 0 && appCount === 0 && condCount === 0) {
          successMsg = "Partial carcass condemnation recorded successfully.";
        } else {
          successMsg = `Recorded Post-Mortem inspection for ${succeededTags.length} carcass(es)!`;
        }

        if (failedCount > 0) {
          showToast(`Partial save: ${succeededTags.length} carcass(es) updated, but ${failedCount} failed (${failedTags.join(", ")}).`, "warning");
        } else {
          setInAppAlert({
            title: "Post-Mortem Inspection Certified",
            message: successMsg,
            variant: condCount > 0 && appCount === 0 ? "warning" : "success",
          });
          showToast(successMsg, "success");
        }
        setModalSuccessAlert(null);
      } else {
        const tags = (payload.tag_number || "").split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) {
          showToast("No animal tags found", "error");
          return;
        }
        const payloadIsPartial =
          payload.decision === "Partial" ||
          payload.decision === "Passed with Partial Condemnation" ||
          payload.raw_decision === "Partial";

        const enrichedRecords = tags.map((tag, idx) => {
          const resolvedOwner = resolveOwnerName({ tag_number: tag });
          const animal = resolveAnimal({ tag_number: tag });
          const attachCondemnation = tags.length === 1 || idx === 0;
          return {
            ...payload,
            tag_number: tag,
            livestock_id: animal?.id || "",
            species: animal?.species || "Unknown",
            owner_name: resolvedOwner !== "Ã¢â‚¬â€" ? resolvedOwner : (animal?.owner_name || payload.owner_name || ""),
            condemned_parts: attachCondemnation ? payload.condemned_parts : [],
            photos: attachCondemnation ? payload.photos : [],
            ...(attachCondemnation || !payloadIsPartial
              ? {}
              : { decision: "Approved", raw_decision: "Approved" }),
            animal,
          };
        });

        const batchRes = await vetService.createInspectionsBatch("Post-Mortem", enrichedRecords);
        succeededTags.push(...batchRes.succeededTags);
        failedTags.push(...batchRes.failedTags);

        if (succeededTags.length === 0 && batchRes.failedTags.length > 0) {
          const errMsg = `Failed to record Post-Mortem inspection for ${batchRes.failedTags.length} carcass(es) (${batchRes.failedTags.join(", ")}). Please try again.`;
          showToast(errMsg, "error");
          throw new Error(errMsg);
        }

        const isPartial = payloadIsPartial;
        const isApproved = payload.decision === "Approved" || payload.decision === "Passed" || isPartial;
        const statusMessage = isPartial
          ? `Passed with Partial Condemnation (${payload.condemned_parts?.length || 1} cuts recorded). Carcass proceeds to Carcass Weighing!`
          : isApproved
          ? "Passed & Fit for Food. Carcass proceeds to Carcass Weighing!"
          : "Whole Carcass Condemned (Will not proceed to weighing).";
        
        const successMsg = `Successfully recorded and certified Post-Mortem carcass inspection for ${succeededTags.length} carcass(es)! ${statusMessage}`;

        if (batchRes.failedTags.length > 0) {
          showToast(`Partial save: ${succeededTags.length} carcass(es) updated, but ${batchRes.failedTags.length} failed (${batchRes.failedTags.join(", ")}).`, "warning");
        } else {
          setInAppAlert({
            title: "Post-Mortem Inspection Certified",
            message: successMsg,
          });
          showToast(successMsg, "success");
        }
      }

      // RealtimeSync automatically debounces and coordinates dependent table reloads
      // without firing duplicate un-cached network requests.

      if (failedTags.length > 0) {
        const err = new Error(`Partial save: ${succeededTags.length} carcass(es) succeeded, but ${failedTags.length} failed (${failedTags.join(", ")}).`);
        err.succeededTags = succeededTags;
        err.failedTags = failedTags;
        throw err;
      }

      // Check remaining pending carcasses from the local awaiting queue (instant in-memory check)
      const allSubmittedTags = succeededTags;
      const submittedSet = new Set(allSubmittedTags.map((t) => String(t).trim().toLowerCase()));

      const stillPendingAcrossAll = (awaitingCarcasses || []).filter(
        (c) => !submittedSet.has(String(c.tag_number || "").trim().toLowerCase())
      );

      const firstTag = allSubmittedTags[0] || targetTagForModal;
      let targetOwner = null;
      if (firstTag) {
        const clean = String(firstTag).trim().toLowerCase();
        const found = (awaitingCarcasses || []).find((c) => String(c.tag_number || "").trim().toLowerCase() === clean);
        targetOwner = found?.owner_name || resolveOwnerName({ tag_number: firstTag });
      }
      if (!targetOwner || targetOwner === "Ã¢â‚¬â€") {
        targetOwner = records?.[0]?.owner_name || payload?.owner_name;
      }

      // 1. Check current owner's remaining carcasses to preserve owner grouping
      if (targetOwner && targetOwner !== "Ã¢â‚¬â€" && targetOwner !== "Unknown Owner") {
        const cleanTargetOwner = String(targetOwner).trim().toLowerCase();
        const stillPendingForOwner = stillPendingAcrossAll.filter((c) => {
          const oName = String(c.owner_name || resolveOwnerName(c) || "").trim().toLowerCase();
          return oName && oName === cleanTargetOwner;
        });

        if (stillPendingForOwner.length > 0) {
          const nextTag = stillPendingForOwner[0].tag_number;
          setTargetTagForModal(nextTag);
          setPostDecision("Approved");
          setModalOpen(true);
          return;
        }
      }

      // 2. Current owner has no remaining carcasses (or owner was unknown).
      if (stillPendingAcrossAll.length > 0) {
        const nextTag = stillPendingAcrossAll[0].tag_number;
        setTargetTagForModal(nextTag);
        setPostDecision("Approved");
        setModalOpen(true);
        return;
      } else {
        setModalOpen(false);
        setTargetTagForModal("");
        setPostDecision("Approved");
        return;
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to record Post-Mortem inspection", "error");
      throw err;
    }
  };

  const del = async () => {
    if (!confirmDel || isDeleting) return;
    setIsDeleting(true);
    try {
      await vetService.deleteInspection("Post-Mortem", confirmDel.id);
      showToast("Inspection record deleted successfully. Returned tag to Awaiting Carcasses.", "success");
      setConfirmDel(null);
      setActiveTab("awaiting");
      refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to delete inspection record", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePrintCertificate = (insp = selectedInspection) => {
    if (!insp) return;
    const printWin = window.open("", "_blank", "width=850,height=1100");
    if (!printWin) {
      window.print();
      return;
    }

    const d = new Date(insp.date || new Date());
    const day = d.getDate();
    const suffix = (day % 100 > 10 && day % 100 < 14) ? "th" : (day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th");
    const month = d.toLocaleString("en-US", { month: "long" });
    const year = d.getFullYear();
    const dateFormattedOrdinal = `${day}${suffix} day of ${month}, ${year}`;
    const resolvedOwner = resolveOwnerName(insp);
    const animal = resolveAnimal(insp);
    const ownerName = resolvedOwner !== "Ã¢â‚¬â€" ? resolvedOwner : "Authorized Owner";
    const species = insp.species || animal?.species || "Livestock";

    const isPartial = insp.decision === "Partial" || insp.decision === "Passed with Partial Condemnation" || insp.raw_decision === "Partial";
    const isCondemned = !isPartial && (insp.decision === "Condemned" || insp.decision === "Rejected");
    const condTag = String(insp.tag_number || "").trim();
    const condemnedCuts = (insp.condemned_parts && insp.condemned_parts.length > 0)
      ? insp.condemned_parts
      : (condemnedRecords || []).filter((c) =>
          matchesStage(c, "Post-Mortem") &&
          String(c.tag_number || "").split(",").map((t) => t.trim()).includes(condTag)
        );

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>&lrm;</title>
        <style>
          @page {
            size: letter portrait;
            margin: 0;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: 'Times New Roman', Times, Georgia, serif;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 0.5in 0.6in;
            font-size: 11pt;
            line-height: 1.55;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .cert-container {
            padding: 0;
            max-width: 100%;
            margin: 0 auto;
            background: #fff;
          }
          .header {
            text-align: center;
            border-bottom: 1.5px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 12px;
          }
          .header .rep {
            font-size: 9pt;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin: 0 0 1px 0;
            color: #334155;
          }
          .header .prov {
            font-size: 9pt;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin: 0 0 2px 0;
            color: #334155;
          }
          .header .city {
            font-size: 18pt;
            font-weight: 900;
            letter-spacing: 2.5px;
            text-transform: uppercase;
            margin: 3px 0 2px 0;
            color: #0f172a;
          }
          .header .dept {
            font-size: 9.5pt;
            font-weight: bold;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin: 2px 0 0 0;
            color: #0284c7;
          }
          .title-section {
            text-align: center;
            margin: 14px 0 16px 0;
          }
          .title {
            font-size: 15pt;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            border-bottom: 1.5px solid #0f172a;
            display: inline-block;
            padding-bottom: 3px;
            margin: 0 0 2px 0;
            color: #0f172a;
          }
          .serial {
            font-family: monospace;
            font-size: 9.5pt;
            color: #475569;
            margin-top: 2px;
          }
          .body-text {
            text-align: justify;
            text-indent: 30px;
            font-size: 11pt;
            line-height: 1.7;
            margin: 12px 0;
            color: #0f172a;
          }
          .body-text strong {
            color: #000;
          }
          .stamp-text {
            text-align: center;
            font-size: 13pt;
            font-weight: 900;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin: 18px 0 16px 0;
          }
          .date-location {
            text-align: justify;
            text-indent: 30px;
            font-size: 10.5pt;
            line-height: 1.6;
            margin: 14px 0 20px 0;
            color: #334155;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 28px;
            padding: 0 10px;
          }
          .sig-block {
            text-align: center;
            width: 230px;
          }
          .sig-line {
            border-bottom: 1.5px solid #0f172a;
            font-weight: 800;
            font-size: 11pt;
            padding-bottom: 2px;
            margin-bottom: 2px;
            text-transform: uppercase;
            color: #0f172a;
          }
          .sig-label {
            font-size: 8.5pt;
            font-weight: 800;
            text-transform: uppercase;
            color: #475569;
            letter-spacing: 0.5px;
          }
          .sig-sub {
            font-size: 8pt;
            color: #94a3b8;
            margin-top: 1px;
          }
        </style>
      </head>
      <body>
        <div class="cert-container">
          <div class="header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px;">
            <img src="/naga_city_seal.png" alt="City of Naga" style="width: 60px; height: 60px; object-fit: contain; border-radius: 50%;" />
            <div style="text-align: center; flex: 1;">
              <p class="rep" style="margin: 0;">Republic of the Philippines</p>
              <p class="prov" style="margin: 0 0 2px 0;">Province of Cebu</p>
              <div class="city" style="margin: 3px 0 2px 0;">City of Naga</div>
              <p style="margin: 1px 0 0 0; font-size: 10.5px; color: #64748b;">Tinaan, City of Naga, Cebu, Philippines</p>
            </div>
            <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas" style="width: 60px; height: 60px; object-fit: contain; border-radius: 50%;" />
          </div>

          <div class="title-section">
            <div class="title">Certificate of Meat Inspection</div>
            <div class="serial">Certificate ID: <strong>CERT-NAGA-${insp.id || "00001"}</strong></div>
          </div>

          <p class="body-text">
            This is to certify that the slaughtered meat and carcass comprising <strong>1 head</strong> of <strong>${species}</strong>, owned by <strong style="text-transform: uppercase;">${ownerName}</strong>, has successfully undergone mandatory pre-slaughter <strong>Ante-Mortem</strong> clinical inspection and post-slaughter <strong>Post-Mortem</strong> organoleptic and pathology examination in full accordance with national veterinary public health regulations and the Philippine Meat Inspection Code.
          </p>

          <p class="body-text">
            ${isPartial
              ? `The main carcass of the aforementioned animal was examined and verified wholesome and fit for human food, following the mandatory safe excision and sanitary condemnation of non-conforming cut(s): <strong>${condemnedCuts.map((c) => `${c.part || "Part"} (${c.weight_kg ? `${c.weight_kg} kg` : c.quantity})`).join(", ") || "specified parts"}</strong> in strict compliance with NMIS regulations.`
              : isCondemned
              ? `The carcass and offal of the aforementioned animal exhibited generalized pathology or infectious lesion and was formally condemned in its entirety as unfit for human consumption.`
              : `The said livestock / carcass showed no lesions, symptoms, or indications of infectious, zoonotic, or contagious disease and is hereby declared and certified as:`
            }
          </p>

          <div class="stamp-text" style="color: ${isCondemned ? '#dc2626' : isPartial ? '#0284c7' : '#0f172a'};">
            ${isPartial ? 'PASSED (WITH PARTIAL CONDEMNATION) &amp; FIT FOR HUMAN FOOD' : isCondemned ? 'CONDEMNED &amp; UNFIT FOR HUMAN CONSUMPTION' : 'PASSED &amp; FIT FOR HUMAN CONSUMPTION'}
          </div>

          <p class="date-location">
            Issued this <strong>${dateFormattedOrdinal}</strong> at Tinaan, City of Naga, Cebu, Philippines.
          </p>

          <div class="signatures">
            <div class="sig-block">
              <div class="sig-line">${formatDate(insp.date || new Date())}</div>
              <div class="sig-label">Date Issued</div>
            </div>
            <div class="sig-block">
              <div class="sig-line">${insp.inspector_name || "Dr. Dave"}</div>
              <div class="sig-label">Authorized Veterinary Inspector</div>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  const exportCSV = () => {
    if (data.length === 0) {
      showToast("No inspection records to export", "warning");
      return;
    }
    const headers = "Inspection ID,Tag #,Species,Sex,Owner,Inspection Date,Inspector,Decision,Findings,Remarks";
    const rows = data.map((i) => {
      const animal = resolveAnimal(i);
      const id = i.id || "Ã¢â‚¬â€";
      const tag = i.tag_number || "Ã¢â‚¬â€";
      const species = i.species || animal?.species || "Ã¢â‚¬â€";
      const sex = formatSex(i.sex || animal?.sex);
      const owner = resolveOwnerName(i).replace(/"/g, '""');
      const date = i.date ? formatDate(i.date) : "Ã¢â‚¬â€";
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
    link.setAttribute("download", `postmortem_inspection_records_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Post-Mortem records exported successfully!", "success");
  };

  return (
    <div className="postmortem-page records-page-container" style={{ width: "100%", padding: 0 }}>
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
                count: awaitingCarcasses.length,
                icon: <Icon.Clock size={14} />,
              },
              {
                id: "evidence",
                label: "Condemnation Evidence",
                count: postEvidenceCount,
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
                      background: isActive ? "rgba(124, 58, 237, 0.15)" : "var(--color-border)",
                      color: isActive ? "#7c3aed" : "var(--color-text-muted)",
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


            {/* Conduct Carcass Inspection Button if Awaiting */}
            {activeTab === "awaiting" && (
              <Button
                size="sm"
                onClick={() => handleOpenModal()}
                disabled={awaitingCarcasses.length === 0}
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
                <Icon.Activity size={14} /> Conduct Inspection
              </Button>
            )}

          </div>
        </div>

        {/* Evidence & Photos / Condemnation Evidence Tab */}
        {activeTab === "evidence" && (
          <div className="records-scrollable-content" style={{ padding: 0, border: "none", flex: 1, minHeight: 0, overflowY: "auto" }}>
            <EvidenceUpload type="Post-Mortem" hideHeader hideStats search={search} filterSpecies={filterSpecies} />
          </div>
        )}

        {/* Tab 1: Inspected Carcasses Table (Owner-grouped with dedicated record view matching Condemnation) */}
        {activeTab === "inspected" && (
          groupedInspected.length === 0 ? (
            <EmptyState
              title="No Post-Mortem inspections found"
              message={
                search || filterSpecies !== "all" || dateRange !== "all"
                  ? "Try clearing filters to see more inspection records."
                  : "No Post-Mortem inspections recorded yet. Click 'Conduct Carcass Inspection' to begin."
              }
              icon={<Icon.Activity size={42} />}
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
                    <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", textAlign: "center", background: "var(--color-bg)" }}>Total Carcasses</th>
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
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(139, 92, 246, 0.04)")}
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
                              background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
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
                              {grp.count} carcass{grp.count > 1 ? "es" : ""} inspected
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date Inspected */}
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#8b5cf6" }} />
                          <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Undated Inspection"}</span>
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
                            fontWeight: 600,
                            color: "#8b5cf6",
                          }}
                        >
                          {grp.count} carcass{grp.count > 1 ? "es" : ""}
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
                          {grp.partialCount > 0 && (
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
                              {grp.partialCount} Partial Condemned
                            </span>
                          )}
                          {grp.wholeCount > 0 && (
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
                              {grp.wholeCount} Whole Condemned
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
              title="Carcass queue is completely cleared!"
              message="All slaughtered carcasses have successfully undergone Post-Mortem inspection and sanitary certification."
              icon={<Icon.Check size={42} />}
            />
          ) : (
            /* Main Owner List View for Awaiting Carcasses */
            <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", border: "none", boxShadow: "none", flex: 1, minHeight: 0 }}>
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
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(139, 92, 246, 0.04)")}
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
                                background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
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
                                {grp.count} carcass{grp.count > 1 ? "es" : ""} awaiting inspection
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Date Slaughtered */}
                        <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#8b5cf6" }} />
                            <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Recent Slaughter"}</span>
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
                              fontWeight: 600,
                              color: "#7c3aed",
                            }}
                          >
                            {grp.count} carcass{grp.count > 1 ? "es" : ""}
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
                              color: "#7c3aed",
                            }}
                          >
                            <Icon.Activity size={13} /> Slaughtered Ã‚Â· Ready for Vet
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
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                                color: "#ffffff",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <Icon.Activity size={13} /> Inspect Batch
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
              <b>{Math.min(currentPage * pageSize, currentDataset.length)}</b> of <b>{currentDataset.length}</b> {activeTab === "inspected" ? `owner groups (${filteredLog.length} carcass inspections)` : `owner groups (${filteredQueue.length} carcasses)`}
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

            {/* Standardized Dedicated Owner Records Modal */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => setSelectedOwnerKey(null)}
        title={
          activeTab === "inspected"
            ? `Post-Mortem Inspection Records Ã¢â‚¬â€ ${selectedOwnerView?.owner_name || ""}`
            : `Awaiting Post-Mortem Inspection Ã¢â‚¬â€ ${selectedOwnerView?.owner_name || ""}`
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {selectedOwnerView?.items?.length || 0} {activeTab === "inspected" ? "inspected record" : "carcass"}{selectedOwnerView?.items?.length === 1 ? "" : "es"}
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
                    background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                    color: "#ffffff",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon.Activity size={14} /> Inspect All Carcasses
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
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Findings / Lesions</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Inspector</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Decision</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((i) => {
                      const resolvedOwner = resolveOwnerName(i);
                      const animal = resolveAnimal(i);
                      const outcome = getPostOutcome(i);
                      const isPartial = outcome.label === "Partially Condemned";

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
                            {i.species || animal?.species || "Ã¢â‚¬â€"}
                          </td>
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5, color: "var(--color-text)" }}>
                            {formatSex(i.sex || animal?.sex)}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {formatPhDateTime(i.inspected_at || i.action_timestamp || i.created_at || i.date)}
                          </td>
                          <td style={{ padding: "12px 14px" }} title={i.findings || "No pathological lesions detected"}>
                            <div style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                              {i.findings || "No pathological lesions detected"}
                            </div>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", fontSize: 12 }}>
                              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(124, 58, 237, 0.18)", color: "#8b5cf6", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                V
                              </span>
                              <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }} title={i.inspector_name || i.created_by || "Dr. Dave"}>
                                {i.inspector_name || i.created_by || "Dr. Dave"}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <Badge status={outcome.status}>{outcome.label}</Badge>
                            {(() => {
                              const inspectionTag = String(i.tag_number || "").trim();
                              const postParts = (i.condemned_parts && i.condemned_parts.length > 0)
                                ? i.condemned_parts
                                : (condemnedRecords || []).filter((c) =>
                                    matchesStage(c, "Post-Mortem") &&
                                    String(c.tag_number || "").split(",").map((t) => t.trim()).includes(inspectionTag)
                                  );
                              if (!postParts || postParts.length === 0) return null;
                              const totalW = postParts.reduce((s, p) => s + (parseFloat(p.weight_kg || p.quantity) || 0), 0);
                              const chipLabel = isPartial
                                ? `${postParts.length} cut${postParts.length > 1 ? "s" : ""} (${totalW.toFixed(1)} kg)`
                                : "Whole Carcass Condemned";
                              return (
                                <div style={{ marginTop: 3 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#f87171", background: "rgba(220, 38, 38, 0.15)", border: "1px solid rgba(220, 38, 38, 0.3)", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                                    {chipLabel}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div className="actions" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => setSelectedInspection({ ...i, animal, owner_name: resolvedOwner })}
                                title="View Official Inspection Details"
                                aria-label="View Details"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 7,
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "#8b5cf6",
                                  cursor: "pointer",
                                }}
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
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Operator</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Slaughter Completed Time</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Processing Status</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOwnerView.items || []).map((item) => (
                      <tr key={item.id || item.tag_number} style={{ borderBottom: "1px solid var(--color-border)" }}>
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
                            {item.tag_number || "Ã¢â‚¬â€"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {item.species}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                          {formatSex(item.sex)}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                          {item.operator || "Assigned Operator"}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                          {item.completed_at || item.updated_at || item.marked_at || item.registered_at || item.created_at || item.slaughter_date || item.date
                            ? formatPhDateTime(item.completed_at || item.updated_at || item.marked_at || item.registered_at || item.created_at || item.slaughter_date || item.date)
                            : "Ã¢â‚¬â€"}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#7c3aed" }}>
                            Slaughter Completed Ã‚Â· Ready for Vet
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right" }}>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedOwnerKey(null);
                              handleOpenModal(item.tag_number);
                            }}
                            style={{
                              padding: "5px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                              color: "#ffffff",
                            }}
                          >
                            <Icon.Activity size={13} /> Inspect Carcass
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

{/* New Post-Mortem Inspection Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setTargetTagForModal(""); setModalSuccessAlert(null); setPostDecision("Approved"); }}
        title="Conduct Post-Mortem Inspection"
        headerRight={
          <div
            role="tablist"
            aria-label="Post-mortem inspection outcome"
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
            {/* 1. Fit for Consumption (Approved) */}
            <button
              type="button"
              role="tab"
              aria-selected={postDecision === "Approved"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPostDecision("Approved");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: postDecision === "Approved" ? 750 : 600,
                cursor: "pointer",
                transition: "all 140ms ease",
                border: postDecision === "Approved" ? "1.5px solid #10b981" : "1.5px solid transparent",
                background: postDecision === "Approved" ? "var(--color-surface, #ffffff)" : "transparent",
                color: postDecision === "Approved" ? "#047857" : "var(--color-text-muted, #64748b)",
                boxShadow: postDecision === "Approved" ? "0 2px 6px rgba(16, 185, 129, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05)" : "none",
                pointerEvents: "auto",
                userSelect: "none",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
              title="Carcass is approved and fully fit for human consumption"
            >
              <Icon.Check size={13} style={{ color: postDecision === "Approved" ? "#059669" : "#10b981", pointerEvents: "none" }} />
              <span style={{ pointerEvents: "none" }}>Fit for Consumption</span>
            </button>

            {/* 2. Partially Condemned */}
            <button
              type="button"
              role="tab"
              aria-selected={postDecision === "Partial"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPostDecision("Partial");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: postDecision === "Partial" ? 750 : 600,
                cursor: "pointer",
                transition: "all 140ms ease",
                border: postDecision === "Partial" ? "1.5px solid #f59e0b" : "1.5px solid transparent",
                background: postDecision === "Partial" ? "var(--color-surface, #ffffff)" : "transparent",
                color: postDecision === "Partial" ? "#b45309" : "var(--color-text-muted, #64748b)",
                boxShadow: postDecision === "Partial" ? "0 2px 6px rgba(245, 158, 11, 0.25), 0 1px 2px rgba(0, 0, 0, 0.05)" : "none",
                pointerEvents: "auto",
                userSelect: "none",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
              title="Condemn specific pathological cuts or organs; main carcass proceeds"
            >
              <Icon.Scale size={13} style={{ color: postDecision === "Partial" ? "#d97706" : "#f59e0b", pointerEvents: "none" }} />
              <span style={{ pointerEvents: "none" }}>Partially Condemned</span>
            </button>

            {/* 3. Condemned (Total) */}
            <button
              type="button"
              role="tab"
              aria-selected={postDecision === "Condemned"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPostDecision("Condemned");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: postDecision === "Condemned" ? 750 : 600,
                cursor: "pointer",
                transition: "all 140ms ease",
                border: postDecision === "Condemned" ? "1.5px solid #ef4444" : "1.5px solid transparent",
                background: postDecision === "Condemned" ? "var(--color-surface, #ffffff)" : "transparent",
                color: postDecision === "Condemned" ? "#b91c1c" : "var(--color-text-muted, #64748b)",
                boxShadow: postDecision === "Condemned" ? "0 2px 6px rgba(239, 68, 68, 0.25), 0 1px 2px rgba(0, 0, 0, 0.05)" : "none",
                pointerEvents: "auto",
                userSelect: "none",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
              title="Entire carcass is unfit for consumption and totally condemned"
            >
              <Icon.AlertTriangle size={13} style={{ color: postDecision === "Condemned" ? "#dc2626" : "#ef4444", pointerEvents: "none" }} />
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
        alert={modalSuccessAlert}
      >
        <InspectionForm
          key={targetTagForModal || "pm-modal"}
          type="Post-Mortem"
          decision={postDecision}
          onDecisionChange={setPostDecision}
          livestock={awaitingCarcasses}
          initialTag={targetTagForModal}
          onSubmit={save}
          onCancel={() => { setModalOpen(false); setTargetTagForModal(""); setModalSuccessAlert(null); setPostDecision("Approved"); }}
        />
      </Modal>

      {/* Inspection Slip / Certificate View Modal */}
      <Modal
        open={!!selectedInspection}
        onClose={() => setSelectedInspection(null)}
        title="Official Post-Mortem Meat Inspection Certificate"
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
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Republic of the Philippines Ã‚Â· City Veterinary Office
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", marginTop: 2 }}>
                  Post-Mortem Inspection Certificate
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                  Record ID: #{selectedInspection.id || "00001"} Ã‚Â· Date: {formatPhDateTime(selectedInspection.inspected_at || selectedInspection.created_at || selectedInspection.date)}
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
                  {selectedInspection.species || selectedInspection.animal?.species || resolveAnimal(selectedInspection)?.species || "Ã¢â‚¬â€"} Ã‚Â· {formatSex(selectedInspection.sex || selectedInspection.animal?.sex || resolveAnimal(selectedInspection)?.sex)}
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

            {/* Pathological Findings */}
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text)", textTransform: "uppercase", marginBottom: 6 }}>
                Post-Mortem Findings & Pathology Observations
              </div>
              <div style={{ fontSize: 14, color: "var(--color-text)", lineHeight: 1.5, background: "var(--color-bg)", padding: "12px 14px", borderRadius: 8 }}>
                {selectedInspection.findings || "No pathological lesions or signs of infectious disease detected. Meat cleared fit for human consumption."}
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

            {/* Condemnation Parts Details if any */}
            {(() => {
              const selTag = String(selectedInspection.tag_number || "").trim();
              const relatedCondemns = (condemnedRecords || []).filter(
                (c) => String(c.tag_number || "").split(",").map((t) => t.trim()).includes(selTag)
              );
              if (relatedCondemns.length === 0) return null;

              return (
                <div style={{ background: "var(--color-surface)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.AlertTriangle size={15} />
                    Condemnation Details & Parts
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {relatedCondemns.map((c, idx) => (
                      <div key={idx} style={{ fontSize: 13, background: "rgba(239, 68, 68, 0.06)", padding: "8px 12px", borderRadius: 6, display: "flex", justifyContent: "space-between" }}>
                        <span><strong>Part:</strong> {c.part || c.parts || "Whole carcass"} ({c.reason || "Condemned"})</span>
                        {c.weight && <span><strong>Weight:</strong> {c.weight} kg</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Audit Trail & Process Timeline */}
            <div style={{ marginTop: 4 }}>
              <ProcessHistoryTimeline
                livestock={selectedInspection.animal || (livestock || []).find((l) => (l.id && l.id === selectedInspection.livestock_id) || l.tag_number === selectedInspection.tag_number) || selectedInspection}
                title="Livestock & Carcass Inspection Audit Trail"
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
        message="Are you sure you want to delete this inspection record? This will reset the livestock status to Pending."
        confirmText="Confirm Delete"
        confirmVariant="danger"
        loading={isDeleting}
      />

      {/* Clean In-App Alert Dialog (replaces window.alert to eliminate localhost:5173 says) */}
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
