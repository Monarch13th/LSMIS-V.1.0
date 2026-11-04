import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, StatCard, EmptyState, Button } from "../../components/ui";
import { Badge } from "../../components/ui/Badge";
import { TagBadge } from "../../components/ui/TagBadge";
import { Icon } from "../../components/icons";
import { SpeciesBar, TeamAssignmentBar } from "../../components/charts/StaffCharts";
import { WelcomeBanner } from "../../components/layout/WelcomeBanner";
import { DashBanner, ListRow, DashSkeleton } from "../../components/dashboard/DashboardParts";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { formatDate, uuid, isWaitingForSlaughter } from "../../utils/helpers";
import { formatPhDateTime, formatSex } from "../../utils/formatters";
import { getAttributionName } from "../../utils/processHistory";
import {
  pickDate,
  recency,
  isSameDay,
  LIVESTOCK_DATE_FIELDS,
} from "../../utils/dashboardMetrics";
import { supabase } from "../../services/supabaseClient";
import "../../styles/dashboard.css";

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
        };
        supabase.from(TABLES.NOTIFICATIONS).insert(newNotif).then();
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

  // 1. Recent Intake
  const recentLivestock = useMemo(() => {
    return [...(livestock || [])]
      .sort((a, b) => recency(b, LIVESTOCK_DATE_FIELDS) - recency(a, LIVESTOCK_DATE_FIELDS))
      .slice(0, 6);
  }, [livestock]);

  // 2. Recent Animal Marking Activities
  const recentMarked = useMemo(() => {
    return [...markedLivestock]
      .sort(
        (a, b) =>
          recency(b, ["mark_date", "marked_at", "received_date", "created_at"]) -
          recency(a, ["mark_date", "marked_at", "received_date", "created_at"])
      )
      .slice(0, 6);
  }, [markedLivestock]);

  // 3. Recent Slaughter Floor Operations
  const recentProcessing = useMemo(() => {
    return [...(processing || [])]
      .sort(
        (a, b) =>
          recency(b, ["processed_at", "date", "created_at", "started_at"]) -
          recency(a, ["processed_at", "date", "created_at", "started_at"])
      )
      .slice(0, 6);
  }, [processing]);

  // 4. Recent Meat Permits Processed
  const recentPermits = useMemo(() => {
    return [...(permits || [])]
      .sort(
        (a, b) =>
          recency(b, ["issued_at", "date_issued", "created_at"]) -
          recency(a, ["issued_at", "date_issued", "created_at"])
      )
      .slice(0, 6);
  }, [permits]);

  const go = (path) => () => navigate(`/staff/${path}`);

  const now = new Date();
  const receivedToday = (livestock || []).filter((l) => isSameDay(pickDate(l, LIVESTOCK_DATE_FIELDS), now)).length;

  if (livestockLoading && processingLoading && permitsLoading) return <DashSkeleton />;

  return (
    <div className="dash" style={{ paddingBottom: 24 }}>
      {/* 1. Header Banner */}
      <WelcomeBanner icon={<Icon.Cow size={28} />} />

      {/* 2. Urgent Slaughter Line Intake Alert Banner */}
      {readyList.length > 0 && (
        <DashBanner
          tone="amber"
          icon={<Icon.Scissors size={20} />}
          title="Slaughter Line Intake"
          text={`${readyList.length} animal${readyList.length > 1 ? "s are" : " is"} marked and ready for slaughter processing.`}
          onClick={go("slaughter-processing")}
          action={
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                go("slaughter-processing")();
              }}
            >
              <Icon.Scissors size={15} /> Go to Slaughter Floor
            </Button>
          }
        />
      )}

      {/* 3. Section: Operational KPI Cards */}
      <div className="dash-grid-4">
        <StatCard
          label="Livestock Intake"
          value={(livestock || []).length}
          trend={receivedToday > 0 ? `${receivedToday} registered today` : "Total received"}
          icon={<Icon.Cow />}
          color="emerald"
          onClick={go("owners")}
        />
        <StatCard
          label="Marked Animals"
          value={markedLivestock.length}
          trend={`${Math.max(0, (livestock || []).length - markedLivestock.length)} awaiting marking`}
          icon={<Icon.Tag />}
          color="sky"
          onClick={go("animal-marking")}
        />
        <StatCard
          label="Slaughter Processing"
          value={(processing || []).length}
          trend={readyList.length > 0 ? `${readyList.length} queued for line` : "Line active"}
          icon={<Icon.Scissors />}
          color="violet"
          onClick={go("slaughter-processing")}
        />
        <StatCard
          label="Meat Permits Issued"
          value={(permits || []).length}
          trend="Certified for release"
          icon={<Icon.FileText />}
          color="amber"
          onClick={go("permits")}
        />
      </div>

      {/* 4. Section: Exactly Two Graphs Per Role Requirements */}
      <div className="dash-grid-2">
        {/* Graph 1: Livestock Intake & Registration by Species */}
        <Card
          title="Livestock Intake by Species"
          action={
            <Button size="sm" variant="ghost" onClick={go("owners")}>
              View Owners →
            </Button>
          }
        >
          <SpeciesBar livestock={livestock} />
        </Card>

        {/* Graph 2: Slaughter Floor Team Operator Assignments */}
        <Card
          title="Slaughter Floor Team Assignments"
          action={
            <Button size="sm" variant="ghost" onClick={go("slaughter-processing")}>
              Line Operations →
            </Button>
          }
        >
          <TeamAssignmentBar processing={processing} />
        </Card>
      </div>

      {/* 5. Section: Actual Record Lists (Role-Separated) - Intake & Marking */}
      <div className="dash-grid-2">
        {/* Record List 1: Recent Livestock Intake & Registrations */}
        <Card
          title="Recent Livestock Registrations"
          action={
            <Button size="sm" variant="ghost" onClick={go("owners")}>
              View All ({(livestock || []).length}) →
            </Button>
          }
        >
          {recentLivestock.length === 0 ? (
            <EmptyState
              title="No livestock registered yet"
              message="Register an owner and receive animals to get started"
              icon={<Icon.Cow />}
            />
          ) : (
            <div className="dash-list">
              {recentLivestock.map((l) => (
                <ListRow
                  key={l.id || l.tag_number}
                  gradient="linear-gradient(135deg, #10b981, #047857)"
                  icon={<Icon.Cow size={14} />}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={l.tag_number} />
                      <span>{l.species || "Livestock"} · {formatSex(l.sex)}</span>
                    </span>
                  }
                  sub={`${l.owner_name || "Unknown owner"} · ${formatDate(l.received_date || l.created_at)} · by ${getAttributionName(l.registered_by || l.created_by)}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={l.status} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={go("owners")}
                        style={{ padding: "3px 8px", fontSize: 11.5 }}
                      >
                        View
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>

        {/* Record List 2: Recent Animal Marking Activities */}
        <Card
          title="Recent Animal Marking Activities"
          action={
            <Button size="sm" variant="ghost" onClick={go("animal-marking")}>
              View All ({markedLivestock.length}) →
            </Button>
          }
        >
          {recentMarked.length === 0 ? (
            <EmptyState
              title="No animals marked yet"
              message="Apply tattoo or ear tag marks to incoming livestock."
              icon={<Icon.Tag />}
            />
          ) : (
            <div className="dash-list">
              {recentMarked.map((m) => (
                <ListRow
                  key={m.id || m.tag_number}
                  gradient="linear-gradient(135deg, #0ea5e9, #0284c7)"
                  icon={<Icon.Tag size={14} />}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={m.tag_number} />
                      <span>{m.species || "Livestock"} · {m.mark_type || "Ear Tag"}</span>
                    </span>
                  }
                  sub={`${m.owner_name || "Unknown owner"} · Marked: ${formatDate(m.mark_date || m.created_at)}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={m.status || "Marked"} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={go("animal-marking")}
                        style={{ padding: "3px 8px", fontSize: 11.5 }}
                      >
                        View
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 6. Section: Actual Record Lists (Role-Separated) - Slaughter Processing & Meat Permits */}
      <div className="dash-grid-2">
        {/* Record List 3: Recent Slaughter Floor Operations */}
        <Card
          title="Recent Slaughter Operations"
          action={
            <Button size="sm" variant="ghost" onClick={go("slaughter-processing")}>
              View All ({(processing || []).length}) →
            </Button>
          }
        >
          {recentProcessing.length === 0 ? (
            <EmptyState
              title="No slaughter operations recorded"
              message="Live animals processed on the slaughter floor will appear here."
              icon={<Icon.Scissors />}
            />
          ) : (
            <div className="dash-list">
              {recentProcessing.map((p) => (
                <ListRow
                  key={p.id || p.tag_number}
                  gradient="linear-gradient(135deg, #8b5cf6, #6d28d9)"
                  icon={<Icon.Scissors size={14} />}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={p.tag_number} />
                      <span>{p.species || "Livestock"} · Operator: <strong>{p.operator || "Unassigned"}</strong></span>
                    </span>
                  }
                  sub={`${p.owner_name || "Unknown owner"} · ${p.processed_at ? formatPhDateTime(p.processed_at) : formatDate(p.date || p.created_at)}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={p.status || "In Progress"} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={go("slaughter-processing")}
                        style={{ padding: "3px 8px", fontSize: 11.5 }}
                      >
                        View
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>

        {/* Record List 4: Recent Meat Permits Processed */}
        <Card
          title="Recent Meat Permits Issued"
          action={
            <Button size="sm" variant="ghost" onClick={go("permits")}>
              View All ({(permits || []).length}) →
            </Button>
          }
        >
          {recentPermits.length === 0 ? (
            <EmptyState
              title="No meat permits issued yet"
              message="Processed permits for meat transport and release will appear here."
              icon={<Icon.FileText />}
            />
          ) : (
            <div className="dash-list">
              {recentPermits.map((pm) => (
                <ListRow
                  key={pm.id || pm.permit_no}
                  gradient="linear-gradient(135deg, #f59e0b, #d97706)"
                  icon={<Icon.FileText size={14} />}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <TagBadge tag={pm.tag_number} />
                      <span>Permit #{pm.permit_no || pm.permit_number || "—"}</span>
                    </span>
                  }
                  sub={`${pm.owner_name || "Unknown owner"} · ${pm.species || "Meat"} · ${pm.carcass_weight ? `${pm.carcass_weight} kg` : "—"} · ${formatDate(pm.issued_at || pm.created_at)}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={pm.status || "Active"} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={go("permits")}
                        style={{ padding: "3px 8px", fontSize: 11.5 }}
                      >
                        View
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
