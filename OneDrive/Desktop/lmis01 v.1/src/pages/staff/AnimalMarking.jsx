import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Badge, Modal, PageHeader, EmptyState, TagBadge, ConfirmDialog, Pagination, AlertDialog } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { staffService } from "../../services/staffService";
import { formatDate, formatPhDateTime, formatTime, initials, today, formatSex } from "../../utils/helpers";

const MARK_TYPES = [
  {
    id: "Ear Tag",
    label: "Ear Tag",
    desc: "Standard plastic/metal ear tag",
    iconName: "Tag",
    color: "var(--color-primary, #10b981)",
    bg: "rgba(16, 185, 129, 0.1)",
    border: "rgba(16, 185, 129, 0.3)",
    badge: "Recommended"
  },
  {
    id: "Tattoo",
    label: "Tattoo",
    desc: "Permanent ear or flank ink marking",
    iconName: "Edit",
    color: "#6366f1",
    bg: "rgba(99, 102, 241, 0.1)",
    border: "rgba(99, 102, 241, 0.3)",
    badge: "Permanent"
  }
];

export const AnimalMarking = ({ navTabs }) => {
  const { data: data = [], loading: dataLoading = false, refresh, setData } = useSupabase(TABLES.LIVESTOCK);
  const { data: processing = [], loading: procLoading = false } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: slaughterRecords = [], loading: slaughterLoading = false } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: carcass = [], loading: carcassLoading = false } = useSupabase(TABLES.CARCASS);
  const { data: anteMortem = [], loading: amLoading = false } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: owners = [], loading: ownersLoading = false } = useSupabase(TABLES.OWNERS);
  const { data: dbSpecies = [] } = useSupabase(TABLES.SPECIES);
  const loading = (dataLoading || procLoading || slaughterLoading || carcassLoading || amLoading || ownersLoading) && data.length === 0;

  const activeSpeciesList = useMemo(() => {
    if (Array.isArray(dbSpecies) && dbSpecies.length > 0) {
      const active = dbSpecies.filter((s) => s.status === "Active" || !s.status);
      if (active.length > 0) return active;
    }
    return [
      { name: "Hog", description: "Swine" },
      { name: "Cattle", description: "Bovine" },
      { name: "Carabao", description: "Water Buffalo" },
      { name: "Goat", description: "Caprine" },
    ];
  }, [dbSpecies]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [markType, setMarkType] = useState("Ear Tag");
  const [returnOwnerKey, setReturnOwnerKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingMark, setConfirmingMark] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Edit livestock details states
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({
    species: "Cattle",
    quantity: 1,
    sex: "Male",
    age: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Marking completed notification dialog state
  const [markSuccessNotice, setMarkSuccessNotice] = useState(null);

  // Active view & filtering states
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "marked" || urlTab === "for_marking") return urlTab;
    return "for_marking";
  });
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const { showToast } = useToast();

  // Sync URL search params whenever they change
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "marked" || urlTab === "for_marking") {
      setActiveTab(urlTab);
    }
    const q = searchParams.get("tag") || searchParams.get("search");
    if (q) {
      setSearch(q);
      const upperQ = q.toUpperCase();
      const match = (data || []).find(
        (a) => String(a.tag_number || "").toUpperCase() === upperQ || String(a.id || "") === q
      );
      if (match) {
        const s = String(match.status || "").toLowerCase();
        if (s.includes("returned to") || s === "for marking" || !match.marked_at) {
          setActiveTab("for_marking");
        } else {
          setActiveTab("marked");
        }
      }
    }
  }, [searchParams, data]);

  // Pagination states
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Trigger 24-hour marking fallback check on mount once to return stale marked animals
  useEffect(() => {
    staffService.processMarking24hFallback()
      .then((res) => {
        if (res && (res.processed > 0 || res.processed_count > 0)) {
          refresh?.();
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, activeTab, sortBy]);

  // Expand/collapse group helper
  const toggleGroupExpand = (groupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // Map of animals with Ante-Mortem Approved status from the Veterinarian.
  // Keys are stored normalised so lookups match regardless of casing/whitespace
  // differences between the inspection row and the livestock row.
  const approvedAnteMortemMap = useMemo(() => {
    const map = new Map();
    (anteMortem || []).forEach((am) => {
      if (!am) return;
      if (am.decision === "Approved" || am.decision === "Passed") {
        if (am.livestock_id) map.set(String(am.livestock_id).trim().toLowerCase(), am);
        if (am.tag_number) map.set(String(am.tag_number).trim().toLowerCase(), am);
      }
    });
    return map;
  }, [anteMortem]);

  // Set of tag numbers and IDs for downstream processes (slaughter, processing, carcass)
  const downstreamTagSet = useMemo(() => {
    const set = new Set();
    (processing || []).forEach((p) => {
      if (p.tag_number) set.add(p.tag_number);
      if (p.livestock_id) set.add(p.livestock_id);
    });
    (slaughterRecords || []).forEach((s) => {
      if (s.tag_number) set.add(s.tag_number);
      if (s.livestock_id) set.add(s.livestock_id);
    });
    (carcass || []).forEach((c) => {
      if (c.tag_number) set.add(c.tag_number);
      if (c.livestock_id) set.add(c.livestock_id);
    });
    return set;
  }, [processing, slaughterRecords, carcass]);

  // Sort animals sequentially
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  }, [data]);

  // Helper to check if an animal is marked
  const isMarked = (l) => {
    if (!l) return false;
    return Boolean(
      (l.marked === true || l.marked === "true" || l.marked === "t" || l.marked === 1 || l.marked === "1") &&
      l.marked !== "false"
    );
  };

  // Animals ready for marking.
  // Newly registered livestock proceeds directly to Animal Marking upon intake.
  // Eligibility: Any registered livestock with an assigned tag number that is not yet marked,
  // not condemned/rejected, and not already downstream in slaughter operations.
  const toMark = useMemo(() => {
    if (loading) return [];
    return sortedData.filter((l) => {
      if (!l.tag_number || String(l.tag_number).trim() === "") return false;

      const isFallback = l.status === "Returned to Animal Marking" || Boolean(l.fallback_at);
      if (!isFallback) {
        if (isMarked(l)) return false;
        if (l.mark_type || l.mark_date) return false;
      }

      const s = String(l.status || "").trim().toLowerCase();
      if (s.includes("condemn") || s.includes("reject")) return false;
      if (
        s === "released" ||
        s === "completed" ||
        s === "ready for slaughter" ||
        s === "weighed" ||
        s === "paid" ||
        s === "slaughtered" ||
        s === "in progress" ||
        s === "ready for dispatch" ||
        s === "permit issued" ||
        s === "dispatched"
      ) return false;

      if (!isFallback && (downstreamTagSet.has(l.tag_number) || downstreamTagSet.has(l.id))) return false;

      return true;
    });
  }, [loading, sortedData, downstreamTagSet]);

  // Philippine Standard Time (UTC+8) current date helper
  const getPHToday = () => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  };

  // Date range filter helper
  const isWithinDateRange = (itemDateStr, range) => {
    if (!itemDateStr || range === "all") return true;
    const cleanDate = String(itemDateStr).trim().split("T")[0];
    const phToday = getPHToday();
    if (range === "today") {
      return cleanDate === phToday;
    }
    const d = new Date(cleanDate);
    const now = new Date(phToday);
    if (isNaN(d.getTime())) return true;
    if (range === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (range === "month") {
      const monthAgo = new Date(now);
      monthAgo.setMonth(now.getMonth() - 1);
      return d >= monthAgo;
    }
    return true;
  };

  // Helper to resolve owner name cleanly prioritizing master owners directory
  const resolveOwnerName = (item) => {
    if (!item) return "Unknown Owner";
    const targetOwnerId = item.owner_id;
    if (targetOwnerId && owners && owners.length > 0) {
      const cleanOId = String(targetOwnerId).trim().toLowerCase();
      const match = owners.find(
        (o) =>
          (o.id && String(o.id).trim().toLowerCase() === cleanOId) ||
          (o.owner_id && String(o.owner_id).trim().toLowerCase() === cleanOId) ||
          (o.temp_reg_id && String(o.temp_reg_id).trim().toLowerCase() === cleanOId) ||
          (o.auth_user_id && String(o.auth_user_id).trim().toLowerCase() === cleanOId)
      );
      if (match?.name) return match.name.trim();
    }
    const directName = (item.owner_name || "").trim();
    if (directName && directName !== "Unknown Owner" && directName !== "—" && directName !== "-") {
      if (owners && owners.length > 0) {
        const nameMatch = owners.find(
          (o) => (o.name || "").trim().toLowerCase() === directName.toLowerCase()
        );
        if (nameMatch?.name) return nameMatch.name.trim();
      }
      return directName;
    }
    return "Unknown Owner";
  };

  // Helper to resolve owner id cleanly using direct fields & owners directory lookup
  const resolveOwnerId = (item) => {
    if (!item) return null;
    if (item.owner_id) return item.owner_id;
    const directName = (item.owner_name || "").trim().toLowerCase();
    if (directName && directName !== "unknown owner" && owners && owners.length > 0) {
      const match = owners.find((o) => (o.name || "").trim().toLowerCase() === directName);
      if (match?.id) return match.id;
    }
    return null;
  };

  // Helper to resolve intake/marking date without falsely defaulting to current date 'today()'
  const resolveDateStr = (item, isMarkedTab = false) => {
    if (!item) return "";
    const rawDate = isMarkedTab
      ? (item.mark_date || item.received_date || item.date || item.created_at)
      : (item.received_date || item.date || item.created_at);

    if (!rawDate) return "";
    const str = String(rawDate).trim();
    if (!str || str.toLowerCase() === "undefined" || str.toLowerCase() === "null") return "";
    return str.split("T")[0];
  };

  // Animals officially marked ("Marked") - historical log of all currently active marked animals
  const markedAnimals = useMemo(() => {
    if (loading) return [];
    return sortedData.filter((l) => {
      if (!l.tag_number || String(l.tag_number).trim() === "") return false;
      return isMarked(l) || Boolean(l.mark_type) || Boolean(l.mark_date);
    });
  }, [loading, sortedData]);

  // Filtered list of livestock for marking (itemized)
  const filteredToMark = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = toMark.filter((a) => {
      const owner = resolveOwnerName(a).toLowerCase();
      const rawOwner = (a.owner_name || "").toLowerCase();
      const tag = (a.tag_number || "").toLowerCase();
      const species = (a.species || "").toLowerCase();
      const breed = (a.breed || "").toLowerCase();
      const markingCode = (a.marking_code || "").toLowerCase();
      const id = String(a.id || "").toLowerCase();

      const matchesSearch =
        !q ||
        owner.includes(q) ||
        rawOwner.includes(q) ||
        tag.includes(q) ||
        species.includes(q) ||
        breed.includes(q) ||
        markingCode.includes(q) ||
        id.includes(q);
      return matchesSearch;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "tag_asc") {
        return (a.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }
      if (sortBy === "tag_desc") {
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }
      if (sortBy === "owner") {
        return (a.owner_name || "").localeCompare(b.owner_name || "");
      }
      // default: newest
      const timeA = new Date(a.created_at || a.received_date || 0).getTime();
      const timeB = new Date(b.created_at || b.received_date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true });
    });
  }, [toMark, owners, search, sortBy]);

  // Filtered list of marked livestock (itemized)
  const filteredMarked = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = markedAnimals.filter((a) => {
      const owner = resolveOwnerName(a).toLowerCase();
      const rawOwner = (a.owner_name || "").toLowerCase();
      const tag = (a.tag_number || "").toLowerCase();
      const species = (a.species || "").toLowerCase();
      const mark = (a.mark_type || "").toLowerCase();
      const breed = (a.breed || "").toLowerCase();
      const markingCode = (a.marking_code || "").toLowerCase();
      const id = String(a.id || "").toLowerCase();

      const matchesSearch =
        !q ||
        owner.includes(q) ||
        rawOwner.includes(q) ||
        tag.includes(q) ||
        species.includes(q) ||
        mark.includes(q) ||
        breed.includes(q) ||
        markingCode.includes(q) ||
        id.includes(q);
      return matchesSearch;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "tag_asc") {
        return (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }
      if (sortBy === "tag_desc") {
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      }
      if (sortBy === "owner") {
        return (a.owner_name || "").localeCompare(b.owner_name || "");
      }
      // default: newest
      const timeA = new Date(a.mark_date || a.created_at || a.received_date || 0).getTime();
      const timeB = new Date(b.mark_date || b.created_at || b.received_date || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true });
    });
  }, [markedAnimals, search, sortBy]);

  // Grouped dataset for "For Marking" tab (grouped strictly by actual registered owner)
  const groupedToMark = useMemo(() => {
    const groups = new Map();
    filteredToMark.forEach((item) => {
      // Filter out corrupt/invalid records without tag numbers
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = resolveOwnerName(item);
      const ownerId = resolveOwnerId(item);
      // Omit orphan/ghost records that have no valid owner info
      if (owner === "Unknown Owner" && !ownerId && !item.owner_name) return;

      const key = ownerId ? `owner_${String(ownerId).toLowerCase().trim()}` : `owner_${owner.toLowerCase().trim()}`;
      const species = (item.species || "Unknown Species").trim();
      const rawTime = item.created_at || item.registered_at || item.received_date || item.date;
      const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
      const dateStr = resolveDateStr(item, false);

      if (!groups.has(key)) {
        const ownerObj = (owners || []).find(
          (o) =>
            (ownerId &&
              (String(o.id || "").toLowerCase() === String(ownerId).toLowerCase() ||
                String(o.owner_id || "").toLowerCase() === String(ownerId).toLowerCase())) ||
            (o.name || "").toLowerCase().trim() === owner.toLowerCase().trim()
        );
        groups.set(key, {
          key,
          owner_name: owner,
          owner_id: ownerId,
          avatar_url: ownerObj?.avatar_url || null,
          date: dateStr,
          rawDate: rawTime,
          latestTimestamp: itemTime,
          species: species,
          speciesList: [],
          items: [],
          hasFallback: false,
        });
      }

      const grp = groups.get(key);
      if (item.status === "Returned to Animal Marking" || item.fallback_at) {
        grp.hasFallback = true;
      }
      grp.items.push(item);
      if (species && species !== "—" && species !== "Unknown Species" && !grp.speciesList.includes(species)) {
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
        hasFallback: g.items.some((i) => i.status === "Returned to Animal Marking" || Boolean(i.fallback_at)),
        items: [...g.items].sort((a, b) => {
          const timeA = new Date(a.created_at || a.received_date || 0).getTime();
          const timeB = new Date(b.created_at || b.received_date || 0).getTime();
          if (timeB !== timeA) return timeB - timeA;
          return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
        }),
      }))
      .sort((a, b) => {
        // Priority sort: groups with fallback items appear at top of queue
        if (a.hasFallback && !b.hasFallback) return -1;
        if (!a.hasFallback && b.hasFallback) return 1;
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredToMark, owners]);

  // Grouped dataset for "Marked" tab (grouped by owner based on time and date)
  const groupedMarked = useMemo(() => {
    // 1. Group items by owner first
    const ownerBuckets = new Map();

    filteredMarked.forEach((item) => {
      if (!item.tag_number || String(item.tag_number).trim() === "") return;

      const owner = resolveOwnerName(item);
      const ownerId = resolveOwnerId(item);
      if (owner === "Unknown Owner" && !ownerId && !item.owner_name) return;

      const ownerKey = ownerId ? `owner_${String(ownerId).toLowerCase().trim()}` : `owner_${owner.toLowerCase().trim()}`;
      if (!ownerBuckets.has(ownerKey)) {
        ownerBuckets.set(ownerKey, {
          owner_name: owner,
          owner_id: ownerId,
          items: [],
        });
      }
      ownerBuckets.get(ownerKey).items.push(item);
    });

    const resultGroups = [];

    // 2. For each owner, sub-group items based on time and date
    ownerBuckets.forEach((bucket, ownerKey) => {
      // Sort this owner's marked animals newest first
      const sortedItems = [...bucket.items].sort((a, b) => {
        const timeA = new Date(a.marked_at || a.mark_date || a.created_at || a.received_date || 0).getTime();
        const timeB = new Date(b.marked_at || b.mark_date || b.created_at || b.received_date || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.tag_number || "").localeCompare(a.tag_number || "", undefined, { numeric: true, sensitivity: "base" });
      });

      // Cluster items into sessions based on time and date (within 15 minutes on the same date)
      const sessions = [];
      let currentSession = null;

      sortedItems.forEach((item) => {
        const rawTime = item.marked_at || item.mark_date || item.created_at || item.registered_at || item.received_date || item.date;
        const itemTime = rawTime ? new Date(rawTime).getTime() : 0;
        const dateStr = resolveDateStr(item, true);

        if (!currentSession) {
          currentSession = {
            owner_name: bucket.owner_name,
            owner_id: bucket.owner_id,
            latestTimestamp: itemTime,
            earliestTimestamp: itemTime,
            rawDate: rawTime,
            date: dateStr,
            items: [item],
          };
          sessions.push(currentSession);
        } else {
          // Check if item belongs to currentSession (within 15 minutes of session window and same date)
          const timeDiff = Math.abs(currentSession.earliestTimestamp - itemTime);
          const isSameDate = !dateStr || !currentSession.date || dateStr === currentSession.date;
          const isWithinWindow = timeDiff <= 15 * 60 * 1000; // 15 minutes

          if (isSameDate && isWithinWindow) {
            currentSession.items.push(item);
            if (itemTime < currentSession.earliestTimestamp) currentSession.earliestTimestamp = itemTime;
            if (itemTime > currentSession.latestTimestamp) {
              currentSession.latestTimestamp = itemTime;
              currentSession.rawDate = rawTime;
              currentSession.date = dateStr;
            }
          } else {
            // Start a new session
            currentSession = {
              owner_name: bucket.owner_name,
              owner_id: bucket.owner_id,
              latestTimestamp: itemTime,
              earliestTimestamp: itemTime,
              rawDate: rawTime,
              date: dateStr,
              items: [item],
            };
            sessions.push(currentSession);
          }
        }
      });

      // Build group objects for each session
      sessions.forEach((sess, idx) => {
        const speciesList = [];
        sess.items.forEach((it) => {
          const sp = (it.species || "Unknown Species").trim();
          if (sp && sp !== "—" && sp !== "Unknown Species" && !speciesList.includes(sp)) {
            speciesList.push(sp);
          }
        });

        // Unique key for modal selection: ownerKey + session timestamp + index
        const groupKey = `${ownerKey}_session_${sess.latestTimestamp || idx}_${idx}`;

        resultGroups.push({
          key: groupKey,
          owner_name: sess.owner_name,
          owner_id: sess.owner_id,
          date: sess.date,
          rawDate: sess.rawDate,
          latestTimestamp: sess.latestTimestamp,
          species: speciesList[0] || "Livestock",
          speciesList,
          items: sess.items,
          count: sess.items.length,
        });
      });
    });

    // 3. Sort all groups by newest marking session timestamp first
    return resultGroups.sort((a, b) => {
      if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
      return a.owner_name.localeCompare(b.owner_name);
    });
  }, [filteredMarked, owners]);

  // Auto-expand group containing searched tag
  useEffect(() => {
    const q = (searchParams.get("tag") || searchParams.get("search") || "").trim().toUpperCase();
    if (!q) return;
    const allGroups = [...groupedToMark, ...groupedMarked];
    const match = allGroups.find((g) =>
      (g.items || []).some(
        (it) => String(it.tag_number || "").toUpperCase() === q || String(it.id || "") === q
      )
    );
    if (match) {
      setExpandedGroups((prev) => new Set([...prev, match.key]));
    }
  }, [searchParams, groupedToMark, groupedMarked]);

  // Selected Owner Dedicated View State (matches Condemnation UI)
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);
  useEffect(() => {
    setSelectedOwnerKey(null);
  }, [search, sortBy, activeTab]);

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    const currentDataset = activeTab === "for_marking" ? groupedToMark : groupedMarked;
    return (currentDataset || []).find((g) => g.key === selectedOwnerKey) || null;
  }, [activeTab, groupedToMark, groupedMarked, selectedOwnerKey]);

  // View records pagination (10 per page default)
  const [ownerViewPage, setOwnerViewPage] = useState(1);
  const [ownerViewPageSize, setOwnerViewPageSize] = useState(10);

  useEffect(() => {
    setOwnerViewPage(1);
  }, [selectedOwnerKey, activeTab]);

  const paginatedOwnerItems = useMemo(() => {
    if (!selectedOwnerView?.items) return [];
    return selectedOwnerView.items;
  }, [selectedOwnerView]);

  // Individual & batch livestock selection for marking within owner view
  const [selectedLivestockKeys, setSelectedLivestockKeys] = useState(new Set());

  // Reset selection when switching owner, changing search/filter, or changing tabs
  useEffect(() => {
    setSelectedLivestockKeys(new Set());
  }, [selectedOwnerKey, activeTab, search, sortBy]);

  const toggleSelectLivestock = (key) => {
    if (!key) return;
    setSelectedLivestockKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedItemsForOwner = useMemo(() => {
    if (!selectedOwnerView?.items || activeTab !== "for_marking") return [];
    return selectedOwnerView.items.filter((i) => selectedLivestockKeys.has(i.id || i.tag_number));
  }, [selectedOwnerView, selectedLivestockKeys, activeTab]);

  const isOwnerAllSelected = useMemo(() => {
    if (!selectedOwnerView?.items || selectedOwnerView.items.length === 0 || activeTab !== "for_marking") return false;
    return selectedOwnerView.items.every((i) => selectedLivestockKeys.has(i.id || i.tag_number));
  }, [selectedOwnerView, selectedLivestockKeys, activeTab]);

  const isOwnerSomeSelected = useMemo(() => {
    if (!selectedOwnerView?.items || activeTab !== "for_marking") return false;
    const hasSome = selectedOwnerView.items.some((i) => selectedLivestockKeys.has(i.id || i.tag_number));
    return hasSome && !isOwnerAllSelected;
  }, [selectedOwnerView, selectedLivestockKeys, isOwnerAllSelected, activeTab]);

  const toggleSelectOwnerAll = () => {
    if (!selectedOwnerView?.items || activeTab !== "for_marking") return;
    setSelectedLivestockKeys((prev) => {
      const next = new Set(prev);
      if (isOwnerAllSelected) {
        selectedOwnerView.items.forEach((i) => next.delete(i.id || i.tag_number));
      } else {
        selectedOwnerView.items.forEach((i) => next.add(i.id || i.tag_number));
      }
      return next;
    });
  };

  const openMarkSelected = (items) => {
    if (!items || items.length === 0) return;
    if (items.length === 1) {
      openMarkSingle(items[0]);
      return;
    }
    setSelected(null);
    const firstWithTime = items.find((i) => i?.created_at || i?.registered_at || i?.received_date);
    setSelectedBatch({
      owner_name: selectedOwnerView.owner_name,
      owner_id: selectedOwnerView.owner_id,
      count: items.length,
      items,
      rawDate: firstWithTime?.created_at || firstWithTime?.registered_at || firstWithTime?.received_date || selectedOwnerView.rawDate || selectedOwnerView.date,
      date: selectedOwnerView.date,
      hasFallback: items.some((i) => i.status === "Returned to Animal Marking" || Boolean(i.fallback_at)),
    });
    setMarkType("Ear Tag");
    setModalOpen(true);
  };

  const resolveBatchSexSummary = (target) => {
    if (!target) return "—";
    const items = Array.isArray(target.items) && target.items.length > 0 ? target.items : [target];
    let maleCount = 0;
    let femaleCount = 0;
    items.forEach((item) => {
      const s = formatSex(item?.sex);
      if (s === "Male") maleCount += 1;
      else if (s === "Female") femaleCount += 1;
      else {
        const digits = String(item?.tag_number || "").replace(/\D/g, "");
        const num = digits ? parseInt(digits, 10) : String(item?.tag_number || "").length;
        if (num % 2 === 0) femaleCount += 1;
        else maleCount += 1;
      }
    });
    const parts = [];
    if (maleCount > 0) parts.push(`${maleCount} Male`);
    if (femaleCount > 0) parts.push(`${femaleCount} Female`);
    return parts.length > 0 ? parts.join(", ") : "—";
  };

  const resolveSpeciesSexBreakdown = (target) => {
    if (!target) return [];
    const items = Array.isArray(target.items) && target.items.length > 0 ? target.items : [target];
    const speciesMap = new Map();

    items.forEach((item) => {
      const sp = String(item?.species || target?.species || "Livestock").trim() || "Livestock";
      if (!speciesMap.has(sp)) {
        speciesMap.set(sp, { species: sp, male: 0, female: 0, total: 0 });
      }
      const entry = speciesMap.get(sp);
      entry.total += 1;

      const s = formatSex(item?.sex);
      if (s === "Male") {
        entry.male += 1;
      } else if (s === "Female") {
        entry.female += 1;
      } else {
        const digits = String(item?.tag_number || "").replace(/\D/g, "");
        const num = digits ? parseInt(digits, 10) : String(item?.tag_number || "").length;
        if (num % 2 === 0) entry.female += 1;
        else entry.male += 1;
      }
    });

    return Array.from(speciesMap.values()).map((entry) => {
      const sexParts = [];
      if (entry.male > 0) sexParts.push(`${entry.male} Male`);
      if (entry.female > 0) sexParts.push(`${entry.female} Female`);
      return {
        ...entry,
        sexText: sexParts.join(" and ") || "—",
      };
    });
  };

  const resolveIntakeDateTime = (target) => {
    if (!target) return "—";
    const hasTime = (v) => v && (String(v).includes("T") || String(v).includes(":"));
    if (Array.isArray(target.items) && target.items.length > 0) {
      for (const it of target.items) {
        const candidate = it?.created_at || it?.registered_at || it?.fallback_at || it?.updated_at;
        if (hasTime(candidate)) return formatPhDateTime(candidate);
      }
      if (hasTime(target.rawDate)) return formatPhDateTime(target.rawDate);
      const firstDate = target.items[0]?.received_date || target.items[0]?.created_at || target.rawDate || target.date;
      if (firstDate) return formatPhDateTime(firstDate);
    }
    const singleCandidate = target.created_at || target.registered_at || target.fallback_at || target.updated_at || target.rawDate || target.received_date || target.date;
    return singleCandidate ? formatPhDateTime(singleCandidate) : "—";
  };

  // Active dataset (grouped by default)
  const activeDataset = useMemo(() => {
    return activeTab === "for_marking" ? groupedToMark : groupedMarked;
  }, [activeTab, groupedToMark, groupedMarked]);

  const totalCount = activeDataset.length;
  const paginatedDataset = activeDataset;

  // Helper to accurately resolve the species list for a target batch or animal
  // Accurately extracts distinct species from the actual livestock records in the batch / active queue
  const resolveTargetSpeciesList = (target) => {
    if (!target) return [];

    const speciesSet = new Set();

    // 1. If target is a batch (has items array), accurately extract distinct species directly from its livestock
    if (Array.isArray(target.items) && target.items.length > 0) {
      target.items.forEach((item) => {
        if (item?.species && String(item.species).trim()) {
          speciesSet.add(String(item.species).trim());
        }
      });
    }

    // 2. If target has speciesList array
    if (speciesSet.size === 0 && Array.isArray(target.speciesList) && target.speciesList.length > 0) {
      target.speciesList.forEach((sp) => {
        if (sp && String(sp).trim()) {
          speciesSet.add(String(sp).trim());
        }
      });
    }

    // 3. If target is an individual animal, return its specific species
    if (speciesSet.size === 0 && target.tag_number && target.species) {
      speciesSet.add(String(target.species).trim());
    }

    // 4. Fallback if target directly specifies a species string
    if (speciesSet.size === 0 && target.species && String(target.species).trim()) {
      speciesSet.add(String(target.species).trim());
    }

    // 5. Fallback to active queue (toMark) for this owner if no items directly on target
    if (speciesSet.size === 0) {
      const targetOwnerName = (target.owner_name || "").trim().toLowerCase();
      const targetOwnerId = target.owner_id;
      const matchingActive = (toMark || []).filter((l) => {
        if (!l) return false;
        if (targetOwnerId && l.owner_id === targetOwnerId) return true;
        if (targetOwnerName && targetOwnerName !== "unknown owner" && resolveOwnerName(l).toLowerCase() === targetOwnerName) return true;
        return false;
      });
      matchingActive.forEach((l) => {
        if (l.species && String(l.species).trim()) {
          speciesSet.add(String(l.species).trim());
        }
      });
    }

    const list = Array.from(speciesSet);

    // Standard LSMIS display ordering: Hog, Cattle, Carabao, Goat
    const PREFERRED_ORDER = ["Hog", "Cattle", "Carabao", "Goat"];
    list.sort((a, b) => {
      const idxA = PREFERRED_ORDER.indexOf(a);
      const idxB = PREFERRED_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return list.length > 0 ? list : [target.species || "Livestock"];
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

  const openMarkSingle = (animal) => {
    if (!animal) return;
    const isFallback = animal.status === "Returned to Animal Marking" || Boolean(animal.fallback_at);
    if (isMarked(animal) && !isFallback) {
      showToast("This livestock record has already been officially marked.", "info");
      return;
    }
    const resolvedOwner = resolveOwnerName(animal);
    const resolvedId = resolveOwnerId(animal);
    const enriched = {
      ...animal,
      owner_name: animal.owner_name || (resolvedOwner !== "Unknown Owner" ? resolvedOwner : (selectedOwnerView?.owner_name || "Unknown Owner")),
      owner_id: animal.owner_id || resolvedId || selectedOwnerView?.owner_id,
    };
    setSelectedBatch(null);
    setSelected(enriched);
    setMarkType("Ear Tag");
    if (selectedOwnerKey) {
      setReturnOwnerKey(selectedOwnerKey);
    }
    setSelectedOwnerKey(null);
    setModalOpen(true);
  };

  const openMarkModal = openMarkSingle;

  const openMarkBatch = (group) => {
    setSelected(null);
    setSelectedBatch(group);
    setMarkType("Ear Tag");
    if (selectedOwnerKey) {
      setReturnOwnerKey(selectedOwnerKey);
    }
    setSelectedOwnerKey(null);
    setModalOpen(true);
  };

  const handleCancelMark = () => {
    setModalOpen(false);
    const targetKey =
      returnOwnerKey ||
      (selected
        ? selected.owner_id
          ? `owner_${String(selected.owner_id).toLowerCase().trim()}`
          : `owner_${String(resolveOwnerName(selected)).toLowerCase().trim()}`
        : null);
    setSelected(null);
    setSelectedBatch(null);
    setMarkType("Ear Tag");
    setReturnOwnerKey(null);
    if (targetKey) {
      setSelectedOwnerKey(targetKey);
    }
  };

  const requestConfirmMark = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation?.();
    }
    if (submitting) return;
    if (!selected && !selectedBatch) return;

    setConfirmingMark({
      type: selectedBatch ? "batch" : "single",
      target: selectedBatch || selected,
      markType,
    });
  };

  const executeMark = async () => {
    if (!confirmingMark || submitting) return;
    setSubmitting(true);

    const { type, target, markType: targetMarkType } = confirmingMark;
    const nowIso = new Date().toISOString();
    const markDateStr = nowIso.split("T")[0];

    try {
      if (type === "batch") {
        const items = target.items || [];
        if (items.length === 0) {
          throw new Error("No livestock records in batch to mark.");
        }

        const markedIds = new Set(items.map((i) => i.id).filter(Boolean));
        const markedTags = new Set(items.map((i) => i.tag_number).filter(Boolean));

        // Concurrently mark animals with preloaded animal data to minimize latency
        const results = await Promise.allSettled(
          items.map((item) =>
            staffService.markAnimal(item.id, item.tag_number, targetMarkType, item, { skipNotify: true })
          )
        );

        let successCount = 0;
        const failedTags = [];
        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            successCount++;
          } else {
            console.error(`Error marking item ${items[idx]?.tag_number}:`, res.reason);
            failedTags.push(items[idx]?.tag_number || `#${idx + 1}`);
          }
        });

        if (successCount === 0) {
          const firstErr = results.find((r) => r.status === "rejected")?.reason;
          throw new Error(firstErr?.message || `Failed to mark any livestock in batch.`);
        }

        // Immediately remove marked animals from pending list & update counts
        setData((prevData) =>
          prevData.map((animal) => {
            const isMatch =
              (animal.id && markedIds.has(animal.id)) ||
              (animal.tag_number && markedTags.has(animal.tag_number));
            if (!isMatch) return animal;
            return {
              ...animal,
              marked: true,
              mark_type: targetMarkType,
              mark_date: markDateStr,
              marked_at: nowIso,
              status: "Marked",
              fallback_at: null,
              fallback_reason: null,
            };
          })
        );

        // Clear selection for marked items
        setSelectedLivestockKeys((prev) => {
          const next = new Set(prev);
          items.forEach((i) => next.delete(i.id || i.tag_number));
          return next;
        });

        // Notify other windows/tabs once for the entire batch
        staffService.notifyTableChange();

        showToast(
          `Batch of ${successCount} animal(s) for ${target.owner_name} successfully marked with ${targetMarkType}!`,
          "success"
        );

        setMarkSuccessNotice({
          title: "Livestock Mark Completed",
          message: `Livestock mark completed. Batch of ${successCount} animal(s) for ${target.owner_name} has been marked with ${targetMarkType} and transferred to Ante-Mortem Inspection.`,
        });

        if (failedTags.length > 0) {
          showToast(`Some animals failed to mark: ${failedTags.join(", ")}`, "warning");
        }
      } else {
        // Single animal marking
        await staffService.markAnimal(target.id, target.tag_number, targetMarkType, target);

        // Immediately remove marked animal from pending list
        setData((prevData) =>
          prevData.map((animal) => {
            const isMatch =
              (target.id && animal.id === target.id) ||
              (target.tag_number && animal.tag_number === target.tag_number);
            if (!isMatch) return animal;
            return {
              ...animal,
              marked: true,
              mark_type: targetMarkType,
              mark_date: markDateStr,
              marked_at: nowIso,
              status: "Marked",
              fallback_at: null,
              fallback_reason: null,
            };
          })
        );

        setSelectedLivestockKeys((prev) => {
          const next = new Set(prev);
          next.delete(target.id || target.tag_number);
          return next;
        });

        showToast(
          `Livestock ${target.tag_number} successfully marked with ${targetMarkType}!`,
          "success"
        );

        setMarkSuccessNotice({
          title: "Livestock Mark Completed",
          message: `Livestock mark completed. Record for ${target.tag_number} (${target.species || "Animal"}) has been marked with ${targetMarkType} and transferred to Ante-Mortem Inspection.`,
        });
      }

      setConfirmingMark(null);
      setModalOpen(false);
      setSelected(null);
      setSelectedBatch(null);
      setReturnOwnerKey(null);

      // Optimistically update local dataset so UI responds at 0ms
      if (typeof setData === "function" && target?.tag_number) {
        setData((prev) =>
          prev.map((a) =>
            a.id === target.id || a.tag_number === target.tag_number
              ? {
                  ...a,
                  marked: true,
                  mark_type: targetMarkType,
                  mark_date: new Date().toISOString(),
                }
              : a
          )
        );
      }

      // Background sync without blocking user interaction
      if (typeof refresh === "function") {
        refresh();
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to mark livestock", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (item) => {
    if (!item) return;
    setEditTarget(item);
    setEditForm({
      species: item.species || "Cattle",
      quantity: item.quantity && Number(item.quantity) >= 1 ? Number(item.quantity) : 1,
      sex: item.sex ? (String(item.sex).toLowerCase().startsWith("f") ? "Female" : "Male") : "Male",
      age: item.age_months !== null && item.age_months !== undefined ? String(item.age_months) : "",
      mark_type: item.mark_type || "Ear Tag",
    });
  };

  const handleSaveEdit = async (e) => {
    e?.preventDefault?.();
    if (!editTarget || !editTarget.id) return;
    const cleanAge = (editForm.age || "").trim();
    if (!cleanAge) {
      showToast("Age is required.", "error");
      return;
    }
    const qty = parseInt(editForm.quantity, 10);
    const validQty = isNaN(qty) || qty < 1 ? 1 : qty;
    setSavingEdit(true);
    try {
      const payload = {
        species: editForm.species || "Cattle",
        quantity: 1,
        head_count: 1,
        sex: editForm.sex || "Male",
        age_months: cleanAge,
        mark_type: editTarget.mark_type || editForm.mark_type || "Ear Tag",
      };
      await staffService.updateLivestock(editTarget.id, payload);
      showToast(`Livestock details for ${editTarget.tag_number || "record"} updated successfully.`, "success");
      setEditTarget(null);
      if (selected && selected.id === editTarget.id) {
        setSelected((prev) => ({ ...prev, ...payload }));
      }
      await refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to update livestock details.", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === "batch" || deleteTarget.type === "bulk") {
        const items = deleteTarget.data.items || [];
        for (const item of items) {
          await staffService.deleteLivestock(item.id, false);
        }
        showToast(
          deleteTarget.type === "bulk"
            ? `${items.length} selected livestock records deleted successfully.`
            : `Batch of ${items.length} livestock for ${deleteTarget.data.owner_name} deleted successfully.`,
          "success"
        );
        setSelectedLivestockKeys(new Set());
        if (deleteTarget.type === "batch" && selectedOwnerKey === deleteTarget.data.key) {
          setSelectedOwnerKey(null);
        }
      } else {
        const item = deleteTarget.data;
        await staffService.deleteLivestock(item.id, false);
        showToast(`Livestock ${item.tag_number} deleted successfully.`, "success");
      }
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to delete record.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const exportCSV = () => {
    const listToExport = activeTab === "for_marking" ? filteredToMark : filteredMarked;
    if (!listToExport || listToExport.length === 0) {
      showToast("No records to export", "warning");
      return;
    }
    const headers = "Tag #,Species,Sex,Age,Owner Name,Type of Marking,Date Marked,Time Marked,Status";
    const rows = listToExport.map((a) => {
      const tag = a.tag_number || "—";
      const species = a.species || "—";
      const sex = formatSex(a.sex);
      const age = a.age_months ? a.age_months : "—";
      const owner = a.owner_name ? a.owner_name.replace(/"/g, '""') : "—";
      const mark = a.mark_type || (isMarked(a) ? "Ear Tag" : "Unmarked");
      const date = a.mark_date ? formatDate(a.mark_date) : formatDate(a.received_date || today());
      const time = a.mark_time ? a.mark_time : "—";
      const status = isMarked(a) ? "Marked" : "For Marking";
      return `"${tag}","${species}","${sex}","${age}","${owner}","${mark}","${date}","${time}","${status}"`;
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `animal_marking_${activeTab}_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Animal marking records exported successfully!", "success");
  };

  return (
    <div className="animal-marking-page" style={{ width: "100%", padding: 0, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* 3. Main Record List Table Container */}
      <div style={{ background: "var(--color-surface)", borderRadius: 12, overflow: "hidden", border: "none", boxShadow: "none", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Search & Filter Toolbar */}
        <div
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 14,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            minHeight: 54,
            boxSizing: "border-box",
          }}
        >
          {/* Left: Swapped Navigation Tabs */}
          {navTabs ? (
            navTabs
          ) : (
            <div />
          )}

          {/* Right: Search Box transferred beside Filter & Sort Selectors */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* Search Box */}
            <div
              style={{
                width: 250,
                maxWidth: "100%",
                position: "relative",
                display: "flex",
                alignItems: "center",
                background: "var(--color-bg)",
                border: `1px solid ${searchFocused ? "var(--color-primary, #10b981)" : "var(--color-border)"}`,
                borderRadius: 8,
                boxShadow: searchFocused ? "0 0 0 3px rgba(16, 185, 129, 0.14)" : "none",
                transition: "all 0.2s ease",
                height: 34,
              }}
            >
              <Icon.Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  color: searchFocused ? "var(--color-primary, #10b981)" : "var(--color-text-muted)",
                  pointerEvents: "none",
                  transition: "color 0.2s ease",
                  zIndex: 10,
                }}
              />
              <input
                type="text"
                placeholder={
                  activeTab === "for_marking"
                    ? "Search waiting livestock..."
                    : "Search marked records..."
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: "100%",
                  height: "100%",
                  paddingLeft: 36,
                  paddingRight: search ? 32 : 12,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--color-text)",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    background: "var(--color-border)",
                    border: "none",
                    borderRadius: "50%",
                    width: 18,
                    height: 18,
                    color: "var(--color-text)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    transition: "opacity 0.15s ease",
                  }}
                  title="Clear search"
                >
                  <Icon.X size={12} />
                </button>
              )}
            </div>

            {/* Status / Tab Select Dropdown */}
            <select
              value={activeTab}
              onChange={(e) => {
                setActiveTab(e.target.value);
                setPage(1);
              }}
              style={{
                height: 34,
                padding: "0 10px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                cursor: "pointer",
                outline: "none",
                maxWidth: 170,
              }}
            >
              <option value="for_marking">🏷️ For Marking ({toMark.length})</option>
              <option value="marked">✅ Marked ({markedAnimals.length})</option>
            </select>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                height: 34,
                padding: "0 10px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                cursor: "pointer",
                outline: "none",
                width: 130,
              }}
            >
              <option value="tag_asc">Tag (A → Z)</option>
              <option value="tag_desc">Tag (Z → A)</option>
              <option value="owner">Owner Name</option>
              <option value="newest">Newest First</option>
            </select>
          </div>
        </div>

        {/* 24-Hour Timeout Warning Alert Banner */}
        {activeTab === "for_marking" && toMark.some((i) => i.status === "Returned to Animal Marking" || i.fallback_at) && (
          <div
            style={{
              margin: "14px 18px 0",
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(245, 158, 11, 0.12)",
              border: "1.5px solid rgba(245, 158, 11, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon.AlertTriangle size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 800, color: "#b45309", fontSize: 13.5 }}>
                  24-Hour Timeout Alert: {toMark.filter((i) => i.status === "Returned to Animal Marking" || i.fallback_at).length} Livestock Returned to Animal Marking
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
                  These animals were marked but did not enter slaughter processing within 24 hours. They have been returned to this queue and require re-marking.
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#92400e",
              }}
            >
              Action Required: Re-Mark
            </span>
          </div>
        )}

        {/* 5. Main Table Records List */}
        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)" }}>
            Loading animal marking records...
          </div>
        ) : activeDataset.length === 0 ? (
          <EmptyState
            title={
              activeTab === "for_marking"
                ? search
                  ? `No livestock for marking match "${search}"`
                  : "No livestock waiting to be marked"
                : search
                ? `No marked livestock match "${search}"`
                : "No marked livestock records found"
            }
            message={
              activeTab === "for_marking"
                ? "All received livestock have been officially marked."
                : "Animals will appear here once officially marked."
            }
            icon={activeTab === "for_marking" ? <Icon.Tag size={36} /> : <Icon.CheckCircle size={36} />}
          />
        ) : (
          /* ================= MAIN OWNER LIST TABLE (MATCHES CONDEMNATION PATTERN) ================= */
          <div
            className="records-scrollable-content table-wrap"
            style={{
              overflowX: "auto",
              overflowY: "auto",
              scrollbarWidth: "thin",
              flex: 1,
              minHeight: 0,
            }}
          >
            <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Owner Name</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>{activeTab === "for_marking" ? "Registration Date" : "Date Marked"}</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>Total Heads</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDataset.map((grp) => {
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
                      {/* Owner Name */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
                            {grp.avatar_url ? (
                              <img
                                src={grp.avatar_url}
                                alt={grp.owner_name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  if (e.currentTarget.nextSibling) {
                                    e.currentTarget.nextSibling.style.display = "flex";
                                  }
                                }}
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: "50%",
                                  objectFit: "cover",
                                  flexShrink: 0,
                                  border: "1px solid var(--color-border)",
                                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                                }}
                              />
                            ) : null}
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                                color: "#ffffff",
                                display: grp.avatar_url ? "none" : "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                fontSize: 12,
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                              {grp.owner_name}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                              {grp.count} {grp.count === 1 ? "head" : "heads"} {activeTab === "for_marking" ? "registered" : "marked"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.7, color: "#10b981" }} />
                          <span>{grp.rawDate || grp.date ? formatPhDateTime(grp.rawDate || grp.date) : "Undated Intake"}</span>
                        </div>
                      </td>

                      {/* Species */}
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          {formatSpeciesList(grp.speciesList && grp.speciesList.length > 0 ? grp.speciesList : [grp.species])}
                        </span>
                      </td>

                      {/* Total Heads */}
                      <td style={{ padding: "14px 18px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#059669",
                          }}
                        >
                          {grp.count} head{grp.count > 1 ? "s" : ""}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "14px 18px" }}>
                        {activeTab === "for_marking" ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: grp.hasFallback ? "#b45309" : "#d97706",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {grp.hasFallback ? (
                              <>
                                <Icon.AlertTriangle size={14} /> Returned ({grp.items.filter((i) => i.status === "Returned to Animal Marking" || i.fallback_at).length})
                              </>
                            ) : (
                              <>
                                <Icon.Clock size={14} /> For Marking
                              </>
                            )}
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: "#059669",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon.CheckCircle size={14} /> Marked ({grp.count})
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e?.stopPropagation?.();
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
                          {activeTab === "for_marking" && (
                            <>
                              <Button
                                size="sm"
                                className={grp.hasFallback ? "btn-warning" : "btn-primary"}
                                onClick={(e) => {
                                  e?.stopPropagation?.();
                                  openMarkBatch(grp);
                                }}
                                style={{
                                  padding: "6px 14px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  background: grp.hasFallback ? "#f59e0b" : undefined,
                                  borderColor: grp.hasFallback ? "#d97706" : undefined,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <Icon.Tag size={13} /> {grp.hasFallback ? "Re-Mark Batch" : "Mark Batch"}
                              </Button>
                            </>
                          )}
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

            {/* Standardized Dedicated Owner Records Modal */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => setSelectedOwnerKey(null)}
        title={
          activeTab === "for_marking"
            ? `For Official Animal Marking — ${selectedOwnerView?.owner_name || ""}`
            : `Marked Livestock Records — ${selectedOwnerView?.owner_name || ""}`
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {selectedOwnerView?.items?.length || 0} head{selectedOwnerView?.items?.length === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {activeTab === "for_marking" && selectedOwnerView && selectedOwnerView.items.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = selectedOwnerView;
                    setSelectedOwnerKey(null);
                    openMarkBatch(target);
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
                  <Icon.Tag size={14} /> {selectedOwnerView.hasFallback ? "Re-Mark All Animals" : "Mark All Animals"}
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
            <div
              style={{
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "55vh",
                border: "none",
                boxShadow: "none",
                scrollbarWidth: "thin",
              }}
            >
              <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Age</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>{activeTab === "for_marking" ? "Registration Date" : "Marked Date"}</th>
                    {activeTab === "marked" && (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Type of Marking</th>
                    )}
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                    {activeTab === "for_marking" && (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginatedOwnerItems.map((item) => {
                    const isFallback = Boolean(item.is_fallback);
                    return (
                      <tr
                        key={item.id || item.tag_number}
                        onClick={() => {
                          if (activeTab === "for_marking") {
                            openMarkSingle(item);
                          }
                        }}
                        style={{
                          borderBottom: "1px solid var(--color-border)",
                          cursor: activeTab === "for_marking" ? "pointer" : "default",
                          transition: "background 120ms ease",
                        }}
                        onMouseEnter={(e) => {
                          if (activeTab === "for_marking") e.currentTarget.style.background = "var(--color-bg)";
                        }}
                        onMouseLeave={(e) => {
                          if (activeTab === "for_marking") e.currentTarget.style.background = "transparent";
                        }}
                      >
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
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{item.species}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{formatSex(item.sex)}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>{item.age_months ? `${item.age_months} mos` : "—"}</td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text)" }}>
                          {formatPhDateTime(item.mark_date || item.created_at || item.registered_at)}
                        </td>
                        {activeTab === "marked" && (
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: item.mark_type === "Tattoo" ? "rgba(99, 102, 241, 0.1)" : "rgba(16, 185, 129, 0.1)",
                                color: item.mark_type === "Tattoo" ? "#6366f1" : "#10b981",
                                border: `1px solid ${item.mark_type === "Tattoo" ? "rgba(99, 102, 241, 0.25)" : "rgba(16, 185, 129, 0.25)"}`,
                              }}
                            >
                              <Icon.Tag size={12} />
                              {item.mark_type || "Ear Tag"}
                            </span>
                          </td>
                        )}
                        <td style={{ padding: "12px 14px" }}>
                          {activeTab === "marked" ? (
                            <Badge status="Marked" />
                          ) : isFallback ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "rgba(245, 158, 11, 0.14)", padding: "2px 6px", borderRadius: 4 }}>
                              Fallback Needed
                            </span>
                          ) : (
                            <Badge status={item.status || "Pending"} />
                          )}
                        </td>
                        {activeTab === "for_marking" && (
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                              {/* 1. Mark Animal Icon Button */}
                              <button
                                type="button"
                                title={isFallback ? "Re-Mark Animal" : "Mark Animal"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMarkSingle(item);
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 7,
                                  border: "none",
                                  background: isFallback
                                    ? "linear-gradient(135deg, #f59e0b, #d97706)"
                                    : "linear-gradient(135deg, #0284c7, #0369a1)",
                                  color: "#ffffff",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  boxShadow: isFallback
                                    ? "0 2px 5px rgba(217, 119, 6, 0.25)"
                                    : "0 2px 5px rgba(2, 132, 199, 0.25)",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon.Tag size={14} />
                              </button>

                              {/* 2. Edit Details Icon Button */}
                              <button
                                type="button"
                                title={`Edit details for ${item.tag_number}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal({
                                    ...item,
                                    owner_name: item.owner_name || selectedOwnerView?.owner_name || resolveOwnerName(item),
                                    owner_id: item.owner_id || selectedOwnerView?.owner_id || resolveOwnerId(item),
                                  });
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 7,
                                  border: "1px solid var(--color-border)",
                                  background: "var(--color-surface)",
                                  color: "var(--color-text)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon.Edit size={14} />
                              </button>

                              {/* 3. Delete Record Icon Button */}
                              <button
                                type="button"
                                title={`Delete livestock ${item.tag_number}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({
                                    type: "single",
                                    data: {
                                      ...item,
                                      owner_name: item.owner_name || selectedOwnerView?.owner_name || resolveOwnerName(item),
                                      owner_id: item.owner_id || selectedOwnerView?.owner_id || resolveOwnerId(item),
                                    },
                                  });
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 7,
                                  border: "none",
                                  background: "rgba(239, 68, 68, 0.08)",
                                  color: "#ef4444",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon.Trash size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

{/* 6. Mark Livestock Action Modal */}
      <Modal
        open={modalOpen}
        onClose={handleCancelMark}
        title={
          selectedBatch
            ? `Mark Batch — ${selectedBatch.owner_name} (${selectedBatch.count} Heads)`
            : selected
            ? `Mark Livestock — ${selected.tag_number}`
            : "Mark Livestock"
        }
      >
        {(selected || selectedBatch) && (
          <form onSubmit={requestConfirmMark} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Livestock Particulars Header Card */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "16px 18px",
                background: "var(--color-bg)",
                borderRadius: 14,
                border: "1.5px solid rgba(16, 185, 129, 0.3)",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 16,
                      boxShadow: "0 4px 10px rgba(5, 150, 105, 0.25)",
                      flexShrink: 0,
                    }}
                  >
                    {initials(selectedBatch ? selectedBatch.owner_name : selected.owner_name || "Owner")}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#10b981",
                      }}
                    >
                      {selectedBatch ? `Target Batch (${selectedBatch.count} Heads)` : "Target Livestock Record"}
                    </div>
                    {selectedBatch ? (
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text)", marginTop: 2 }}>
                        {selectedBatch.owner_name}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                        <TagBadge tag={selected.tag_number} />
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text)" }}>
                          {selected.owner_name || "Unknown Owner"}
                        </span>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 3 }}>
                      Intake Date &amp; Time:{" "}
                      <strong style={{ color: "var(--color-text)" }}>
                        {resolveIntakeDateTime(selectedBatch || selected)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    fontWeight: 700,
                    flexShrink: 0,
                    marginTop: 2,
                    color:
                      selected?.status === "Returned to Animal Marking" ||
                      selected?.fallback_at ||
                      selectedBatch?.hasFallback
                        ? "#b45309"
                        : "#d97706",
                  }}
                >
                  {selected?.status === "Returned to Animal Marking" ||
                  selected?.fallback_at ||
                  selectedBatch?.hasFallback ? (
                    <>
                      <Icon.AlertTriangle size={14} /> Returned to Animal Marking
                    </>
                  ) : (
                    <>
                      <Icon.Clock size={14} /> For Marking
                    </>
                  )}
                </div>
              </div>

              {/* Per-Species Male & Female Breakdown */}
              <div
                style={{
                  paddingTop: 10,
                  borderTop: "1px solid rgba(16, 185, 129, 0.2)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px 14px",
                  fontSize: 12.5,
                  color: "var(--color-text-muted)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Species &amp; Sex:
                </span>
                {resolveSpeciesSexBreakdown(selectedBatch || selected).map((spItem, idx, arr) => (
                  <span
                    key={spItem.species}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      color: "var(--color-text)",
                    }}
                  >
                    <strong style={{ fontWeight: 700, color: "var(--color-text)" }}>{spItem.species}:</strong>
                    <span style={{ fontWeight: 600, color: "#10b981" }}>{spItem.sexText}</span>
                    {idx < arr.length - 1 && (
                      <span style={{ color: "var(--color-text-muted)", marginLeft: 8 }}>·</span>
                    )}
                  </span>
                ))}
                {selected && !selectedBatch && (selected.age_months || selected.breed || selected.remarks) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px 14px",
                      width: "100%",
                      paddingTop: 6,
                      marginTop: 2,
                      borderTop: "1px dashed rgba(16, 185, 129, 0.2)",
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {selected.age_months && (
                      <span>
                        Age: <strong style={{ color: "var(--color-text)" }}>{selected.age_months} {String(selected.age_months).toLowerCase().includes("month") || String(selected.age_months).toLowerCase().includes("year") || String(selected.age_months).toLowerCase().includes("age") ? "" : "mos"}</strong>
                      </span>
                    )}
                    {selected.breed && (
                      <span>
                        Breed: <strong style={{ color: "var(--color-text)" }}>{selected.breed}</strong>
                      </span>
                    )}
                    {selected.remarks && (
                      <span>
                        Remarks: <strong style={{ color: "var(--color-text)" }}>{selected.remarks}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Type of Marking Options Grid */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label className="form-label" style={{ fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                  Select Type of Marking <span className="req">*</span>
                </label>
                <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
                  Official identification method
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                {MARK_TYPES.map((m) => {
                  const isSelected = markType === m.id;
                  const IconComp = Icon[m.iconName] || Icon.Tag;

                  return (
                    <div
                      key={m.id}
                      onClick={() => setMarkType(m.id)}
                      style={{
                        padding: "14px 16px",
                        borderRadius: 12,
                        border: isSelected ? `2px solid ${m.color}` : "1.5px solid var(--color-border)",
                        background: isSelected ? m.bg : "var(--color-surface)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "all 140ms ease",
                        boxShadow: isSelected ? `0 4px 12px ${m.color}22` : "none"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: m.bg,
                            border: `1px solid ${m.border}`,
                            color: m.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0
                          }}
                        >
                          <IconComp size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--color-text)" }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                            {m.desc}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          border: isSelected ? `2px solid ${m.color}` : "2px solid var(--color-border)",
                          background: isSelected ? m.color : "var(--color-bg)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          marginLeft: 8,
                          transition: "all 140ms ease"
                        }}
                      >
                        {isSelected && <Icon.Check size={12} style={{ color: "#ffffff" }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 4,
                paddingTop: 14,
                borderTop: "1px solid var(--color-border)"
              }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelMark}
                style={{ padding: "9px 18px", borderRadius: 8, fontWeight: 600 }}
              >
                Cancel
              </Button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "10px 24px",
                    borderRadius: 8,
                    fontSize: 13.5,
                    fontWeight: 700,
                    background: submitting ? "var(--color-border)" : "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                    color: "#ffffff",
                    border: "none",
                    cursor: submitting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 6px rgba(5, 150, 105, 0.25)",
                    transition: "all 140ms ease"
                  }}
                >
                  {submitting ? (
                    <>
                      <span className="spinner" style={{ width: 14, height: 14 }} /> Processing...
                    </>
                  ) : (
                    <>
                      <Icon.Tag size={16} /> Mark Livestock
                    </>
                  )}
                </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Animal Marking Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmingMark)}
        onCancel={() => {
          if (!submitting) setConfirmingMark(null);
        }}
        onConfirm={executeMark}
        title="Confirm Animal Marking"
        message={
          confirmingMark ? (
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
                {confirmingMark.type === "batch"
                  ? `Do you want to mark this batch of ${confirmingMark.target?.count} livestock?`
                  : "Do you want to mark this livestock?"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                {(() => {
                  const speciesDisplay =
                    resolveTargetSpeciesList(confirmingMark.target).join(", ") ||
                    confirmingMark.target?.species ||
                    "—";
                  return confirmingMark.type === "batch" ? (
                    <>
                      Owner: <strong style={{ color: "var(--color-text)" }}>{confirmingMark.target?.owner_name}</strong> · Species: <strong style={{ color: "var(--color-text)" }}>{speciesDisplay}</strong> · Method: <strong style={{ color: "var(--color-primary, #10b981)" }}>{confirmingMark.markType}</strong>
                    </>
                  ) : (
                    <>
                      Tag: <strong style={{ color: "var(--color-text)" }}>{confirmingMark.target?.tag_number}</strong> · Owner: <strong style={{ color: "var(--color-text)" }}>{confirmingMark.target?.owner_name || "Unknown"}</strong> · Species: <strong style={{ color: "var(--color-text)" }}>{speciesDisplay}</strong> · Method: <strong style={{ color: "var(--color-primary, #10b981)" }}>{confirmingMark.markType}</strong>
                    </>
                  );
                })()}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 8 }}>
                This will record official marking and transfer the livestock to <strong>Ante-Mortem Inspection</strong>.
              </div>
            </div>
          ) : ""
        }
        confirmText={
          confirmingMark?.type === "batch"
            ? "Yes, Mark Batch"
            : "Yes, Mark Livestock"
        }
        confirmVariant="success"
        loading={submitting}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={
          deleteTarget?.type === "bulk"
            ? `Delete ${deleteTarget?.data?.count || deleteTarget?.data?.items?.length || 0} Selected Animals?`
            : deleteTarget?.type === "batch"
            ? `Delete Batch (${deleteTarget?.data?.owner_name || "Livestock"})?`
            : `Delete Livestock ${deleteTarget?.data?.tag_number}?`
        }
        message={(() => {
          if (deleteTarget?.type === "bulk") {
            return `Are you sure you want to permanently delete the ${deleteTarget?.data?.items?.length || 0} selected livestock records? This action cannot be undone.`;
          }
          const speciesDisplay =
            resolveTargetSpeciesList(deleteTarget?.data).join(", ") ||
            deleteTarget?.data?.species ||
            "livestock";
          return deleteTarget?.type === "batch"
            ? `Are you sure you want to delete this batch of ${deleteTarget?.data?.count} heads (${speciesDisplay}) for ${deleteTarget?.data?.owner_name}? This will remove the animal records from the system.`
            : `Are you sure you want to delete livestock ${deleteTarget?.data?.tag_number} (${speciesDisplay}) for ${deleteTarget?.data?.owner_name}? This action cannot be undone.`;
        })()}
        confirmText="Delete Record"
        confirmVariant="danger"
        loading={deleting}
      />

      {/* Edit Livestock Details Modal */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => {
          if (!savingEdit) setEditTarget(null);
        }}
        title={`Edit Livestock Details — ${editTarget?.tag_number || "Record"}`}
        size="md"
        dialogStyle={{ maxWidth: "560px" }}
        bodyStyle={{ padding: "18px 22px" }}
      >
        {editTarget && (
          <form onSubmit={handleSaveEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Quick Context Banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                background: "var(--color-bg)",
                borderRadius: 9,
                border: "1px solid var(--color-border)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  className="mono font-semibold"
                  style={{
                    fontSize: "0.82rem",
                    color: "#047857",
                    background: "#ecfdf5",
                    padding: "3px 9px",
                    borderRadius: "6px",
                    border: "1px solid #a7f3d0",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.02em",
                  }}
                >
                  {editTarget.tag_number}
                </span>
                <div style={{ fontSize: "0.82rem", color: "var(--color-text)", fontWeight: 600 }}>
                  Owner: <span style={{ color: "var(--color-primary-dark, #059669)", fontWeight: 700 }}>{resolveOwnerName(editTarget)}</span>
                </div>
              </div>
              <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                <Icon.Calendar size={13} style={{ flexShrink: 0 }} />
                <span>Intake: {resolveDateStr(editTarget) || "Recorded"}</span>
              </div>
            </div>

            {/* Symmetrical 2-Column Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
              {/* 1. Animal Species (Name only) */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--color-text)", display: "block" }}>
                  Animal Species <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <select
                    className="form-control"
                    value={editForm.species}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, species: e.target.value }))}
                    style={{
                      width: "100%",
                      height: 38,
                      padding: "0 28px 0 10px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      fontSize: 13,
                      fontWeight: 600,
                      outline: "none",
                      cursor: "pointer",
                      appearance: "none",
                    }}
                  >
                    {activeSpeciesList.map((s) => (
                      <option key={s.id || s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--color-text-muted)", fontSize: 10 }}>▼</span>
                </div>
              </div>

              {/* 2. Quantity (Fixed to 1) */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--color-text)", display: "block" }}>
                  Quantity
                </label>
                <div
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    userSelect: "none",
                  }}
                  title="Tag represents an individual animal (fixed to 1 Head)"
                >
                  <span>1 Head</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text-muted)",
                      background: "var(--color-surface)",
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    Fixed
                  </span>
                </div>
              </div>

              {/* 3. Sex */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--color-text)", display: "block" }}>
                  Sex <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, height: 38 }}>
                  {[
                    { id: "Male", label: "Male ♂", activeColor: "#0284c7", activeBg: "rgba(2, 132, 199, 0.1)", activeBorder: "#38bdf8" },
                    { id: "Female", label: "Female ♀", activeColor: "#e11d48", activeBg: "rgba(225, 29, 72, 0.1)", activeBorder: "#fb7185" },
                  ].map((s) => {
                    const isSel = editForm.sex === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, sex: s.id }))}
                        style={{
                          height: "100%",
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 700,
                          border: isSel ? `1.5px solid ${s.activeBorder}` : "1px solid var(--color-border)",
                          background: isSel ? s.activeBg : "var(--color-bg)",
                          color: isSel ? s.activeColor : "var(--color-text)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Age */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--color-text)", display: "block" }}>
                  Age <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  list="edit-animal-age-presets"
                  value={editForm.age}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, age: e.target.value }))}
                  placeholder="e.g. 1 year and 9 months"
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "0 10px",
                    outline: "none",
                  }}
                />
                <datalist id="edit-animal-age-presets">
                  <option value="6 months" />
                  <option value="8 months" />
                  <option value="1 year" />
                  <option value="1 year and 6 months" />
                  <option value="2 years" />
                  <option value="2 years and 6 months" />
                  <option value="3 years" />
                </datalist>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 4,
                paddingTop: 12,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
                disabled={savingEdit}
                style={{ height: 36, padding: "0 16px", fontSize: 13, fontWeight: 600 }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="btn-primary"
                loading={savingEdit}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 36,
                  padding: "0 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                  borderColor: "#059669",
                }}
              >
                <Icon.Check size={14} /> Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>
      {/* Marking Completed Notification Modal */}
      <AlertDialog
        open={Boolean(markSuccessNotice)}
        onClose={() => setMarkSuccessNotice(null)}
        title={markSuccessNotice?.title || "Livestock Mark Completed"}
        message={markSuccessNotice?.message || "Livestock mark completed."}
        buttonText="OK"
        variant="success"
      />
    </div>
  );
};

export default AnimalMarking;
