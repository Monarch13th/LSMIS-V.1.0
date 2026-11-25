import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/icons";
import { DashSkeleton } from "../../components/dashboard/DashboardParts";
import { InteractiveAreaChart, InteractiveRings } from "../../components/dashboard/InteractiveDashWidgets";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { formatDate } from "../../utils/helpers";
import { recency, INSPECTION_DATE_FIELDS, calculateInspectionCategoryCounts } from "../../utils/dashboardMetrics";
import "../../styles/dashboard.css";
import "../../styles/admin_dash.css";
import { getPostOutcome, isAnteCondemnedDecision } from "./condemnationStage";

export const VetDashboard = () => {
  const navigate = useNavigate();
  const { data: livestock, loading: livestockLoading } = useSupabase(TABLES.LIVESTOCK);
  const { data: ante, loading: anteLoading } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post } = useSupabase(TABLES.POST_MORTEM);
  const { data: condemnationRecords } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: processing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: carcass } = useSupabase(TABLES.CARCASS_RECORDS);

  const normalizedAnte = (ante || []).map((i) => ({ ...i, type: "Ante-Mortem" }));
  const normalizedPost = (post || []).map((i) => ({ ...i, type: "Post-Mortem" }));
  const inspections = [...normalizedAnte, ...normalizedPost];

  const awaitingWeighing = useMemo(() => {
    const weighedTags = new Set((carcass || []).map((c) => String(c.tag_number || "").trim().toLowerCase()).filter(Boolean));
    const weighedIds = new Set((carcass || []).map((c) => String(c.livestock_id || "").trim()).filter(Boolean));

    return (post || []).filter((p) => {
      const isApproved = p.decision === "Approved" || p.decision === "Passed";
      const isPartial = p.decision === "Partial Condemnation" || p.decision === "Partially Condemned";
      if (!isApproved && !isPartial) return false;

      const tag = String(p.tag_number || "").trim().toLowerCase();
      if (tag && weighedTags.has(tag)) return false;
      if (p.livestock_id && weighedIds.has(String(p.livestock_id).trim())) return false;
      return true;
    });
  }, [post, carcass]);

  const anteLivestockIds = useMemo(() => new Set((ante || []).map((i) => String(i.livestock_id || "").trim()).filter(Boolean)), [ante]);
  const anteTags = useMemo(() => new Set((ante || []).map((i) => String(i.tag_number || "").trim().toLowerCase()).filter(Boolean)), [ante]);
  const postMortemTags = useMemo(() => new Set((post || []).map((p) => String(p.tag_number || "").trim().toLowerCase()).filter(Boolean)), [post]);
  const postMortemIds = useMemo(() => new Set((post || []).map((p) => String(p.livestock_id || "").trim()).filter(Boolean)), [post]);

  const awaitingAnteMortem = useMemo(() => {
    const seenTags = new Set();
    return (livestock || []).filter((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (!tag) return false;
      if (seenTags.has(tag)) return false;

      const s = String(l.status || "").toLowerCase();

      if (
        s === "pending marking" ||
        s === "for marking" ||
        s === "ready for marking" ||
        s === "received" ||
        s === "returned to animal marking" ||
        s === "returned to marking" ||
        Boolean(l.fallback_at)
      ) return false;

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

      if (l.id && anteLivestockIds.has(String(l.id).trim())) return false;
      if (anteTags.has(tag)) return false;

      const isMarked = Boolean(
        (l.marked === true || l.marked === "true" || l.marked === 1 || l.marked === "1" || l.marked === "t") &&
        l.marked !== "false" &&
        l.marked !== false &&
        (Boolean(l.mark_type) || Boolean(l.mark_date) || Boolean(l.marked_at) || s === "marked")
      );
      if (!isMarked) return false;

      if (postMortemTags.has(tag)) return false;
      if (l.id && postMortemIds.has(String(l.id).trim())) return false;

      seenTags.add(tag);
      return true;
    });
  }, [livestock, anteLivestockIds, anteTags, postMortemTags, postMortemIds]);

  const inspectedPostMortemTags = useMemo(() => {
    const tags = new Set();
    (post || []).forEach((i) => {
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
  }, [post]);

  const inspectedPostMortemIds = useMemo(() => {
    return new Set((post || []).map((i) => String(i.livestock_id || "").trim()).filter(Boolean));
  }, [post]);

  const awaitingPostMortem = useMemo(() => {
    const list = [];
    const seenTags = new Set();

    const livestockMap = new Map();
    (livestock || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      if (tag) livestockMap.set(tag.toLowerCase(), l);
    });

    (processing || []).forEach((p) => {
      const tag = String(p.tag_number || "").trim();
      const cleanTag = tag.toLowerCase();
      if (!cleanTag || seenTags.has(cleanTag)) return;

      const doneCount = p.steps ? Object.values(p.steps).filter((v) => v === true || v?.done === true).length : 0;
      const isCompleted = p.status === "Completed" || doneCount >= 6;
      if (!isCompleted) return;

      if (inspectedPostMortemTags.has(cleanTag)) return;

      const l = livestockMap.get(cleanTag);
      if (l && (l.status === "Condemned" || l.status === "Rejected")) return;
      if (l && l.id && inspectedPostMortemIds.has(String(l.id).trim())) return;

      seenTags.add(cleanTag);
      list.push({
        id: l?.id || p.id,
        tag_number: p.tag_number || l?.tag_number,
        species: p.species || l?.species || "Hog",
        owner_name: p.owner_name || l?.owner_name || "Unknown Owner",
        operator: p.operator || l?.operator || "Assigned Operator",
        received_date: l?.received_date || p.date,
        status: "Slaughter Completed",
      });
    });

    return list;
  }, [post, livestock, processing, inspectedPostMortemTags, inspectedPostMortemIds]);

  const isCondemnedOutcome = (i) => {
    if (i.type === "Post-Mortem") {
      const o = getPostOutcome(i);
      return o.label === "Partially Condemned" || o.label === "Whole Carcass Condemned";
    }
    return isAnteCondemnedDecision(i.decision);
  };

  const approved = inspections.filter(
    (i) => !isCondemnedOutcome(i) && (i.decision === "Approved" || i.decision === "Passed")
  ).length;
  const condemned = inspections.filter(isCondemnedOutcome).length;

  const sortedAnte = useMemo(() => {
    return [...(ante || [])]
      .sort((a, b) => recency(b, INSPECTION_DATE_FIELDS) - recency(a, INSPECTION_DATE_FIELDS))
      .slice(0, 3);
  }, [ante]);

  const sortedPost = useMemo(() => {
    return [...(post || [])]
      .sort((a, b) => recency(b, INSPECTION_DATE_FIELDS) - recency(a, INSPECTION_DATE_FIELDS))
      .slice(0, 2);
  }, [post]);

  const anteApprovedCount = (ante || []).filter((i) => i.decision === "Approved" || i.decision === "Passed").length;
  const postApprovedCount = (post || []).filter((i) => i.decision === "Approved" || i.decision === "Passed").length;
  const totalAwaiting = awaitingAnteMortem.length + awaitingPostMortem.length;
  const passPct = inspections.length > 0 ? Math.round((approved / inspections.length) * 100) : 100;

  const inspectionCounts = useMemo(() => {
    return calculateInspectionCategoryCounts({
      ante,
      post,
      livestock,
      condemned: condemnationRecords,
    });
  }, [ante, post, livestock, condemnationRecords]);

  const outcomeRows = useMemo(
    () => [
      {
        label: "Ante-Mortem",
        shortLabel: "ANTE",
        count: inspectionCounts?.antemortem ?? anteApprovedCount,
        hint: "Click to open Ante-Mortem Inspection",
        onClick: () => navigate("/vet/ante-mortem"),
      },
      {
        label: "Post-Mortem",
        shortLabel: "POST",
        count: inspectionCounts?.postmortem ?? postApprovedCount,
        hint: "Click to open Post-Mortem Inspection",
        onClick: () => navigate("/vet/post-mortem"),
      },
      {
        label: "Condemned",
        shortLabel: "CONDEMNED",
        count: (inspectionCounts?.partially_condemned || 0) + (inspectionCounts?.condemned || condemned),
        hint: "Click to inspect clinical history",
        onClick: () => navigate("/vet/history"),
      },
    ],
    [inspectionCounts, anteApprovedCount, postApprovedCount, condemned, navigate]
  );

  const chartPoints = useMemo(() => {
    const anteLen = (ante || []).length;
    const postLen = (post || []).length;
    const weighedLen = (carcass || []).length;
    return [
      {
        label: "Awaiting",
        v: totalAwaiting,
        sub: awaitingAnteMortem.length,
        primaryTag: "Total awaiting check",
        secondaryTag: "Awaiting Ante-Mortem",
        hint: "Click to inspect waiting queue →",
        onClick: () => navigate(awaitingAnteMortem.length > 0 ? "/vet/ante-mortem" : "/vet/post-mortem"),
      },
      {
        label: "Ante-Mortem",
        v: anteLen,
        sub: anteApprovedCount,
        primaryTag: "Total Ante-Mortem",
        secondaryTag: "Passed Ante-Mortem",
        hint: "Click to open Ante-Mortem Inspection →",
        onClick: () => navigate("/vet/ante-mortem"),
      },
      {
        label: "Post-Mortem",
        v: postLen,
        sub: postApprovedCount,
        primaryTag: "Total Post-Mortem",
        secondaryTag: "Passed Post-Mortem",
        hint: "Click to open Post-Mortem Inspection →",
        onClick: () => navigate("/vet/post-mortem"),
      },
      {
        label: "Weighed",
        v: weighedLen,
        sub: weighedLen,
        primaryTag: "Weighed carcasses",
        secondaryTag: "Certified weights",
        hint: "Click to open Carcass Weighing →",
        onClick: () => navigate("/vet/carcass-weighing"),
      },
    ];
  }, [totalAwaiting, awaitingAnteMortem.length, ante, post, carcass, anteApprovedCount, postApprovedCount, navigate]);

  const go = (path) => () => navigate(`/vet/${path}`);

  if (livestockLoading && anteLoading) return <DashSkeleton />;

  return (
    <div className="ag-dash">
      <div className="ag-row ag-row-top">
        <section className="ag-card ag-dark ag-overview">
          <header className="ag-card-head">
            <h2>Overall information</h2>
            <button
              type="button"
              className="ag-icon-btn"
              onClick={go("history")}
              data-ag-tip="Open Inspection History"
              data-ag-tip-pos="right"
              aria-label="View Inspection History"
            >
              <Icon.ExternalLink size={15} />
            </button>
          </header>

          <div className="ag-overview-stats">
            <div
              className="ag-big interactive"
              onClick={go("history")}
              data-ag-tip={`${inspections.length} total clinical inspections (${(ante || []).length} Ante-Mortem · ${(post || []).length} Post-Mortem)`}
              data-ag-tip-pos="left"
            >
              <strong>{inspections.length}</strong>
              <span>
                Inspections
                <br />
                for all time
              </span>
            </div>
            <div className="ag-big-sep" />
            <div
              className="ag-big small interactive"
              onClick={go(awaitingAnteMortem.length > 0 ? "ante-mortem" : "post-mortem")}
              data-ag-tip={`${awaitingAnteMortem.length} awaiting Ante-Mortem · ${awaitingPostMortem.length} awaiting Post-Mortem`}
            >
              <strong>{totalAwaiting}</strong>
              <span>
                Awaiting
                <br />
                evaluation
              </span>
            </div>
          </div>

          <div
            className="ag-progress"
            onClick={go("history")}
            data-ag-tip={`${approved} of ${inspections.length} inspections passed (${passPct}%)${condemned ? ` · ${condemned} condemned` : ""}`}
          >
            <i style={{ width: `${Math.max(passPct, 8)}%` }} />
          </div>

          <div className="ag-tiles">
            <button
              type="button"
              className="ag-tile mid"
              onClick={go("ante-mortem")}
              data-ag-tip={`${(ante || []).length} Ante-Mortem inspections (${anteApprovedCount} passed · ${awaitingAnteMortem.length} waiting)`}
            >
              <span className="ag-tile-icon">
                <Icon.Stethoscope size={15} />
              </span>
              <strong>{(ante || []).length}</strong>
              <span>Ante-Mortem</span>
            </button>
            <button
              type="button"
              className="ag-tile"
              onClick={go("post-mortem")}
              data-ag-tip={`${(post || []).length} Post-Mortem inspections (${postApprovedCount} passed · ${awaitingPostMortem.length} waiting)`}
            >
              <span className="ag-tile-icon">
                <Icon.Activity size={15} />
              </span>
              <strong>{(post || []).length}</strong>
              <span>Post-Mortem</span>
            </button>
            <button
              type="button"
              className="ag-tile light"
              onClick={go("carcass-weighing")}
              data-ag-tip={`${(carcass || []).length} carcasses weighed (${awaitingWeighing.length} awaiting scale)`}
            >
              <span className="ag-tile-icon">
                <Icon.Scale size={15} />
              </span>
              <strong>{(carcass || []).length}</strong>
              <span>Weighed</span>
            </button>
          </div>
        </section>

        <section className="ag-card ag-glass">
          <header className="ag-card-head">
            <h2>Clinical inspection flow</h2>
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
            secondaryLabel={`Passed (${approved} certified)`}
            ariaLabel="Clinical inspection throughput"
          />
        </section>

        <section className="ag-card ag-white ag-progress-card">
          <div>
            <header className="ag-card-head">
              <h2>Inspection Outcomes</h2>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={go("history")}
                data-ag-tip="View Inspection History"
                data-ag-tip-pos="right"
                aria-label="View Inspection History"
              >
                <Icon.TrendingUp size={16} />
              </button>
            </header>

            <p
              className="ag-sub-stat interactive"
              onClick={go("history")}
              data-ag-tip={`${approved} passed inspections · ${condemned} condemned (${passPct}% pass rate)`}
              data-ag-tip-pos="left"
            >
              <b>{approved}</b> passed inspections
              {condemned ? ` · ${condemned} condemned` : ""}
            </p>

            <div className="ag-overview-label">OVERVIEW</div>
            <InteractiveRings
              rows={outcomeRows}
              centerValue={`${passPct}%`}
              centerCaption="PASSED"
              ariaLabel="Inspection outcomes"
            />
          </div>

          <div className="ag-card-foot-actions">
            <button
              type="button"
              className="ag-circle-action"
              onClick={go("ante-mortem")}
              data-ag-tip="Ante-Mortem Inspection"
              data-ag-tip-pos="left"
              aria-label="Ante-Mortem Inspection"
            >
              <Icon.Stethoscope size={15} />
            </button>
            <button
              type="button"
              className="ag-outline-pill"
              onClick={go("reports")}
              data-ag-tip="Export & view veterinary inspection reports"
            >
              View Reports
            </button>
          </div>
        </section>
      </div>

      <div className="ag-row ag-row-mid">
        <section className="ag-card ag-white ag-goals">
          <header className="ag-card-head">
            <h2>Clinical Queue</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="ag-goals-badge"
                data-ag-tip={`${awaitingAnteMortem.length} Ante-Mortem + ${awaitingPostMortem.length} Post-Mortem waiting`}
              >
                {totalAwaiting} waiting
              </span>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={go(awaitingAnteMortem.length > 0 ? "ante-mortem" : "post-mortem")}
                data-ag-tip="Start Inspecting Queue"
                data-ag-tip-pos="right"
                aria-label="Start Inspecting"
              >
                <Icon.Stethoscope size={14} />
              </button>
            </div>
          </header>

          <ul className="ag-checklist">
            <li
              onClick={go("ante-mortem")}
              data-ag-tip={`${awaitingAnteMortem.length} marked live animal(s) ready for Ante-Mortem evaluation`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {awaitingAnteMortem.length} live animal{awaitingAnteMortem.length === 1 ? "" : "s"} awaiting Ante-Mortem
              </span>
              <span className="ag-check-sub">Inspect</span>
            </li>
            <li
              className="muted"
              onClick={go("post-mortem")}
              data-ag-tip={`${awaitingPostMortem.length} slaughtered carcass(es) ready for Post-Mortem evaluation`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {awaitingPostMortem.length} carcass{awaitingPostMortem.length === 1 ? "" : "es"} awaiting Post-Mortem
              </span>
              <span className="ag-check-sub">Inspect</span>
            </li>
            <li
              className="muted"
              onClick={go("carcass-weighing")}
              data-ag-tip={`${awaitingWeighing.length} approved carcass(es) awaiting scale weight entry`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {awaitingWeighing.length} carcass{awaitingWeighing.length === 1 ? "" : "es"} awaiting scale weight
              </span>
              <span className="ag-check-sub">Weigh</span>
            </li>
            <li
              className="muted"
              onClick={go("history")}
              data-ag-tip={`Browse all ${inspections.length} clinical inspection records`}
            >
              <span className="ag-check">
                <Icon.Check size={12} />
              </span>
              <span className="ag-check-text">
                {inspections.length} total clinical inspections recorded
              </span>
            </li>
          </ul>
        </section>

        <div className="ag-process">
          <header className="ag-process-head">
            <h2>
              Recent Post-Mortem <small>( {(post || []).length} )</small>
            </h2>
            <button type="button" className="ag-link" onClick={go("post-mortem")}>
              Open Post-Mortem <Icon.ChevronRight size={14} />
            </button>
          </header>

          <div className="ag-process-grid">
            {sortedPost.length === 0 ? (
              <div className="ag-card ag-white ag-empty-card" style={{ gridColumn: "span 2" }}>
                No Post-Mortem inspections recorded yet.
              </div>
            ) : (
              sortedPost.map((i) => (
                <article
                  key={i.id || `${i.tag_number}-${i.date}`}
                  className="ag-card ag-white ag-task"
                  onClick={go("post-mortem")}
                  data-ag-tip={`Tag ${i.tag_number || "Carcass"} · Decision: ${i.decision || "Approved"} · ${i.findings || i.remarks || "No visceral abnormalities"}`}
                >
                  <div>
                    <div className="ag-task-top">
                      <span className="ag-task-icon">
                        <Icon.Activity size={18} />
                      </span>
                      <Badge status={i.decision || "Approved"} />
                    </div>
                    <h3>{i.tag_number || "Carcass"}</h3>
                    <p>
                      {i.species || "Carcass"} · {i.findings || i.remarks || "No visceral abnormalities"}
                    </p>
                  </div>
                  <footer>
                    <span>{i.date ? formatDate(i.date) : "Inspected"}</span>
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
              onClick={go("post-mortem")}
              data-ag-tip={`Open Post-Mortem Inspection (${awaitingPostMortem.length} awaiting carcass check)`}
            >
              <span>View Post-Mortem</span>
              <small>{awaitingPostMortem.length} awaiting carcass check</small>
            </button>
          </div>
        </div>
      </div>

      <div className="ag-section-head">
        <h2 className="ag-section">Latest Ante-Mortem Inspections</h2>
        <button type="button" className="ag-link" onClick={go("ante-mortem")}>
          View all ({(ante || []).length}) <Icon.ChevronRight size={14} />
        </button>
      </div>

      <div className="ag-row ag-row-bottom">
        {sortedAnte.length === 0 ? (
          <div className="ag-card ag-dark ag-empty-card" style={{ gridColumn: "1 / -1" }}>
            No Ante-Mortem inspections recorded yet.
          </div>
        ) : (
          sortedAnte.map((i) => (
            <article
              key={i.id || `${i.tag_number}-${i.date}`}
              className="ag-card ag-dark ag-project"
              onClick={go("ante-mortem")}
              data-ag-tip={`Tag ${i.tag_number || "Untagged"} · ${i.species || "Livestock"} · Decision: ${i.decision || "Approved"} · ${i.findings || "No clinical abnormalities"}`}
            >
              <header>
                <h3>
                  {i.species || "Livestock"} · {i.tag_number || "Untagged"}
                </h3>
                <span className="ag-ring-badge">
                  {(i.decision || "Approved") === "Approved" || i.decision === "Passed" ? "OK" : "!"}
                </span>
              </header>
              <ul>
                <li>
                  <strong>{i.decision || "Approved"}</strong>
                </li>
                <li>
                  {i.findings || "No clinical abnormalities"}
                  {i.date ? ` · ${formatDate(i.date)}` : ""}
                </li>
              </ul>
            </article>
          ))
        )}
      </div>
    </div>
  );
};
