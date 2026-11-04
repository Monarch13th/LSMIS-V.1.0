import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate, formatDateTime, formatPhDateTime, formatCurrency, formatSex, getManilaTodayDateString, isTodayInManila } from "../../utils/formatters";
import { ensureOwnerMockSeeded } from "../../utils/ownerMockData";
import { calculateLivestockProgress } from "./Animals";
import { getOwnerCondemnationDetails } from "../../utils/condemnationHelpers";
import { OwnerCondemnationModal } from "../../components/owner/OwnerCondemnationModal";
import { subscribeOwnerLiveRefresh, buildOwnerScope } from "../../utils/ownerLiveRefresh";

export const OwnerDashboard = () => {
  const { session, userName, ownerId: authOwnerId } = useAuth();
  const navigate = useNavigate();

  // Core Data States
  const [loading, setLoading] = useState(true);
  const [ownerInfo, setOwnerInfo] = useState(null);
  const [resolvedOwnerId, setResolvedOwnerId] = useState(authOwnerId || null);
  const [avatarError, setAvatarError] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState(null);
  const [animals, setAnimals] = useState([]);
  const [anteInspections, setAnteInspections] = useState([]);
  const [postInspections, setPostInspections] = useState([]);
  const [condemnations, setCondemnations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [permits, setPermits] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Milestone lookup maps for calculating accurate progress
  const [milestones, setMilestones] = useState({
    ante: {},
    post: {},
    condemnation: {},
    slaughterProc: {},
    slaughterRec: {},
    carcass: {},
    payment: {},
    dispatch: {},
    permits: {},
  });

  // Modal States
  const [selectedAnimal, setSelectedAnimal] = useState(null);
  const [selectedPermit, setSelectedPermit] = useState(null);
  const [condemnationDetails, setCondemnationDetails] = useState(null);

  // Search, Filter & Pagination states for Today's Livestock
  const [todaySearchQuery, setTodaySearchQuery] = useState("");
  const [todayStatusFilter, setTodayStatusFilter] = useState("all");
  const [todayPage, setTodayPage] = useState(1);
  const todayPageSize = 5;

  // Stability & Concurrency guards
  const inFlightRef = useRef(false);
  const fetchRef = useRef(null);
  const ownerScopeRef = useRef(null);

  // Authoritative Supabase Data Fetcher
  const loadDashboardData = useCallback(async (opts = {}) => {
    const isSilent = Boolean(opts?.silent);
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!isSilent) {
      setLoading(true);
    }
    try {
      // 0. Ensure legacy mock keys are purged
      ensureOwnerMockSeeded();

      // 1. Resolve authentic owner from active session
      const { data: authUserRes } = await supabase.auth.getUser();
      const authEmail = (authUserRes?.user?.email || session?.email || "").trim().toLowerCase();

      let currentOwnerId = null;
      let foundOwner = null;

      if (authEmail) {
        const { data: oByEmail } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .ilike("email", authEmail)
          .maybeSingle();
        if (oByEmail) {
          foundOwner = oByEmail;
          currentOwnerId = oByEmail.id;
        }
      }

      if (!foundOwner && authEmail) {
        const { data: uData } = await supabase
          .from(TABLES.USERS)
          .select("owner_id, full_name")
          .ilike("email", authEmail)
          .maybeSingle();
        if (uData?.owner_id) {
          currentOwnerId = uData.owner_id;
          const { data: oByUserId } = await supabase
            .from(TABLES.OWNERS)
            .select("*")
            .eq("id", currentOwnerId)
            .maybeSingle();
          if (oByUserId) foundOwner = oByUserId;
        }
      }

      if (!foundOwner && (authOwnerId || session?.owner_id)) {
        const candidateId = authOwnerId || session?.owner_id;
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", candidateId)
          .maybeSingle();
        if (oData) {
          foundOwner = oData;
          currentOwnerId = oData.id;
        }
      }

      setResolvedOwnerId(currentOwnerId);
      setOwnerInfo(foundOwner);

      // 2. Fetch Owner's Livestock strictly from Supabase filtered by authenticated owner ID
      let liveList = [];
      if (currentOwnerId) {
        const { data: lData } = await supabase
          .from(TABLES.LIVESTOCK)
          .select("*")
          .eq("owner_id", currentOwnerId)
          .order("received_date", { ascending: false });
        if (lData) liveList = lData;
      }
      setAnimals(liveList);

      const tagList = liveList.map((a) => a.tag_number).filter(Boolean);

      // 3. Parallel fetching of Inspection, Payment, and Permit records
      let anteList = [];
      let postList = [];
      let condList = [];
      let spList = [];
      let srList = [];
      let carcassList = [];
      let payList = [];
      let permList = [];
      let notifList = [];

      if (tagList.length > 0) {
        const [
          anteRes,
          postRes,
          condRes,
          spRes,
          srRes,
          carcassRes,
          payRes,
          permRes,
        ] = await Promise.all([
          supabase.from(TABLES.ANTE_MORTEM).select("*").in("tag_number", tagList).order("date", { ascending: false }),
          supabase.from(TABLES.POST_MORTEM).select("*").in("tag_number", tagList).order("date", { ascending: false }),
          supabase.from(TABLES.CONDEMNATION_RECORDS).select("*").in("tag_number", tagList).order("date", { ascending: false }),
          supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*").in("tag_number", tagList),
          supabase.from(TABLES.SLAUGHTER_RECORDS).select("*").in("tag_number", tagList),
          supabase.from(TABLES.CARCASS).select("*").in("tag_number", tagList),
          supabase.from(TABLES.PAYMENTS).select("*").in("tag_number", tagList).order("date", { ascending: false }),
          supabase.from(TABLES.PERMITS).select("*").in("tag_number", tagList).order("issued_at", { ascending: false }),
        ]);

        anteList = anteRes.data || [];
        postList = postRes.data || [];
        condList = condRes.data || [];
        spList = spRes.data || [];
        srList = srRes.data || [];
        carcassList = carcassRes.data || [];
        payList = payRes.data || [];
        permList = permRes.data || [];
      }

      // Merge payments linked directly by owner_id or owner_name
      if (currentOwnerId || foundOwner?.name) {
        try {
          let payQuery = supabase.from(TABLES.PAYMENTS).select("*");
          if (currentOwnerId && foundOwner?.name) {
            payQuery = payQuery.or(`owner_id.eq.${currentOwnerId},owner_name.ilike.${foundOwner.name}`);
          } else if (currentOwnerId) {
            payQuery = payQuery.eq("owner_id", currentOwnerId);
          } else {
            payQuery = payQuery.ilike("owner_name", foundOwner.name);
          }
          const { data: directPays } = await payQuery;
          if (directPays && directPays.length > 0) {
            const seen = new Set(payList.map((p) => p.id));
            directPays.forEach((p) => {
              if (!seen.has(p.id)) payList.push(p);
            });
          }
        } catch (_) {}

        // Fetch permits linked by owner_name
        if (foundOwner?.name && permList.length === 0) {
          try {
            const { data: ownerPerms } = await supabase
              .from(TABLES.PERMITS)
              .select("*")
              .ilike("owner_name", foundOwner.name)
              .order("issued_at", { ascending: false });
            if (ownerPerms && ownerPerms.length > 0) {
              permList = ownerPerms;
            }
          } catch (_) {}
        }

        // Fetch owner notifications strictly belonging to this owner
        try {
          const { data: nData } = await supabase
            .from(TABLES.NOTIFICATIONS)
            .select("*")
            .eq("owner_id", currentOwnerId)
            .order("date", { ascending: false })
            .limit(10);
          if (nData) notifList = nData;
        } catch (_) {}
      }

      // Build milestone lookup maps
      const anteMap = {};
      anteList.forEach((x) => { if (x.tag_number) anteMap[x.tag_number] = x; });

      const postMap = {};
      postList.forEach((x) => { if (x.tag_number) postMap[x.tag_number] = x; });

      const condMap = {};
      condList.forEach((x) => { if (x.tag_number) condMap[x.tag_number] = x; });

      const spMap = {};
      spList.forEach((x) => { if (x.tag_number) spMap[x.tag_number] = x; });

      const srMap = {};
      srList.forEach((x) => { if (x.tag_number) srMap[x.tag_number] = x; });

      const carcassMap = {};
      carcassList.forEach((x) => { if (x.tag_number) carcassMap[x.tag_number] = x; });

      const payMap = {};
      payList.forEach((x) => { if (x.tag_number) payMap[x.tag_number] = x; });

      const permMap = {};
      permList.forEach((x) => {
        if (x.tag_number) permMap[x.tag_number] = x;
        if (x.livestock_id) permMap[x.livestock_id] = x;
      });

      setMilestones({
        ante: anteMap,
        post: postMap,
        condemnation: condMap,
        slaughterProc: spMap,
        slaughterRec: srMap,
        carcass: carcassMap,
        payment: payMap,
        permits: permMap,
      });

      setAnteInspections(anteList);
      setPostInspections(postList);
      setCondemnations(condList);
      setPayments(payList);
      setPermits(permList);
      setNotifications(notifList);
    } catch (err) {
      console.warn("Owner dashboard load error:", err);
    } finally {
      inFlightRef.current = false;
      if (!isSilent) setLoading(false);
    }
  }, [authOwnerId, session?.id, session?.email]);

  // Keep fetchRef in sync
  useEffect(() => {
    fetchRef.current = loadDashboardData;
  }, [loadDashboardData]);

  // Synchronize owner scope for Realtime filtering
  useEffect(() => {
    ownerScopeRef.current = buildOwnerScope(resolvedOwnerId || ownerInfo?.id || authOwnerId, animals);
  }, [resolvedOwnerId, ownerInfo?.id, authOwnerId, animals]);

  // Initial dashboard load (once, with loading spinner)
  useEffect(() => {
    loadDashboardData({ silent: false });
  }, [loadDashboardData]);

  // Debounced, owner-scoped Supabase Realtime synchronization
  useEffect(() => {
    return subscribeOwnerLiveRefresh({
      channelName: "owner-dash-live-" + (authOwnerId || session?.owner_id || "client"),
      tables: [
        TABLES.LIVESTOCK,
        TABLES.NOTIFICATIONS,
        TABLES.ANTE_MORTEM,
        TABLES.POST_MORTEM,
        TABLES.PAYMENTS,
        TABLES.PERMITS,
        TABLES.CARCASS,
        TABLES.SLAUGHTER_PROCESSING,
      ],
      getScope: () => ownerScopeRef.current,
      getRefresh: () => () => fetchRef.current?.({ silent: true }),
      debounceMs: 500,
    });
  }, [authOwnerId, session?.owner_id]);

  // Selective lmis-db-change listener (strictly ignores unrelated tables like audit_logs, users, etc.)
  useEffect(() => {
    const handleDbChange = (e) => {
      const changedTable = e?.detail?.table;
      const relevant = [
        TABLES.LIVESTOCK,
        TABLES.NOTIFICATIONS,
        TABLES.ANTE_MORTEM,
        TABLES.POST_MORTEM,
        TABLES.PAYMENTS,
        TABLES.PERMITS,
        TABLES.CARCASS,
        TABLES.SLAUGHTER_PROCESSING,
      ];
      if (!changedTable || relevant.includes(changedTable)) {
        fetchRef.current?.({ silent: true });
      }
    };
    window.addEventListener("lmis-db-change", handleDbChange);
    return () => window.removeEventListener("lmis-db-change", handleDbChange);
  }, []);

  // Automatic Date Updates: Silently refresh when the calendar date rolls over in Asia/Manila
  useEffect(() => {
    let lastManilaDate = getManilaTodayDateString();

    const checkDateRollover = () => {
      const currentManilaDate = getManilaTodayDateString();
      if (currentManilaDate !== lastManilaDate) {
        lastManilaDate = currentManilaDate;
        fetchRef.current?.({ silent: true });
      }
    };

    const interval = setInterval(checkDateRollover, 30000);
    return () => clearInterval(interval);
  }, []);

  // Sync avatar when owner updates profile picture in Profile section
  useEffect(() => {
    const handleProfileUpdate = (e) => {
      if (e.detail?.avatar_url) {
        setCustomAvatarUrl(e.detail.avatar_url);
        setAvatarError(false);
      }
    };
    window.addEventListener("lmis_profile_updated", handleProfileUpdate);
    return () => window.removeEventListener("lmis_profile_updated", handleProfileUpdate);
  }, []);

  const resolvedAvatarUrl =
    customAvatarUrl ||
    ownerInfo?.avatar_url ||
    session?.avatar_url ||
    "";

  // Enrich animals with friendly progress & categories
  const enrichedAnimals = useMemo(() => {
    return animals.map((a) => {
      const progress = calculateLivestockProgress(a, milestones);
      return {
        ...a,
        progress,
      };
    });
  }, [animals, milestones]);

  // Strictly filter for today's registered livestock in Asia/Manila for the authenticated owner ID
  const todayEnrichedAnimals = useMemo(() => {
    if (!resolvedOwnerId) return [];
    return enrichedAnimals.filter((a) => {
      // 1. Strict owner ID match
      if (String(a.owner_id || "").trim() !== String(resolvedOwnerId).trim()) {
        return false;
      }
      // 2. Check registration or processing timestamp in Asia/Manila timezone
      const regTimestamp = a.registered_at || a.created_at || a.received_date;
      const isRegToday = isTodayInManila(regTimestamp);
      const isProcToday = isTodayInManila(a.marked_at) || isTodayInManila(a.slaughter_date);
      return isRegToday || isProcToday;
    });
  }, [enrichedAnimals, resolvedOwnerId]);

  // Reset today's pagination when search or status filter changes
  useEffect(() => {
    setTodayPage(1);
  }, [todaySearchQuery, todayStatusFilter]);

  // Today's category count badges
  const countTodayAll = todayEnrichedAnimals.length;
  const countTodayInspection = todayEnrichedAnimals.filter((a) => a.progress?.statusCategory === "inspection").length;
  const countTodayProcessing = todayEnrichedAnimals.filter((a) => a.progress?.statusCategory === "processing").length;
  const countTodayCleared = todayEnrichedAnimals.filter((a) => a.progress?.statusCategory === "cleared").length;
  const countTodayCondemned = todayEnrichedAnimals.filter(
    (a) => a.progress?.statusCategory === "condemned" || a.progress?.statusCategory === "rejected"
  ).length;

  // Filtered today's dataset based on active search & category tab
  const filteredTodayAnimals = useMemo(() => {
    const q = todaySearchQuery.trim().toLowerCase();
    return todayEnrichedAnimals.filter((a) => {
      if (q) {
        const tag = String(a.tag_number || "").toLowerCase();
        const species = String(a.species || "").toLowerCase();
        const breed = String(a.breed || "").toLowerCase();
        const sex = formatSex(a.sex || a.gender).toLowerCase();
        const status = String(a.progress?.statusLabel || a.status || "").toLowerCase();
        if (!tag.includes(q) && !species.includes(q) && !breed.includes(q) && !sex.includes(q) && !status.includes(q)) {
          return false;
        }
      }

      if (todayStatusFilter !== "all") {
        const cat = a.progress?.statusCategory || "inspection";
        if (todayStatusFilter === "inspection" && cat !== "inspection") return false;
        if (todayStatusFilter === "processing" && cat !== "processing") return false;
        if (todayStatusFilter === "cleared" && cat !== "cleared") return false;
        if (todayStatusFilter === "condemned" && (cat !== "condemned" && cat !== "rejected")) return false;
      }

      return true;
    });
  }, [todayEnrichedAnimals, todaySearchQuery, todayStatusFilter]);

  // Pagination for Today's Livestock
  const totalTodayPages = Math.max(1, Math.ceil(filteredTodayAnimals.length / todayPageSize));
  const paginatedTodayAnimals = useMemo(() => {
    const start = (todayPage - 1) * todayPageSize;
    return filteredTodayAnimals.slice(start, start + todayPageSize);
  }, [filteredTodayAnimals, todayPage, todayPageSize]);

  // Simple, owner-friendly 4-stat metrics (Requirement 3.B)
  const totalCount = enrichedAnimals.length > 0
    ? enrichedAnimals.reduce((sum, a) => sum + (Number(a.quantity) || 1), 0)
    : (Number(ownerInfo?.total_animals) || 0);

  const forInspectionCount = enrichedAnimals.filter(
    (a) => a.progress?.statusCategory === "inspection" ||
      ["pending", "marked", "intake", "receiving"].includes(String(a.status || "").toLowerCase().trim())
  ).length;

  const approvedCount = enrichedAnimals.filter(
    (a) => a.progress?.statusCategory === "cleared" ||
      a.progress?.statusCategory === "processing" ||
      ["approved", "passed", "weighed", "released", "slaughtered"].includes(String(a.status || "").toLowerCase().trim())
  ).length;

  const condemnedCount = enrichedAnimals.filter(
    (a) => a.progress?.statusCategory === "condemned" ||
      a.progress?.statusCategory === "rejected" ||
      ["condemned", "rejected"].includes(String(a.status || "").toLowerCase().trim()) ||
      Boolean(milestones.condemnation[a.tag_number])
  ).length;

  // Handler for opening Condemnation Details with Pathology Photos
  const handleOpenCondemnation = (tagNumber) => {
    const matchedAnimal = animals.find((a) => a.tag_number === tagNumber) || { tag_number: tagNumber };
    const ante = milestones.ante[tagNumber];
    const post = milestones.post[tagNumber];
    const cond = milestones.condemnation[tagNumber];

    const details = getOwnerCondemnationDetails({
      animal: matchedAnimal,
      ante,
      post,
      condemnation: cond,
      evidence: [],
    });

    if (details) {
      setCondemnationDetails(details);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "10px 4px 28px 4px", maxWidth: "100%", overflowX: "hidden" }}>
      
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SECTION A: COMPACT HEADER (Requirement 3.A)                              */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <Link
        to="/owner/profile"
        title="View your profile"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 14px",
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderLeft: "4px solid #0284c7",
          borderRadius: 16,
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        {/* Avatar with verified dot */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: "50%",
              overflow: "hidden",
              border: "2px solid var(--color-surface, #ffffff)",
              boxShadow: "0 0 0 2px #0284c7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#e0f2fe",
            }}
          >
            {resolvedAvatarUrl && !avatarError ? (
              <img
                src={resolvedAvatarUrl}
                alt={ownerInfo?.name || "Owner Profile"}
                onError={() => setAvatarError(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <Icon.User size={24} style={{ color: "#0284c7" }} />
            )}
          </div>
          <span
            title="Verified Owner"
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#10b981",
              border: "2px solid var(--color-surface, #ffffff)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 900,
            }}
          >
            ✓
          </span>
        </div>

        {/* Greeting, name, status */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted, #64748b)", display: "block", fontWeight: 500 }}>
            {(() => {
              const h = Number(
                new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" }).format(new Date())
              );
              return h < 12 ? "Good morning," : h < 18 ? "Good afternoon," : "Good evening,";
            })()}
          </span>
          <strong
            style={{
              fontSize: 17,
              color: "var(--color-text, #0f172a)",
              fontWeight: 800,
              display: "block",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.25,
            }}
          >
            {ownerInfo?.name || userName || session?.name || "Livestock Raiser"}
          </strong>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "#059669",
                background: "rgba(16, 185, 129, 0.12)",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              Verified Owner
            </span>
            <span style={{ fontSize: 10.5, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
              {new Intl.DateTimeFormat("en-PH", {
                timeZone: "Asia/Manila",
                weekday: "short",
                month: "short",
                day: "numeric",
              }).format(new Date())}
            </span>
          </div>
        </div>

        <Icon.ChevronRight size={18} style={{ color: "#94a3b8", flexShrink: 0 }} />
      </Link>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SECTION B: LIVESTOCK OVERVIEW (Requirement 3.B)                           */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* 1. Total Registered */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#0284c7", marginBottom: 6 }}>
            <Icon.Tag size={16} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Total Registered
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "var(--color-text, #0f172a)" }}>
            {loading ? "..." : totalCount}
          </div>
          <span style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)" }}>
            Livestock in system
          </span>
        </div>

        {/* 2. For Inspection */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#f59e0b", marginBottom: 6 }}>
            <Icon.Stethoscope size={16} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              For Inspection
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "var(--color-text, #0f172a)" }}>
            {loading ? "..." : forInspectionCount}
          </div>
          <span style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)" }}>
            Awaiting vet check
          </span>
        </div>

        {/* 3. Approved Livestock */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#10b981", marginBottom: 6 }}>
            <Icon.CheckCircle size={16} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Approved
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "var(--color-text, #0f172a)" }}>
            {loading ? "..." : approvedCount}
          </div>
          <span style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)" }}>
            Passed examination
          </span>
        </div>

        {/* 4. Condemned Livestock */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#ef4444", marginBottom: 6 }}>
            <Icon.AlertTriangle size={16} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Condemned
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "var(--color-text, #0f172a)" }}>
            {loading ? "..." : condemnedCount}
          </div>
          <span style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)" }}>
            Failed / condemned
          </span>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* SECTION C: TODAY'S LIVESTOCK RECORDS                                      */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: 16,
          padding: "16px 14px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
        }}
      >
        {/* Section Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.Cow size={18} style={{ color: "#0284c7" }} />
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)" }}>
              Today's Livestock
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: "rgba(2, 132, 199, 0.12)",
                padding: "2px 8px",
                borderRadius: 999,
                color: "#0284c7",
              }}
            >
              {todayEnrichedAnimals.length} Today
            </span>
          </div>

          <Link
            to="/owner/animals"
            style={{ fontSize: 12, fontWeight: 700, color: "#0284c7", textDecoration: "none" }}
          >
            See All Records →
          </Link>
        </div>

        {/* Compact Search Bar */}
        <div style={{ position: "relative", width: "100%", marginBottom: 10 }}>
          <span
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#94a3b8",
              display: "flex",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            <Icon.Search size={14} />
          </span>
          <input
            type="text"
            placeholder="Search tag, species, breed, sex..."
            value={todaySearchQuery}
            onChange={(e) => setTodaySearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: 35,
              paddingLeft: 34,
              paddingRight: todaySearchQuery ? 32 : 12,
              borderRadius: 10,
              border: "1px solid var(--color-border, #e2e8f0)",
              background: "var(--color-bg, #f8fafc)",
              color: "var(--color-text, #0f172a)",
              fontSize: 12,
              fontWeight: 500,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {todaySearchQuery && (
            <button
              type="button"
              onClick={() => setTodaySearchQuery("")}
              title="Clear search"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "#94a3b8",
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

        {/* Filter Pills Tabs (All, Inspection, Processing, Cleared, Condemned) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 8,
            marginBottom: 10,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {[
            { id: "all", label: "All", count: countTodayAll },
            { id: "inspection", label: "Inspection", count: countTodayInspection },
            { id: "processing", label: "Processing", count: countTodayProcessing },
            { id: "cleared", label: "Cleared", count: countTodayCleared },
            { id: "condemned", label: "Condemned", count: countTodayCondemned },
          ].map((tab) => {
            const isActive = todayStatusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTodayStatusFilter(tab.id)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: isActive ? "1px solid #0284c7" : "1px solid var(--color-border, #e2e8f0)",
                  background: isActive ? "#0284c7" : "var(--color-bg, #f8fafc)",
                  color: isActive ? "#ffffff" : "var(--color-text-muted, #64748b)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s ease",
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    fontSize: 10,
                    opacity: isActive ? 0.9 : 0.7,
                    fontWeight: 800,
                  }}
                >
                  ({tab.count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        {loading && animals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#64748b", fontSize: 12.5 }}>
            <Icon.RefreshCw size={18} className="animate-spin" style={{ margin: "0 auto 8px auto", color: "#0284c7", display: "block" }} />
            Loading today&apos;s livestock records...
          </div>
        ) : filteredTodayAnimals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 12px", color: "#64748b" }}>
            <span style={{ fontSize: 32, display: "block", marginBottom: 6 }}>📋</span>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
              No livestock registered today.
            </div>
            <p style={{ fontSize: 12, margin: "6px 0 0", color: "#64748b", lineHeight: 1.5, maxWidth: 300, marginLeft: "auto", marginRight: "auto" }}>
              Newly registered livestock by abattoir receiving staff will appear here.
            </p>
            {(todaySearchQuery || todayStatusFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setTodaySearchQuery("");
                  setTodayStatusFilter("all");
                }}
                style={{
                  marginTop: 12,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "#0284c7",
                  background: "rgba(2, 132, 199, 0.1)",
                  border: "1px solid rgba(2, 132, 199, 0.25)",
                  padding: "5px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Clear Search &amp; Filters
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {paginatedTodayAnimals.map((a) => {
              const prog = a.progress || {};
              const isCondemned = prog.statusCategory === "condemned" || prog.statusCategory === "rejected";
              const isCleared = prog.statusCategory === "cleared";
              const isProcessing = prog.statusCategory === "processing";

              const badgeColor = isCondemned ? "#ef4444" : isCleared ? "#10b981" : isProcessing ? "#0284c7" : "#f59e0b";
              const badgeBg = isCondemned ? "rgba(239, 68, 68, 0.1)" : isCleared ? "rgba(16, 185, 129, 0.1)" : isProcessing ? "rgba(2, 132, 199, 0.1)" : "rgba(245, 158, 11, 0.1)";

              const regTimeFormatted = formatPhDateTime(a.registered_at || a.created_at || a.received_date);
              const carcassWeight = milestones.carcass?.[a.tag_number]?.total_weight || milestones.carcass?.[a.tag_number]?.cold_weight;

              return (
                <div
                  key={a.id || a.tag_number}
                  onClick={() => setSelectedAnimal(a)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid var(--color-border, #e2e8f0)",
                    background: "var(--color-bg, #f8fafc)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    cursor: "pointer",
                    transition: "border-color 0.15s ease",
                  }}
                  title="Click to view details"
                >
                  {/* Tag Number & Status Pill Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: "#0284c7",
                        background: "rgba(2, 132, 199, 0.1)",
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontFamily: "monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.tag_number || "NO TAG"}
                    </span>

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: badgeColor,
                        background: badgeBg,
                        padding: "3px 9px",
                        borderRadius: 999,
                        border: `1px solid ${badgeColor}33`,
                        whiteSpace: "nowrap",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: badgeColor,
                        }}
                      />
                      {prog.statusLabel || a.status || "Registered"}
                    </span>
                  </div>

                  {/* Clean Info Row: Species, Breed, Sex */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-muted, #64748b)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                      {a.species}
                      {a.breed && a.breed !== "Standard" ? ` · ${a.breed}` : ""}
                    </span>
                    <span style={{ color: "var(--color-border, #cbd5e1)" }}>•</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "var(--color-text-muted, #94a3b8)", fontWeight: 500 }}>Sex:</span>
                      <strong style={{ color: "var(--color-text, #334155)", fontWeight: 700 }}>{formatSex(a.sex)}</strong>
                    </span>
                    {carcassWeight && (
                      <>
                        <span style={{ color: "var(--color-border, #cbd5e1)" }}>•</span>
                        <span style={{ color: "#059669", fontWeight: 700 }}>{carcassWeight} kg</span>
                      </>
                    )}
                  </div>

                  {/* Mini Progress Bar (Stage X of 7) */}
                  <div style={{ marginTop: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--color-text-muted, #64748b)", marginBottom: 4 }}>
                      <span>Stage {prog.currentStageIndex || 1} of 7</span>
                      <span>{prog.statusLabel || "In Progress"}</span>
                    </div>
                    <div style={{ height: 4, width: "100%", background: "rgba(0,0,0,0.06)", borderRadius: 999, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, ((prog.currentStageIndex || 1) / 7) * 100)}%`,
                          background: badgeColor,
                          borderRadius: 999,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>

                  {/* Footer Row: Timestamp & View Details Action */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11.5,
                      color: "var(--color-text-muted, #64748b)",
                      borderTop: "1px dashed var(--color-border, #e2e8f0)",
                      paddingTop: 8,
                      marginTop: 2,
                    }}
                  >
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon.Clock size={12} style={{ color: "#0284c7" }} />
                      <span>{regTimeFormatted}</span>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "#0284c7",
                      }}
                    >
                      <span>View Details</span>
                      <Icon.ChevronRight size={13} />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination Controls */}
            {totalTodayPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 10,
                  borderTop: "1px solid var(--color-border, #e2e8f0)",
                  fontSize: 11.5,
                  color: "var(--color-text-muted, #64748b)",
                }}
              >
                <span>
                  Showing {(todayPage - 1) * todayPageSize + 1}–{Math.min(todayPage * todayPageSize, filteredTodayAnimals.length)} of {filteredTodayAnimals.length}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    disabled={todayPage <= 1}
                    onClick={() => setTodayPage((p) => Math.max(1, p - 1))}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border, #e2e8f0)",
                      background: todayPage <= 1 ? "transparent" : "var(--color-bg, #f8fafc)",
                      color: todayPage <= 1 ? "#94a3b8" : "var(--color-text, #0f172a)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: todayPage <= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    Prev
                  </button>

                  <span style={{ fontSize: 11, fontWeight: 700 }}>
                    {todayPage} / {totalTodayPages}
                  </span>

                  <button
                    type="button"
                    disabled={todayPage >= totalTodayPages}
                    onClick={() => setTodayPage((p) => Math.min(totalTodayPages, p + 1))}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border, #e2e8f0)",
                      background: todayPage >= totalTodayPages ? "transparent" : "var(--color-bg, #f8fafc)",
                      color: todayPage >= totalTodayPages ? "#94a3b8" : "var(--color-text, #0f172a)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: todayPage >= totalTodayPages ? "not-allowed" : "pointer",
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: VIEW LIVESTOCK HISTORY DETAILS MODAL (Records/Animals Parity)    */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {selectedAnimal && (() => {
        const selTag = selectedAnimal.tag_number;
        const selTagUpper = String(selTag || "").trim().toUpperCase();
        const prog = calculateLivestockProgress(selectedAnimal, milestones);
        const isPermitIssued = prog.statusLabel === "Permit Issued" || prog.statusCategory === "cleared";
        const isCondemned = prog.statusCategory === "condemned" || prog.statusCategory === "rejected";

        const carcassRec = milestones.carcass?.[selTag] || milestones.carcass?.[selTagUpper];
        const steps = prog.steps || [];

        return (
          <div
            onClick={() => setSelectedAnimal(null)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(6px)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 12,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxHeight: "90vh",
                overflowY: "auto",
                width: "100%",
                maxWidth: 500,
                backgroundColor: "var(--color-surface, #ffffff)",
                borderRadius: 20,
                boxShadow: "0 20px 40px -15px rgba(0,0,0,0.3)",
                padding: "20px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: "#0284c7",
                      letterSpacing: "0.06em",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Icon.ShieldCheck size={13} />
                    Official Abattoir Record
                  </span>
                  <h2
                    style={{
                      fontSize: 20,
                      fontWeight: 900,
                      margin: "4px 0 0",
                      fontFamily: "monospace",
                      color: "var(--color-text, #0f172a)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {selectedAnimal.tag_number || "NO TAG"}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedAnimal(null)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--color-bg, #f1f5f9)",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  title="Close"
                >
                  <Icon.X size={16} />
                </button>
              </div>

              {/* Status Hero Banner */}
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: isCondemned
                    ? "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)"
                    : isPermitIssued
                    ? "linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.06) 100%)"
                    : "linear-gradient(135deg, rgba(14, 165, 233, 0.14) 0%, rgba(2, 132, 199, 0.06) 100%)",
                  border: `1.5px solid ${
                    isCondemned
                      ? "rgba(239, 68, 68, 0.3)"
                      : isPermitIssued
                      ? "rgba(16, 185, 129, 0.35)"
                      : "rgba(14, 165, 233, 0.3)"
                  }`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: isCondemned ? "#ef4444" : isPermitIssued ? "#10b981" : "#0ea5e9",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        textTransform: "uppercase",
                        color: isCondemned ? "#dc2626" : isPermitIssued ? "#059669" : "#0284c7",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {prog.statusLabel || "Registered"}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: isCondemned ? "#dc2626" : isPermitIssued ? "#059669" : "#0284c7",
                      background: "rgba(255, 255, 255, 0.8)",
                      padding: "2px 8px",
                      borderRadius: 6,
                    }}
                  >
                    Stage {prog.currentStageIndex || 1} of 7
                  </span>
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    height: 6,
                    backgroundColor: "rgba(0, 0, 0, 0.08)",
                    borderRadius: 999,
                    marginTop: 10,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, ((prog.currentStageIndex || 1) / 7) * 100)}%`,
                      backgroundColor: isCondemned ? "#ef4444" : isPermitIssued ? "#10b981" : "#0284c7",
                      borderRadius: 999,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>

              {/* Core Particulars Grid (Species, Sex, Carcass Weight) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    padding: "9px 11px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Species &amp; Breed
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                    {selectedAnimal.species}
                    {selectedAnimal.breed && selectedAnimal.breed !== "Standard" ? ` · ${selectedAnimal.breed}` : ""}
                  </div>
                </div>

                <div
                  style={{
                    padding: "9px 11px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Sex
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                    {formatSex(selectedAnimal.sex || selectedAnimal.gender)}
                  </div>
                </div>

                <div
                  style={{
                    padding: "9px 11px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Carcass Weight
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#059669", marginTop: 2 }}>
                    {carcassRec?.total_weight || carcassRec?.cold_weight
                      ? `${carcassRec.total_weight || carcassRec.cold_weight} kg`
                      : selectedAnimal.weight ? `${selectedAnimal.weight} kg (Intake)` : "Pending scale"}
                  </div>
                </div>
              </div>

              {/* 7 Official Processing Milestones */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: "var(--color-text, #0f172a)",
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon.Clock size={13} style={{ color: "#0284c7" }} />
                    Lifecycle Milestones
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted, #64748b)" }}>
                    7-Stage Abattoir Flow
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {steps.map((st) => {
                    const isDone = st.state === "completed";
                    const isCurr = st.state === "current";
                    const isRej = st.state === "rejected" || st.state === "condemned";

                    return (
                      <div
                        key={st.id}
                        style={{
                          padding: "9px 12px",
                          borderRadius: 12,
                          background: isDone
                            ? "rgba(16, 185, 129, 0.05)"
                            : isCurr
                            ? "rgba(14, 165, 233, 0.07)"
                            : isRej
                            ? "rgba(239, 68, 68, 0.07)"
                            : "var(--color-bg, #f8fafc)",
                          border: `1px solid ${
                            isDone
                              ? "rgba(16, 185, 129, 0.22)"
                              : isCurr
                              ? "rgba(14, 165, 233, 0.3)"
                              : isRej
                              ? "rgba(239, 68, 68, 0.3)"
                              : "var(--color-border, #e2e8f0)"
                          }`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 800,
                              backgroundColor: isDone
                                ? "#10b981"
                                : isRej
                                ? "#ef4444"
                                : isCurr
                                ? "#0ea5e9"
                                : "var(--color-border, #cbd5e1)",
                              color: "#ffffff",
                              flexShrink: 0,
                            }}
                          >
                            {isDone ? "✓" : isRej ? "✕" : st.id}
                          </span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                              {st.label}
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--color-text-muted, #64748b)", marginTop: 1 }}>
                              {st.sublabel || (isDone ? "Completed" : isCurr ? "In Progress" : "Pending")}
                              {st.actor ? ` · ${st.actor}` : ""}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 6,
                              background: isDone
                                ? "rgba(16, 185, 129, 0.12)"
                                : isCurr
                                ? "rgba(14, 165, 233, 0.12)"
                                : "rgba(148, 163, 184, 0.12)",
                              color: isDone ? "#10b981" : isCurr ? "#0ea5e9" : "#64748b",
                            }}
                          >
                            {isDone ? "Completed" : isCurr ? "Active" : "Pending"}
                          </span>
                          {st.timestampFormatted && (
                            <div style={{ fontSize: 10, color: "#0284c7", fontWeight: 600, marginTop: 2 }}>
                              {st.timestampFormatted}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Close Button Footer */}
              <button
                type="button"
                onClick={() => setSelectedAnimal(null)}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  borderRadius: 12,
                  background: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Close Details
              </button>
            </div>
          </div>
        );
      })()}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: OFFICIAL MEAT PERMIT PREVIEW MODAL                               */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {selectedPermit && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 10,
          }}
          onClick={() => setSelectedPermit(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              maxWidth: 480,
              width: "100%",
              maxHeight: "88vh",
              overflowY: "auto",
              padding: "16px",
              boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
              fontFamily: "Arial, sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Government Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #cbd5e1", paddingBottom: 10, marginBottom: 12 }}>
              <img src="/naga_city_seal.png" alt="City Seal" style={{ width: 44, height: 44, objectFit: "contain" }} />
              <div style={{ textAlign: "center", flex: 1, padding: "0 6px" }}>
                <div style={{ fontSize: 10, color: "#334155" }}>Republic of the Philippines</div>
                <div style={{ fontSize: 11, fontWeight: "bold", color: "#000000" }}>City of Naga, Cebu</div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0284c7" }}>OFFICIAL MEAT INSPECTION PERMIT</div>
              </div>
              <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas" style={{ width: 44, height: 44, objectFit: "contain" }} />
            </div>

            {/* Certificate Details */}
            <div style={{ fontSize: 11.5, color: "#0f172a", lineHeight: 1.6, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Permit No:</span>
                <strong>{selectedPermit.permit_no || "MIC-001"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Date Issued:</span>
                <strong>{formatPhDateTime(selectedPermit.issued_at || selectedPermit.created_at)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Owner Name:</span>
                <strong>{selectedPermit.owner_name || ownerInfo?.name || "Verified Owner"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Livestock Tag:</span>
                <strong>{selectedPermit.tag_number || "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Species:</span>
                <strong>{selectedPermit.species || "Carcass"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Carcass Weight:</span>
                <strong>{selectedPermit.carcass_weight ? `${selectedPermit.carcass_weight} kg` : "Weighed"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "#64748b" }}>Destination:</span>
                <strong>{selectedPermit.destination || "Public Market"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Conveyance / Plate:</span>
                <strong>{selectedPermit.conveyance || "Meat Van"} ({selectedPermit.plate_no || "Registered"})</strong>
              </div>
            </div>

            <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 10.5, color: "#475569", marginBottom: 14 }}>
              This certifies that the carcass has passed both veterinary ante-mortem and post-mortem hygiene standards and is officially cleared for public transport and consumption.
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, textAlign: "center", borderTop: "1px dashed #cbd5e1", paddingTop: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>{selectedPermit.inspector || "Dr. Dave"}</div>
                <div style={{ color: "#64748b" }}>Meat Inspector</div>
              </div>
              <div>
                <div style={{ fontWeight: 800 }}>{selectedPermit.city_vet || "City Veterinarian"}</div>
                <div style={{ color: "#64748b" }}>City Veterinarian Office</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedPermit(null)}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "9px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#0f172a",
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Close Permit View
            </button>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: CONDEMNATION & PATHOLOGY PHOTO VIEWER                            */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {condemnationDetails && (
        <OwnerCondemnationModal
          open={!!condemnationDetails}
          details={condemnationDetails}
          onClose={() => setCondemnationDetails(null)}
        />
      )}
    </div>
  );
};

export default OwnerDashboard;
