import { useState, useEffect, useMemo } from "react";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatPhDateTime, formatSex } from "../../utils/formatters";
import { calculateLivestockProgress } from "./Animals";
import { getOwnerCondemnationDetails } from "../../utils/condemnationHelpers";
import { OwnerCondemnationModal } from "../../components/owner/OwnerCondemnationModal";

export const OwnerRecords = () => {
  const { ownerId } = useAuth();
  const [allLivestock, setAllLivestock] = useState([]);
  const [milestones, setMilestones] = useState({});
  const [selectedLivestock, setSelectedLivestock] = useState(null);
  const [condemnationDetails, setCondemnationDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");

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

  const fetchRecordsData = async (opts = {}) => {
    const isSilent = opts.silent === true;
    if (!isSilent) setLoading(true);
    try {
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


      let liveAnimals = [];
      if (targetOwnerId) {
        try {
          const { data: aData, error: aErr } = await supabase
            .from(TABLES.LIVESTOCK)
            .select("*")
            .eq("owner_id", targetOwnerId);
          if (!aErr && aData) liveAnimals = aData;
        } catch (e) {}

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
            supabase.from(TABLES.ANTE_MORTEM).select("*").in("tag_number", tagNumbers).order("date", { ascending: false }),
            supabase.from(TABLES.POST_MORTEM).select("*").in("tag_number", tagNumbers).order("date", { ascending: false }),
            supabase.from(TABLES.CONDEMNATION_RECORDS).select("*").in("tag_number", tagNumbers).order("date", { ascending: false }),
            supabase.from(TABLES.SLAUGHTER_PROCESSING).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.SLAUGHTER_RECORDS).select("*").in("tag_number", tagNumbers),
            supabase.from(TABLES.PERMITS).select("*").in("tag_number", tagNumbers),
          ]);

          (carcRes.data || []).forEach((c) => {
            if (c.livestock_id) cMap[c.livestock_id] = c;
            if (c.tag_number) cMap[c.tag_number] = c;
          });
          (anteRes.data || []).forEach((a) => {
            if (a.livestock_id) anteMap[a.livestock_id] = a;
            if (a.tag_number) {
              if (!anteMap[a.tag_number] || a.livestock_id) {
                anteMap[a.tag_number] = a;
                anteMap[String(a.tag_number).trim().toUpperCase()] = a;
              }
            }
          });
          (postRes.data || []).forEach((pm) => {
            if (pm.livestock_id) postMap[pm.livestock_id] = pm;
            if (pm.tag_number) {
              if (!postMap[pm.tag_number] || pm.livestock_id) {
                postMap[pm.tag_number] = pm;
                postMap[String(pm.tag_number).trim().toUpperCase()] = pm;
              }
            }
          });
          (condRes.data || []).forEach((cd) => {
            if (cd.livestock_id) {
              if (!condMap[cd.livestock_id]) condMap[cd.livestock_id] = [];
              condMap[cd.livestock_id].push(cd);
            }
            if (cd.tag_number) {
              const rawTag = cd.tag_number;
              const upperTag = String(cd.tag_number).trim().toUpperCase();
              if (!condMap[rawTag]) condMap[rawTag] = [];
              condMap[rawTag].push(cd);
              if (upperTag !== rawTag) {
                if (!condMap[upperTag]) condMap[upperTag] = [];
                condMap[upperTag].push(cd);
              }
            }
          });
          (spRes.data || []).forEach((sp) => { if (sp.tag_number) spMap[sp.tag_number] = sp; });
          (srRes.data || []).forEach((sr) => { if (sr.tag_number) srMap[sr.tag_number] = sr; });
          permList = permRes.data || [];
        } catch (e) {}
      }

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
      if (!isSilent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordsData();
    const onRefresh = () => fetchRecordsData({ silent: true });
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

  useEffect(() => {
    if (selectedLivestock?.tag_number) {
      const activeTag = String(selectedLivestock.tag_number).trim().toUpperCase();
      const updated = (allLivestock || []).find(
        (a) => String(a.tag_number || "").trim().toUpperCase() === activeTag
      );
      if (updated && updated !== selectedLivestock) {
        setSelectedLivestock((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    }
  }, [allLivestock]);

  useEffect(() => {
    if (!selectedLivestock || condemnationDetails) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSelectedLivestock(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLivestock, condemnationDetails]);

  const enrichedLivestock = useMemo(() => {
    return (allLivestock || []).map((a) => {
      const progress = calculateLivestockProgress(a, milestones);
      return {
        ...a,
        progress,
      };
    });
  }, [allLivestock, milestones]);

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

  const handleOpenCondemnation = (tagNumber, e) => {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    const tagUpper = String(tagNumber || "").trim().toUpperCase();
    const matchedAnimal =
      filteredLivestock.find((a) => String(a.tag_number || "").trim().toUpperCase() === tagUpper) ||
      { tag_number: tagNumber };
    const aId = matchedAnimal.id;
    const ante = (aId && milestones.ante?.[aId]) || milestones.ante?.[tagNumber] || milestones.ante?.[tagUpper];
    const post = (aId && milestones.post?.[aId]) || milestones.post?.[tagNumber] || milestones.post?.[tagUpper];
    const cond = (aId && milestones.condemnation?.[aId]) || milestones.condemnation?.[tagNumber] || milestones.condemnation?.[tagUpper];
    const ev = (aId && milestones.evidence?.[aId]) || milestones.evidence?.[tagNumber] || milestones.evidence?.[tagUpper] || [];

    const details =
      getOwnerCondemnationDetails({
        animal: matchedAnimal,
        ante,
        post,
        condemnation: cond,
        evidence: ev,
      }) || {
        tagNumber: matchedAnimal.tag_number || tagNumber,
        species: matchedAnimal.species || "Livestock",
        sex: matchedAnimal.sex,
        resultLabel: matchedAnimal.progress?.isPartialCondemned ? "Passed with Partial Condemnation" : "Condemned",
        scope: matchedAnimal.progress?.isPartialCondemned ? "partial" : "whole",
        locationArea: "Tinaan, City of Naga, Cebu, Philippines",
        totalWeightQty: matchedAnimal.weight ? `${matchedAnimal.weight} kg` : "—",
        inspectionDateFormatted: formatPhDateTime(new Date()),
        vetName: "Official Meat Inspection Service (Veterinarian)",
        pathologyReasons: "Veterinary condemnation decision recorded.",
        inspectionFindings: "Official condemnation record on file.",
        dispositionSummary: "Condemned carcass/cuts condemned and disposed in accordance with BAI/NMIS abattoir regulations.",
        condemnedParts: [],
        evidencePhotos: [],
        hasPhotos: false,
      };

    if (details) {
      setCondemnationDetails(details);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingBottom: 2,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Icon.FileText size={18} style={{ color: "var(--color-primary)" }} />
            <h1 style={{ fontSize: 15, fontWeight: 900, margin: 0, color: "var(--color-text, #1A201C)", letterSpacing: "-0.01em" }}>
              Records
            </h1>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(24, 122, 86, 0.12)",
                color: "#187A56",
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
            placeholder="Search tag number or species..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: 35,
              paddingLeft: 34,
              paddingRight: searchQuery ? 32 : 12,
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

        <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", marginTop: 2 }}>
          <div style={{ position: "relative", flex: 1 }}>
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
                border: dateFilter ? "1px solid #187A56" : "1px solid var(--color-border, #E2E6E3)",
                background: "var(--color-bg, #F9FAF8)",
                color: "var(--color-text, #1A201C)",
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
              border: dateFilter === getManilaTodayStr() ? "1px solid #187A56" : "1px solid var(--color-border, #E2E6E3)",
              background: dateFilter === getManilaTodayStr() ? "rgba(24, 122, 86, 0.12)" : "var(--color-bg, #F9FAF8)",
              color: dateFilter === getManilaTodayStr() ? "#187A56" : "var(--color-text, #1A201C)",
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
                border: "1px solid var(--color-border, #E2E6E3)",
                background: "var(--color-bg, #F9FAF8)",
                color: "#5D6660",
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
                    color: "#187A56",
                    background: "rgba(24, 122, 86, 0.1)",
                    border: "1px solid rgba(24, 122, 86, 0.25)",
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
              const isPartial = Boolean(progress.isPartialCondemned);
              const isActuallyCondemned = !isPartial && (isCondemnedOrRejected || /condemn|reject/i.test(`${progress.statusLabel || ""} ${animal.status || ""}`));

              const regTimeFormatted = formatPhDateTime(animal.registered_at || animal.created_at || animal.received_date);
              const tag = animal.tag_number;
              const tagUpper = String(tag || "").trim().toUpperCase();
              const aId = animal.id;
              const condRec = (aId && milestones.condemnation?.[aId]) || milestones.condemnation?.[tag] || milestones.condemnation?.[tagUpper];
              const postRec = (aId && milestones.post?.[aId]) || milestones.post?.[tag] || milestones.post?.[tagUpper];
              const anteRec = (aId && milestones.ante?.[aId]) || milestones.ante?.[tag] || milestones.ante?.[tagUpper];
              const rejectedPartsStr =
                Array.isArray(postRec?.condemned_parts) && postRec.condemned_parts.length > 0
                  ? postRec.condemned_parts.filter(p => p && (p.part || p.specific_part)).map((p) => `${p.specific_part ? `${p.part} (${p.specific_part})` : (p.part || "Cut")}${p.weight || p.quantity || p.weight_kg ? ` (${p.weight || p.quantity || p.weight_kg} kg)` : ""}`).join(", ")
                  : Array.isArray(condRec) && condRec.length > 0
                  ? condRec.filter(c => c && c.part && !/whole|entire|live animal/i.test(c.part)).map((c) => `${c.part}${c.weight || c.weight_kg ? ` (${c.weight || c.weight_kg} kg)` : ""}`).join(", ")
                  : condRec?.part && !/whole|entire|live animal/i.test(condRec.part)
                  ? `${condRec.part}${condRec.weight || condRec.weight_kg ? ` (${condRec.weight || condRec.weight_kg} kg)` : ""}`
                  : "Pathological cuts removed";

              if (isActuallyCondemned) {
                const condStageName = progress.condemnationStage || (progress.currentStageIndex === 3 ? "Ante-Mortem" : "Post-Mortem");
                const condTimeFormatted =
                  progress.condemnationDateFormatted ||
                  formatPhDateTime(animal.registered_at || animal.created_at || animal.received_date);

                return (
                  <div
                    key={animal.id || animal.tag_number}
                    className="owner-animal-card owner-condemned-card"
                    onClick={() => setSelectedLivestock(animal)}
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
                        handleOpenCondemnation(animal.tag_number, e);
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
                  onClick={() => setSelectedLivestock(animal)}
                  style={{ cursor: "pointer" }}
                  title="Tap to view full lifecycle history"
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
                      {progress.statusLabel || animal.status || "Registered"}
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

                    {progress.markTimestampFormatted && (
                      <>
                        <span style={{ color: "var(--color-border, #C2CAC4)" }}>—</span>
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
                          handleOpenCondemnation(animal.tag_number, e);
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

                  {Array.isArray(progress.trackerStages) && progress.trackerStages.length > 0 && (
                    <div
                      className="owner-tracker-wrap no-scrollbar"
                      style={{
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: "1px dashed var(--color-border, #E2E6E3)",
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
                                  ? "#24966D"
                                  : "var(--color-border, #E2E6E3)",
                                color: isCompleted || isRejected || isCurrent ? "#ffffff" : "#9BA49E",
                              }}
                            >
                              {isCompleted ? <Icon.Check size={11} strokeWidth={3} /> : isRejected ? <Icon.X size={11} strokeWidth={3} /> : stg.id}
                            </div>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: isCurrent ? 800 : 600,
                                color: isCurrent ? "#24966D" : isCompleted ? "#10b981" : isRejected ? "#ef4444" : "#9BA49E",
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

                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 8,
                      borderTop: "1px dashed var(--color-border, #E2E6E3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#187A56",
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

      {selectedLivestock && (() => {
        const selTag = selectedLivestock.tag_number;
        const selTagUpper = String(selTag || "").trim().toUpperCase();
        const prog = calculateLivestockProgress(selectedLivestock, milestones);
        const isPermitIssued = prog.statusLabel === "Permit Issued" || prog.statusCategory === "cleared";
        const isCondemned = prog.statusCategory === "condemned" || prog.statusCategory === "rejected";

        const carcassRec = milestones.carcass?.[selTag] || milestones.carcass?.[selTagUpper];
        const selId = selectedLivestock.id;
        const anteRec = (selId && milestones.ante?.[selId]) || milestones.ante?.[selTag] || milestones.ante?.[selTagUpper];
        const postRec = (selId && milestones.post?.[selId]) || milestones.post?.[selTag] || milestones.post?.[selTagUpper];
        const condRec = (selId && milestones.condemnation?.[selId]) || milestones.condemnation?.[selTag] || milestones.condemnation?.[selTagUpper];
        const permitRec =
          (selId && milestones.permits?.[selId]) ||
          milestones.permits?.[selTag] ||
          milestones.permits?.[selTagUpper];

        const steps = prog.steps || [];

        const modalRejectedPartsStr =
          Array.isArray(postRec?.condemned_parts) && postRec.condemned_parts.length > 0
            ? postRec.condemned_parts.filter(p => p && (p.part || p.specific_part)).map((p) => `${p.specific_part ? `${p.part} (${p.specific_part})` : (p.part || "Cut")}${p.weight || p.quantity || p.weight_kg ? ` (${p.weight || p.quantity || p.weight_kg} kg)` : ""}`).join(", ")
            : Array.isArray(condRec) && condRec.length > 0
            ? condRec.filter(c => c && c.part && !/whole|entire|live animal/i.test(c.part)).map((c) => `${c.part}${c.weight || c.weight_kg ? ` (${c.weight || c.weight_kg} kg)` : ""}`).join(", ")
            : condRec?.part && !/whole|entire|live animal/i.test(condRec.part)
            ? `${condRec.part}${condRec.weight || condRec.weight_kg ? ` (${condRec.weight || condRec.weight_kg} kg)` : ""}`
            : "Pathological cuts removed";

        return (
          <div
            className="owner-modal-backdrop owner-animal-detail-overlay"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedLivestock(null);
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
              padding: "16px",
            }}
          >
            <div
              className="owner-modal-sheet owner-animal-detail-modal"
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
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: "#187A56",
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
                      color: "var(--color-text, #1A201C)",
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
                    background: "var(--color-bg, #EFF2F0)",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#5D6660",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                  title="Close"
                >
                  <Icon.X size={17} />
                </button>
              </div>

              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: isCondemned
                    ? "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)"
                    : isPermitIssued
                    ? "linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(5, 150, 105, 0.06) 100%)"
                    : "linear-gradient(135deg, rgba(24, 122, 86, 0.14) 0%, rgba(24, 122, 86, 0.06) 100%)",
                  border: `1.5px solid ${
                    isCondemned
                      ? "rgba(239, 68, 68, 0.3)"
                      : isPermitIssued
                      ? "rgba(16, 185, 129, 0.35)"
                      : "rgba(24, 122, 86, 0.3)"
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
                        backgroundColor: isCondemned ? "#ef4444" : isPermitIssued ? "#10b981" : "#24966D",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        textTransform: "uppercase",
                        color: isCondemned ? "#dc2626" : isPermitIssued ? "#059669" : "#187A56",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {isCondemned ? "CONDEMNED" : prog.statusLabel || "Registered"}
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
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: isCondemned ? "#dc2626" : isPermitIssued ? "#059669" : "#187A56",
                      background: "rgba(255, 255, 255, 0.8)",
                      padding: "2px 8px",
                      borderRadius: 6,
                    }}
                  >
                    Stage {prog.currentStageIndex} of 7
                  </span>
                </div>

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
                      backgroundColor: isCondemned ? "#ef4444" : isPermitIssued ? "#10b981" : "#187A56",
                      borderRadius: 999,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>

              {prog.isPartialCondemned && (
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
                      handleOpenCondemnation(selectedLivestock.tag_number, e);
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
                className="owner-animal-modal-stats-grid"
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
                    background: "var(--color-bg, #F9FAF8)",
                    border: "1px solid var(--color-border, #E2E6E3)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #5D6660)", fontWeight: 600 }}>
                    Species &amp; Breed
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #1A201C)", marginTop: 2 }}>
                    {selectedLivestock.species}
                    {selectedLivestock.breed && selectedLivestock.breed !== "Standard" ? ` • ${selectedLivestock.breed}` : ""}
                  </div>
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--color-bg, #F9FAF8)",
                    border: "1px solid var(--color-border, #E2E6E3)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #5D6660)", fontWeight: 600 }}>
                    Sex
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text, #1A201C)", marginTop: 2 }}>
                    {formatSex(selectedLivestock.sex || selectedLivestock.gender)}
                  </div>
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--color-bg, #F9FAF8)",
                    border: "1px solid var(--color-border, #E2E6E3)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--color-text-muted, #5D6660)", fontWeight: 600 }}>
                    Carcass Weight
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#059669", marginTop: 2 }}>
                    {carcassRec?.total_weight || carcassRec?.cold_weight
                      ? `${carcassRec.total_weight || carcassRec.cold_weight} kg`
                      : "Pending scale"}
                  </div>
                </div>
              </div>


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
                      color: "var(--color-text, #1A201C)",
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon.Clock size={14} style={{ color: "#187A56" }} />
                    Lifecycle Milestones
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted, #5D6660)" }}>
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
                        className="owner-animal-modal-milestone-item"
                        style={{
                          padding: "10px 14px",
                          borderRadius: 12,
                          background: isDone
                            ? "rgba(16, 185, 129, 0.05)"
                            : isCurr
                            ? "rgba(24, 122, 86, 0.07)"
                            : isRej
                            ? "rgba(239, 68, 68, 0.07)"
                            : "var(--color-bg, #F9FAF8)",
                          border: `1px solid ${
                            isDone
                              ? "rgba(16, 185, 129, 0.22)"
                              : isCurr
                              ? "rgba(24, 122, 86, 0.3)"
                              : isRej
                              ? "rgba(239, 68, 68, 0.3)"
                              : "var(--color-border, #E2E6E3)"
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
                                ? "#24966D"
                                : "var(--color-border, #C2CAC4)",
                              color: "#ffffff",
                              flexShrink: 0,
                            }}
                          >
                            {isDone ? <Icon.Check size={12} strokeWidth={3} /> : isRej ? <Icon.X size={12} strokeWidth={3} /> : st.id}
                          </span>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text, #1A201C)" }}>
                              {st.label}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted, #5D6660)", marginTop: 1 }}>
                              {st.sublabel || (isDone ? "Completed" : isCurr ? "In Progress" : "Pending")}
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
                                  handleOpenCondemnation(selectedLivestock.tag_number, e);
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
                                  handleOpenCondemnation(selectedLivestock.tag_number, e);
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
                            <div style={{ fontSize: 10.5, color: isRej ? "#dc2626" : "#187A56", fontWeight: 600, marginTop: 3 }}>
                              {st.timestampFormatted}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedLivestock(null)}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  borderRadius: 12,
                  background: "#187A56",
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
                  boxShadow: "0 2px 8px rgba(24, 122, 86, 0.25)",
                }}
              >
                <span>Close Details</span>
              </button>
            </div>
          </div>
        );
      })()}

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

export default OwnerRecords;
