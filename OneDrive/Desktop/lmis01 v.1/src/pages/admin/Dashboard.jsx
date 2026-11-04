import { useState, useEffect, useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { Card, StatCard, EmptyState } from "../../components/ui";
import { Badge } from "../../components/ui/Badge";
import { TagBadge } from "../../components/ui/TagBadge";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/icons";
import { OperationsThroughputBar, UserRolesDoughnut } from "../../components/charts/AdminCharts";
import { WelcomeBanner } from "../../components/layout/WelcomeBanner";
import { RecentActivity } from "../../components/RecentActivity";
import { DashBanner, ListRow } from "../../components/dashboard/DashboardParts";
import { formatDateTime, formatPhDateTime } from "../../utils/formatters";
import { initials } from "../../utils/helpers";
import { toDate } from "../../utils/dashboardMetrics";
import { fetchAdminDashboardData, invalidateAdminDashboardCache } from "../../services/adminDashboardService";
import "../../styles/dashboard.css";

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  // Authoritative data fetcher with in-memory non-blocking cache
  const loadDashboard = useCallback(async (force = false) => {
    try {
      const data = await fetchAdminDashboardData(force);
      startTransition(() => {
        setMetrics(data);
        setLoading(false);
      });
    } catch (err) {
      console.warn("Admin dashboard load failed:", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(false);

    let debounceTimer = null;
    const handleDbChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        invalidateAdminDashboardCache();
        loadDashboard(true);
      }, 400);
    };

    window.addEventListener("lmis-db-change", handleDbChange);
    window.addEventListener("storage", handleDbChange);

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener("lmis-db-change", handleDbChange);
      window.removeEventListener("storage", handleDbChange);
    };
  }, [loadDashboard]);

  const m = metrics || {
    users: [],
    livestockCount: 0,
    slaughterCount: 0,
    inspectionsCount: 0,
    permitCount: 0,
    permitsThisMonth: 0,
    throughputStats: { livestockCount: 0, slaughterCount: 0, inspectionCount: 0, inspectionsCount: 0, permitCount: 0 },
    activeUsers: 0,
    restrictedUsers: 0,
    registeredThisMonth: 0,
    recentUsers: [],
    recentPermits: [],
    recentLivestock: [],
    pendingOwnersCount: 0,
    pendingOwners: [],
    hasSyncIssue: false,
  };

  return (
    <div className="dash" style={{ paddingBottom: 24 }}>
      {/* 1. Header Banner */}
      <WelcomeBanner icon={<Icon.Shield size={28} />} />

      {/* 2. High-Priority Pending Approvals Banner */}
      {m.pendingOwnersCount > 0 && (
        <DashBanner
          tone="amber"
          icon={<Icon.AlertCircle size={22} />}
          title={`${m.pendingOwnersCount} Pending Owner Account Application${m.pendingOwnersCount > 1 ? "s" : ""}`}
          text="Newly registered livestock owners are currently awaiting review and administrative verification."
          onClick={() => navigate("/admin/owners")}
          action={
            <Button
              size="sm"
              variant="warning"
              onClick={(e) => {
                e.stopPropagation();
                navigate("/admin/owners");
              }}
            >
              Review Applications →
            </Button>
          }
        />
      )}

      {/* 3. Section: Executive Overview Key Metrics */}
      <div className="dash-grid-4">
        <StatCard
          label="Active Personnel"
          value={loading && !metrics ? "..." : (m.users || []).length}
          trend={`${m.activeUsers} active${m.restrictedUsers ? ` · ${m.restrictedUsers} restricted` : ""}`}
          icon={<Icon.Users />}
          color="violet"
          onClick={() => navigate("/admin/users")}
        />
        <StatCard
          label="Livestock Records"
          value={loading && !metrics ? "..." : m.livestockCount}
          trend={`${m.registeredThisMonth} registered this month`}
          icon={<Icon.Cow />}
          color="emerald"
          onClick={() => navigate("/admin/livestock")}
        />
        <StatCard
          label="Inspections Conducted"
          value={loading && !metrics ? "..." : m.inspectionsCount}
          trend="Ante-mortem and post-mortem"
          icon={<Icon.Stethoscope />}
          color="sky"
          onClick={() => navigate("/admin/inspection/records")}
        />
        <StatCard
          label="Meat Permits Issued"
          value={loading && !metrics ? "..." : m.permitCount}
          trend={`${m.permitsThisMonth} issued this month`}
          icon={<Icon.FileText />}
          color="amber"
          onClick={() => navigate("/admin/permits")}
        />
      </div>

      {/* 4. Section: Exactly Two Graphs Per Role Requirements */}
      <div className="dash-grid-2">
        {/* Graph 1: System-Wide Operations Throughput */}
        <Card
          title="System Operations Throughput"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/reports")}>
              View Reports →
            </Button>
          }
        >
          <OperationsThroughputBar stats={m.throughputStats} />
        </Card>

        {/* Graph 2: Personnel & Registered User Distribution */}
        <Card
          title="Personnel & User Distribution"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/users")}>
              Manage Users →
            </Button>
          }
        >
          <UserRolesDoughnut users={m.users} />
        </Card>
      </div>

      {/* 5. Section: Actual Record Lists (Role-Separated) */}
      <div className="dash-grid-2">
        {/* Record List 1: Recent Meat Permits Issued */}
        <Card
          title="Recent Meat Permits Issued"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/permits")}>
              View All ({m.permitCount}) →
            </Button>
          }
        >
          {m.recentPermits.length === 0 ? (
            <EmptyState
              title="No meat permits issued yet"
              message="Issued inspection certificates and meat release permits will appear here."
              icon={<Icon.FileText />}
            />
          ) : (
            <div className="dash-list">
              {m.recentPermits.map((p) => (
                <ListRow
                  key={p.id || p.permit_no}
                  gradient="linear-gradient(135deg, #10b981, #047857)"
                  icon={<Icon.FileText size={14} />}
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <strong>{p.permit_no}</strong>
                      {p.tag_number && <TagBadge tag={p.tag_number} />}
                    </span>
                  }
                  sub={`${p.owner_name || "Unknown Owner"} · ${p.species || "Livestock"} · ${p.carcass_weight ? `${p.carcass_weight} kg` : "—"} · ${p.issued_at ? formatPhDateTime(p.issued_at) : "Recent"}`}
                  end={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge status={p.status || "Active"} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/admin/permits")}
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

        {/* Record List 2: Recent User & Personnel Registrations */}
        <Card
          title="Recent Personnel Sign-Ins & Users"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/users")}>
              Manage Users →
            </Button>
          }
        >
          {m.recentUsers.length === 0 ? (
            <EmptyState
              title="No user accounts yet"
              message="Active personnel accounts will appear here once authenticated."
              icon={<Icon.Users />}
            />
          ) : (
            <div className="dash-list">
              {m.recentUsers.map((u) => {
                const login = toDate(u.last_login);
                return (
                  <ListRow
                    key={u.id}
                    gradient="linear-gradient(135deg, #8b5cf6, #6d28d9)"
                    icon={initials(u.full_name)}
                    title={u.full_name || "Personnel"}
                    sub={`${u.email || "No email"} · ${login ? `Last login ${formatDateTime(login)}` : "Never logged in"}`}
                    end={
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                          <Badge status={u.status || "active"} />
                          <span className="text-muted capitalize" style={{ fontSize: 11, fontWeight: 700 }}>
                            {u.role || "Staff"}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate("/admin/users")}
                          style={{ padding: "3px 8px", fontSize: 11.5 }}
                        >
                          View
                        </Button>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 6. Section: Live System Activities (Standardized Audit Log Records) */}
      <RecentActivity title="Recent System Activities" limit={6} />
    </div>
  );
};
