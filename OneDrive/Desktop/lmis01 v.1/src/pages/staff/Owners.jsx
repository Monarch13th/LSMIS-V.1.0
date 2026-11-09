import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Modal, EmptyState, AlertDialog } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { staffService } from "../../services/staffService";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate, initials, formatSex } from "../../utils/helpers";
import { formatOwnerId } from "../admin/OwnerManagement";
import { MultiLivestockForm } from "../../components/forms/MultiLivestockForm";
import { AnimalMarking } from "./AnimalMarking";

import { useSupabase } from "../../hooks/useSupabase";


const generateNextTagForSpecies = (rows, species) => {
  if (!species) return "";
  const targetSpecies = String(species).trim().toUpperCase();
  const speciesRows = (rows || []).filter((r) => {
    const rSpecies = String(r.species || "").trim().toUpperCase();
    const tagUpper = String(r.tag_number || "").trim().toUpperCase();
    return rSpecies === targetSpecies || tagUpper.endsWith(`-${targetSpecies}`);
  });

  const nums = speciesRows
    .map((r) => {
      const tagStr = String(r.tag_number || "");
      const m = tagStr.match(/TAG-(?:(\d+)-(?:[A-Z]+|\d{4})|(?:[A-Z]+|\d{4})-(\d+)|(\d+))/i) 
             || tagStr.match(/(\d+)/);
      return m ? parseInt(m[1] || m[2] || m[3] || m[0], 10) : 0;
    })
    .filter((n) => !isNaN(n));

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `TAG-${String(next).padStart(3, "0")}-${targetSpecies}`;
};

export const getLivestockStatusStyle = (status) => {
  const s = String(status || "").toLowerCase();
  if (s.includes("condemn") || s.includes("reject") || s.includes("discard")) {
    return {
      background: "rgba(239, 68, 68, 0.12)",
      color: "#dc2626",
      border: "1px solid rgba(239, 68, 68, 0.3)",
    };
  }
  if (s.includes("weighed") || s.includes("permit issued") || s.includes("completed") || s.includes("dispatch") || s.includes("passed")) {
    return {
      background: "rgba(16, 185, 129, 0.12)",
      color: "#16a34a",
      border: "1px solid rgba(16, 185, 129, 0.3)",
    };
  }
  if (s.includes("inspection") || s.includes("processing") || s.includes("ante-mortem") || s.includes("post-mortem") || s.includes("slaughter")) {
    return {
      background: "rgba(59, 130, 246, 0.12)",
      color: "#2563eb",
      border: "1px solid rgba(59, 130, 246, 0.3)",
    };
  }
  return {
    background: "rgba(245, 158, 11, 0.12)",
    color: "#d97706",
    border: "1px solid rgba(245, 158, 11, 0.3)",
  };
};

