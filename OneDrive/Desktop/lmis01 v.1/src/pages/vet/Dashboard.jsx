import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, StatCard, EmptyState, Button } from "../../components/ui";
import { Badge } from "../../components/ui/Badge";
import { TagBadge } from "../../components/ui/TagBadge";
import { Icon } from "../../components/icons";
import { InspectionDecisions, CarcassWeightSpeciesBar } from "../../components/charts/VetCharts";
import { WelcomeBanner } from "../../components/layout/WelcomeBanner";
import { DashBanner, ListRow, DashSkeleton } from "../../components/dashboard/DashboardParts";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { formatDate } from "../../utils/helpers";
import { formatSex, formatPhDateTime } from "../../utils/formatters";
import { getAttributionName } from "../../utils/processHistory";
import { pickDate, recency, INSPECTION_DATE_FIELDS, calculateInspectionCategoryCounts } from "../../utils/dashboardMetrics";
import "../../styles/dashboard.css";
import { getPostOutcome, isAnteCondemnedDecision } from "./condemnationStage";

export const VetDashboard = () => {
  const navigate = useNavigate();
  const { data: livestock, loading: livestockLoading } = useSupabase(TABLES.LIVESTOCK);
  const { data: ante, loading: anteLoading } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post } = useSupabase(TABLES.POST_MORTEM);
  const { data: condemnationRecords } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: processing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: slaughter } = useSupabase(TABLES.SLAUGHTER_RECORDS);
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

  // Live animals awaiting ante-mortem inspection:
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

      // Livestock awaiting marking or returned to marking must NEVER appear in Ante-Mortem inspection.
      if (
        s === "pending marking" ||
        s === "for marking" ||
        s === "ready for marking" ||
        s === "received" ||
        s === "returned to animal marking" ||
        s === "returned to marking" ||
        Boolean(l.fallback_at)
      ) return false;

      // Terminal or downstream statuses
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

      // Already inspected at Ante-Mortem
      if (l.id && anteLivestockIds.has(String(l.id).trim())) return false;
      if (anteTags.has(tag)) return false;

      // Animal MUST be marked by Staff to be awaiting Ante-Mortem inspection
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

  // Carcasses awaiting post-mortem inspection
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
        status: "Slaughter Completed"
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

  // Newest first sorted record lists
  const sortedAnte = useMemo(() => {
    return [...(ante || [])]
      .sort((a, b) => recency(b, INSPECTION_DATE_FIELDS) - recency(a, INSPECTION_DATE_FIELDS))
      .slice(0, 6);
  }, [ante]);

  const sortedPost = useMemo(() => {
    return [...(post || [])]
      .sort((a, b) => recency(b, INSPECTION_DATE_FIELDS) - recency(a, INSPECTION_DATE_FIELDS))
      .slice(0, 6);
  }, [post]);

  const sortedCarcass = useMemo(() => {
    return [...(carcass || [])]
      .sort((a, b) => recency(b, ["weighed_at", "date", "created_at"]) - recency(a, ["weighed_at", "date", "created_at"]))
      .slice(0, 6);
  }, [carcass]);

  const anteApprovedCount = (ante || []).filter((i) => i.decision === "Approved" || i.decision === "Passed").length;
  const totalAwaiting = awaitingAnteMortem.length + awaitingPostMortem.length;
  const go = (path) => () => navigate(`/vet/${path}`);

  const inspectionCounts = useMemo(() => {
    return calculateInspectionCategoryCounts({
      ante,
      post,
      livestock,
      condemned: condemnationRecords,
    });
  }, [ante, post, livestock, condemnationRecords]);

  if (livestockLoading && anteLoading) return <DashSkeleton />;

  return (
    <div className="dash" style={{ paddingBottom: 24 }}>
      {/* 1. Header Banner */}
      <WelcomeBanner icon={<Icon.Stethoscope size={28} />} />

      {/* 2. Urgent Queue Alert */}
      {totalAwaiting > 0 && (
        <DashBanner
          tone="sky"
          icon={<Icon.Stethoscope size={20} />}
          title={`${totalAwaiting} inspection${totalAwaiting > 1 ? "s" : ""} waiting for clinical evaluation`}
          text={`${awaitingAnteMortem.length} live animal${awaitingAnteMortem.length === 1 ? "" : "s"} awaiting ante-mortem · ${awaitingPostMortem.length} carcass${awaitingPostMortem.length === 1 ? "" : "es"} awaiting post-mortem`}
          onClick={go(awaitingAnteMortem.length > 0 ? "ante-mortem" : "post-mortem")}
          action={
            <Button size="sm" onClick={(e) => { e.stopPropagation(); go(awaitingAnteMortem.length > 0 ? "ante-mortem" : "post-mortem")(); }}>
              <Icon.Stethoscope size={15} /> Start Inspecting
            </Button>
          }
        />
      )}

      {/* 3. Section: Clinical KPI Metrics */}
      <div className="dash-grid-4">
        <StatCard
          label="Ante-Mortem Records"
          value={(ante || []).length}
          trend={`${anteApprovedCount} passed · ${(ante || []).length - anteApprovedCount} suspect/condemned`}
          icon={<Icon.Stethoscope size={24} />}
          color="sky"
          onClick={go("ante-mortem/records")}
        />
        <StatCard
          label="Awaiting Live Check"
          value={awaitingAnteMortem.length}
          trend={awaitingAnteMortem.length > 0 ? "Live animals in lairage" : "Queue clear"}
          icon={<Icon.Clock size={24} />}
          color="amber"
          onClick={go("ante-mortem")}
        />
        <StatCard
          label="Post-Mortem Records"
          value={(post || []).length}
          trend={awaitingPostMortem.length > 0 ? `${awaitingPostMortem.length} carcasses pending` : "All carcasses inspected"}
          icon={<Icon.Activity size={24} />}
          color="violet"
          onClick={go("post-mortem/records")}
        />
        <StatCard
          label="Carcass Scale Weights"
          value={(carcass || []).length}
          trend={awaitingWeighing.length > 0 ? `${awaitingWeighing.length} awaiting scale` : "All carcasses weighed"}
          icon={<Icon.Scale size={24} />}
          color="emerald"
          onClick={go("carcass-weighing")}
        />
      </div>

      {/* 4. Section: Exactly Two Graphs Per Role Requirements */}
      <div className="dash-grid-2">
        {/* Graph 1: Clinical Inspection Decisions & Outcomes */}
        <Card
          title="Clinical Inspection Outcomes"
          action={
            <Button size="sm" variant="ghost" onClick={go("history")}>
              View History →
            </Button>
          }
        >
          <InspectionDecisions counts={inspectionCounts} data={inspections} />
        </Card>

        {/* Graph 2: Verified Carcass Scale Weights by Species */}
        <Card
          title="Average Carcass Scale Weight by Species"
          action={
            <Button size="sm" variant="ghost" onClick={go("carcass-weighing")}>
              Scale Records →
            </Button>
          }
        >
          <CarcassWeightSpeciesBar carcass={carcass} livestock={livestock} />
        </Card>
      </div>

      {/* 5. Section: Actual Record Lists (Role-Separated) */}
      <div className="dash-grid-2">
        {/* Record List 1: Recent Ante-Mortem Inspections */}
        <Card
          title="Recent Ante-Mortem Inspections"
          action={
            <Button size="sm" variant="ghost" onClick={go("ante-mortem/records")}>
              View All ({(ante || []).length}) →
            </Button>
          }
        >
          {sortedAnte.length === 0 ? (
            <EmptyState
              title="No Ante-Mortem inspections recorded"
              message="Conducted live animal evaluations will appear here."
              icon={<Icon.Stethoscope />}
            />
          ) : (
            <div className="dash-list">
              {sortedAnte.map((i) => (
                <ListRow
                  key={i.id || `${i.tag_number}-${i.date}`}
                  gradient="linear-gradient(135deg, #0ea5e9, #0369a1)"
                  icon={<Icon.Stethoscope size={14} />}
                  onClick={go("ante-mortem/records")}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={i.tag_number} />
                      <span>{i.species || "Livestock"}</span>
                    </span>
                  }
                  sub={`${formatDate(i.date)} · ${i.findings || "No clinical abnormalities"} · ${i.inspector_name || "Dr. Dave"}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={i.decision || "Approved"} />
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>

        {/* Record List 2: Recent Post-Mortem Inspections */}
        <Card
          title="Recent Post-Mortem Inspections"
          action={
            <Button size="sm" variant="ghost" onClick={go("post-mortem/records")}>
              View All ({(post || []).length}) →
            </Button>
          }
        >
          {sortedPost.length === 0 ? (
            <EmptyState
              title="No Post-Mortem inspections recorded"
              message="Conducted carcass and visceral evaluations will appear here."
              icon={<Icon.Activity />}
            />
          ) : (
            <div className="dash-list">
              {sortedPost.map((i) => (
                <ListRow
                  key={i.id || `${i.tag_number}-${i.date}`}
                  gradient="linear-gradient(135deg, #8b5cf6, #6d28d9)"
                  icon={<Icon.Activity size={14} />}
                  onClick={go("post-mortem/records")}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={i.tag_number} />
                      <span>{i.species || "Carcass"}</span>
                    </span>
                  }
                  sub={`${formatDate(i.date)} · ${i.findings || i.remarks || "No visceral abnormalities"} · ${i.inspector_name || "Dr. Dave"}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={i.decision || "Approved"} />
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Record List 3: Recent Carcass Weighing Records */}
      <Card
        title="Recent Carcass Weighing & Scale Records"
        action={
          <Button size="sm" variant="ghost" onClick={go("carcass-weighing")}>
            View All ({(carcass || []).length}) →
          </Button>
        }
      >
        {sortedCarcass.length === 0 ? (
          <EmptyState
            title="No carcass scale records yet"
            message="Verified carcass scale weights will appear here once processed on the scale."
            icon={<Icon.Scale />}
          />
        ) : (
          <div className="dash-list">
            {sortedCarcass.map((c) => (
              <ListRow
                key={c.id || c.tag_number}
                gradient="linear-gradient(135deg, #10b981, #047857)"
                icon={<Icon.Scale size={14} />}
                onClick={go("carcass-weighing")}
                title={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <TagBadge tag={c.tag_number} />
                    <strong>{c.total_weight ? `${c.total_weight} kg` : "—"}</strong>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      (Hot: {c.hot_weight ? `${c.hot_weight} kg` : "—"} · Cold: {c.cold_weight ? `${c.cold_weight} kg` : "—"})
                    </span>
                  </span>
                }
                sub={`Grade ${c.grade || "A"} · Scale Operator: ${c.operator || "Dave Gisigisi"} · ${c.date ? formatDate(c.date) : "Recent"}`}
                end={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge status={c.status || "Weighed"} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
