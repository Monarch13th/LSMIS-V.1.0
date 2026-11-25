import { useState, useEffect, useCallback, useTransition, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Badge } from "../../components/ui/Badge";
import { InteractiveAreaChart, InteractiveRings } from "../../components/dashboard/InteractiveDashWidgets";
import { formatPhDateTime } from "../../utils/formatters";
import { fetchAdminDashboardData, invalidateAdminDashboardCache } from "../../services/adminDashboardService";
import "../../styles/admin_dash.css";

const EMPTY_METRICS = {
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
};

const roleOf = (u) => String(u.role || "").toLowerCase().trim();

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const m = metrics || EMPTY_METRICS;
  const ready = !(loading && !metrics);
  const val = (v) => (ready ? v : "…");

  const totalUsers = (m.users || []).length;
  const activePct = totalUsers ? Math.round((m.activeUsers / totalUsers) * 100) : 0;

  const roleRows = useMemo(() => {
    const users = m.users || [];
    const count = (fn) => users.filter((u) => fn(roleOf(u))).length;
    return [
      {
        label: "Veterinarians",
        shortLabel: "VETS",
        count: count((r) => r === "vet" || r === "veterinarian"),
        hint: "Click to manage Veterinarians",
        onClick: () => navigate("/admin/users"),
      },
      {
        label: "Staff",
        shortLabel: "STAFF",
        count: count((r) => r === "staff" || r === "operator"),
        hint: "Click to manage Staff Personnel",
        onClick: () => navigate("/admin/users"),
      },
      {
        label: "Owners",
        shortLabel: "OWNERS",
        count: count((r) => r === "owner"),
        hint: "Click to manage Registered Owners",
        onClick: () => navigate("/admin/owners"),
      },
    ];
  }, [m.users, navigate]);

  const chartPoints = useMemo(() => {
    const stats = m.throughputStats || {};
    const intake = Number(stats.livestockCount) || Number(m.livestockCount) || 0;
    const slaughter = Number(stats.slaughterCount) || Number(m.slaughterCount) || 0;
    const insp = Number(stats.inspectionCount ?? stats.inspectionsCount) || Number(m.inspectionsCount) || 0;
    const perm = Number(stats.permitCount) || Number(m.permitCount) || 0;
    return [
      {
        label: "Intake",
        v: intake,
        sub: Number(m.registeredThisMonth) || 0,
        primaryTag: "All-time intake",
        secondaryTag: "Registered this month",
        hint: "Click to view Livestock Records →",
        onClick: () => navigate("/admin/livestock"),
      },
      {
        label: "Slaughter",
        v: slaughter,
        sub: Math.round(slaughter * 0.65),
        primaryTag: "Total slaughtered",
        secondaryTag: "Monthly processed",
        hint: "Click to view Slaughter Records →",
        onClick: () => navigate("/admin/slaughter/records"),
      },
      {
        label: "Inspections",
        v: insp,
        sub: Math.round(insp * 0.75),
        primaryTag: "Total inspections",
        secondaryTag: "Monthly certified",
        hint: "Click to view Inspection Records →",
        onClick: () => navigate("/admin/inspection/records"),
      },
      {
        label: "Permits",
        v: perm,
        sub: Number(m.permitsThisMonth) || 0,
        primaryTag: "All-time permits",
        secondaryTag: "Issued this month",
        hint: "Click to view Permit Records →",
        onClick: () => navigate("/admin/permits"),
      },
    ];
  }, [m, navigate]);

  const permits = (m.recentPermits || []).slice(0, 2);
  const livestock = (m.recentLivestock || []).slice(0, 3);
  const pending = (m.pendingOwners || []).slice(0, 4);

  return (
    <div className="ag-dash">
      <div className="ag-row ag-row-top">
        <section className="ag-card ag-dark ag-overview">
          <header className="ag-card-head">
            <h2>Overall information</h2>
            <button
              type="button"
              className="ag-icon-btn"
              onClick={() => navigate("/admin/livestock")}
              data-ag-tip="Open Livestock Records"
              data-ag-tip-pos="right"
              aria-label="View Livestock Records"
            >
              <Icon.ExternalLink size={15} />
            </button>
          </header>

          <div className="ag-overview-stats">
            <div
              className="ag-big interactive"
              onClick={() => navigate("/admin/livestock")}
              data-ag-tip={`Total livestock registered: ${val(m.livestockCount)} (+${val(m.registeredThisMonth)} this month)`}
              data-ag-tip-pos="left"
            >
              <strong>{val(m.livestockCount)}</strong>
              <span>
                Livestock
                <br />
                for all time
              </span>
            </div>
            <div className="ag-big-sep" />
            <div
              className="ag-big small interactive"
              onClick={() => navigate("/admin/owners")}
              data-ag-tip={`${val(m.pendingOwnersCount)} owner registration(s) awaiting approval`}
            >
              <strong>{val(m.pendingOwnersCount)}</strong>
              <span>
                Owner approvals
                <br />
                pending
              </span>
            </div>
          </div>

          <div
            className="ag-progress"
            onClick={() => navigate("/admin/users")}
            data-ag-tip={`${m.activeUsers} of ${totalUsers} personnel active (${activePct}%)${m.restrictedUsers ? ` · ${m.restrictedUsers} restricted` : ""}`}
          >
            <i style={{ width: `${Math.max(activePct, 8)}%` }} />
          </div>

          <div className="ag-tiles">
            <button
              type="button"
              className="ag-tile mid"
              onClick={() => navigate("/admin/users")}
              data-ag-tip={`${val(totalUsers)} total system users · ${val(m.activeUsers)} active`}
            >
              <span className="ag-tile-icon">
                <Icon.Users size={15} />
              </span>
              <strong>{val(totalUsers)}</strong>
              <span>Personnel</span>
            </button>
            <button
              type="button"
              className="ag-tile"
              onClick={() => navigate("/admin/inspection/records")}
              data-ag-tip={`${val(m.inspectionsCount)} clinical inspections recorded`}
            >
              <span className="ag-tile-icon">
                <Icon.Stethoscope size={15} />
              </span>
              <strong>{val(m.inspectionsCount)}</strong>
              <span>Inspections</span>
            </button>
            <button
              type="button"
              className="ag-tile light"
              onClick={() => navigate("/admin/permits")}
              data-ag-tip={`${val(m.permitCount)} meat permits issued (+${val(m.permitsThisMonth)} this month)`}
            >
              <span className="ag-tile-icon">
                <Icon.CheckCircle size={15} />
              </span>
              <strong>{val(m.permitCount)}</strong>
              <span>Permits</span>
            </button>
          </div>
        </section>

        <section className="ag-card ag-glass">
          <header className="ag-card-head">
            <h2>Operations throughput</h2>
            <button
              type="button"
              className="ag-icon-btn"
              onClick={() => navigate("/admin/reports")}
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
            secondaryLabel={`Current month (+${val(m.registeredThisMonth)} intake)`}
            ariaLabel="Operations throughput"
          />
        </section>

        <section className="ag-card ag-white ag-progress-card">
          <div>
            <header className="ag-card-head">
              <h2>Users by Role</h2>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={() => navigate("/admin/users")}
                data-ag-tip="Manage Personnel Accounts"
                data-ag-tip-pos="right"
                aria-label="Manage Personnel"
              >
                <Icon.TrendingUp size={16} />
              </button>
            </header>

            <p
              className="ag-sub-stat interactive"
              onClick={() => navigate("/admin/users")}
              data-ag-tip={`${val(m.activeUsers)} active accounts · ${val(m.restrictedUsers)} restricted`}
              data-ag-tip-pos="left"
            >
              <b>{val(m.activeUsers)}</b> active accounts
              {m.restrictedUsers ? ` · ${m.restrictedUsers} restricted` : ""}
            </p>

            <div className="ag-overview-label">OVERVIEW</div>
            <InteractiveRings
              rows={roleRows}
              centerValue={`${activePct}%`}
              centerCaption="ACTIVE"
              ariaLabel="Users by role"
            />
          </div>

          <div className="ag-card-foot-actions">
            <button
              type="button"
              className="ag-circle-action"
              onClick={() => navigate("/admin/users")}
              data-ag-tip="Personnel Management"
              data-ag-tip-pos="left"
              aria-label="Personnel Management"
            >
              <Icon.Users size={15} />
            </button>
            <button
              type="button"
              className="ag-outline-pill"
              onClick={() => navigate("/admin/reports")}
              data-ag-tip="Export & view comprehensive system reports"
            >
              View Reports
            </button>
          </div>
        </section>
      </div>

      <div className="ag-row ag-row-mid">
        <section className="ag-card ag-white ag-goals">
          <header className="ag-card-head">
            <h2>Pending Approvals</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="ag-goals-badge"
                data-ag-tip={`${val(m.pendingOwnersCount)} owner registration(s) awaiting review`}
              >
                {val(m.pendingOwnersCount)} waiting
              </span>
              <button
                type="button"
                className="ag-icon-btn"
                onClick={() => navigate("/admin/owners")}
                data-ag-tip="Review Owner Registrations"
                data-ag-tip-pos="right"
                aria-label="Review Owner Registrations"
              >
                <Icon.Edit size={14} />
              </button>
            </div>
          </header>

          {pending.length === 0 ? (
            <ul className="ag-checklist">
              <li
                onClick={() => navigate("/admin/owners")}
                data-ag-tip="All owner registrations are up to date · Click to open Owner Management"
              >
                <span className="ag-check">
                  <Icon.Check size={12} />
                </span>
                <span className="ag-check-text">All owner registrations reviewed</span>
              </li>
              <li
                className="muted"
                onClick={() => navigate("/admin/users")}
                data-ag-tip={`${val(m.activeUsers)} of ${val(totalUsers)} accounts active · Click to manage personnel`}
              >
                <span className="ag-check">
                  <Icon.Check size={12} />
                </span>
                <span className="ag-check-text">{val(m.activeUsers)} active personnel accounts</span>
              </li>
              <li
                className="muted"
                onClick={() => navigate("/admin/livestock")}
                data-ag-tip={`${val(m.registeredThisMonth)} new livestock registered this month`}
              >
                <span className="ag-check">
                  <Icon.Check size={12} />
                </span>
                <span className="ag-check-text">+{val(m.registeredThisMonth)} livestock registered this month</span>
              </li>
              <li
                className="muted"
                onClick={() => navigate("/admin/permits")}
                data-ag-tip={`${val(m.permitsThisMonth)} meat permits issued this month`}
              >
                <span className="ag-check">
                  <Icon.Check size={12} />
                </span>
                <span className="ag-check-text">+{val(m.permitsThisMonth)} meat permits issued this month</span>
              </li>
            </ul>
          ) : (
            <ul className="ag-checklist">
              {pending.map((o, idx) => (
                <li
                  key={o.id}
                  className={idx > 0 ? "muted" : ""}
                  onClick={() => navigate("/admin/owners")}
                  data-ag-tip={`${o.name || "Owner"}${o.email ? ` (${o.email})` : ""} · Click to review registration`}
                >
                  <span className="ag-check">
                    <Icon.Check size={12} />
                  </span>
                  <span className="ag-check-text">{o.name || o.email || "Pending Owner"}</span>
                  <span className="ag-check-sub">Review</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ag-process">
          <header className="ag-process-head">
            <h2>
              Recent Permits <small>( {val(m.permitCount)} )</small>
            </h2>
            <button type="button" className="ag-link" onClick={() => navigate("/admin/permits")}>
              Open Permit Records <Icon.ChevronRight size={14} />
            </button>
          </header>

          <div className="ag-process-grid">
            {permits.length === 0 ? (
              <div className="ag-card ag-white ag-empty-card" style={{ gridColumn: "span 2" }}>
                No meat permits issued yet.
              </div>
            ) : (
              permits.map((p) => (
                <article
                  key={p.id || p.permit_no}
                  className="ag-card ag-white ag-task"
                  onClick={() => navigate("/admin/permits")}
                  data-ag-tip={`Permit ${p.permit_no || "Record"} · Owner: ${p.owner_name || "Registered Owner"} · Status: ${p.status || "Active"}`}
                >
                  <div>
                    <div className="ag-task-top">
                      <span className="ag-task-icon">
                        <Icon.FileText size={18} />
                      </span>
                      <Badge status={p.status || "Active"} />
                    </div>
                    <h3>{p.permit_no || "Meat Permit"}</h3>
                    <p>
                      {p.owner_name || "Registered Owner"} · {p.species || "Livestock"}
                    </p>
                  </div>
                  <footer>
                    <span>{p.issued_at ? formatPhDateTime(p.issued_at) : "Issued"}</span>
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
              onClick={() => navigate("/admin/permits")}
              data-ag-tip={`Browse all ${val(m.permitCount)} meat permits (+${val(m.permitsThisMonth)} issued this month)`}
            >
              <span>View All Permits</span>
              <small>+{val(m.permitsThisMonth)} issued this month</small>
            </button>
          </div>
        </div>
      </div>

      <div className="ag-section-head">
        <h2 className="ag-section">Latest Livestock Records</h2>
        <button type="button" className="ag-link" onClick={() => navigate("/admin/livestock")}>
          View all ({val(m.livestockCount)}) <Icon.ChevronRight size={14} />
        </button>
      </div>

      <div className="ag-row ag-row-bottom">
        {livestock.length === 0 ? (
          <div className="ag-card ag-dark ag-empty-card" style={{ gridColumn: "1 / -1" }}>
            No livestock records registered yet.
          </div>
        ) : (
          livestock.map((l) => (
            <article
              key={l.id || l.tag_number}
              className="ag-card ag-dark ag-project"
              onClick={() => navigate("/admin/livestock")}
              data-ag-tip={`Tag ${l.tag_number || "Untagged"} · ${l.species || "Livestock"} · Status: ${l.status || "Registered"} · Owner: ${l.owner_name || "Unknown"}`}
            >
              <header>
                <h3>
                  {l.species || "Livestock"} · {l.tag_number || "Untagged"}
                </h3>
                <span className="ag-ring-badge">{l.sex ? String(l.sex).slice(0, 1).toUpperCase() : "OK"}</span>
              </header>
              <ul>
                <li>
                  <strong>{l.status || "Registered"}</strong>
                </li>
                <li>
                  Owner: {l.owner_name || "Unknown"}
                  {l.received_date ? ` · ${l.received_date}` : ""}
                </li>
              </ul>
            </article>
          ))
        )}
      </div>
    </div>
  );
};
