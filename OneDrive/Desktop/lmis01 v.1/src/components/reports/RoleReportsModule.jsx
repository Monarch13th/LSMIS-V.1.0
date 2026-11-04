import React, { useState, useEffect, useMemo, useRef } from "react";
import { Card, PageHeader, Button, StatCard, EmptyState, Modal, Pagination } from "../ui";
import { TagBadge } from "../ui/TagBadge";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { useAuth } from "../../hooks/useAuth";
import { TABLES } from "../../utils/constants";
import {
  formatPhDateTime,
  formatPhDate,
  formatSex,
  initials,
  today,
} from "../../utils/helpers";
import { formatOwnerId } from "../../utils/formatters";
import { CondemnationEvidenceModal } from "./CondemnationEvidenceModal";

const ROLE_REPORT_TYPES = {
  admin: [
    {
      id: "livestock",
      label: "Livestock",
      title: "Livestock Registration & Marking Report",
      subtitle: "Registered owners, livestock intake, tattoo and ear tag marking records, and receiving personnel",
      icon: <Icon.Cow size={16} />,
      color: "#0284c7",
      badgeBg: "rgba(2, 132, 199, 0.15)",
      badgeColor: "#0284c7",
    },
    {
      id: "slaughter",
      label: "Slaughter",
      title: "Slaughter Processing & Carcass Weighing Report",
      subtitle: "Slaughter floor operations, assigned operator teams, completion timestamps, and carcass scale weights",
      icon: <Icon.Scissors size={16} />,
      color: "#d97706",
      badgeBg: "rgba(217, 119, 6, 0.15)",
      badgeColor: "#d97706",
    },
    {
      id: "inspection",
      label: "Inspections",
      title: "Veterinary Inspections & Condemnations Report",
      subtitle: "Ante-mortem and post-mortem decisions, clinical findings, condemned parts, and inspecting veterinarians",
      icon: <Icon.Stethoscope size={16} />,
      color: "#7c3aed",
      badgeBg: "rgba(124, 58, 237, 0.15)",
      badgeColor: "#7c3aed",
    },
    {
      id: "permits",
      label: "Permits",
      title: "Meat Permits & Dispatch Release Report",
      subtitle: "Issued meat inspection certificates, certified carcass weights, and released livestock batches",
      icon: <Icon.FileText size={16} />,
      color: "#10b981",
      badgeBg: "rgba(16, 185, 129, 0.15)",
      badgeColor: "#10b981",
    },
  ],
  vet: [
    {
      id: "antemortem",
      label: "Ante-Mortem",
      title: "Ante-Mortem Inspection Report",
      subtitle: "Pre-slaughter live animal screening decisions, clinical observations, and responsible veterinary personnel",
      icon: <Icon.Activity size={16} />,
      color: "#0284c7",
      badgeBg: "rgba(2, 132, 199, 0.15)",
      badgeColor: "#0284c7",
    },
    {
      id: "postmortem",
      label: "Post-Mortem",
      title: "Post-Mortem Inspection Report",
      subtitle: "Carcass and visceral examination outcomes, partial condemnations, and certifying veterinarians",
      icon: <Icon.Shield size={16} />,
      color: "#7c3aed",
      badgeBg: "rgba(124, 58, 237, 0.15)",
      badgeColor: "#7c3aed",
    },
    {
      id: "condemnation",
      label: "Condemnations",
      title: "Veterinary Condemnation Report",
      subtitle: "Whole carcass and partial cut condemnations, pathological reasons, weights, and inspecting veterinarians",
      icon: <Icon.AlertTriangle size={16} />,
      color: "#ef4444",
      badgeBg: "rgba(239, 68, 68, 0.15)",
      badgeColor: "#ef4444",
    },
    {
      id: "weighing",
      label: "Carcass Weighing",
      title: "Carcass Weighing & Branding Report",
      subtitle: "Official hot and cold carcass weights, meat grades, brand codes, and weighing personnel",
      icon: <Icon.Scale size={16} />,
      color: "#d97706",
      badgeBg: "rgba(217, 119, 6, 0.15)",
      badgeColor: "#d97706",
    },
  ],
  staff: [
    {
      id: "receiving",
      label: "Registration & Marking",
      title: "Livestock Registration & Animal Marking Report",
      subtitle: "Owner and livestock registrations, tattoo and ear tag markings, and responsible receiving staff",
      icon: <Icon.Tag size={16} />,
      color: "#0284c7",
      badgeBg: "rgba(2, 132, 199, 0.15)",
      badgeColor: "#0284c7",
    },
    {
      id: "slaughter",
      label: "Slaughter",
      title: "Team Operator and Slaughter Report",
      subtitle: "Assigned slaughter operator teams, floor processing progress, and completion timestamps",
      icon: <Icon.Users size={16} />,
      color: "#d97706",
      badgeBg: "rgba(217, 119, 6, 0.15)",
      badgeColor: "#d97706",
    },
    {
      id: "permits",
      label: "Meat Permits",
      title: "Meat Permits Report",
      subtitle: "Issued meat inspection permits, certified carcass weights, and dispatch release status",
      icon: <Icon.Check size={16} />,
      color: "#10b981",
      badgeBg: "rgba(16, 185, 129, 0.15)",
      badgeColor: "#10b981",
    },
  ],
};

const STATUS_FILTERS = [
  { id: "all", label: "All Statuses" },
  { id: "completed", label: "Completed / Approved" },
  { id: "pending", label: "Pending / In Progress" },
  { id: "condemned", label: "Condemned / Rejected" },
];

const toManilaDateStr = (val) => {
  if (!val || val === "—") return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
  } catch {
    return "";
  }
};