export const Owners = ({ initialTab = "owners" }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  
  const [activeTab, setActiveTab] = useState(() => {
    if (urlTab && ["owners", "marking"].includes(urlTab)) return urlTab;
    return initialTab && initialTab !== "receiving" ? initialTab : "owners";
  });

  useEffect(() => {
    if (urlTab && ["owners", "marking"].includes(urlTab)) {
      setActiveTab(urlTab);
    } else if (initialTab && initialTab !== "receiving") {
      setActiveTab(initialTab);
    }
  }, [urlTab, initialTab]);

  const handleTabSwitch = (tabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId }, { replace: true });
  };
  const { showToast } = useToast();
  
  const { data: data = [], loading: loadingOwners, refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  const { data: dbUsers = [] } = useSupabase(TABLES.USERS);
  const { data: livestock = [], loading: loadingLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: anteRecords = [], refresh: refreshAnte } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: condemnedRecords = [], refresh: refreshCondemned } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: processingRecords = [], refresh: refreshProcessing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: slaughterRecords = [], refresh: refreshSlaughter } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: carcassRecords = [], refresh: refreshCarcass } = useSupabase(TABLES.CARCASS);

  const [allKnownRows, setAllKnownRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const knownTags = new Set((livestock || []).map((x) => x.tag_number));
    const extraRows = [...carcassRecords, ...anteRecords, ...slaughterRecords, ...processingRecords]
      .filter((x) => x?.tag_number && !knownTags.has(x.tag_number))
      .map((x) => ({ tag_number: x.tag_number }));
    setAllKnownRows([...(livestock || []), ...extraRows]);
  }, [livestock, carcassRecords, anteRecords, slaughterRecords, processingRecords]);

  // Search, Filters & Sorting
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all"); // "all" | "with_animals" | "no_animals"
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "Approved" | "Pending"
  const [sortBy, setSortBy] = useState("recent"); // "recent" | "name" | "animals"
  const [copiedId, setCopiedId] = useState(null);

  // Modals & Banners
  const [detailModalOwner, setDetailModalOwner] = useState(null);
  const [intakeModalOwner, setIntakeModalOwner] = useState(null);
  const [registrationSuccessDialog, setRegistrationSuccessDialog] = useState(null);
  const [showBanner, setShowBanner] = useState(() => {
    try {
      return localStorage.getItem("lmis_staff_owners_banner_dismissed") !== "true";
    } catch {
      return true;
    }
  });

  const dismissBanner = () => {
    setShowBanner(false);
    try {
      localStorage.setItem("lmis_staff_owners_banner_dismissed", "true");
    } catch {}
  };

  const resolveOwnerAvatar = useCallback(
    (owner) => {
      if (!owner) return null;
      if (owner.avatar_url) return owner.avatar_url;
      const targetId = owner.id || owner.owner_id || owner.temp_reg_id;
      const cleanEmail = (owner.email || "").toLowerCase().trim();
      const match = (dbUsers || []).find(
        (u) =>
          (targetId && (u.id === targetId || u.owner_id === targetId)) ||
          (cleanEmail && (u.email || "").toLowerCase().trim() === cleanEmail)
      );
      return match?.avatar_url || null;
    },
    [dbUsers]
  );

  const refresh = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    refreshOwners();
    refreshLivestock();
    if (isManual) {
      setTimeout(() => {
        setRefreshing(false);
        showToast("Owner records refreshed", "success");
      }, 300);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const getOwnerAnimals = (o) => {
    if (!o) return [];

    // Rejected owners cannot have active registered intake livestock
    const status = (o.status || "").toLowerCase().trim();
    if (status === "rejected") return [];

    const ownerIdStr = String(o.id || "").toLowerCase().trim();
    const ownerAltIdStr = String(o.owner_id || o.temp_reg_id || "").toLowerCase().trim();
    const formattedId = formatOwnerId(o).toLowerCase().trim();
    const ownerNameStr = String(o.name || "").toLowerCase().trim();

    return livestock.filter((l) => {
      const lOwnerId = String(l.owner_id || "").toLowerCase().trim();
      const lOwnerName = String(l.owner_name || "").toLowerCase().trim();

      // If livestock has an explicit owner_id set, match strictly against owner IDs
      if (lOwnerId) {
        return (
          lOwnerId === ownerIdStr ||
          (ownerAltIdStr && lOwnerId === ownerAltIdStr) ||
          (formattedId && lOwnerId === formattedId)
        );
      }

      // Fallback only if livestock has NO owner_id set, match by owner_name
      return Boolean(lOwnerName && ownerNameStr && lOwnerName === ownerNameStr);
    });
  };

  const getOwnerAnimalsCount = (o) => {
    return getOwnerAnimals(o).reduce((sum, curr) => sum + (Number(curr.quantity) || 1), 0);
  };

  // Filter & Search Logic
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cleanQ = q.replace(/\s+/g, "");

    const matches = data.filter((o) => {
      const name = (o.name || "").toLowerCase();
      const rawId = (o.id || "").toLowerCase();
      const displayId = formatOwnerId(o).toLowerCase();
      const contact = (o.contact || "").toLowerCase().replace(/\s+/g, "");
      const address = (o.address || "").toLowerCase();
      const email = (o.email || "").toLowerCase();
      const ownerAnimals = getOwnerAnimals(o);
      const hasMatchingAnimal = ownerAnimals.some((l) =>
        (l.tag_number || "").toLowerCase().includes(q) ||
        (l.species || "").toLowerCase().includes(q) ||
        (l.breed || "").toLowerCase().includes(q)
      );

      const matchesSearch =
        !q ||
        name.includes(q) ||
        rawId.includes(q) ||
        displayId.includes(q) ||
        contact.includes(cleanQ) ||
        address.includes(q) ||
        email.includes(q) ||
        hasMatchingAnimal;

      if (!matchesSearch) return false;

      const count = getOwnerAnimalsCount(o);
      if (filterType === "with_animals" && count === 0) return false;
      if (filterType === "no_animals" && count > 0) return false;

      const status = o.status || "Approved";
      if (statusFilter !== "all") {
        if (statusFilter === "Approved" && status !== "Approved") return false;
        if (statusFilter === "Pending" && status === "Approved") return false;
      }

      return true;
    });

    // Helper to extract timestamp (created_at or registered_date)
    const getOwnerTimestamp = (o) => {
      if (!o) return 0;
      const regTime = o.registered_date ? new Date(o.registered_date).getTime() : NaN;
      const createTime = o.created_at ? new Date(o.created_at).getTime() : NaN;

      const hasReg = !isNaN(regTime) && regTime > 0;
      const hasCreate = !isNaN(createTime) && createTime > 0;

      if (hasReg && hasCreate) {
        const regDateStr = new Date(regTime).toISOString().slice(0, 10);
        const createDateStr = new Date(createTime).toISOString().slice(0, 10);
        // If created_at is on that same registered date, use created_at for precise time-of-day
        if (regDateStr === createDateStr) {
          return createTime;
        }
        return regTime;
      }
      if (hasCreate) return createTime;
      if (hasReg) return regTime;
      return 0;
    };

    // Sort results
    return [...matches].sort((a, b) => {
      if (sortBy === "animals") {
        const diff = getOwnerAnimalsCount(b) - getOwnerAnimalsCount(a);
        if (diff !== 0) return diff;
        return getOwnerTimestamp(b) - getOwnerTimestamp(a);
      }
      if (sortBy === "name") {
        return (a.name || "").localeCompare(b.name || "");
      }
      // Default: "recent" (Newest registered owners at the top)
      const ta = getOwnerTimestamp(a);
      const tb = getOwnerTimestamp(b);
      if (tb !== ta) return tb - ta;
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (cb !== ca) return cb - ca;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }, [data, livestock, search, filterType, statusFilter, sortBy]);

  // Statistics
  const totalAnimals = data.reduce((s, o) => s + getOwnerAnimalsCount(o), 0);
  const ownersWithAnimalsCount = data.filter((o) => getOwnerAnimalsCount(o) > 0).length;
  const approvedOwnersCount = data.filter((o) => !o.status || o.status === "Approved").length;

  const markedAnimalsCount = useMemo(() => {
    return (livestock || []).filter(
      (l) => l.marked === true || l.marked === "true" || l.marked === 1 || Boolean(l.mark_type) || Boolean(l.mark_date)
    ).length;
  }, [livestock]);

  // Exact Animal Marking count: Only livestock ready for Animal Marking (Unmarked registered animals, not condemned, not downstream)
  const awaitingMarkingCount = useMemo(() => {
    const anteRejectedSet = new Set();
    (anteRecords || []).forEach((am) => {
      const tag = String(am.tag_number || "").trim().toLowerCase();
      const lId = String(am.livestock_id || "").trim();
      const dec = String(am.decision || "").trim().toLowerCase();
      const isRej = dec === "rejected" || dec === "condemned";
      if (isRej) {
        if (tag) anteRejectedSet.add(tag);
        if (lId) anteRejectedSet.add(lId);
      }
    });

    const condSet = new Set();
    (condemnedRecords || []).forEach((c) => {
      const tag = String(c.tag_number || "").trim().toLowerCase();
      if (tag) condSet.add(tag);
    });

    const downstreamSet = new Set();
    (processingRecords || []).forEach((p) => {
      if (p.tag_number) downstreamSet.add(String(p.tag_number).trim().toLowerCase());
      if (p.livestock_id) downstreamSet.add(String(p.livestock_id).trim());
    });
    (slaughterRecords || []).forEach((s) => {
      if (s.tag_number) downstreamSet.add(String(s.tag_number).trim().toLowerCase());
      if (s.livestock_id) downstreamSet.add(String(s.livestock_id).trim());
    });
    (carcassRecords || []).forEach((c) => {
      if (c.tag_number) downstreamSet.add(String(c.tag_number).trim().toLowerCase());
      if (c.livestock_id) downstreamSet.add(String(c.livestock_id).trim());
    });

    const seen = new Set();

    return (livestock || []).filter((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      const id = String(l.id || "").trim();
      if (!tag && !id) return false;
      const key = tag || id;
      if (seen.has(key)) return false;

      // Must NOT be already marked
      const isMarked =
        l.marked === true ||
        l.marked === "true" ||
        l.marked === "t" ||
        l.marked === 1 ||
        l.marked === "1" ||
        Boolean(l.mark_type) ||
        Boolean(l.mark_date);
      if (isMarked) return false;

      // Must NOT be condemned or rejected
      const s = String(l.status || "").trim().toLowerCase();
      if (s.includes("condemn") || s.includes("reject")) return false;
      if (anteRejectedSet.has(tag) || (id && anteRejectedSet.has(id))) return false;
      if (tag && condSet.has(tag)) return false;

      // Must NOT be in downstream stages
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
        s === "dispatched" ||
        s === "carcass weighed"
      ) return false;
      if ((tag && downstreamSet.has(tag)) || (id && downstreamSet.has(id))) return false;

      seen.add(key);
      return true;
    }).length;
  }, [livestock, anteRecords, condemnedRecords, processingRecords, slaughterRecords, carcassRecords]);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [search, filterType, statusFilter, sortBy]);

  const paginated = filtered;

  const copyToClipboard = (text, id) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    showToast(`Copied ${text} to clipboard!`, "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportCSV = () => {
    if (!data || data.length === 0) {
      showToast("No owners data to export", "warning");
      return;
    }
    const headers = "Official ID,System ID,Full Name,Contact Number,Email,Address,Status,Registered Date,Active Livestock";
    const rows = (filtered && filtered.length > 0 ? filtered : data).map((o) => {
      const officialId = formatOwnerId(o);
      const id = o.id || "—";
      const name = o.name ? o.name.replace(/"/g, '""') : "—";
      const contact = o.contact || "—";
      const email = o.email || "—";
      const address = o.address ? o.address.replace(/"/g, '""') : "—";
      const status = o.status || "Approved";
      const regDate = formatDate(o.registered_date || o.created_at) || "—";
      const count = getOwnerAnimalsCount(o);
      return `"${officialId}","${id}","${name}","${contact}","${email}","${address}","${status}","${regDate}","${count}"`;
    });

    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `registered_owners_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Owners directory exported successfully!", "success");
  };

  const handleRegisterLivestock = async (owner) => {
    const isApproved = !owner.status || owner.status === "Approved";
    if (!isApproved) {
      showToast(`Cannot register livestock: Owner account is ${owner.status}.`, "warning");
      return;
    }
    // Retrieve the owner's latest saved profile from Supabase
    try {
      if (owner?.id) {
        const { data, error } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", owner.id)
          .maybeSingle();
        if (data && !error) {
          setIntakeModalOwner(data);
          return;
        }
      }
    } catch (_) {}
    setIntakeModalOwner(owner);
  };

  const handleSaveIntakeBatch = async ({ owner, entries, blocks }) => {
    let tempRows = [...allKnownRows];
    const rowsToInsert = [];

    const linesToProcess = entries && entries.length > 0 ? entries : [];
    if (linesToProcess.length === 0 && Array.isArray(blocks)) {
      blocks.forEach((b) => {
        (b.lines || []).forEach((l) => {
          linesToProcess.push({
            species: b.species,
            sex: l.sex,
            age_months: l.age_months,
            quantity: l.quantity,
            breed: l.breed || "",
            remarks: l.remarks || "",
          });
        });
      });
    }

    const targetOwnerId = owner?.id || owner?.owner_id || null;
    let targetOwnerName = owner?.name || owner?.owner_name || "Owner";

    // Re-verify against master owners record to guarantee 100% current profile name
    if (targetOwnerId) {
      try {
        const { data: freshOwner } = await supabase
          .from(TABLES.OWNERS)
          .select("id, name")
          .eq("id", targetOwnerId)
          .maybeSingle();
        if (freshOwner?.name) {
          targetOwnerName = freshOwner.name;
        }
      } catch (_) {}
    }

    for (const entry of linesToProcess) {
      const qty = parseInt(entry.quantity, 10) || 1;
      const ageVal = entry.age_value !== undefined && entry.age_value !== null && !isNaN(entry.age_value)
        ? Number(entry.age_value)
        : (parseInt(entry.age_months, 10) || null);
      const isYear = String(entry.age_unit || entry.age_months || "").toLowerCase().includes("year");
      const ageUnit = entry.age_unit
        ? String(entry.age_unit).trim()
        : (entry.age_months ? (isYear ? (ageVal === 1 ? "Year" : "Years") : (ageVal === 1 ? "Month" : "Months")) : null);

      for (let i = 0; i < qty; i++) {
        const seqTag = generateNextTagForSpecies(tempRows, entry.species);
        const newRow = {
          tag_number: seqTag,
          species: entry.species,
          species_id: entry.species_id || null,
          sex: entry.sex,
          age_months: (entry.age_months || entry.age || "").trim(),
          age_value: ageVal,
          age_unit: ageUnit,
          quantity: 1,
          breed: entry.breed || "",
          remarks: entry.remarks || "",
          owner_id: targetOwnerId,
          owner_name: targetOwnerName,
          status: "Pending Marking",
          marked: false,
          mark_type: entry.mark_type || "Ear Tag",
          mark_date: null,
          marked_at: null,
        };
        rowsToInsert.push(newRow);
        tempRows.push(newRow);
      }
    }

    const res = await staffService.createLivestockBatch(rowsToInsert);
    if (!res || res.error) {
      throw res?.error || new Error("Failed to register livestock batch in Supabase");
    }

    setIntakeModalOwner(null);
    setRegistrationSuccessDialog({
      open: true,
      title: "Livestock Registered Successfully",
      message: `Successfully registered ${rowsToInsert.length} livestock ${rowsToInsert.length === 1 ? "record" : "records"} for ${targetOwnerName}. Newly registered livestock are now queued in Animal Marking.`,
    });
  };

  const handleCloseRegistrationSuccessDialog = () => {
    setRegistrationSuccessDialog(null);
    refresh();
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
      }}
    >
      {[
        {
          id: "owners",
          label: "Registered Owners",
          count: data.length,
          icon: <Icon.Users size={14} />,
          color: "#10b981",
          badgeBg: "rgba(16, 185, 129, 0.15)",
          badgeColor: "#10b981",
        },
        {
          id: "marking",
          label: "Animal Marking",
          count: awaitingMarkingCount,
          icon: <Icon.Tag size={14} />,
          color: "#8b5cf6",
          badgeBg: "rgba(139, 92, 246, 0.15)",
          badgeColor: "#8b5cf6",
        },
      ].map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              handleTabSwitch(tab.id);
              setPage(1);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 7,
              fontSize: 12.5,
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
    <div className="owners-page records-page-container" style={{ width: "100%", padding: 0 }}>
      {activeTab === "marking" && <AnimalMarking navTabs={renderNavTabs()} />}

      {activeTab === "owners" && (
        <>
          {/* MAIN DIRECTORY CONTAINER (BORDERLESS RECORD VIEW) */}
          <div style={{ background: "var(--color-surface)", borderRadius: 12, overflow: "hidden", border: "none", boxShadow: "none", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Swapped Toolbar: Segmented Tabs (Left) & Search + Sort (Right) */}
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
              {renderNavTabs()}

              {/* Right: Search Bar beside Sort Selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                {/* Search Box */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: 340, maxWidth: "100%", position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Search by Official ID, Raiser Name, Contact, Address..."
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

                {/* Sort Selector (Ante-Mortem Style with Custom Chevron) */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{
                      height: 34,
                      width: "auto",
                      minWidth: 160,
                      fontSize: 13,
                      fontWeight: 600,
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      padding: "0 30px 0 12px",
                      cursor: "pointer",
                      outline: "none",
                      appearance: "none",
                      backgroundImage:
                        "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 10px center",
                      backgroundSize: "14px",
                    }}
                    title="Sort directory"
                  >
                    <option value="recent">Sort: Newest First</option>
                    <option value="name">Sort: Name (A-Z)</option>
                    <option value="animals">Sort: Most Livestock</option>
                  </select>
                </div>
              </div>
            </div>

        {/* Table Content */}
        {loading ? (
          /* Smooth Skeleton Placeholder */
          <div style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[1, 2, 3, 4, 5].map((idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px",
                    borderRadius: 10,
                    background: "var(--color-bg)",
                    opacity: 0.7,
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-border)", flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ width: "35%", height: 14, background: "var(--color-border)", borderRadius: 4 }} />
                    <div style={{ width: "20%", height: 10, background: "var(--color-border)", borderRadius: 4 }} />
                  </div>
                  <div style={{ width: "15%", height: 14, background: "var(--color-border)", borderRadius: 4 }} />
                  <div style={{ width: "20%", height: 14, background: "var(--color-border)", borderRadius: 4 }} />
                  <div style={{ width: "12%", height: 28, background: "var(--color-border)", borderRadius: 8 }} />
                </div>
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "40px 20px" }}>
            <EmptyState
              title={search ? "No matching owners found" : "No registered owners in directory"}
              message={
                search
                  ? `No owners match "${search}". Try adjusting your search query or reset active filters.`
                  : "Approved livestock owners will appear in this registry once registered."
              }
              icon={<Icon.Users size={36} />}
              action={
                search || filterType !== "all" || statusFilter !== "all" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setFilterType("all");
                      setStatusFilter("all");
                    }}
                    style={{ marginTop: 10 }}
                  >
                    Reset All Filters
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
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
                <tr style={{ background: "var(--color-bg)" }}>
                  <th style={{ padding: "14px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                    Owner Raiser
                  </th>
                  <th style={{ padding: "14px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                    Contact &amp; Mobile
                  </th>
                  <th style={{ padding: "14px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                    Address
                  </th>
                  <th style={{ padding: "14px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                    Account Status
                  </th>
                  <th style={{ padding: "14px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>
                    Active Livestock
                  </th>
                  <th className="table-action-th">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((o) => {
                  const animalsCount = getOwnerAnimalsCount(o);
                  const status = o.status || "Approved";
                  const isApproved = status === "Approved";
                  const displayId = formatOwnerId(o);

                  return (
                    <tr
                      key={o.id}
                      style={{
                        transition: "background 140ms ease",
                      }}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                    >
                      {/* 1. Owner Identity */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {(() => {
                            const avatarUrl = o.avatar_url || resolveOwnerAvatar(o);
                            return (
                              <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
                                {avatarUrl ? (
                                  <img
                                    src={avatarUrl}
                                    alt={o.name}
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                      if (e.currentTarget.nextSibling) {
                                        e.currentTarget.nextSibling.style.display = "flex";
                                      }
                                    }}
                                    style={{
                                      width: 40,
                                      height: 40,
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
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                                    color: "#ffffff",
                                    display: avatarUrl ? "none" : "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 800,
                                    fontSize: 13,
                                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                                    flexShrink: 0,
                                  }}
                                >
                                  {initials(o.name || "Owner")}
                                </div>
                              </div>
                            );
                          })()}
                          <div>
                            <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 14 }}>
                              {o.name}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(displayId, o.id)}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  background: "var(--color-bg)",
                                  border: "1px solid var(--color-border)",
                                  borderRadius: 5,
                                  padding: "2px 6px",
                                  fontSize: 11,
                                  fontFamily: "monospace",
                                  color: "var(--color-text-muted)",
                                  cursor: "pointer",
                                }}
                                title="Click to copy official Owner ID"
                              >
                                <span>{displayId}</span>
                                {copiedId === o.id ? (
                                  <Icon.Check size={10} style={{ color: "#10b981" }} />
                                ) : (
                                  <Icon.Copy size={10} style={{ opacity: 0.6 }} />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Contact & Mobile */}
                      <td style={{ padding: "14px 18px" }}>
                        <div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text)", fontSize: 13, fontWeight: 600 }}>
                            <Icon.Phone size={13} style={{ color: "#0ea5e9", flexShrink: 0 }} />
                            <span style={{ fontFamily: "monospace" }}>{o.contact || "—"}</span>
                          </div>
                          {o.email && (
                            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                              <Icon.Mail size={11} style={{ opacity: 0.7 }} />
                              <span className="truncate" style={{ maxWidth: 170 }} title={o.email}>
                                {o.email}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 3. Address */}
                      <td style={{ padding: "14px 18px", maxWidth: 220 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <Icon.MapPin size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0, marginTop: 3 }} />
                          <span style={{ fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.4 }} className="truncate" title={o.address}>
                            {o.address || "—"}
                          </span>
                        </div>
                      </td>

                      {/* 4. Account Status */}
                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 9px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background:
                              status === "Approved"
                                ? "rgba(16, 185, 129, 0.12)"
                                : status.includes("Pending")
                                ? "rgba(245, 158, 11, 0.12)"
                                : "rgba(239, 68, 68, 0.12)",
                            color:
                              status === "Approved"
                                ? "#10b981"
                                : status.includes("Pending")
                                ? "#f59e0b"
                                : "#ef4444",
                            border: `1px solid ${
                              status === "Approved"
                                ? "rgba(16, 185, 129, 0.25)"
                                : status.includes("Pending")
                                ? "rgba(245, 158, 11, 0.25)"
                                : "rgba(239, 68, 68, 0.25)"
                            }`,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background:
                                status === "Approved"
                                  ? "#10b981"
                                  : status.includes("Pending")
                                  ? "#f59e0b"
                                  : "#ef4444",
                            }}
                          />
                          {status}
                        </span>
                      </td>

                      {/* 5. Registered Livestock Heads */}
                      <td style={{ padding: "14px 18px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => setDetailModalOwner(o)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: animalsCount > 0 ? "var(--color-primary, #10b981)" : "var(--color-text-muted)",
                            cursor: "pointer",
                          }}
                          title="Click to view full owner profile & registered livestock"
                        >
                          <Icon.Cow size={14} />
                          <span>{animalsCount} {animalsCount === 1 ? "Head" : "Heads"}</span>
                        </button>
                      </td>

                      {/* 6. Intake Actions */}
                      <td className="table-action-td">
                        <div className="table-action-group">
                          {/* Secondary Action: View Details Modal */}
                          <button
                            type="button"
                            className="action-btn action-btn-outline"
                            onClick={() => setDetailModalOwner(o)}
                            title="View complete raiser credentials & active livestock"
                          >
                            <Icon.Eye size={13} />
                            <span>View</span>
                          </button>

                          {/* Primary Action: Register Livestock */}
                          <button
                            type="button"
                            className="action-btn action-btn-success"
                            onClick={() => handleRegisterLivestock(o)}
                            disabled={!isApproved}
                            title={isApproved ? "Register incoming livestock for this owner" : `Cannot register: Owner account is ${status}`}
                          >
                            <Icon.Plus size={13} style={{ strokeWidth: 2.5 }} />
                            <span>Register Livestock</span>
                          </button>
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

      {/* 5. RICH OWNER PROFILE & DETAILS MODAL */}
      <Modal
        open={!!detailModalOwner}
        onClose={() => setDetailModalOwner(null)}
        title="Owner Details"
        dialogStyle={{
          maxWidth: 680,
          width: "95vw",
          borderRadius: 14,
          overflow: "hidden",
        }}
        headerStyle={{
          padding: "16px 22px",
          borderBottom: "1px solid var(--color-border)",
        }}
        bodyStyle={{
          padding: "20px 22px",
          maxHeight: "82vh",
          overflowY: "auto",
        }}
      >
        {detailModalOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Top Identity Header Card */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 18px",
                background: "var(--color-bg)",
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                flexWrap: "wrap",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {(() => {
                  const modalAvatar = detailModalOwner.avatar_url || resolveOwnerAvatar(detailModalOwner);
                  return (
                    <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                      {modalAvatar ? (
                        <img
                          src={modalAvatar}
                          alt={detailModalOwner.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            if (e.currentTarget.nextSibling) {
                              e.currentTarget.nextSibling.style.display = "flex";
                            }
                          }}
                          style={{
                            width: 48,
                            height: 48,
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
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                          color: "#ffffff",
                          display: modalAvatar ? "none" : "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 800,
                          fontSize: 16,
                          boxShadow: "0 2px 8px rgba(16, 185, 129, 0.28)",
                        }}
                      >
                        {initials(detailModalOwner.name || "Owner")}
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.01em" }}>
                    {detailModalOwner.name}
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontFamily: "monospace",
                        color: "#0284c7",
                        background: "rgba(14, 165, 233, 0.12)",
                        border: "1px solid rgba(14, 165, 233, 0.25)",
                        padding: "2px 7px",
                        borderRadius: 5,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>{formatOwnerId(detailModalOwner)}</span>
                    </span>
                    {detailModalOwner.id && detailModalOwner.id !== formatOwnerId(detailModalOwner) && (
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        System ID: {detailModalOwner.id}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    detailModalOwner.status === "Approved" || !detailModalOwner.status
                      ? "rgba(16, 185, 129, 0.12)"
                      : detailModalOwner.status === "Rejected"
                      ? "rgba(239, 68, 68, 0.12)"
                      : "rgba(245, 158, 11, 0.12)",
                  color:
                    detailModalOwner.status === "Approved" || !detailModalOwner.status
                      ? "#059669"
                      : detailModalOwner.status === "Rejected"
                      ? "#dc2626"
                      : "#d97706",
                  border: `1px solid ${
                    detailModalOwner.status === "Approved" || !detailModalOwner.status
                      ? "rgba(16, 185, 129, 0.3)"
                      : detailModalOwner.status === "Rejected"
                      ? "rgba(239, 68, 68, 0.3)"
                      : "rgba(245, 158, 11, 0.3)"
                  }`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background:
                      detailModalOwner.status === "Approved" || !detailModalOwner.status
                        ? "#10b981"
                        : detailModalOwner.status === "Rejected"
                        ? "#ef4444"
                        : "#f59e0b",
                  }}
                />
                {detailModalOwner.status || "Approved"}
              </span>
            </div>

            {/* 4-Stat Particulars Card */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              {/* Contact Number */}
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface, #ffffff)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "rgba(14, 165, 233, 0.12)",
                    color: "#0284c7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Phone size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Contact Number
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text)", marginTop: 3, fontFamily: "monospace" }}>
                    {detailModalOwner.contact ? (
                      <a
                        href={`tel:${detailModalOwner.contact}`}
                        style={{ color: "var(--color-text)", textDecoration: "none" }}
                        title="Click to dial"
                      >
                        {detailModalOwner.contact}
                      </a>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>

              {/* Account Email */}
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface, #ffffff)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "rgba(139, 92, 246, 0.12)",
                    color: "#7c3aed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Mail size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Account Email
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginTop: 3 }} className="truncate" title={detailModalOwner.email}>
                    {detailModalOwner.email ? (
                      <a
                        href={`mailto:${detailModalOwner.email}`}
                        style={{ color: "var(--color-text)", textDecoration: "none" }}
                        title="Click to send email"
                      >
                        {detailModalOwner.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>

              {/* Address */}
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface, #ffffff)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "rgba(245, 158, 11, 0.12)",
                    color: "#d97706",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.MapPin size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Address
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginTop: 3, lineHeight: 1.35 }} title={detailModalOwner.address}>
                    {detailModalOwner.address || "—"}
                  </div>
                </div>
              </div>

              {/* Registration Date */}
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface, #ffffff)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#059669",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Calendar size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Registration Date
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginTop: 3 }}>
                    {formatDate(detailModalOwner.registered_date || detailModalOwner.created_at) || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Livestock Table Section */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>
                  <Icon.Cow size={16} style={{ color: "#10b981" }} />
                  <span>Tracked Livestock in Abattoir</span>
                </div>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#059669",
                  }}
                >
                  {getOwnerAnimals(detailModalOwner).length} {getOwnerAnimals(detailModalOwner).length === 1 ? "Head" : "Heads"}
                </span>
              </div>

              {getOwnerAnimals(detailModalOwner).length === 0 ? (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    border: "1px dashed var(--color-border)",
                    borderRadius: 10,
                    background: "var(--color-bg)",
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>🐾</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>No livestock registered yet</div>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0 0" }}>
                    This owner does not have any active livestock in the abattoir queue.
                  </p>
                </div>
              ) : (
                <div style={{ maxHeight: 250, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 10, scrollbarWidth: "thin" }}>
                  <table className="table" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface-subtle, #f8fafc)" }}>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "left", textTransform: "uppercase" }}>Tag Number</th>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "left", textTransform: "uppercase" }}>Species</th>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "left", textTransform: "uppercase" }}>Sex</th>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "left", textTransform: "uppercase" }}>Breed</th>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "center", textTransform: "uppercase" }}>Weight</th>
                        <th style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textAlign: "right", textTransform: "uppercase" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getOwnerAnimals(detailModalOwner).map((a, idx) => {
                        const stStyle = getLivestockStatusStyle(a.status || a.health_status);
                        return (
                          <tr
                            key={a.id || a.tag_number || idx}
                            style={{
                              borderBottom: "1px solid var(--color-border, #f1f5f9)",
                              background: idx % 2 === 0 ? "transparent" : "var(--color-surface-subtle, #fcfcfc)",
                            }}
                          >
                            <td style={{ padding: "9px 12px", fontWeight: 700, fontFamily: "monospace", color: "var(--color-text)" }}>
                              {a.tag_number || a.id}
                            </td>
                            <td style={{ padding: "9px 12px", color: "var(--color-text)" }}>
                              {a.species || "—"}
                            </td>
                            <td style={{ padding: "9px 12px", fontWeight: 600, color: "var(--color-text)" }}>
                              {formatSex(a.sex)}
                            </td>
                            <td style={{ padding: "9px 12px", color: "var(--color-text-muted)" }}>
                              {a.breed || "Standard"}
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: a.weight ? 700 : 500, color: a.weight ? "var(--color-text)" : "var(--color-text-muted)" }}>
                              {a.weight ? `${a.weight} kg` : "Pending scale"}
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  lineHeight: 1.25,
                                  maxWidth: 180,
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  ...stStyle,
                                }}
                              >
                                {a.status || a.health_status || "Registered"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Actions Footer: Read-only inspection, clean Close button */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                marginTop: 6,
                paddingTop: 14,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Button
                onClick={() => setDetailModalOwner(null)}
                variant="outline"
                size="sm"
                style={{
                  minWidth: 100,
                  height: 38,
                  fontWeight: 700,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 6. MULTI-LIVESTOCK INTAKE REGISTRATION MODAL */}
      <Modal
        open={!!intakeModalOwner}
        onClose={() => setIntakeModalOwner(null)}
        title={intakeModalOwner ? `Register Incoming Livestock — ${intakeModalOwner.name}` : "Register Incoming Livestock"}
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
      >
        {intakeModalOwner && (
          <MultiLivestockForm
            key={intakeModalOwner.id || intakeModalOwner.owner_id || "modal"}
            owner={intakeModalOwner}
            allKnownRows={allKnownRows}
            onCancel={() => setIntakeModalOwner(null)}
            onSubmit={handleSaveIntakeBatch}
          />
        )}
      </Modal>

      {/* 7. LIVESTOCK REGISTRATION CONFIRMATION POPUP */}
      <AlertDialog
        open={Boolean(registrationSuccessDialog?.open)}
        onClose={handleCloseRegistrationSuccessDialog}
        title={registrationSuccessDialog?.title || "Livestock Registered Successfully"}
        message={registrationSuccessDialog?.message || "The livestock record has been saved successfully."}
        buttonText="OK"
        variant="success"
      />
        </>
      )}
    </div>
  );
};

export default Owners;
