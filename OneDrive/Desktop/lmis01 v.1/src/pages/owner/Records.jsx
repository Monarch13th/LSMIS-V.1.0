import { useState, useEffect, useMemo } from "react";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatPhDateTime, formatSex } from "../../utils/formatters";
import { calculateLivestockProgress } from "./Animals";

/**
 * Owner Records — view-only complete livestock history for the authenticated owner.
 * Permits and payments are intentionally not shown here.
 */
export const OwnerRecords = () => {
  const { ownerId } = useAuth();
  const [allLivestock, setAllLivestock] = useState([]);
  const [milestones, setMilestones] = useState({});
  const [selectedLivestock, setSelectedLivestock] = useState(null);
  const [loading, setLoading] = useState(true);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // Asia/Manila date helpers
  const getManilaTodayStr = () => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().split("T")[0];
    }
  };

  const matchesDateFilter = (recordDate, targetDateStr) => {
    if (!targetDateStr) return true;
    if (!recordDate) return false;

    const rawStr = String(recordDate).trim();
    if (rawStr.startsWith(targetDateStr)) return true;

    try {
      const d = new Date(recordDate);
      if (!isNaN(d.getTime())) {
        const manilaDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
        if (manilaDateStr === targetDateStr) return true;
      }
    } catch (e) {}

    return false;
  };

  const fetchRecordsData = async () => {
    setLoading(true);
    try {
      // 1. Resolve authentic owner from active Supabase session
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email;
      let targetOwnerId = null;
      let foundOwner = null;

      if (email) {
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .ilike("email", email.trim())
          .maybeSingle();
        if (oData) {
          foundOwner = oData;
          targetOwnerId = oData.id;
        } else {
          const { data: uData } = await supabase
            .from(TABLES.USERS)
            .select("owner_id, full_name")
            .ilike("email", email.trim())
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

      if (!foundOwner && ownerId) {
        targetOwnerId = ownerId;
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .eq("id", targetOwnerId)
          .maybeSingle();
        if (oData) foundOwner = oData;
      }


      // 2. Fetch Animals strictly belonging to this owner
      let liveAnimals = [];
      if (targetOwnerId) {
        try {
          const { data: aData, error: aErr } = await supabase
            .from(TABLES.LIVESTOCK)
            .select("*")
            .eq("owner_id", targetOwnerId);
          if (!aErr && aData) liveAnimals = aData;
        } catch (e) {}

        // Fallback by owner name if no records found by ID
        if (liveAnimals.length === 0 && foundOwner?.name) {
          try {
            const { data: aByName } = await supabase
              .from(TABLES.LIVESTOCK)
              .select("*")
              .ilike("owner_name", foundOwner.name);
            if (aByName && aByName.length > 0) liveAnimals = aByName;
          } catch (e) {}
        }
      }
      const tagNumbers = liveAnimals.map((a) => a.tag_number).filter(Boolean);

      // 3. Fetch staff & veterinarian milestone data used for livestock progress
      let cMap = {};
      let anteMap = {};
      let postMap = {};
      let condMap = {};
      let spMap = {};
      let srMap = {};
      let permList = [];

      if (tagNumbers.length > 0) {
        try {
          const [carcRes, anteRes, postRes, condRes, spRes, srRes, permRes] = await Promise.all([
            supabase.from(TABLES.CARCASS).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.ANTE_MORTEM).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.POST_MORTEM).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.CONDEMNATION_RECORDS).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.SLAUGHTER_RECORDS).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.PERMITS).select("*").in("tag_number", tagNumbers),
          ]);

          (carcRes.data || []).forEach((c) => { if (c.tag_number) cMap[c.tag_number] = c; });
          (anteRes.data || []).forEach((a) => { if (a.tag_number) anteMap[a.tag_number] = a; });
          (postRes.data || []).forEach((pm) => { if (pm.tag_number) postMap[pm.tag_number] = pm; });
          (condRes.data || []).forEach((cd) => { if (cd.tag_number) condMap[cd.tag_number] = cd; });
          (spRes.data || []).forEach((sp) => { if (sp.tag_number) spMap[sp.tag_number] = sp; });
          (srRes.data || []).forEach((sr) => { if (sr.tag_number) srMap[sr.tag_number] = sr; });
          permList = permRes.data || [];
        } catch (e) {}
      }

      // Save complete livestock history and milestone maps
      setAllLivestock(liveAnimals || []);
      const permMap = {};
      (permList || []).forEach((p) => {
        if (p.tag_number) permMap[p.tag_number] = p;
        if (p.livestock_id) permMap[p.livestock_id] = p;
      });
      setMilestones({
        carcass: cMap,
        ante: anteMap,
        post: postMap,
        condemnation: condMap,
        slaughterProc: spMap,
        slaughterRec: srMap,
        permits: permMap,
      });
    } catch (err) {
      console.warn("Owner records fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordsData();
    const onRefresh = () => fetchRecordsData();
    window.addEventListener("lmis-db-change", onRefresh);
    window.addEventListener("storage", onRefresh);

    let channel = null;
    try {
      channel = supabase
        .channel("owner-records-live")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.LIVESTOCK }, onRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.CARCASS }, onRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.POST_MORTEM }, onRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.ANTE_MORTEM }, onRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.SLAUGHTER_PROCESSING }, onRefresh)
        .subscribe();
    } catch (e) {}

    return () => {
      window.removeEventListener("lmis-db-change", onRefresh);
      window.removeEventListener("storage", onRefresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [ownerId]);

  // Enrich full livestock history with milestone progress
  const enrichedLivestock = useMemo(() => {
    return (allLivestock || []).map((a) => {
      const progress = calculateLivestockProgress(a, milestones);
      return {
        ...a,
        progress,
      };
    });
  }, [allLivestock, milestones]);

  // Filter full livestock history without today's-only restriction
  const filteredLivestock = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedLivestock.filter((a) => {
      const tag = String(a.tag_number || "").toLowerCase();
      const sp = String(a.species || "").toLowerCase();
      const stat = String(a.progress?.statusLabel || a.status || "").toLowerCase();
      const mark = String(a.mark_type || a.marking_type || a.marking_method || "").toLowerCase();
      const matchesQ = !q || tag.includes(q) || sp.includes(q) || stat.includes(q) || mark.includes(q);

      const regDate = a.registered_at || a.created_at || a.received_date;
      const matchesDate = matchesDateFilter(regDate, dateFilter);

      return matchesQ && matchesDate;
    }).sort((a, b) => {
      const dateA = new Date(a.registered_at || a.created_at || a.received_date || 0);
      const dateB = new Date(b.registered_at || b.created_at || b.received_date || 0);
      return dateB - dateA;
    });
  }, [enrichedLivestock, searchQuery, dateFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. COMPACT FIXED TOP CONTROLS (Title + Badge + Refresh + Search) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingBottom: 2,
          flexShrink: 0,
        }}
      >
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 17 }}>📜</span>
            <h1 style={{ fontSize: 15, fontWeight: 900, margin: 0, color: "var(--color-text, #0f172a)", letterSpacing: "-0.01em" }}>
              Records
            </h1>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(2, 132, 199, 0.12)",
                color: "#0284c7",
              }}
            >
              {dateFilter || searchQuery ? `${filteredLivestock.length} / ${allLivestock.length}` : `${allLivestock.length} Total`}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={fetchRecordsData}
              title="Refresh records"
              style={{
                background: "var(--color-bg, #f8fafc)",
                border: "1px solid var(--color-border, #e2e8f0)",
                borderRadius: 8,
                padding: "4px 9px",
                color: "var(--color-text-muted, #64748b)",
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

        {/* Compact Search Bar */}
        <div style={{ position: "relative", width: "100%" }}>
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
            placeholder="Search tag number or species..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: 35,
              paddingLeft: 34,
              paddingRight: searchQuery ? 32 : 12,
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
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
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

        {/* Date Filter Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", marginTop: 2 }}>
          <div style={{ position: "relative", flex: 1 }}>
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
              <Icon.Calendar size={14} />
            </span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter records by date"
              style={{
                width: "100%",
                height: 35,
                paddingLeft: 34,
                paddingRight: 10,
                borderRadius: 10,
                border: dateFilter ? "1px solid #0284c7" : "1px solid var(--color-border, #e2e8f0)",
                background: "var(--color-bg, #f8fafc)",
                color: "var(--color-text, #0f172a)",
                fontSize: 12,
                fontWeight: 600,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setDateFilter(getManilaTodayStr())}
            title="Show today's records"
            style={{
              height: 35,
              padding: "0 12px",
              borderRadius: 10,
              border: dateFilter === getManilaTodayStr() ? "1px solid #0284c7" : "1px solid var(--color-border, #e2e8f0)",
              background: dateFilter === getManilaTodayStr() ? "rgba(2, 132, 199, 0.12)" : "var(--color-bg, #f8fafc)",
              color: dateFilter === getManilaTodayStr() ? "#0284c7" : "var(--color-text, #0f172a)",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Today
          </button>

          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              title="Clear date filter (Show all dates)"
              style={{
                height: 35,
                padding: "0 10px",
                borderRadius: 10,
                border: "1px solid var(--color-border, #e2e8f0)",
                background: "var(--color-bg, #f8fafc)",
                color: "#64748b",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon.X size={12} />
              <span>All</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. LIVESTOCK HISTORY */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Complete Livestock History
            </h2>
            <span className="text-[11px] text-slate-400 font-medium">
              Showing {filteredLivestock.length} of {allLivestock.length}
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
              Loading livestock history records...
            </div>
          ) : filteredLivestock.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center text-slate-400 mb-2">
                <Icon.Cow size={22} />
              </div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                No livestock records found
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {searchQuery || dateFilter
                  ? `No records found matching ${searchQuery ? `"${searchQuery}"` : ""}${searchQuery && dateFilter ? " on " : ""}${dateFilter ? dateFilter : ""}.`
                  : "All livestock registered under your account will appear here."}
              </p>
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter("")}
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#0284c7",
                    background: "rgba(2, 132, 199, 0.1)",
                    border: "1px solid rgba(2, 132, 199, 0.25)",
                    padding: "4px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Show All Dates
                </button>
              )}
            </div>
          ) : (
            filteredLivestock.map((animal) => {
              const progress = animal.progress || {};
              const isCleared = progress.statusCategory === "cleared";
              const isProcessing = progress.statusCategory === "processing";
              const isCondemnedOrRejected = progress.statusCategory === "condemned" || progress.statusCategory === "rejected";

              return (
                <div
                  key={animal.id || animal.tag_number}
                  className="owner-animal-card"
                  onClick={() => setSelectedLivestock(animal)}
                  style={{ cursor: "pointer" }}
                  title="Tap to view full lifecycle history"
                >
                  {/* Animal Card Header: Tag No. & Status Pill */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span
                      className="owner-animal-tag"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        letterSpacing: "0.02em",
                        color: "var(--color-text, #0f172a)",
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
                            ? "#0ea5e9"
                            : "#f59e0b",
                        }}
                      />
                      {progress.statusLabel || animal.status || "Registered"}
                    </span>
                  </div>

                  {/* Clean Info Row: Sex and Date */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--color-text-muted, #64748b)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "var(--color-text-muted, #94a3b8)", fontWeight: 500 }}>Sex:</span>
                      <strong style={{ color: "var(--color-text, #334155)", fontWeight: 700 }}>
                        {formatSex(animal.sex || animal.gender)}
                      </strong>
                    </span>

                    <span style={{ color: "var(--color-border, #cbd5e1)" }}>•</span>

                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon.Clock size={12} style={{ color: "#0ea5e9", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>
                        {formatPhDateTime(animal.registered_at || animal.created_at || animal.received_date)}
                      </span>
                    </span>

                    {progress.markTimestampFormatted && (
                      <>
                        <span style={{ color: "var(--color-border, #cbd5e1)" }}>•</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icon.Tag size={12} style={{ color: progress.isReturnedToMarking ? "#f59e0b" : "#10b981", flexShrink: 0 }} />
                          <span style={{ fontWeight: 600 }}>
                            {progress.isReturnedToMarking ? "Re-Marking: " : "Marked: "}
                            {progress.markTimestampFormatted}
                          </span>
                        </span>
                      </>
                    )}
                  </div>

                  {/* 7-Milestone Visual Progress Tracker */}
                  {Array.isArray(progress.trackerStages) && progress.trackerStages.length > 0 && (
                    <div
                      className="owner-tracker-wrap no-scrollbar"
                      style={{
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: "1px dashed var(--color-border, #e2e8f0)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        overflowX: "auto",
                        gap: 4,
                      }}
                    >
                      {progress.trackerStages.map((stg) => {
                        const isCompleted = stg.state === "completed";
                        const isCurrent = stg.state === "current";
                        const isRejected = stg.state === "rejected" || stg.state === "condemned";

                        return (
                          <div
                            key={stg.id}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              flex: 1,
                              minWidth: 42,
                              textAlign: "center",
                            }}
                          >
                            <div
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9,
                                fontWeight: 800,
                                backgroundColor: isCompleted
                                  ? "#10b981"
                                  : isRejected
                                  ? "#ef4444"
                                  : isCurrent
                                  ? "#0ea5e9"
                                  : "var(--color-border, #e2e8f0)",
                                color: isCompleted || isRejected || isCurrent ? "#ffffff" : "#94a3b8",
                              }}
                            >
                              {isCompleted ? "✓" : isRejected ? "✕" : stg.id}
                            </div>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: isCurrent ? 800 : 600,
                                color: isCurrent ? "#0ea5e9" : isCompleted ? "#10b981" : isRejected ? "#ef4444" : "#94a3b8",
                                marginTop: 3,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {stg.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* View Details Action Button */}
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 8,
                      borderTop: "1px dashed var(--color-border, #e2e8f0)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#0284c7",
                    }}
                  >
                    <span>View Details</span>
                    <Icon.ChevronRight size={14} />
                  </div>
                </div>
              );
            })
          )}
        </div>

      {/* 4. VIEW LIVESTOCK HISTORY DETAILS MODAL */}
      {selectedLivestock && (() => {
        const selTag = selectedLivestock.tag_number;
        const selTagUpper = String(selTag || "").trim().toUpperCase();
        const prog = calculateLivestockProgress(selectedLivestock, milestones);
        const isPermitIssued = prog.statusLabel === "Permit Issued" || prog.statusCategory === "cleared";
        const isCondemned = prog.statusCategory === "condemned" || prog.statusCategory === "rejected";

        const carcassRec = milestones.carcass?.[selTag] || milestones.carcass?.[selTagUpper];
        const anteRec = milestones.ante?.[selTag] || milestones.ante?.[selTagUpper];
        const postRec = milestones.post?.[selTag] || milestones.post?.[selTagUpper];
        const condRec = milestones.condemnation?.[selTag] || milestones.condemnation?.[selTagUpper];
        const permitRec =
          milestones.permits?.[selTag] ||
          milestones.permits?.[selTagUpper] ||
          milestones.permits?.[selectedLivestock.id];

        const steps = prog.steps || [];

        return (
          <div
            className="owner-modal-backdrop"
            onClick={() => setSelectedLivestock(null)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(6px)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
          >
            <div
              className="owner-modal-sheet"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxHeight: "90vh",
                overflowY: "auto",
                width: "100%",
                maxWidth: 520,
                backgroundColor: "var(--color-surface, #ffffff)",
                borderRadius: 20,
                boxShadow: "0 20px 40px -15px rgba(0,0,0,0.3)",
                padding: "22px 20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
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
                    {selectedLivestock.tag_number}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedLivestock(null)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "var(--color-bg, #f1f5f9)",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                  title="Close"
                >
                  <Icon.X size={17} />
                </button>
              </div>

              {/* Status Hero Banner */}
              <div
                style={{
                  padding: "14px 16px",
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
                    Stage {prog.currentStageIndex} of 7
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
                      width: `${Math.min(100, (prog.currentStageIndex / 7) * 100)}%`,
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
                  gap: 10,
                }}
              >
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Species &amp; Breed
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                    {selectedLivestock.species}
                    {selectedLivestock.breed && selectedLivestock.breed !== "Standard" ? ` · ${selectedLivestock.breed}` : ""}
                  </div>
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Sex
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                    {formatSex(selectedLivestock.sex || selectedLivestock.gender)}
                  </div>
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", fontWeight: 600 }}>
                    Carcass Weight
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#059669", marginTop: 2 }}>
                    {carcassRec?.total_weight || carcassRec?.cold_weight
                      ? `${carcassRec.total_weight || carcassRec.cold_weight} kg`
                      : "Pending scale"}
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
                      fontSize: 12.5,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: "var(--color-text, #0f172a)",
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon.Clock size={14} style={{ color: "#0284c7" }} />
                    Lifecycle Milestones
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted, #64748b)" }}>
                    7-Stage Abattoir Flow
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {steps.map((st) => {
                    const isDone = st.state === "completed";
                    const isCurr = st.state === "current";
                    const isRej = st.state === "rejected" || st.state === "condemned";

                    return (
                      <div
                        key={st.id}
                        style={{
                          padding: "10px 14px",
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
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              width: 22,
                              height: 22,
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
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                              {st.label}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted, #64748b)", marginTop: 1 }}>
                              {st.sublabel || (isDone ? "Completed" : isCurr ? "In Progress" : "Pending")}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: "2px 8px",
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
                            {!isDone && isCurr && st.isReturnedToMarking ? (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  borderRadius: 6,
                                  background: "rgba(245, 158, 11, 0.14)",
                                  color: "#b45309",
                                }}
                              >
                                Re-Marking
                              </span>
                            ) : null}
                          </div>

                          {st.timestampFormatted ? (
                            <div style={{ fontSize: 10.5, color: "#0284c7", fontWeight: 600, marginTop: 3 }}>
                              {st.timestampFormatted}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Close Button Footer */}
              <button
                type="button"
                onClick={() => setSelectedLivestock(null)}
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
                  marginTop: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  boxShadow: "0 2px 8px rgba(2, 132, 199, 0.25)",
                }}
              >
                <span>Close Details</span>
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default OwnerRecords;