const toTimestampMs = (val) => {
  if (!val || val === "—") return 0;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

const classifyStatusBucket = (statusStr) => {
  const s = String(statusStr || "").toLowerCase();
  if (s.includes("partial")) {
    return "partial";
  }
  if (
    s.includes("condemn") ||
    s.includes("reject") ||
    s.includes("unfit") ||
    s.includes("cancel")
  ) {
    return "condemned";
  }
  if (
    s.includes("complet") ||
    s.includes("approv") ||
    s.includes("pass") ||
    s.includes("weigh") ||
    s.includes("releas") ||
    s.includes("dispatch") ||
    s.includes("issued") ||
    s.includes("marked") ||
    s.includes("slaughtered") ||
    s.includes("active")
  ) {
    return "completed";
  }
  return "pending";
};

const resolveCondemnationStatus = (c, stage) => {
  if (!c) return "Condemned";
  const scope = String(c.scope || "").toLowerCase();
  if (scope === "whole") return "Condemned";
  if (scope === "partial") return "Partially Condemned";

  const decision = String(c.decision || c.raw_decision || "").toLowerCase();
  if (decision.includes("partial")) return "Partially Condemned";
  if (decision === "condemned" || decision === "rejected" || decision.includes("whole") || decision.includes("totally")) return "Condemned";

  const part = String(c.part || "").trim().toLowerCase();
  if (
    part === "whole carcass" ||
    part === "entire carcass" ||
    part === "live animal" ||
    part.includes("whole") ||
    part.includes("entire")
  ) {
    return "Condemned";
  }
  if (part && part !== "whole carcass" && part !== "entire carcass" && part !== "live animal") {
    return "Partially Condemned";
  }

  if (stage === "Ante-Mortem" || c.inspection_type === "Ante-Mortem") {
    return "Condemned";
  }

  const combinedText = `${c.reason || ""} ${c.notes || ""} ${c.findings || ""} ${c.quantity || ""}`.toLowerCase();
  if (combinedText.includes("partial") || combinedText.includes("cut:") || combinedText.includes("condemned cut")) {
    return "Partially Condemned";
  }

  return "Condemned";
};

const getStatusDotStyle = (statusStr) => {
  const s = String(statusStr || "").toLowerCase();
  if (s.includes("partial")) return { color: "#d97706", label: statusStr || "Partially Condemned" };
  const bucket = classifyStatusBucket(statusStr);
  if (bucket === "condemned") return { color: "#dc2626", label: statusStr || "Condemned" };
  if (bucket === "completed") return { color: "#059669", label: statusStr || "Completed" };
  return { color: "#d97706", label: statusStr || "In Progress" };
};

export const RoleReportsModule = ({
  role = "admin",
  initialReportType = null,
  monitoringModule = null,
  initialStatusFilter = "all",
}) => {
  const { showToast } = useToast();
  const { session } = useAuth();
  const normalizedRole = role === "vet" ? "vet" : role === "staff" ? "staff" : "admin";
  const reportTypes = useMemo(() => {
    if (monitoringModule === "inspection") return ROLE_REPORT_TYPES.vet;
    if (monitoringModule === "livestock" || monitoringModule === "slaughter" || monitoringModule === "permits") {
      return ROLE_REPORT_TYPES.admin.filter((t) => t.id === monitoringModule);
    }
    return ROLE_REPORT_TYPES[normalizedRole] || ROLE_REPORT_TYPES.admin;
  }, [normalizedRole, monitoringModule]);

  const resolveValidType = (candidate) => {
    if (monitoringModule && monitoringModule !== "inspection") return monitoringModule;
    if (candidate === "collection" || candidate === "payment") return "permits";
    if (candidate && reportTypes.some((t) => t.id === candidate)) return candidate;
    return reportTypes[0].id;
  };

  const [activeType, setActiveType] = useState(() => resolveValidType(initialReportType));
  const isRegMarking = activeType === "livestock" || activeType === "receiving";

  // Filters (matching InspectionResults / SlaughterProcessing UI/UX)
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => initialStatusFilter || "all");

  // Auto-compressing Toolbar state & observer
  const toolbarRef = useRef(null);
  const [toolbarWidth, setToolbarWidth] = useState(() =>
    typeof window !== "undefined" ? Math.min(window.innerWidth - 280, 1200) : 1200
  );

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;

    const updateFromEl = () => {
      if (toolbarRef.current) {
        setToolbarWidth(toolbarRef.current.offsetWidth || toolbarRef.current.clientWidth || 1200);
      }
    };

    updateFromEl();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentBoxSize) {
            const inlineSize = Array.isArray(entry.contentBoxSize)
              ? entry.contentBoxSize[0].inlineSize
              : entry.contentBoxSize.inlineSize;
            setToolbarWidth(inlineSize);
          } else if (entry.contentRect) {
            setToolbarWidth(entry.contentRect.width);
          }
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      window.addEventListener("resize", updateFromEl);
      return () => window.removeEventListener("resize", updateFromEl);
    }
  }, []);

  const isVeryCompact = toolbarWidth < 768;
  const isCompact = toolbarWidth < 1024;

  useEffect(() => {
    if (monitoringModule && monitoringModule !== "inspection") {
      setActiveType(monitoringModule);
      setSelectedOwnerKey(null);
      setStatusFilter(initialStatusFilter || "all");
      setPage(1);
    } else if (initialReportType) {
      setActiveType(resolveValidType(initialReportType));
      setSelectedOwnerKey(null);
      setStatusFilter(initialStatusFilter || "all");
      setPage(1);
    }
  }, [initialReportType, monitoringModule, initialStatusFilter, normalizedRole]);

  // Drill-down owner view (matches InspectionResults / Condemnation pattern)
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [viewingCondemnation, setViewingCondemnation] = useState(null);

  // Pagination (default 10 per page)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [ownerViewPage, setOwnerViewPage] = useState(1);
  const [ownerViewPageSize, setOwnerViewPageSize] = useState(10);

  // Live Supabase Data (no payments table used)
  const { data: livestock = [], loading: loadingLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: owners = [], loading: loadingOwners } = useSupabase(TABLES.OWNERS);
  const { data: ante = [], loading: loadingAnte, refresh: refreshAnte } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post = [], loading: loadingPost, refresh: refreshPost } = useSupabase(TABLES.POST_MORTEM);
  const { data: condemned = [] } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: carcass = [], loading: loadingCarcass, refresh: refreshCarcass } = useSupabase(TABLES.CARCASS);
  const { data: slaughterRecords = [] } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: slaughterProcessing = [], loading: loadingProc, refresh: refreshProc } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: permits = [], refresh: refreshPermits } = useSupabase(TABLES.PERMITS);
  const { data: dispatchRecords = [] } = useSupabase(TABLES.DISPATCH);
  const { data: auditLogs = [] } = useSupabase(normalizedRole === "admin" ? TABLES.AUDIT_LOGS : null);
  const { data: evidence = [] } = useSupabase(TABLES.EVIDENCE_RECORDS);
  const { data: postCuts = [] } = useSupabase(TABLES.POST_MORTEM_CONDEMNED_CUTS);
  const { data: users = [] } = useSupabase(TABLES.USERS);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading =
    (loadingLivestock && livestock.length === 0) ||
    (loadingOwners && owners.length === 0) ||
    (normalizedRole === "vet" && loadingAnte && loadingPost && ante.length === 0 && post.length === 0) ||
    (normalizedRole === "staff" && loadingProc && slaughterProcessing.length === 0 && livestock.length === 0);

  useEffect(() => {
    setActiveType(resolveValidType(initialReportType));
    setStatusFilter(initialStatusFilter || "all");
    setSelectedOwnerKey(null);
    setSelectedRecord(null);
  }, [monitoringModule, initialReportType, initialStatusFilter]);

  useEffect(() => {
    setPage(1);
    setSelectedOwnerKey(null);
  }, [activeType, search, filterSpecies, datePreset, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    setOwnerViewPage(1);
  }, [selectedOwnerKey]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        refreshLivestock?.(),
        refreshAnte?.(),
        refreshPost?.(),
        refreshCarcass?.(),
        refreshProc?.(),
        refreshPermits?.(),
      ]);
      showToast("Report records synchronized with database", "success");
    } finally {
      setTimeout(() => setIsRefreshing(false), 250);
    }
  };

  // O(1) Lookup Maps
  const lookupMaps = useMemo(() => {
    const ownerById = new Map();
    const ownerByName = new Map();
    (owners || []).forEach((o) => {
      if (!o) return;
      if (o.id) {
        ownerById.set(String(o.id), o);
        ownerById.set(String(o.id).trim().toLowerCase(), o);
      }
      if (o.owner_id) {
        ownerById.set(String(o.owner_id), o);
        ownerById.set(String(o.owner_id).trim().toLowerCase(), o);
      }
      if (o.temp_reg_id) {
        ownerById.set(String(o.temp_reg_id), o);
        ownerById.set(String(o.temp_reg_id).trim().toLowerCase(), o);
      }
      if (o.auth_user_id) {
        ownerById.set(String(o.auth_user_id), o);
        ownerById.set(String(o.auth_user_id).trim().toLowerCase(), o);
      }
      const fmtId = formatOwnerId(o);
      if (fmtId) {
        ownerById.set(String(fmtId), o);
        ownerById.set(String(fmtId).trim().toLowerCase(), o);
      }
      if (o.name) {
        ownerByName.set(String(o.name).trim().toLowerCase(), o);
      }
    });

    const livestockByTag = new Map();
    const livestockById = new Map();
    (livestock || []).forEach((l) => {
      if (l?.tag_number) livestockByTag.set(String(l.tag_number).trim().toLowerCase(), l);
      if (l?.id) livestockById.set(String(l.id), l);
    });

    const anteByTag = new Map();
    (ante || []).forEach((a) => {
      if (a?.tag_number) anteByTag.set(String(a.tag_number).trim().toLowerCase(), a);
    });

    const postByTag = new Map();
    (post || []).forEach((p) => {
      if (p?.tag_number) postByTag.set(String(p.tag_number).trim().toLowerCase(), p);
    });

    const carcassByTag = new Map();
    (carcass || []).forEach((c) => {
      if (c?.tag_number) carcassByTag.set(String(c.tag_number).trim().toLowerCase(), c);
    });

    const procByTag = new Map();
    (slaughterProcessing || []).forEach((p) => {
      if (p?.tag_number) procByTag.set(String(p.tag_number).trim().toLowerCase(), p);
    });

    const srByTag = new Map();
    (slaughterRecords || []).forEach((s) => {
      if (s?.tag_number) srByTag.set(String(s.tag_number).trim().toLowerCase(), s);
    });

    const permitByTag = new Map();
    (permits || []).forEach((pm) => {
      if (pm?.tag_number) permitByTag.set(String(pm.tag_number).trim().toLowerCase(), pm);
      if (Array.isArray(pm?.tags)) {
        pm.tags.forEach((t) => {
          if (t) permitByTag.set(String(t).trim().toLowerCase(), pm);
        });
      }
    });

    const dispatchByTag = new Map();
    (dispatchRecords || []).forEach((d) => {
      if (d?.tag_number) dispatchByTag.set(String(d.tag_number).trim().toLowerCase(), d);
      if (Array.isArray(d?.tags)) {
        d.tags.forEach((t) => {
          if (t) dispatchByTag.set(String(t).trim().toLowerCase(), d);
        });
      }
    });

    // Downstream process tags and IDs (mirrors AnimalMarking.jsx eligibility)
    const downstreamTagSet = new Set();
    (slaughterProcessing || []).forEach((p) => {
      if (p?.tag_number) downstreamTagSet.add(String(p.tag_number).trim().toLowerCase());
      if (p?.livestock_id) downstreamTagSet.add(String(p.livestock_id).trim().toLowerCase());
    });
    (slaughterRecords || []).forEach((s) => {
      if (s?.tag_number) downstreamTagSet.add(String(s.tag_number).trim().toLowerCase());
      if (s?.livestock_id) downstreamTagSet.add(String(s.livestock_id).trim().toLowerCase());
    });
    (carcass || []).forEach((c) => {
      if (c?.tag_number) downstreamTagSet.add(String(c.tag_number).trim().toLowerCase());
      if (c?.livestock_id) downstreamTagSet.add(String(c.livestock_id).trim().toLowerCase());
    });
    (ante || []).forEach((a) => {
      if (a?.tag_number) downstreamTagSet.add(String(a.tag_number).trim().toLowerCase());
      if (a?.livestock_id) downstreamTagSet.add(String(a.livestock_id).trim().toLowerCase());
    });
    (permits || []).forEach((pm) => {
      if (pm?.tag_number) downstreamTagSet.add(String(pm.tag_number).trim().toLowerCase());
      if (pm?.livestock_id) downstreamTagSet.add(String(pm.livestock_id).trim().toLowerCase());
      if (Array.isArray(pm?.tags)) {
        pm.tags.forEach((t) => {
          if (t) downstreamTagSet.add(String(t).trim().toLowerCase());
        });
      }
    });
    (dispatchRecords || []).forEach((d) => {
      if (d?.tag_number) downstreamTagSet.add(String(d.tag_number).trim().toLowerCase());
      if (d?.livestock_id) downstreamTagSet.add(String(d.livestock_id).trim().toLowerCase());
      if (Array.isArray(d?.tags)) {
        d.tags.forEach((t) => {
          if (t) downstreamTagSet.add(String(t).trim().toLowerCase());
        });
      }
    });

    const resolveOwner = (rec, animalFallback = null) => {
      const a =
        animalFallback ||
        (rec?.livestock_id ? livestockById.get(String(rec.livestock_id)) : null) ||
        (rec?.tag_number ? livestockByTag.get(String(rec.tag_number).trim().toLowerCase()) : null);
      const oid = rec?.owner_id || a?.owner_id;
      const oname = rec?.owner_name || a?.owner_name || "";
      const oObj =
        (oid
          ? ownerById.get(String(oid)) ||
            ownerById.get(String(oid).trim().toLowerCase())
          : null) ||
        (oname ? ownerByName.get(String(oname).trim().toLowerCase()) : null);
      return {
        id: oObj?.id || oid || "",
        name:
          oObj?.name ||
          (oObj?.first_name ? `${oObj.first_name} ${oObj.last_name || ""}`.trim() : "") ||
          oname ||
          "Registered Producer",
        contact: oObj?.contact || oObj?.phone || oObj?.mobile || a?.owner_contact || "—",
        address: oObj?.address || a?.owner_address || "—",
        avatar_url: oObj?.avatar_url || a?.owner_avatar || a?.avatar_url || null,
      };
    };

    return {
      livestockByTag,
      anteByTag,
      postByTag,
      carcassByTag,
      procByTag,
      srByTag,
      permitByTag,
      dispatchByTag,
      downstreamTagSet,
      resolveOwner,
    };
  }, [owners, livestock, ante, post, carcass, slaughterProcessing, slaughterRecords, permits, dispatchRecords]);

  // Build normalized rows for the active report type (strictly no payment/fees)
  const rawReportRows = useMemo(() => {
    const {
      livestockByTag,
      anteByTag,
      postByTag,
      carcassByTag,
      procByTag,
      srByTag,
      permitByTag,
      dispatchByTag,
      downstreamTagSet,
      resolveOwner,
    } = lookupMaps;

    const extractStaffActor = (l, stageKeyword) => {
      const hist = Array.isArray(l?.process_history) ? l.process_history : [];
      for (let i = hist.length - 1; i >= 0; i--) {
        const h = hist[i];
        if (!stageKeyword || String(h?.stage || h?.action || "").toLowerCase().includes(stageKeyword)) {
          if (h?.actor_name || h?.user) return h.actor_name || h.user;
        }
      }
      return l?.marked_by || l?.received_by || "Staff Personnel";
    };

    const isDirectlyMarked = (l) => {
      if (!l) return false;
      return Boolean(
        (l.marked === true || l.marked === "true" || l.marked === "t" || l.marked === 1 || l.marked === "1") &&
        l.marked !== "false" &&
        l.marked !== 0
      );
    };

    // Exactly matches AnimalMarking.jsx eligibility: returns true ONLY for intake livestock genuinely awaiting marking
    const isAwaitingMarking = (l) => {
      if (!l || !l.tag_number || String(l.tag_number).trim() === "") return false;

      const isFallback = l.status === "Returned to Animal Marking" || Boolean(l.fallback_at);
      if (!isFallback) {
        if (isDirectlyMarked(l)) return false;
        if (l.mark_type || l.mark_date || l.marked_at || l.marked_by) return false;
      }

      const s = String(l.status || "").trim().toLowerCase();
      if (s.includes("condemn") || s.includes("reject")) return false;
      if (
        s === "marked" ||
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
        s === "approved" ||
        s === "passed"
      ) return false;

      const tagKey = String(l.tag_number).trim().toLowerCase();
      const idKey = String(l.id || "").trim().toLowerCase();

      if (!isFallback && (downstreamTagSet.has(tagKey) || (idKey && downstreamTagSet.has(idKey)))) {
        return false;
      }

      return true;
    };

    // 1. ADMIN — ALL SYSTEM TRANSACTIONS
    if (normalizedRole === "admin" && activeType === "transactions") {
      return (livestock || []).map((l) => {
        const tagKey = String(l.tag_number || "").trim().toLowerCase();
        const owner = resolveOwner(l, l);
        const am = anteByTag.get(tagKey);
        const pm = postByTag.get(tagKey);
        const cw = carcassByTag.get(tagKey);
        const pr = procByTag.get(tagKey) || srByTag.get(tagKey);
        const pmt = permitByTag.get(tagKey);
        const dsp = dispatchByTag.get(tagKey);

        const weightKg = Number(cw?.total_weight || cw?.cold_weight || l.weight || 0);
        const permitNo = pmt?.permit_no || l.permit_no || "—";
        const latestDate =
          dsp?.created_at ||
          l.permit_issued_at ||
          cw?.weighed_at ||
          cw?.date ||
          pm?.created_at ||
          pm?.date ||
          pr?.completed_at ||
          am?.created_at ||
          l.marked_at ||
          l.created_at ||
          l.received_date;

        const personnelParts = [];
        if (pr?.operator) personnelParts.push(pr.operator);
        if (pm?.inspector_name || am?.inspector_name) personnelParts.push(pm?.inspector_name || am?.inspector_name);
        if (personnelParts.length === 0) personnelParts.push(extractStaffActor(l));

        const awaiting = isAwaitingMarking(l);
        const stageSummary = [
          awaiting ? "Unmarked" : `Marked (${l.mark_type || "Ear Tag"})`,
          am ? `AM: ${am.decision}` : null,
          pr?.status === "Completed" ? "Slaughtered" : pr?.operator ? `Floor (${pr.operator})` : null,
          pm ? `PM: ${pm.decision}` : null,
          weightKg > 0 ? `${weightKg.toFixed(1)} kg` : null,
          permitNo !== "—" ? `Permit: ${permitNo}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return {
          id: l.id || l.tag_number,
          reportTitle: "System Transaction",
          stageLabel: permitNo !== "—" ? "Meat Permit Issued" : weightKg > 0 ? "Carcass Weighed" : pm ? "Post-Mortem" : pr ? "Slaughter" : am ? "Ante-Mortem" : !awaiting ? "Animal Marking" : "Registration",
          tag_number: l.tag_number || "—",
          species: l.species || "Livestock",
          sex: formatSex(l.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: stageSummary || "Registered in Livestock Intake",
          weight_kg: weightKg,
          personnel: personnelParts.join(" / "),
          date: latestDate,
          status: l.status || "Pending",
          raw: l,
        };
      });
    }

    // 2. LIVESTOCK & MARKING (Admin 'livestock' or Staff 'receiving')
    if (activeType === "livestock" || activeType === "receiving") {
      return (livestock || []).map((l) => {
        const owner = resolveOwner(l, l);
        const awaiting = isAwaitingMarking(l);
        const markType = l.mark_type || "Ear Tag";
        const markDate = l.mark_date || l.marked_at || l.received_date || l.created_at;
        const markLabel = awaiting
          ? "Awaiting Marking"
          : `${markType} (${markDate ? formatPhDate(markDate) : "Marked"})`;
        const ts = l.marked_at || l.mark_date || l.created_at || l.received_date;
        const actor = l.marked_by || extractStaffActor(l, "mark") || "Staff Personnel";
        return {
          id: l.id || l.tag_number,
          reportTitle: "Registration & Marking",
          stageLabel: awaiting ? "Registration" : "Animal Marking",
          tag_number: l.tag_number || "—",
          species: l.species || "Livestock",
          sex: formatSex(l.sex),
          mark_type: markType,
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `${l.species || "Livestock"} (${formatSex(l.sex)}) · Type of Marking: ${markType}`,
          weight_kg: Number(l.weight || 0),
          personnel: actor,
          date: ts,
          status: awaiting ? "Awaiting Marking" : "Marked",
          raw: l,
        };
      });
    }

    // 3. INSPECTIONS (Admin 'inspection' or Vet 'inspection' / 'antemortem' / 'postmortem')
    if (activeType === "inspection" || activeType === "antemortem" || activeType === "postmortem") {
      const list = [];
      const seen = new Set();

      const anteCondemnedTags = new Set(
        (condemned || [])
          .filter((c) => {
            const stg = c.inspection_type || (c.part === "Live Animal" || String(c.notes || "").toLowerCase().includes("ante") ? "Ante-Mortem" : "Post-Mortem");
            return stg === "Ante-Mortem" || c.part === "Live Animal";
          })
          .map((c) => String(c.tag_number || "").trim().toLowerCase())
      );

      const postCondemnedTags = new Set(
        (condemned || [])
          .filter((c) => {
            const stg = c.inspection_type || (c.part === "Live Animal" || String(c.notes || "").toLowerCase().includes("ante") ? "Ante-Mortem" : "Post-Mortem");
            return stg === "Post-Mortem" && c.part !== "Live Animal";
          })
          .map((c) => String(c.tag_number || "").trim().toLowerCase())
      );

      if (activeType !== "postmortem") {
        const anteSeen = new Set();
        (ante || []).forEach((a) => {
          const key = `am-${a.id || a.tag_number}`;
          const tag = String(a.tag_number || "").trim().toLowerCase();
          if (tag) anteSeen.add(tag);
          if (seen.has(key)) return;
          const animal = livestockByTag.get(tag);
          const owner = resolveOwner(a, animal);
          const dec = String(a.decision || "").trim();
          const dLower = dec.toLowerCase();

          // Exclude condemned and partially condemned from Ante-Mortem (routed to Condemnations)
          if (
            dLower.includes("condemn") ||
            dLower.includes("reject") ||
            dLower.includes("partial") ||
            anteCondemnedTags.has(tag) ||
            (animal && (String(animal.status || "").toLowerCase().includes("condemn") || String(animal.status || "").toLowerCase().includes("reject")))
          ) {
            return;
          }

          seen.add(key);
          const status = (!dec || dLower === "pending" || dLower.includes("await")) ? "Pending" : dec;
          list.push({
            id: key,
            reportTitle: "Ante-Mortem Inspection",
            stageLabel: "Ante-Mortem",
            tag_number: a.tag_number || "—",
            species: a.species || animal?.species || "Livestock",
            sex: formatSex(a.sex || animal?.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: a.findings || a.remarks || (status === "Pending" ? "Awaiting clinical examination" : "No clinical abnormalities noted"),
            weight_kg: 0,
            personnel: a.inspector_name || "Veterinary Inspector",
            date: a.created_at || a.inspected_at || a.date,
            status,
            raw: a,
          });
        });

        // Also include marked livestock currently awaiting ante-mortem examination
        (livestock || []).forEach((l) => {
          const tag = String(l.tag_number || "").trim().toLowerCase();
          if (!tag || anteSeen.has(tag)) return;
          const s = String(l.status || "").toLowerCase();
          if (
            s === "pending marking" ||
            s === "for marking" ||
            s === "ready for marking" ||
            s === "received" ||
            s === "returned to animal marking" ||
            s === "returned to marking" ||
            Boolean(l.fallback_at)
          ) return;
          const isMarked = Boolean(
            (l.marked === true || l.marked === "true" || l.marked === 1 || l.marked === "1" || l.marked === "t") &&
            l.marked !== "false" &&
            l.marked !== false &&
            (Boolean(l.mark_type) || Boolean(l.mark_date) || Boolean(l.marked_at) || s === "marked")
          );
          if (!isMarked) return;
          if (s.includes("condemn") || s.includes("reject") || anteCondemnedTags.has(tag)) return;
          if (
            s === "completed" ||
            s === "ante-mortem passed" ||
            s === "ready for slaughter" ||
            s === "slaughtered" ||
            s === "weighed" ||
            s === "permit issued" ||
            s === "released" ||
            s === "dispatched"
          ) return;
          if (procByTag.has(tag) || srByTag.has(tag) || carcassByTag.has(tag) || permitByTag.has(tag)) return;

          const key = `am-awaiting-${l.id || tag}`;
          if (seen.has(key)) return;
          seen.add(key);
          const owner = resolveOwner(l, l);
          list.push({
            id: key,
            reportTitle: "Ante-Mortem Inspection",
            stageLabel: "Ante-Mortem",
            tag_number: l.tag_number || "—",
            species: l.species || "Livestock",
            sex: formatSex(l.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: "Awaiting Ante-Mortem clinical examination",
            weight_kg: 0,
            personnel: l.marked_by || extractStaffActor(l) || "Staff Personnel",
            date: l.marked_at || l.mark_date || l.created_at || l.received_date,
            status: "Pending",
            raw: l,
          });
        });
      }

      if (activeType !== "antemortem") {
        (post || []).forEach((p) => {
          const dLower = String(p.decision || "").trim().toLowerCase();
          if (!dLower || dLower === "pending" || dLower.includes("awaiting")) return;
          const pTag = String(p.tag_number || "").trim().toLowerCase();
          const partsCount = Array.isArray(p.condemned_parts) ? p.condemned_parts.length : 0;

          // Exclude condemned and partially condemned from Post-Mortem (routed to Condemnations)
          if (
            dLower.includes("condemn") ||
            dLower.includes("reject") ||
            dLower.includes("partial") ||
            partsCount > 0 ||
            postCondemnedTags.has(pTag)
          ) {
            return;
          }

          const key = `pm-${p.id || p.tag_number}`;
          if (seen.has(key)) return;
          seen.add(key);
          const animal = livestockByTag.get(pTag);
          const owner = resolveOwner(p, animal);
          list.push({
            id: key,
            reportTitle: "Post-Mortem Inspection",
            stageLabel: "Post-Mortem",
            tag_number: p.tag_number || "—",
            species: p.species || animal?.species || "Livestock",
            sex: formatSex(p.sex || animal?.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: p.findings || p.remarks || "Wholesome carcass",
            weight_kg: 0,
            personnel: p.inspector_name || "Veterinary Inspector",
            date: p.created_at || p.inspected_at || p.date,
            status: p.decision || "Approved",
            raw: p,
          });
        });
      }

      if (activeType === "inspection") {
        (condemned || []).forEach((c) => {
          const tagKey = String(c.tag_number || "").trim().toLowerCase();
          const animal = livestockByTag.get(tagKey);
          const owner = resolveOwner(c, animal);
          const stage =
            c.inspection_type ||
            (c.part === "Live Animal" || String(c.notes || "").toLowerCase().includes("ante")
              ? "Ante-Mortem"
              : "Post-Mortem");
          const key = `cond-${c.id || `${stage}-${tagKey}`}`;
          if (seen.has(key)) return;
          seen.add(key);
          const w = parseFloat(c.weight_kg || c.quantity) || 0;
          const st = resolveCondemnationStatus(c, stage);
          const partLabel = c.part || (st === "Condemned" ? "Whole Carcass" : "Condemned Cut");
          list.push({
            id: key,
            reportTitle: `${stage} Condemnation`,
            stageLabel: `${stage} Condemnation`,
            tag_number: c.tag_number || "—",
            species: c.species || animal?.species || "Livestock",
            sex: formatSex(c.sex || animal?.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: `Part: ${partLabel} · Reason: ${c.reason || "Pathological finding"} (${c.quantity || (w > 0 ? `${w} kg` : "1 Head")})`,
            weight_kg: w,
            personnel: c.inspector || "Veterinary Inspector",
            date: c.created_at || c.date,
            status: st,
            raw: c,
          });
        });
      }

      return list;
    }

    // 4. VET CARCASS WEIGHING & BRANDING ('weighing')
    if (activeType === "weighing") {
      return (carcass || []).map((c) => {
        const animal = livestockByTag.get(String(c.tag_number || "").trim().toLowerCase());
        const owner = resolveOwner(c, animal);
        const w = Number(c.total_weight || c.cold_weight || c.hot_weight || 0);
        return {
          id: c.id || c.tag_number,
          reportTitle: "Carcass Weighing & Branding",
          stageLabel: "Carcass Weighing",
          tag_number: c.tag_number || "—",
          species: c.species || animal?.species || "Livestock",
          sex: formatSex(c.sex || animal?.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `Weight: ${w.toFixed(1)} kg · Grade: ${c.grade || "A"} · Brand: ${c.brand_code || "NAGA-PASSED"}`,
          weight_kg: w,
          personnel: c.weighed_by || c.inspector_name || "Veterinary Personnel",
          date: c.weighed_at || c.created_at || c.date,
          status: c.status || "Weighed",
          raw: c,
        };
      });
    }

    // 5. CONDEMNATION RECORDS ('condemnation')
    if (activeType === "condemnation") {
      const list = [];
      const covered = new Set();

      (condemned || []).forEach((c) => {
        const tagKey = String(c.tag_number || "").trim().toLowerCase();
        const animal = livestockByTag.get(tagKey);
        const owner = resolveOwner(c, animal);
        const stage =
          c.inspection_type ||
          (c.part === "Live Animal" || String(c.notes || "").toLowerCase().includes("ante")
            ? "Ante-Mortem"
            : "Post-Mortem");
        covered.add(`${stage}|${tagKey}`);
        const w = parseFloat(c.weight_kg || c.quantity) || 0;
        const st = resolveCondemnationStatus(c, stage);
        const partLabel = c.part || (st === "Condemned" ? "Whole Carcass" : "Condemned Cut");
        list.push({
          id: c.id || `${stage}-${tagKey}`,
          reportTitle: `${stage} Condemnation`,
          stageLabel: stage,
          tag_number: c.tag_number || "—",
          species: c.species || animal?.species || "Livestock",
          sex: formatSex(c.sex || animal?.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `Part: ${partLabel} · Reason: ${c.reason || "Pathological finding"} (${c.quantity || (w > 0 ? `${w} kg` : "1 Head")})`,
          weight_kg: w,
          personnel: c.inspector || "Veterinary Inspector",
          date: c.created_at || c.date,
          status: st,
          raw: c,
        });
      });

      (ante || []).forEach((a) => {
        const dLower = String(a.decision || "").toLowerCase();
        if (!dLower.includes("condemn") && !dLower.includes("reject")) return;
        const tagKey = String(a.tag_number || "").trim().toLowerCase();
        if (covered.has(`Ante-Mortem|${tagKey}`)) return;
        covered.add(`Ante-Mortem|${tagKey}`);
        const animal = livestockByTag.get(tagKey);
        const owner = resolveOwner(a, animal);
        list.push({
          id: `ante-cond-${a.id || tagKey}`,
          reportTitle: "Ante-Mortem Condemnation",
          stageLabel: "Ante-Mortem",
          tag_number: a.tag_number || "—",
          species: a.species || animal?.species || "Livestock",
          sex: formatSex(a.sex || animal?.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `Live Animal · Reason: ${a.findings || a.remarks || "Condemned at screening"}`,
          weight_kg: 0,
          personnel: a.inspector_name || "Veterinary Inspector",
          date: a.created_at || a.date,
          status: "Condemned",
          raw: a,
        });
      });

      (post || []).forEach((p) => {
        const dLower = String(p.decision || "").trim().toLowerCase();
        const isWholePost = dLower === "condemned" || dLower === "rejected" || dLower.includes("whole") || dLower.includes("totally");
        const isPartialPost = !isWholePost && (
          dLower.includes("partial") ||
          (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0)
        );
        if (!isWholePost && !isPartialPost) return;
        const tagKey = String(p.tag_number || "").trim().toLowerCase();
        if (covered.has(`Post-Mortem|${tagKey}`)) return;
        covered.add(`Post-Mortem|${tagKey}`);
        const animal = livestockByTag.get(tagKey);
        const owner = resolveOwner(p, animal);

        if (isWholePost) {
          list.push({
            id: `post-cond-${p.id || tagKey}`,
            reportTitle: "Post-Mortem Condemnation",
            stageLabel: "Post-Mortem",
            tag_number: p.tag_number || "—",
            species: p.species || animal?.species || "Livestock",
            sex: formatSex(p.sex || animal?.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: `Whole Carcass · Reason: ${p.findings || p.remarks || "Condemned at post-mortem"}`,
            weight_kg: 0,
            personnel: p.inspector_name || "Veterinary Inspector",
            date: p.created_at || p.inspected_at || p.date,
            status: "Condemned",
            raw: p,
          });
        } else if (isPartialPost) {
          const parts = Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0
            ? p.condemned_parts.map((cp) => cp.part || cp).join(", ")
            : p.part || "Condemned Cut";
          list.push({
            id: `post-part-${p.id || tagKey}`,
            reportTitle: "Post-Mortem Condemnation",
            stageLabel: "Post-Mortem",
            tag_number: p.tag_number || "—",
            species: p.species || animal?.species || "Livestock",
            sex: formatSex(p.sex || animal?.sex),
            owner_id: owner.id,
            owner_name: owner.name,
            owner_contact: owner.contact,
            owner_address: owner.address,
            details: `Part: ${parts} · Reason: ${p.findings || p.remarks || "Partial condemnation"}`,
            weight_kg: 0,
            personnel: p.inspector_name || "Veterinary Inspector",
            date: p.created_at || p.inspected_at || p.date,
            status: "Partially Condemned",
            raw: p,
          });
        }
      });

      return list;
    }

    // 6. SLAUGHTER PROCESSING & TEAM ASSIGNMENTS (Admin 'slaughter' or Staff 'slaughter')
    if (activeType === "slaughter") {
      const seenTags = new Set();
      const list = [];

      const combined = [...(slaughterProcessing || []), ...(slaughterRecords || [])];
      combined.forEach((rec) => {
        const tagKey = String(rec.tag_number || "").trim().toLowerCase();
        if (!tagKey || seenTags.has(tagKey)) return;
        seenTags.add(tagKey);

        const proc = procByTag.get(tagKey) || rec;
        const sr = srByTag.get(tagKey) || rec;
        const animal = livestockByTag.get(tagKey);
        const cw = carcassByTag.get(tagKey);
        const owner = resolveOwner(proc, animal);

        const operatorTeam = proc.operator || sr.operator || animal?.previous_operator || "Unassigned";
        const actor = proc.processed_by || operatorTeam;
        const w = Number(cw?.total_weight || cw?.cold_weight || animal?.weight || 0);
        const statusVal = proc.status || sr.status || animal?.status || "Scheduled";
        const ts =
          proc.completed_at ||
          proc.updated_at ||
          proc.processed_at ||
          proc.reassigned_at ||
          sr.slaughter_date ||
          sr.scheduled_date ||
          proc.date;

        list.push({
          id: proc.id || sr.id || tagKey,
          reportTitle: normalizedRole === "staff" ? "Team Operator and Slaughter" : "Slaughter Processing",
          stageLabel: `Team: ${operatorTeam}`,
          tag_number: proc.tag_number || sr.tag_number || "—",
          species: proc.species || animal?.species || "Livestock",
          sex: formatSex(animal?.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `Assigned Team: ${operatorTeam}${w > 0 ? ` · Carcass Weight: ${w.toFixed(1)} kg` : ""}`,
          weight_kg: w,
          personnel: actor !== operatorTeam ? `${operatorTeam} (${actor})` : operatorTeam,
          date: ts,
          status: statusVal,
          raw: proc,
        });
      });

      return list;
    }

    // 7. MEAT PERMITS & DISPATCH (Admin 'permits' or Staff 'permits')
    if (activeType === "permits") {
      const seenTags = new Set();
      const list = [];

      // Check livestock that have been weighed, permitted, or released
      (livestock || []).forEach((l) => {
        const tagKey = String(l.tag_number || "").trim().toLowerCase();
        if (!tagKey || seenTags.has(tagKey)) return;
        const cw = carcassByTag.get(tagKey);
        const pmt = permitByTag.get(tagKey);
        const dsp = dispatchByTag.get(tagKey);
        const isEligibleOrIssued =
          Boolean(pmt) ||
          Boolean(l.permit_no) ||
          Boolean(l.permit_issued_at) ||
          Boolean(cw) ||
          l.status === "Released" ||
          l.status === "Dispatched" ||
          l.status === "Permit Issued" ||
          l.status === "Ready for Dispatch" ||
          l.status === "Weighed";

        if (!isEligibleOrIssued) return;
        seenTags.add(tagKey);

        const owner = resolveOwner(l, l);
        const w = Number(cw?.total_weight || cw?.cold_weight || l.weight || 0);
        const permitNo = pmt?.permit_no || l.permit_no || "Pending Permit";
        const isIssued = Boolean(pmt?.permit_no || l.permit_no || l.permit_issued_at || l.status === "Released" || l.status === "Permit Issued" || l.status === "Ready for Dispatch");

        list.push({
          id: pmt?.id || `pmt-${l.id || tagKey}`,
          reportTitle: "Meat Permit",
          stageLabel: isIssued ? "Permit Issued" : "Ready for Permit",
          tag_number: l.tag_number || "—",
          species: l.species || cw?.species || "Livestock",
          sex: formatSex(l.sex || cw?.sex),
          owner_id: owner.id,
          owner_name: owner.name,
          owner_contact: owner.contact,
          owner_address: owner.address,
          details: `Permit #: ${permitNo}${w > 0 ? ` · Certified Weight: ${w.toFixed(1)} kg` : ""}${cw?.brand_code ? ` · Brand: ${cw.brand_code}` : ""}`,
          weight_kg: w,
          personnel: pmt?.issued_by || dsp?.released_by || extractStaffActor(l, "permit") || "Staff Personnel",
          date: dsp?.created_at || pmt?.issued_at || l.permit_issued_at || cw?.weighed_at || l.updated_at || l.created_at,
          status: l.status === "Released" ? "Released" : isIssued ? "Permit Issued" : "Awaiting Permit",
          raw: l,
        });
      });

      return list;
    }

    // 8. ADMIN — VET & STAFF PERSONNEL ACTIVITY SUMMARY ('personnel')
    if (normalizedRole === "admin" && activeType === "personnel") {
      return (auditLogs || [])
        .filter((log) => {
          const r = String(log.role || "").toLowerCase();
          return r === "vet" || r === "staff" || r === "admin" || Boolean(log.user);
        })
        .map((log) => {
          const roleLabel =
            String(log.role || "").toLowerCase() === "vet"
              ? "Vet Personnel"
              : String(log.role || "").toLowerCase() === "staff"
              ? "Staff Personnel"
              : "Administrator";
          const tagKey = String(log.tag_number || "").trim().toLowerCase();
          const animal = tagKey ? livestockByTag.get(tagKey) : null;
          const actorName = log.user || roleLabel;

          return {
            id: log.id,
            reportTitle: `${roleLabel} Activity`,
            stageLabel: log.module || roleLabel,
            tag_number: log.tag_number || log.module || "SYS",
            species: animal?.species || log.module || "System",
            sex: animal?.sex ? formatSex(animal.sex) : roleLabel,
            owner_id: `${actorName}|||${roleLabel}`,
            owner_name: actorName,
            owner_contact: roleLabel,
            owner_address: `Module: ${log.module || "Operations"}`,
            details: log.action || "Recorded operational action",
            weight_kg: 0,
            personnel: `${actorName} (${roleLabel})`,
            date: log.timestamp || log.created_at,
            status: "Completed",
            raw: log,
          };
        });
    }

    return [];
  }, [
    normalizedRole,
    activeType,
    livestock,
    ante,
    post,
    condemned,
    carcass,
    slaughterProcessing,
    slaughterRecords,
    permits,
    dispatchRecords,
    auditLogs,
    lookupMaps,
  ]);

  // Apply Search, Species Filter, Date Range Filter, and Status Filter
  const filteredRows = useMemo(() => {
    const todayManila = toManilaDateStr(new Date());
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const currentMonthPrefix = todayManila.slice(0, 7);

    const q = search.trim().toLowerCase();

    return rawReportRows
      .filter((row) => {
        if (filterSpecies !== "all" && row.species !== filterSpecies) {
          return false;
        }

        if (datePreset !== "all") {
          const rowDateStr = toManilaDateStr(row.date);
          if (!rowDateStr) return false;
          if (datePreset === "today" && rowDateStr !== todayManila) return false;
          if (datePreset === "week") {
            const d = new Date(row.date);
            if (isNaN(d.getTime()) || d < weekAgo) return false;
          }
          if (datePreset === "month" && !rowDateStr.startsWith(currentMonthPrefix)) return false;
          if (datePreset === "custom") {
            if (dateFrom && rowDateStr < dateFrom) return false;
            if (dateTo && rowDateStr > dateTo) return false;
          }
        }

        if (statusFilter !== "all") {
          const sLower = String(row.status || "").trim().toLowerCase();

          if (activeType === "condemnation") {
            if (statusFilter === "condemned") {
              if (row.status !== "Condemned" || sLower.includes("partial")) return false;
            } else if (statusFilter === "partially_condemned" || statusFilter === "partial") {
              if (row.status !== "Partially Condemned" && !sLower.includes("partial")) return false;
              if (row.status === "Condemned" || sLower === "condemned") return false;
            }
          } else if (activeType === "antemortem") {
            if (statusFilter === "approved") {
              if (!sLower.includes("approv") && !sLower.includes("pass")) return false;
            } else if (statusFilter === "pending") {
              if (!sLower.includes("pending") && !sLower.includes("await")) return false;
            }
          } else if (activeType === "postmortem") {
            if (statusFilter === "approved") {
              if (!sLower.includes("approv") && !sLower.includes("pass")) return false;
            }
          } else if (activeType === "inspection") {
            if (statusFilter === "approved") {
              if (!sLower.includes("approv") && !sLower.includes("pass")) return false;
              if (sLower.includes("partial")) return false;
            } else if (statusFilter === "pending") {
              if (!sLower.includes("pending") && !sLower.includes("await")) return false;
            } else if (statusFilter === "partially_condemned" || statusFilter === "partial") {
              if (row.status !== "Partially Condemned" && !sLower.includes("partial")) return false;
              if (row.status === "Condemned" || sLower === "condemned") return false;
            } else if (statusFilter === "condemned") {
              if (sLower.includes("partial") || row.status === "Partially Condemned") return false;
              if (!sLower.includes("condemn") && !sLower.includes("reject") && !sLower.includes("suspect")) return false;
            }
          } else if (activeType === "weighing") {
            if (statusFilter === "weighed") {
              if (!sLower.includes("weigh") && !sLower.includes("complet")) return false;
            } else if (statusFilter === "pending") {
              if (sLower.includes("weigh") || sLower.includes("complet")) return false;
            }
          } else if (isRegMarking) {
            if (statusFilter === "completed") {
              if (!sLower.includes("marked")) return false;
            } else if (statusFilter === "pending") {
              if (!sLower.includes("awaiting")) return false;
            }
          } else if (activeType === "slaughter") {
            if (statusFilter === "completed") {
              if (!sLower.includes("slaughtered") && !sLower.includes("completed")) return false;
            } else if (statusFilter === "pending") {
              if (sLower.includes("slaughtered") || sLower.includes("completed")) return false;
            }
          } else if (activeType === "permits") {
            if (statusFilter === "completed") {
              if (!sLower.includes("issued") && !sLower.includes("dispatched") && !sLower.includes("released")) return false;
            } else if (statusFilter === "pending") {
              if (sLower.includes("issued") || sLower.includes("dispatched") || sLower.includes("released")) return false;
            }
          } else {
            const bucket = classifyStatusBucket(row.status);
            if (bucket !== statusFilter) return false;
          }
        }

        if (q) {
          const match =
            String(row.owner_name || "").toLowerCase().includes(q) ||
            String(row.tag_number || "").toLowerCase().includes(q) ||
            String(row.species || "").toLowerCase().includes(q) ||
            String(row.details || "").toLowerCase().includes(q) ||
            String(row.personnel || "").toLowerCase().includes(q) ||
            String(row.status || "").toLowerCase().includes(q) ||
            String(row.stageLabel || "").toLowerCase().includes(q);
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const diff = toTimestampMs(b.date) - toTimestampMs(a.date);
        if (diff !== 0) return diff;
        return String(b.tag_number || "").localeCompare(String(a.tag_number || ""), undefined, { numeric: true });
      });
  }, [rawReportRows, filterSpecies, datePreset, dateFrom, dateTo, statusFilter, search]);

  // Group filtered records by Owner (matching InspectionResults / SlaughterProcessing pattern)
  const groupedData = useMemo(() => {
    const groups = new Map();

    filteredRows.forEach((item) => {
      const key = String(item.owner_id || item.owner_name || "unknown").trim().toLowerCase();
      if (!groups.has(key)) {
        const ownerObj = (owners || []).find(
          (o) =>
            String(o.id || o.owner_id || "").toLowerCase() === key ||
            (o.name || "").toLowerCase().trim() === (item.owner_name || "").toLowerCase().trim()
        );
        const avatarUrl = item.owner_avatar || item.avatar_url || ownerObj?.avatar_url || null;
        groups.set(key, {
          key,
          owner_name: item.owner_name || "Registered Producer",
          owner_avatar: avatarUrl,
          owner_contact: item.owner_contact || "—",
          owner_address: item.owner_address || "—",
          stageLabel: item.stageLabel || item.reportTitle,
          reportTitle: item.reportTitle,
          speciesList: [],
          speciesCounts: {},
          personnelSet: new Set(),
          items: [],
          totalWeight: 0,
          latestTimestamp: 0,
          rawDate: null,
          completedCount: 0,
          pendingCount: 0,
          condemnedCount: 0,
          partialCount: 0,
        });
      }

      const grp = groups.get(key);
      grp.items.push(item);

      const sp = item.species || "Livestock";
      if (!grp.speciesList.includes(sp)) grp.speciesList.push(sp);
      grp.speciesCounts[sp] = (grp.speciesCounts[sp] || 0) + 1;

      if (item.personnel && item.personnel !== "—") {
        grp.personnelSet.add(item.personnel);
      }
      grp.totalWeight += Number(item.weight_kg || 0);

      const ms = toTimestampMs(item.date);
      if (ms > grp.latestTimestamp) {
        grp.latestTimestamp = ms;
        grp.rawDate = item.date;
      }

      const b = classifyStatusBucket(item.status);
      if (b === "completed") grp.completedCount += 1;
      else if (b === "condemned") grp.condemnedCount += 1;
      else if (b === "partial") grp.partialCount += 1;
      else grp.pendingCount += 1;
    });

    const SPECIES_ORDER = ["Hog", "Carabao", "Cattle", "Goat"];
    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        speciesList: [...g.speciesList].sort((a, b) => {
          const idxA = SPECIES_ORDER.indexOf(a);
          const idxB = SPECIES_ORDER.indexOf(b);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.localeCompare(b);
        }),
        count: g.items.length,
        personnelSummary: Array.from(g.personnelSet).slice(0, 2).join(", ") || "Assigned Personnel",
      }))
      .sort((a, b) => {
        if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
        return a.owner_name.localeCompare(b.owner_name);
      });
  }, [filteredRows]);

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return groupedData.find((g) => g.key === selectedOwnerKey) || null;
  }, [groupedData, selectedOwnerKey]);

  const paginatedOwnerItems = useMemo(() => {
    if (!selectedOwnerView?.items) return [];
    const start = (ownerViewPage - 1) * ownerViewPageSize;
    return selectedOwnerView.items.slice(start, start + ownerViewPageSize);
  }, [selectedOwnerView, ownerViewPage, ownerViewPageSize]);

  const totalGroups = groupedData.length;
  const totalPages = Math.ceil(totalGroups / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return groupedData.slice(start, start + pageSize);
  }, [groupedData, currentPage, pageSize]);

  // Unfiltered module KPI counts (unaffected by active statusFilter)
  const moduleBaseStats = useMemo(() => {
    const totalRecords = rawReportRows.length;
    const ownerKeys = new Set(
      rawReportRows.map((r) => String(r.owner_id || r.owner_name || "unknown").trim().toLowerCase())
    );
    const totalOwners = ownerKeys.size;
    const completedCount = rawReportRows.filter((r) => classifyStatusBucket(r.status) === "completed").length;
    const pendingCount = rawReportRows.filter((r) => classifyStatusBucket(r.status) === "pending").length;
    const condemnedCount = rawReportRows.filter((r) => classifyStatusBucket(r.status) === "condemned").length;
    const partialCount = rawReportRows.filter((r) => classifyStatusBucket(r.status) === "partial").length;
    const totalWeight = rawReportRows.reduce((s, r) => s + Number(r.weight_kg || 0), 0);

    return {
      totalRecords,
      totalOwners,
      completedCount,
      pendingCount,
      condemnedCount,
      partialCount,
      totalWeight,
    };
  }, [rawReportRows]);

  // Summary KPI counts
  const summaryStats = useMemo(() => {
    const totalRecords = filteredRows.length;
    const totalOwners = groupedData.length;
    const completedCount = filteredRows.filter((r) => classifyStatusBucket(r.status) === "completed").length;
    const pendingCount = filteredRows.filter((r) => classifyStatusBucket(r.status) === "pending").length;
    const condemnedCount = filteredRows.filter((r) => classifyStatusBucket(r.status) === "condemned").length;
    const partialCount = filteredRows.filter((r) => classifyStatusBucket(r.status) === "partial").length;
    const totalWeight = filteredRows.reduce((s, r) => s + Number(r.weight_kg || 0), 0);

    return {
      totalRecords,
      totalOwners,
      completedCount,
      pendingCount,
      condemnedCount,
      partialCount,
      totalWeight,
    };
  }, [filteredRows, groupedData]);

  const activeReportMeta = useMemo(
    () => reportTypes.find((t) => t.id === activeType) || reportTypes[0],
    [reportTypes, activeType]
  );

  const tabCounts = useMemo(() => {
    const { carcassByTag, permitByTag } = lookupMaps;

    // Slaughter records count
    const slaughterSeen = new Set();
    [...(slaughterProcessing || []), ...(slaughterRecords || [])].forEach((r) => {
      const t = String(r?.tag_number || "").trim().toLowerCase();
      if (t) slaughterSeen.add(t);
    });

    // Meat permits count
    const permitsSeen = new Set();
    (livestock || []).forEach((l) => {
      const tagKey = String(l?.tag_number || "").trim().toLowerCase();
      if (!tagKey || permitsSeen.has(tagKey)) return;
      const cw = carcassByTag.get(tagKey);
      const pmt = permitByTag.get(tagKey);
      const isEligibleOrIssued =
        Boolean(pmt) ||
        Boolean(l?.permit_no) ||
        Boolean(l?.permit_issued_at) ||
        Boolean(cw) ||
        l?.status === "Released" ||
        l?.status === "Dispatched" ||
        l?.status === "Permit Issued" ||
        l?.status === "Ready for Dispatch" ||
        l?.status === "Weighed";
      if (isEligibleOrIssued) permitsSeen.add(tagKey);
    });

    const anteCondTags = new Set(
      (condemned || [])
        .filter((c) => {
          const stg = c?.inspection_type || (c?.part === "Live Animal" || String(c?.notes || "").toLowerCase().includes("ante") ? "Ante-Mortem" : "Post-Mortem");
          return stg === "Ante-Mortem" || c?.part === "Live Animal";
        })
        .map((c) => String(c?.tag_number || "").trim().toLowerCase())
    );

    const postCondTags = new Set(
      (condemned || [])
        .filter((c) => {
          const stg = c?.inspection_type || (c?.part === "Live Animal" || String(c?.notes || "").toLowerCase().includes("ante") ? "Ante-Mortem" : "Post-Mortem");
          return stg === "Post-Mortem" && c?.part !== "Live Animal";
        })
        .map((c) => String(c?.tag_number || "").trim().toLowerCase())
    );

    // Ante-mortem inspected count (excluding condemned & partially condemned)
    const anteInspectedCount = (ante || []).filter((a) => {
      const d = String(a?.decision || "").trim().toLowerCase();
      if (!d || d === "pending" || d.includes("awaiting")) return false;
      if (d.includes("condemn") || d.includes("reject") || d.includes("partial")) return false;
      const tagKey = String(a?.tag_number || "").trim().toLowerCase();
      if (anteCondTags.has(tagKey)) return false;
      return true;
    }).length;

    // Post-mortem inspected count (excluding condemned & partially condemned)
    const postInspectedCount = (post || []).filter((p) => {
      const d = String(p?.decision || "").trim().toLowerCase();
      if (!d || d === "pending" || d.includes("awaiting")) return false;
      if (d.includes("condemn") || d.includes("reject") || d.includes("partial")) return false;
      const partsCount = Array.isArray(p?.condemned_parts) ? p.condemned_parts.length : 0;
      if (partsCount > 0) return false;
      const tagKey = String(p?.tag_number || "").trim().toLowerCase();
      if (postCondTags.has(tagKey)) return false;
      return true;
    }).length;

    // Condemnations count
    const condSeen = new Set();
    (condemned || []).forEach((c) => {
      const tagKey = String(c?.tag_number || "").trim().toLowerCase();
      const stage =
        c?.inspection_type ||
        (c?.part === "Live Animal" || String(c?.notes || "").toLowerCase().includes("ante")
          ? "Ante-Mortem"
          : "Post-Mortem");
      condSeen.add(`${stage}|${tagKey}`);
    });
    let anteCondCount = 0;
    (ante || []).forEach((a) => {
      const dLower = String(a?.decision || "").toLowerCase();
      if (!dLower.includes("condemn") && !dLower.includes("reject")) return;
      const tagKey = String(a?.tag_number || "").trim().toLowerCase();
      if (!condSeen.has(`Ante-Mortem|${tagKey}`)) anteCondCount++;
    });
    const totalCondemned = (condemned || []).length + anteCondCount;

    // Personnel activity count
    const personnelCount = (auditLogs || []).filter((log) => {
      const r = String(log?.role || "").toLowerCase();
      return r === "vet" || r === "staff" || r === "admin" || Boolean(log?.user);
    }).length;

    return {
      transactions: (livestock || []).length,
      livestock: (livestock || []).length,
      receiving: (livestock || []).length,
      slaughter: slaughterSeen.size,
      permits: permitsSeen.size,
      inspection: anteInspectedCount + postInspectedCount + (condemned || []).length,
      antemortem: anteInspectedCount,
      postmortem: postInspectedCount,
      weighing: (carcass || []).length,
      condemnation: totalCondemned,
      personnel: personnelCount,
    };
  }, [
    livestock,
    slaughterProcessing,
    slaughterRecords,
    ante,
    post,
    carcass,
    condemned,
    auditLogs,
    lookupMaps,
  ]);

  const isFilterActive = Boolean(
    search || filterSpecies !== "all"
  );

  const statusFilterOptions = useMemo(() => {
    // 1. Condemnations module: only Condemned & Partially Condemned
    if (activeType === "condemnation") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "condemned", label: "Condemned" },
        { id: "partially_condemned", label: "Partially Condemned" },
      ];
    }

    // 2. Ante-Mortem module: only Approved & Awaiting / Pending
    if (activeType === "antemortem") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "approved", label: "Approved" },
        { id: "pending", label: "Awaiting / Pending" },
      ];
    }

    // 3. Post-Mortem module
    if (activeType === "postmortem") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "approved", label: "Approved / Passed" },
      ];
    }

    // 3b. Admin Inspection Records module (Ante-Mortem, Post-Mortem & Condemnations)
    if (activeType === "inspection") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "approved", label: "Approved / Passed" },
        { id: "pending", label: "Pending / Awaiting" },
        { id: "partially_condemned", label: "Partially Condemned" },
        { id: "condemned", label: "Condemned" },
      ];
    }

    // 4. Carcass Weighing module
    if (activeType === "weighing") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "weighed", label: "Weighed" },
        { id: "pending", label: "Pending" },
      ];
    }

    // 5. Registration & Marking (Admin 'livestock' or Staff 'receiving')
    if (isRegMarking) {
      return [
        { id: "all", label: "All Statuses" },
        { id: "completed", label: "Marked" },
        { id: "pending", label: "Awaiting Marking" },
      ];
    }

    // 6. Team Operator and Slaughter
    if (activeType === "slaughter") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "completed", label: "Slaughtered" },
        { id: "pending", label: "In Progress / Floor" },
      ];
    }

    // 7. Meat Permits
    if (activeType === "permits") {
      return [
        { id: "all", label: "All Statuses" },
        { id: "completed", label: "Permit Issued" },
        { id: "pending", label: "Pending" },
      ];
    }

    return STATUS_FILTERS;
  }, [activeType, isRegMarking]);

  const clearAllFilters = () => {
    setSearch("");
    setFilterSpecies("all");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setPage(1);
  };

  const getDateRangeDescription = () => {
    if (datePreset === "today") return `Today (${formatPhDate(new Date())})`;
    if (datePreset === "week") return "This Week (Last 7 Days)";
    if (datePreset === "month") return "This Month";
    if (datePreset === "custom") {
      return `${dateFrom ? formatPhDate(dateFrom) : "Start"} to ${dateTo ? formatPhDate(dateTo) : "Present"}`;
    }
    return "All Time";
  };

  // Export ALL matching records to Excel-compatible CSV (no payment/fees)
  const handleExportExcel = (rowsToExport = filteredRows, customTitle = null) => {
    if (!rowsToExport || rowsToExport.length === 0) {
      showToast("No matching records to export", "warning");
      return;
    }
    const headers = [
      "Report Title",
      "Owner / Producer",
      "Contact",
      "Tag Number",
      "Species",
      "Sex",
      "Stage",
      isRegMarking ? "Type of Marking" : "Details / Findings",
      "Weight (kg)",
      "Responsible Personnel",
      "Date & Time (Asia/Manila)",
      "Status",
    ];
    const csvRows = rowsToExport.map((r) =>
      [
        r.reportTitle || activeReportMeta.title,
        r.owner_name || "—",
        r.owner_contact || "—",
        r.tag_number || "—",
        r.species || "—",
        r.sex || "—",
        r.stageLabel || "—",
        isRegMarking ? (r.raw?.mark_type || "Ear Tag") : (r.details || "—"),
        r.weight_kg > 0 ? Number(r.weight_kg).toFixed(2) : "—",
        r.personnel || "—",
        r.date ? formatPhDateTime(r.date) : "—",
        r.status || "—",
      ]
        .map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );

    const csvContent = "\uFEFF" + [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeSlug = String(customTitle || activeReportMeta.id || "lsmis_report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `${safeSlug}_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${rowsToExport.length} record(s) to Excel (CSV)`, "success");
  };

  // Export / Print PDF containing ALL matching records across all pages
  const handleExportPDF = (rowsToExport = filteredRows, reportTitle = activeReportMeta.title, ownerHeader = null) => {
    if (!rowsToExport || rowsToExport.length === 0) {
      showToast("No matching records to print or export", "warning");
      return;
    }

    const totalW = rowsToExport.reduce((s, r) => s + Number(r.weight_kg || 0), 0);
    const generatedBy = session?.full_name || session?.name || session?.email || `${normalizedRole.toUpperCase()} Personnel`;
    const generatedAt = formatPhDateTime(new Date().toISOString());
    const dateRangeText = getDateRangeDescription();

    const escapeHtml = (str) =>
      String(str ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const tableRowsHtml = rowsToExport
      .map(
        (r, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td style="font-weight:700;">${escapeHtml(r.owner_name)}</td>
          <td style="font-family:monospace;font-weight:700;">${escapeHtml(r.tag_number)}</td>
          <td>${escapeHtml(r.species)} ${r.sex && r.sex !== "—" ? `(${escapeHtml(r.sex)})` : ""}</td>
          <td>${escapeHtml(r.stageLabel)}</td>
          <td>${escapeHtml(isRegMarking ? (r.raw?.mark_type || "Ear Tag") : (r.details || "—"))}</td>
          <td>${escapeHtml(r.personnel)}</td>
          <td>${escapeHtml(r.date ? formatPhDateTime(r.date) : "—")}</td>
          <td style="font-weight:700;">${escapeHtml(r.status)}</td>
        </tr>`
      )
      .join("");

    const printWin = window.open("", "_blank", "width=1060,height=780");
    if (!printWin) {
      showToast("Pop-up blocked. Please allow pop-ups to print or save PDF.", "error");
      return;
    }

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(reportTitle)}</title>
        <style>
          @page { size: letter landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 16px; font-size: 11px; }
          .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
          .header p { margin: 2px 0; font-size: 11px; color: #334155; }
          .header h2 { margin: 4px 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
          .header h3 { margin: 4px 0 0; font-size: 13.5px; color: #0284c7; text-transform: uppercase; }
          .meta-grid { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
          th { background: #0f172a; color: #ffffff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; border: 1px solid #0f172a; }
          td { padding: 6px 8px; border: 1px solid #cbd5e1; vertical-align: top; }
          tr:nth-child(even) td { background: #f8fafc; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
          .summary-bar { margin-top: 12px; display: flex; justify-content: flex-end; gap: 20px; font-weight: 700; font-size: 11.5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <p>Republic of the Philippines · Province of Cebu · City of Naga</p>
          <h2>LSMIS Operations Report</h2>
          <p style="margin: 3px 0 0 0; font-size: 11px; color: #475569;">Tinaan, City of Naga, Cebu, Philippines</p>
          <h3>${escapeHtml(reportTitle)}</h3>
        </div>
        <div class="meta-grid">
          <div><strong>Date Range:</strong> ${escapeHtml(dateRangeText)}</div>
          ${ownerHeader ? `<div><strong>Owner / Producer:</strong> ${escapeHtml(ownerHeader)}</div>` : ""}
          <div><strong>Total Records:</strong> ${rowsToExport.length}</div>
          <div><strong>Generated By:</strong> ${escapeHtml(generatedBy)}</div>
          <div><strong>Generated On:</strong> ${escapeHtml(generatedAt)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:34px;text-align:center;">#</th>
              <th style="width:14%;">Owner / Producer</th>
              <th style="width:11%;">Tag #</th>
              <th style="width:10%;">Species / Sex</th>
              <th style="width:11%;">Stage</th>
              <th>${isRegMarking ? "Type of Marking" : "Details / Findings"}</th>
              <th style="width:13%;">Responsible Personnel</th>
              <th style="width:14%;">Date &amp; Time (PH)</th>
              <th style="width:10%;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
        <div class="summary-bar">
          <span>Total Matching Records: ${rowsToExport.length}</span>
          ${totalW > 0 ? `<span>Total Carcass Weight: ${totalW.toFixed(1)} kg</span>` : ""}
        </div>
        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 250); };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
    showToast(`Generated PDF report for ${rowsToExport.length} record(s)`, "success");
  };

  const renderNavTabs = () => {
    const isMonitoring =
      monitoringModule === "livestock" || monitoringModule === "slaughter" || monitoringModule === "permits";

    const tabs = isMonitoring
      ? [
          {
            id: "all",
            label:
              monitoringModule === "livestock"
                ? "All Livestock"
                : monitoringModule === "slaughter"
                ? "All Slaughter"
                : "All Permits",
            count: moduleBaseStats.totalRecords,
            icon:
              monitoringModule === "livestock" ? (
                <Icon.Cow size={14} />
              ) : monitoringModule === "slaughter" ? (
                <Icon.Scissors size={14} />
              ) : (
                <Icon.FileText size={14} />
              ),
            color: "#0284c7",
            badgeBg: "rgba(2, 132, 199, 0.15)",
            badgeColor: "#0284c7",
          },
          {
            id: "completed",
            label:
              monitoringModule === "livestock"
                ? "Marked"
                : monitoringModule === "slaughter"
                ? "Slaughtered"
                : "Permits Issued",
            count: moduleBaseStats.completedCount,
            icon: <Icon.Check size={14} />,
            color: "#10b981",
            badgeBg: "rgba(16, 185, 129, 0.15)",
            badgeColor: "#10b981",
          },
          {
            id: "pending",
            label:
              monitoringModule === "livestock"
                ? "Awaiting Marking"
                : monitoringModule === "slaughter"
                ? "In Progress / Floor"
                : "Pending Clearance",
            count: moduleBaseStats.pendingCount,
            icon: <Icon.Clock size={14} />,
            color: "#d97706",
            badgeBg: "rgba(217, 119, 6, 0.15)",
            badgeColor: "#d97706",
          },
        ]
      : reportTypes.map((tab) => ({
          id: tab.id,
          label: tab.label,
          count: tabCounts[tab.id] ?? (activeType === tab.id ? rawReportRows.length : 0),
          icon: React.isValidElement(tab.icon) ? React.cloneElement(tab.icon, { size: 14 }) : tab.icon,
          color: tab.color,
          badgeBg: tab.badgeBg,
          badgeColor: tab.badgeColor,
        }));

    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "var(--color-bg)",
          padding: "3px",
          borderRadius: 9,
          border: "1px solid var(--color-border)",
          gap: isCompact ? 2 : 4,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {tabs.map((tab) => {
          const isActive = isMonitoring ? statusFilter === tab.id : activeType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (isMonitoring) {
                  setStatusFilter(tab.id);
                  setSelectedOwnerKey(null);
                  setPage(1);
                } else {
                  setActiveType(tab.id);
                  setSelectedOwnerKey(null);
                  setStatusFilter("all");
                  setPage(1);
                }
              }}
              style={{
                height: 32,
                padding: isCompact ? "0 8px" : "0 10px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: isActive ? "var(--color-surface)" : "transparent",
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.1)" : "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                transition: "all 140ms ease",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span style={{ color: isActive ? tab.color : "var(--color-text-muted)", display: "flex" }}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              <span
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isActive ? tab.badgeBg : "var(--color-border)",
                  color: isActive ? tab.badgeColor : "var(--color-text-muted)",
                }}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="reports-page records-page-container"
      style={{
        width: "100%",
        padding: 0,
      }}
    >
      {/* Main Table Container (Standardized with Animal Marking) */}
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 12,
          overflow: "hidden",
          border: "none",
          boxShadow: "none",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Search & Filter Toolbar — Strictly Single Line & Auto-Compressing */}
        <div
          ref={toolbarRef}
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: 8,
            columnGap: 10,
            padding: isCompact ? "8px 12px" : "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            minHeight: 52,
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          {/* Left: Swapped Navigation Tabs */}
          {renderNavTabs()}

          {/* Right: Search Box, Species Filter, Export PDF & Clear */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, justifyContent: "flex-end" }}>
            {/* Search Box */}
            <div
              style={{
                width: isVeryCompact ? 120 : isCompact ? 140 : 175,
                minWidth: 100,
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
                flexShrink: 1,
              }}
            >
              <Icon.Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  color: searchFocused ? "var(--color-primary, #10b981)" : "var(--color-text-muted)",
                  pointerEvents: "none",
                  transition: "color 0.2s ease",
                  zIndex: 10,
                }}
              />
              <input
                type="text"
                placeholder={isCompact ? "Search..." : "Search Tag #, Owner..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: "100%",
                  height: "100%",
                  paddingLeft: 30,
                  paddingRight: search ? 26 : 8,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 12,
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
                    right: 6,
                    background: "var(--color-border)",
                    border: "none",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
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
                  <Icon.X size={10} />
                </button>
              )}
            </div>

            {/* Species Filter Dropdown */}
            {activeType !== "personnel" && (
              <select
                value={filterSpecies}
                onChange={(e) => {
                  setFilterSpecies(e.target.value);
                  setPage(1);
                }}
                style={{
                  height: 34,
                  padding: "0 8px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  outline: "none",
                  width: isCompact ? 100 : 115,
                  flexShrink: 1,
                }}
              >
                <option value="all">All Species</option>
                <option value="Hog">Hog</option>
                <option value="Cattle">Cattle</option>
                <option value="Carabao">Carabao</option>
                <option value="Goat">Goat</option>
              </select>
            )}

            {/* Export PDF Button (Always fully viewed and never clipped) */}
            {!monitoringModule && (
              <Button
                variant="primary"
                onClick={() => handleExportPDF(filteredRows, activeReportMeta.title, null)}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  justifyContent: "center",
                }}
                title="Export report as PDF"
                aria-label="Export report as PDF"
              >
                <Icon.Printer size={15} style={{ flexShrink: 0 }} />
                <span>Export PDF</span>
              </Button>
            )}

            {/* Clear Filters */}
            {isFilterActive && (
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  height: 34,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-danger)",
                  borderRadius: 8,
                  padding: "0 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                title="Reset search and filters"
              >
                <Icon.X size={13} /> {isCompact ? "" : "Clear"}
              </button>
            )}
          </div>
        </div>

        {/* Table Section (Continuous Scroll with Sticky Header, No Outer Scroll) */}
        <div className="records-scrollable-content" style={{ width: "100%", flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin" }}>
          {isLoading ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 14 }}>
              Loading report records...
            </div>
          ) : filteredRows.length === 0 ? (
            <EmptyState
              title="No report records found"
              message={
                isFilterActive
                  ? "No records match your current search, date range, or status filters."
                  : "Records will appear here automatically as livestock operations are recorded."
              }
              icon={<Icon.PieChart size={40} />}
            />
          ) : (
            /* MAIN OWNER-GROUPED TABLE (Matches InspectionResults UI/UX) */
            <div>
              <table
                className="table"
                style={{
                  width: "100%",
                  minWidth: 960,
                  borderCollapse: "separate",
                  borderSpacing: 0,
                }}
              >
                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ width: "21%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                      {activeType === "personnel" ? "Personnel / Actor" : "Owner / Producer"}
                    </th>
                    <th style={{ width: "14%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                      Report Stage
                    </th>
                    <th style={{ width: "17%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                      Latest Date &amp; Time
                    </th>
                    <th style={{ width: "15%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                      Species
                    </th>
                    <th style={{ width: "11%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>
                      Total Records
                    </th>
                    <th style={{ width: "14%", padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                      Status Summary
                    </th>
                    <th style={{ width: 120, padding: "13px 18px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupedData.map((grp) => (
                    <tr
                      key={grp.key}
                      onClick={() => {
                        if (activeType === "condemnation" && grp.items.length === 1) {
                          setViewingCondemnation(grp.items[0]);
                        } else {
                          setSelectedOwnerKey(grp.key);
                        }
                      }}
                      style={{
                        transition: "background 140ms ease",
                        borderBottom: "1px solid var(--color-border)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--color-bg)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <td style={{ padding: "14px 18px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
                            {grp.owner_avatar ? (
                              <img
                                src={grp.owner_avatar}
                                alt={grp.owner_name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  if (e.currentTarget.nextSibling) {
                                    e.currentTarget.nextSibling.style.display = "flex";
                                  }
                                }}
                                style={{
                                  width: 36,
                                  height: 36,
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
                                width: 36,
                                height: 36,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                                color: "#ffffff",
                                fontSize: 12,
                                fontWeight: 800,
                                display: grp.owner_avatar ? "none" : "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5, lineHeight: 1.3 }}>
                              {grp.owner_name}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {grp.owner_contact !== "—" ? grp.owner_contact : grp.personnelSummary}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Stage — Clean plain text without pill border */}
                      <td style={{ padding: "14px 18px", verticalAlign: "middle" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12.5,
                            fontWeight: 700,
                            color: "#0284c7",
                          }}
                        >
                          <span>{grp.stageLabel}</span>
                        </span>
                      </td>

                      {/* Latest Date & Time */}
                      <td style={{ padding: "14px 18px", verticalAlign: "middle", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.75, color: "#0284c7", flexShrink: 0 }} />
                          <span>{grp.rawDate ? formatPhDateTime(grp.rawDate) : "—"}</span>
                        </div>
                      </td>

                      {/* Species — Clean inline comma-separated text without counts */}
                      <td style={{ padding: "14px 18px", verticalAlign: "middle" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          {(grp.speciesList || []).join(", ") || "Livestock"}
                        </span>
                      </td>

                      {/* Total Records */}
                      <td style={{ padding: "14px 18px", verticalAlign: "middle", textAlign: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0284c7" }}>
                          {grp.count} {grp.count === 1 ? "record" : "records"}
                        </span>
                      </td>

                      {/* Status Summary — Clean color-coded status dots without pill borders */}
                      <td style={{ padding: "14px 18px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
                          {grp.completedCount > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#059669" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                              {grp.completedCount} {isRegMarking ? "Marked" : "Completed"}
                            </span>
                          )}
                          {grp.pendingCount > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#d97706" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                              {grp.pendingCount} {isRegMarking ? "Awaiting Marking" : "Pending"}
                            </span>
                          )}
                          {!isRegMarking && grp.condemnedCount > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
                              {grp.condemnedCount} Condemned
                            </span>
                          )}
                          {!isRegMarking && grp.partialCount > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#d97706" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                              {grp.partialCount} Partially Condemned
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Action */}
                      <td
                        style={{ padding: "14px 18px", verticalAlign: "middle", textAlign: "right" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {activeType === "condemnation" && grp.items.length === 1 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViewingCondemnation(grp.items[0])}
                            style={{
                              padding: "6px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon.Eye size={13} /> View Details
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedOwnerKey(grp.key)}
                            style={{
                              padding: "6px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon.Eye size={13} /> {activeType === "condemnation" ? "View Details" : "View"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Standardized Multi-Level View Modal (Owner Group Records + Single Record Dossier) */}
      <Modal
        open={Boolean(selectedOwnerView || selectedRecord)}
        onClose={() => {
          setSelectedOwnerKey(null);
          setSelectedRecord(null);
        }}
        title={
          selectedRecord
            ? `Report Record Details — Tag #${selectedRecord.tag_number || ""}`
            : selectedOwnerView
            ? `${activeReportMeta.title} — ${selectedOwnerView.owner_name}`
            : "Report Details"
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            {selectedRecord ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRecord(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}
              >
                <Icon.ArrowLeft size={14} /> Back to {selectedOwnerView?.owner_name || "Owner"} Records
              </Button>
            ) : (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Showing {selectedOwnerView?.items?.length || 0} {selectedOwnerView?.items?.length === 1 ? "record" : "records"}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {!selectedRecord && selectedOwnerView && !monitoringModule && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    handleExportPDF(
                      selectedOwnerView.items,
                      `${activeReportMeta.title} — ${selectedOwnerView.owner_name}`,
                      selectedOwnerView.owner_name
                    )
                  }
                  style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}
                  title="Export owner report as PDF"
                >
                  <Icon.Printer size={13} /> Export PDF
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setSelectedOwnerKey(null);
                  setSelectedRecord(null);
                }}
                style={{ minWidth: 80, fontWeight: 700 }}
              >
                Close
              </Button>
            </div>
          </div>
        }
      >
        {selectedRecord ? (
          /* Level 2: Single Record Dossier — Clean Unified List View (Instead of fragmented boxes) */
          (() => {
            const recStatus = getStatusDotStyle(selectedRecord.status);
            const detailItems = [
              {
                icon: <Icon.User size={13} />,
                label: "Owner / Producer",
                value: selectedRecord.owner_name || "—",
              },
              {
                icon: <Icon.Phone size={13} />,
                label: "Contact",
                value: selectedRecord.owner_contact || "—",
              },
              {
                icon: <Icon.Tag size={13} />,
                label: "Tag Number",
                value: (
                  <span
                    onClick={() => {
                      if (!selectedRecord.tag_number) return;
                      navigator.clipboard?.writeText(String(selectedRecord.tag_number).trim());
                      showToast(`Copied ${selectedRecord.tag_number}!`, "success");
                    }}
                    title="Click to copy Tag Number"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      padding: "2px 8px",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      cursor: "pointer",
                    }}
                  >
                    <span>{selectedRecord.tag_number || "—"}</span>
                    <Icon.Copy size={11} style={{ opacity: 0.6 }} />
                  </span>
                ),
              },
              {
                icon: <Icon.Cow size={13} />,
                label: "Species & Sex",
                value: `${selectedRecord.species || "—"} (${selectedRecord.sex || "—"})`,
              },
              {
                icon: <Icon.Activity size={13} />,
                label: "Stage",
                value: (
                  <span style={{ color: "#0284c7", fontWeight: 700 }}>
                    {selectedRecord.stageLabel || selectedRecord.reportTitle || "—"}
                  </span>
                ),
              },
              {
                icon: <Icon.CheckCircle size={13} />,
                label: "Status",
                value: (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: recStatus.color,
                      background: `${recStatus.color}18`,
                      border: `1px solid ${recStatus.color}35`,
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: recStatus.color, flexShrink: 0 }} />
                    {selectedRecord.status || "Completed"}
                  </span>
                ),
              },
              {
                icon: <Icon.UserCheck size={13} />,
                label: "Responsible Personnel",
                value: selectedRecord.personnel || "—",
              },
              {
                icon: <Icon.Calendar size={13} />,
                label: "Date & Time (Asia/Manila)",
                value: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {selectedRecord.date ? formatPhDateTime(selectedRecord.date) : "—"}
                  </span>
                ),
              },
              {
                icon: <Icon.FileText size={13} />,
                label: selectedRecord.reportTitle?.includes("Registration") ? "Type of Marking" : "Process Details & Findings",
                value: selectedRecord.reportTitle?.includes("Registration")
                  ? (selectedRecord.raw?.mark_type || "Ear Tag")
                  : (selectedRecord.details || "No additional findings recorded."),
                multiline: true,
              },
            ];

            return (
              <div
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {/* Header Summary Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    padding: "12px 18px",
                    background: "var(--color-bg)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span
                      onClick={() => {
                        if (!selectedRecord.tag_number) return;
                        navigator.clipboard?.writeText(String(selectedRecord.tag_number).trim());
                        showToast(`Copied ${selectedRecord.tag_number}!`, "success");
                      }}
                      title="Click to copy Tag Number"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        padding: "3px 9px",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        cursor: "pointer",
                      }}
                    >
                      <Icon.Tag size={13} style={{ color: "var(--color-primary, #10b981)" }} />
                      <span>{selectedRecord.tag_number}</span>
                      <Icon.Copy size={11} style={{ opacity: 0.6, marginLeft: 2 }} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                      {selectedRecord.species} {selectedRecord.sex ? `· ${selectedRecord.sex}` : ""}
                    </span>
                  </div>

                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: recStatus.color,
                      background: `${recStatus.color}18`,
                      border: `1px solid ${recStatus.color}35`,
                      borderRadius: 999,
                      padding: "3px 10px",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: recStatus.color, flexShrink: 0 }} />
                    {selectedRecord.status || "Completed"}
                  </span>
                </div>

                {/* Structured Record Details List */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {detailItems.map((item, idx) => (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        alignItems: item.multiline ? "flex-start" : "center",
                        justifyContent: "space-between",
                        padding: item.multiline ? "12px 18px" : "10px 18px",
                        borderBottom: idx === detailItems.length - 1 ? "none" : "1px solid var(--color-border)",
                        background: idx % 2 === 0 ? "transparent" : "var(--color-bg)",
                        gap: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          width: 220,
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 7,
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "var(--color-text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        <span style={{ opacity: 0.75, display: "flex" }}>{item.icon}</span>
                        <span>{item.label}</span>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 200,
                          fontSize: 13,
                          fontWeight: item.multiline ? 500 : 700,
                          color: "var(--color-text)",
                          lineHeight: 1.55,
                        }}
                      >
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        ) : selectedOwnerView ? (
          /* Level 1: Owner Itemized Records Table inside Modal */
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
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Stage</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species &amp; Sex</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Date &amp; Time</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>{isRegMarking ? "Type of Marking" : "Details / Findings"}</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Status</th>
                    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: activeType === "condemnation" ? "left" : "right" }}>Responsible Personnel</th>
                    {activeType === "condemnation" && (
                      <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selectedOwnerView.items.map((item) => {
                    const stStyle = getStatusDotStyle(item.status);
                    return (
                      <tr
                        key={item.id || item.tag_number}
                        style={{
                          borderBottom: "1px solid var(--color-border)",
                          transition: "background 140ms ease",
                          cursor: activeType === "condemnation" ? "pointer" : "default",
                        }}
                        onClick={() => {
                          if (activeType === "condemnation") {
                            setViewingCondemnation(item);
                          }
                        }}
                      >
                        <td style={{ padding: "10px 14px" }}>
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
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#0284c7" }}>
                            {item.stageLabel}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ color: "var(--color-text)", fontWeight: 700 }}>{item.species}</span>
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>{item.sex}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--color-text)", whiteSpace: "nowrap" }}>
                          {item.date ? formatPhDateTime(item.date) : "—"}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--color-text)", maxWidth: 280 }}>
                          {isRegMarking ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: (item.mark_type === "Tattoo" || item.raw?.mark_type === "Tattoo") ? "rgba(99, 102, 241, 0.1)" : "rgba(16, 185, 129, 0.1)",
                                color: (item.mark_type === "Tattoo" || item.raw?.mark_type === "Tattoo") ? "#6366f1" : "#10b981",
                                border: `1px solid ${(item.mark_type === "Tattoo" || item.raw?.mark_type === "Tattoo") ? "rgba(99, 102, 241, 0.25)" : "rgba(16, 185, 129, 0.25)"}`,
                              }}
                            >
                              <Icon.Tag size={12} />
                              {item.mark_type || item.raw?.mark_type || "Ear Tag"}
                            </span>
                          ) : (
                            <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4 }} title={item.details}>
                              {item.details}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: stStyle.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: stStyle.color, flexShrink: 0 }} />
                            {stStyle.label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600, textAlign: activeType === "condemnation" ? "left" : "right" }}>
                          {item.personnel}
                        </td>
                        {activeType === "condemnation" && (
                          <td
                            style={{ padding: "10px 14px", textAlign: "right", verticalAlign: "middle" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setViewingCondemnation(item)}
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Icon.Eye size={12} /> View Details
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Condemnation Evidence Viewer Modal */}
      <CondemnationEvidenceModal
        open={Boolean(viewingCondemnation)}
        onClose={() => setViewingCondemnation(null)}
        record={viewingCondemnation}
        livestock={livestock}
        owners={owners}
        ante={ante}
        post={post}
        condemned={condemned}
        postCuts={postCuts}
        evidence={evidence}
        users={users}
      />
    </div>
  );
};
