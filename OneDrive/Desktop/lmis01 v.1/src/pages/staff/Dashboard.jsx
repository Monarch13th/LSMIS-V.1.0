import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/icons";
import { DashSkeleton } from "../../components/dashboard/DashboardParts";
import { InteractiveAreaChart, InteractiveRings } from "../../components/dashboard/InteractiveDashWidgets";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { formatDate, uuid, isWaitingForSlaughter } from "../../utils/helpers";
import { formatPhDateTime, formatSex } from "../../utils/formatters";
import {
  pickDate,
  recency,
  isSameDay,
  LIVESTOCK_DATE_FIELDS,
} from "../../utils/dashboardMetrics";
import { supabase } from "../../services/supabaseClient";
import "../../styles/dashboard.css";
import "../../styles/admin_dash.css";

export const StaffDashboard = () => {
  const navigate = useNavigate();
  const { data: livestock = [], loading: livestockLoading } = useSupabase(TABLES.LIVESTOCK);
  const { data: slaughter = [] } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: processing = [], loading: processingLoading } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: permits = [], loading: permitsLoading } = useSupabase(TABLES.PERMITS);

  const todayStr = new Date().toISOString().split("T")[0];

  // Livestock passed in ante-mortem & marked, ready for slaughter line
  const readyList = useMemo(() => {
    const processingTags = new Set((processing || []).map((p) => p.tag_number));
    const list = [];
    const seen = new Set();

    (slaughter || []).forEach((s) => {
      if (isWaitingForSlaughter(s, processingTags) && !seen.has(s.tag_number)) {
        seen.add(s.tag_number);
        list.push(s);
      }
    });
    (livestock || []).forEach((l) => {
      if (isWaitingForSlaughter(l, processingTags) && !seen.has(l.tag_number)) {
        seen.add(l.tag_number);
        list.push(l);
      }
    });
    return list;
  }, [slaughter, livestock, processing]);

  useEffect(() => {
    if (readyList.length > 0) {
      const alertKey = `alert_slaughter_ready_${todayStr}`;
      if (!localStorage.getItem(alertKey)) {
        const newNotif = {
          id: uuid(),
          title: "Slaughter Line Alert",
          message: `You have ${readyList.length} animal(s) ready for slaughter processing!`,
          date: new Date().toISOString(),
          read: false,
          type: "info",
          role: "staff",
        };
        Promise.resolve(supabase.from(TABLES.NOTIFICATIONS).insert(newNotif)).catch(() => {});
        localStorage.setItem(alertKey, "true");
      }
    }
  }, [readyList.length, todayStr]);

  // Marked livestock records
  const markedLivestock = useMemo(() => {
    return (livestock || []).filter(
      (l) =>
        l.marked === true ||
        l.marked === "true" ||
        l.marked === 1 ||
        Boolean(l.mark_type) ||
        Boolean(l.mark_date) ||
        String(l.status || "").toLowerCase() === "marked"
    );
  }, [livestock]);

  // Recent Intake
  const recentLivestock = useMemo(() => {
    return [...(livestock || [])]
      .sort((a, b) => recency(b, LIVESTOCK_DATE_FIELDS) - recency(a, LIVESTOCK_DATE_FIELDS))
      .slice(0, 3);
  }, [livestock]);

  // Recent Meat Permits Processed
  const recentPermits = useMemo(() => {
    return [...(permits || [])]
      .sort(
        (a, b) =>
          recency(b, ["issued_at", "date_issued", "created_at"]) -
          recency(a, ["issued_at", "date_issued", "created_at"])
      )
      .slice(0, 2);
  }, [permits]);

  const speciesRows = useMemo(() => {
    const list = livestock || [];
    const count = (fn) => list.filter((l) => fn(String(l.species || "").toLowerCase().trim())).length;
    return [
      {
        label: "Hogs",
        shortLabel: "HOGS",
        count: count((s) => s === "hog" || s === "swine" || s === "pig"),
        hint: "Click to view registered livestock",
        onClick: () => navigate("/staff/owners"),
      },
      {
        label: "Cattle",
        shortLabel: "CATTLE",
        count: count((s) => s === "cattle" || s === "cow"),
        hint: "Click to view registered livestock",
        onClick: () => navigate("/staff/owners"),
      },
      {
        label: "Carabao / Goat",
        shortLabel: "OTHER",
        count: count((s) => s !== "hog" && s !== "swine" && s !== "pig" && s !== "cattle" && s !== "cow"),
        hint: "Click to view registered livestock",
        onClick: () => navigate("/staff/owners"),
      },
    ];
  }, [livestock, navigate]);

  const now = new Date();
  const receivedToday = (livestock || []).filter((l) => isSameDay(pickDate(l, LIVESTOCK_DATE_FIELDS), now)).length;
  const totalIntake = (livestock || []).length;
  const markedPct = totalIntake > 0 ? Math.round((markedLivestock.length / totalIntake) * 100) : 0;
  const awaitingMarking = Math.max(0, totalIntake - markedLivestock.length);

  const chartPoints = useMemo(() => {
    const procLen = (processing || []).length;
    const permLen = (permits || []).length;
    return [
      {
        label: "Intake",
        v: totalIntake,
        sub: receivedToday || Math.round(totalIntake * 0.5),
        primaryTag: "All-time intake",
        secondaryTag: "Received today",
        hint: "Click to open Livestock Intake →",
        onClick: () => navigate("/staff/owners"),
      },
      {
        label: "Marked",
        v: markedLivestock.length,
        sub: Math.round(markedLivestock.length * 0.7),
        primaryTag: "Marked livestock",
        secondaryTag: "Verified tags",
        hint: "Click to open Animal Marking →",
        onClick: () => navigate("/staff/animal-marking"),
      },
      {
        label: "Slaughter",
        v: procLen,
        sub: Math.round(procLen * 0.65),
        primaryTag: "Slaughter records",
        secondaryTag: "Completed line",
        hint: "Click to open Slaughter Processing →",
        onClick: () => navigate("/staff/slaughter-processing"),
      },
      {
        label: "Permits",
        v: permLen,
        sub: Math.round(permLen * 0.75),
        primaryTag: "Total meat permits",
        secondaryTag: "Released permits",
        hint: "Click to open Meat Permits →",
        onClick: () => navigate("/staff/permits"),
      },
    ];
  }, [totalIntake, receivedToday, markedLivestock.length, processing, permits, navigate]);

  const go = (path) => () => navigate(`/staff/${path}`);

  if (livestockLoading && processingLoading && permitsLoading) return <DashSkeleton />;

  return (
    <div className="ag-dash">
      {/* Row 1: Hero Overview (Dark) + Abattoir Operations (Glass) + Intake by Species (White) */}
      <div className="ag-row ag-row-top">
        {/* Top-Left: Overall Information Card */}
        <section className="ag-card ag-dark ag-overview">
          <header className="ag-card-head">
            <h2>Overall information</h2>
            <button
              type="button"
              className="ag-icon-btn"
              onClick={go("owners")}
              data-ag-tip="Open Registered Owners & Intake"
              data-ag-tip-pos="right"
              aria-label="View Registered Owners"
            >
              <Icon.ExternalLink size={15} />
            </button>
          </header>

          <div className="ag-overview-stats">
            <div
              className="ag-big interactive"
              onClick={go("owners")}
              data-ag-tip={`Total livestock intake: ${totalIntake} (+${receivedToday} registered today)`}
              data-ag-tip-pos="left"
            >
              <strong>{totalIntake}</strong>
              <span>
                Livestock
                <br />
                intake
              </span>
            </div>
            <div className="ag-big-sep" />
            <div
              className="ag-big small interactive"
              onClick={go("slaughter-processing")}
              data-ag-tip={`${readyList.length} animal(s) cleared Ante-Mortem and ready for slaughter`}
            >
              <strong>{readyList.length}</strong>
              <span>
                Ready for
                <br />
                slaughter
              </span>
            </div>
          </div>

          <div
            className="ag-progress"
            onClick={go("animal-marking")}
            data-ag-tip={`${markedLivestock.length} of ${totalIntake} livestock marked (${markedPct}%)${awaitingMarking ? ` · ${awaitingMarking} awaiting mark` : ""}`}
          >
            <i style={{ width: `${Math.max(markedPct, 8)}%` }} />
          </div>

          <div className="ag-tiles">
            <button
              type="button"
              className="ag-tile mid"
              onClick={go("animal-marking")}
              data-ag-tip={`${markedLivestock.length} animals marked · ${awaitingMarking} awaiting ear tag/tattoo`}
            >
              <span className="ag-tile-icon">
                <Icon.Tag size={15} />
              </span>
              <strong>{markedLivestock.length}</strong>
              <span>Marked</span>
            </button>
            <button
              type="button"
              className="ag-tile"
              onClick={go("slaughter-processing")}
              data-ag-tip={`${(processing || []).length} slaughter processing records (${readyList.length} ready in queue)`}
            >
              <span className="ag-tile-icon">
                <Icon.Scissors size={15} />
              </span>
              <strong>{(processing || []).length}</strong>
              <span>Slaughter</span>
            </button>
            <button
              type="button"
              className="ag-tile light"
              onClick={go("permits")}
              data-ag-tip={`${(permits || []).length} meat permits certified for release`}
            >
              <span className="ag-tile-icon">
                <Icon.FileText size={15} />
              </span>
              <strong>{(permits || []).length}</strong>
              <span>Permits</span>
            </button>
          </div>
        </section>

        {/* Top-Center: Abattoir Operations Card */}
        <section className="ag-card ag-glass">
          <header className="ag-card-head">
            <h2>Abattoir operations</h2>
            <button
              type="button"
              className="ag-icon-btn"
              onClick={go("reports")}
              data-ag-tip="Open Analytical Reports"
              data-ag-tip-pos="right"
              aria-label="Open Analytical Reports"
            >
              <Icon.PieChart size={16} />
            </button>
          </header>

          <InteractiveAreaChart
            points={chartPoints}
            primaryLabel="All-time volume"
            secondaryLabel={`Today's intake (+${receivedToday})`}
            ariaLabel="Staff operations throughput"
          />
        </section>

        {/* Top-Right: Intake by Species Card */}
        <section className="ag-card ag-white ag-progress-card">
          <div>
            <header className="ag-card-head">
              <h2>Intake by Species</h2>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={go("owners")}
                data-ag-tip="View Registered Owners"
                data-ag-tip-pos="right"
                aria-label="View Registered Owners"
              >
                <Icon.TrendingUp size={16} />
              </button>
            </header>

            <p
              className="ag-sub-stat interactive"
              onClick={go("animal-marking")}
              data-ag-tip={`${markedLivestock.length} marked animals · ${awaitingMarking} awaiting mark (${markedPct}% marked)`}
              data-ag-tip-pos="left"
            >
              <b>{markedLivestock.length}</b> marked animals
              {awaitingMarking ? ` · ${awaitingMarking} awaiting mark` : ""}
            </p>

            <div className="ag-overview-label">OVERVIEW</div>
            <InteractiveRings
              rows={speciesRows}
              centerValue={`${markedPct}%`}
              centerCaption="MARKED"
              ariaLabel="Livestock by species"
            />
          </div>

          <div className="ag-card-foot-actions">
            <button
              type="button"
              className="ag-circle-action"
              onClick={go("owners")}
              data-ag-tip="Registered Owners & Intake"
              data-ag-tip-pos="left"
              aria-label="Registered Owners"
            >
              <Icon.User size={15} />
            </button>
            <button
              type="button"
              className="ag-outline-pill"
              onClick={go("reports")}
              data-ag-tip="Export & view operational reports"
            >
              View Reports
            </button>
          </div>
        </section>
      </div>

      {/* Row 2: Slaughter Line Queue Checklist + Recent Permits Cards + All Permits Slot */}
      <div className="ag-row ag-row-mid">
        <section className="ag-card ag-white ag-goals">
          <header className="ag-card-head">
            <h2>Operations Queue</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="ag-goals-badge"
                data-ag-tip={`${readyList.length} animal(s) ready for slaughter processing`}
              >
                {readyList.length} ready
              </span>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={go("slaughter-processing")}
                data-ag-tip="Go to Slaughter Floor"
                data-ag-tip-pos="right"
                aria-label="Go to Slaughter Floor"
              >
                <Icon.Scissors size={14} />
              </button>
            </div>
          </header>

          <ul className="ag-checklist">
            <li
              onClick={go("slaughter-processing")}
              data-ag-tip={`${readyList.length} animal(s) cleared Ante-Mortem · Click to open Slaughter Processing`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {readyList.length} animal{readyList.length === 1 ? "" : "s"} ready for slaughter line
              </span>
              <span className="ag-check-sub">Process</span>
            </li>
            <li
              className="muted"
              onClick={go("animal-marking")}
              data-ag-tip={`${awaitingMarking} animal(s) awaiting ear tag or tattoo · Click to mark`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {awaitingMarking} livestock awaiting ear tag / tattoo
              </span>
              <span className="ag-check-sub">Mark</span>
            </li>
            <li
              className="muted"
              onClick={go("owners")}
              data-ag-tip={`${receivedToday} livestock received today · Click to view owners & intake`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                +{receivedToday} livestock registered today
              </span>
            </li>
            <li
              className="muted"
              onClick={go("permits")}
              data-ag-tip={`Browse all ${(permits || []).length} certified meat permits`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {(permits || []).length} meat permits certified for release
              </span>
            </li>
          </ul>
        </section>

        <div className="ag-process">
          <header className="ag-process-head">
            <h2>
              Recent Permits <small>( {(permits || []).length} )</small>
            </h2>
            <button type="button" className="ag-link" onClick={go("permits")}>
              Open Meat Permits <Icon.ChevronRight size={14} />
            </button>
          </header>

          <div className="ag-process-grid">
            {recentPermits.length === 0 ? (
              <div className="ag-card ag-white ag-empty-card" style={{ gridColumn: "span 2" }}>
                No meat permits issued yet.
              </div>
            ) : (
              recentPermits.map((pm) => (
                <article
                  key={pm.id || pm.permit_no}
                  className="ag-card ag-white ag-task"
                  onClick={go("permits")}
                  data-ag-tip={`Permit ${pm.permit_no || pm.permit_number || "Record"} · Owner: ${pm.owner_name || "Registered Owner"} · Status: ${pm.status || "Active"}`}
                >
                  <div>
                    <div className="ag-task-top">
                      <span className="ag-task-icon">
                        <Icon.FileText size={18} />
                      </span>
                      <Badge status={pm.status || "Active"} />
                    </div>
                    <h3>{pm.permit_no || pm.permit_number || "Meat Permit"}</h3>
                    <p>
                      {pm.owner_name || "Registered Owner"} · {pm.species || "Livestock"}
                    </p>
                  </div>
                  <footer>
                    <span>
                      {pm.issued_at ? formatPhDateTime(pm.issued_at) : formatDate(pm.created_at) || "Issued"}
                    </span>
                    <span className="ag-task-corner">
                      <Icon.ArrowRight size={14} />
                    </span>
                  </footer>
                </article>
              ))
            )}

            <button
              type="button"
              className="ag-dashed-slot"
              onClick={go("permits")}
              data-ag-tip={`View all ${(permits || []).length} meat permits certified for release`}
            >
              <span>View All Permits</span>
              <small>{(permits || []).length} certified for release</small>
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Latest Livestock Dark Cards */}
      <div className="ag-section-head">
        <h2 className="ag-section">Latest Livestock Registrations</h2>
        <button type="button" className="ag-link" onClick={go("owners")}>
          View all ({totalIntake}) <Icon.ChevronRight size={14} />
        </button>
      </div>

      <div className="ag-row ag-row-bottom">
        {recentLivestock.length === 0 ? (
          <div className="ag-card ag-dark ag-empty-card" style={{ gridColumn: "1 / -1" }}>
            No livestock records registered yet.
          </div>
        ) : (
          recentLivestock.map((l) => (
            <article
              key={l.id || l.tag_number}
              className="ag-card ag-dark ag-project"
              onClick={go("owners")}
              data-ag-tip={`Tag ${l.tag_number || "Untagged"} · ${l.species || "Livestock"} · Status: ${l.status || "Registered"} · Owner: ${l.owner_name || "Unknown"}`}
            >
              <header>
                <h3>
                  {l.species || "Livestock"} · {l.tag_number || "Untagged"}
                </h3>
                <span className="ag-ring-badge">
                  {l.sex ? String(formatSex(l.sex)).slice(0, 1).toUpperCase() : "OK"}
                </span>
              </header>
              <ul>
                <li>
                  <strong>{l.status || "Registered"}</strong>
                </li>
                <li>
                  Owner: {l.owner_name || "Unknown"}
                  {l.received_date ? ` · ${formatDate(l.received_date)}` : ""}
                </li>
              </ul>
            </article>
          ))
        )}
      </div>
    </div>
  );
};
