import { useState, useEffect, useCallback, useRef } from "react";
import { Button, EmptyState } from "../ui";
import { TagBadge } from "../ui/TagBadge";
import { Icon } from "../icons";
import {
  getAuditLogsPaginated,
  formatManilaDateTime,
  formatManilaDateAndTimes,
  formatRoleLabel,
  subscribeToAuditLogs,
} from "../../services/activityService";
import { initials } from "../../utils/helpers";
import { useAuth } from "../../hooks/useAuth";
import { AuditDetailModal } from "./AuditDetailModal";

const getRolePill = (role) => {
  const label = formatRoleLabel(role);
  if (label === "Admin") {
    return {
      bg: "rgba(24, 122, 86, 0.12)",
      color: "#24966D",
      border: "rgba(24, 122, 86, 0.28)",
      gradient: "linear-gradient(135deg, #24966D, #136647)",
      label: "Admin",
    };
  }
  if (label === "Veterinarian") {
    return {
      bg: "rgba(24, 122, 86, 0.12)",
      color: "#187A56",
      border: "rgba(24, 122, 86, 0.28)",
      gradient: "linear-gradient(135deg, #24966D, #136647)",
      label: "Veterinarian",
    };
  }
  return {
    bg: "rgba(16, 185, 129, 0.12)",
    color: "#10b981",
    border: "rgba(16, 185, 129, 0.28)",
    gradient: "linear-gradient(135deg, #10b981, #047857)",
    label: "Staff",
  };
};

const getModuleBadge = (mod) => {
  const m = (mod || "").toLowerCase();
  if (m.includes("ante") || m.includes("post") || m.includes("inspect")) {
    return { bg: "rgba(24, 122, 86, 0.12)", color: "#187A56", border: "rgba(24, 122, 86, 0.25)" };
  }
  if (m.includes("condemn")) {
    return { bg: "rgba(239, 68, 68, 0.12)", color: "#ef4444", border: "rgba(239, 68, 68, 0.25)" };
  }
  if (m.includes("pay") || m.includes("fee") || m.includes("weigh") || m.includes("carcass")) {
    return { bg: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "rgba(16, 185, 129, 0.25)" };
  }
  if (m.includes("permit") || m.includes("dispatch") || m.includes("slaughter")) {
    return { bg: "rgba(245, 158, 11, 0.12)", color: "#d97706", border: "rgba(245, 158, 11, 0.25)" };
  }
  if (m.includes("user") || m.includes("personnel") || m.includes("auth") || m.includes("owner")) {
    return { bg: "rgba(24, 122, 86, 0.12)", color: "#24966D", border: "rgba(24, 122, 86, 0.25)" };
  }
  return { bg: "var(--color-bg)", color: "var(--color-text-muted)", border: "var(--color-border)" };
};

const thStyle = {
  padding: "13px 16px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
  background: "var(--color-bg)",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 10,
  boxShadow: "0 1.5px 0 var(--color-border)",
};

export const SharedAuditLogs = ({ roleScope }) => {
  const { role: authRole, loading: authLoading, isInitialized } = useAuth();

  const normalizeRoleKey = (r) => {
    const s = String(r || "").toLowerCase().trim();
    if (s === "admin" || s === "administrator") return "admin";
    if (s === "vet" || s === "veterinarian") return "vet";
    if (s === "staff" || s === "operator") return "staff";
    return s;
  };

  const normAuth = normalizeRoleKey(authRole);
  const effectiveRoleScope = normalizeRoleKey(roleScope || normAuth);
  const isOwner = normAuth === "owner";
  const isAdminScope = effectiveRoleScope === "admin";

  // Enforce role isolation:
  // - Admin can view centralized personnel audit logs (Admin, Veterinarian, and Staff)
  // - Veterinarian and Staff can only access their own role's audit logs
  const isAuthorized = !isOwner && normAuth === effectiveRoleScope && ["admin", "vet", "staff"].includes(effectiveRoleScope);

  // Server-side State
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [roleStats, setRoleStats] = useState({ total: 0, adminCount: 0, vetCount: 0, staffCount: 0 });
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState(null);

  // Search input & Role Filter
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(isAdminScope ? "all" : effectiveRoleScope);

  // Selected Record ID for Detail View
  const [selectedLogId, setSelectedLogId] = useState(null);

  // Debounce search input
  const searchTimeoutRef = useRef(null);
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchInput(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(val);
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  const handleRoleFilterChange = (nextRole) => {
    setRoleFilter(nextRole);
  };

  // Authoritative query execution
  const fetchAuditLogs = useCallback(async () => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setQueryError(null);

    const { data, count, stats, error } = await getAuditLogsPaginated({
      page: 1,
      pageSize: 500,
      search,
      userFilter: "all",
      actionType: "all",
      roleFilter: isAdminScope ? roleFilter : effectiveRoleScope,
      moduleFilter: "all",
      dateRange: "all",
      roleScope: effectiveRoleScope,
    });

    setLoading(false);
    if (error) {
      setQueryError(error.message || "Failed to load audit logs from database.");
      setLogs([]);
      setTotalCount(0);
    } else {
      setLogs(data || []);
      setTotalCount(count || 0);
      if (stats) setRoleStats(stats);
    }
  }, [search, roleFilter, isAdminScope, effectiveRoleScope, isAuthorized]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Real-time subscription to auto-refresh table on database inserts/updates
  useEffect(() => {
    if (!isAuthorized) return;
    const unsub = subscribeToAuditLogs(() => {
      fetchAuditLogs();
    }, effectiveRoleScope);
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [fetchAuditLogs, effectiveRoleScope, isAuthorized]);

  const hasActiveFilters = Boolean(search.trim()) || (isAdminScope && roleFilter !== "all");

  const handleResetFilters = () => {
    setSearchInput("");
    setSearch("");
    if (isAdminScope) setRoleFilter("all");
  };

  if (!isInitialized && authLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 320 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              border: "3px solid var(--color-border)",
              borderTopColor: "var(--color-primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Verifying session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div style={{ width: "100%", padding: "24px 0" }}>
        <div
          style={{
            background: "var(--color-surface)",
            borderRadius: 12,
            padding: "48px 24px",
            border: "1px solid var(--color-border)",
            textAlign: "center",
          }}
        >
          <EmptyState
            title="Access Restricted"
            message="You do not have authorization to view this section of the Audit Logs. Personnel audit logs are strictly isolated to authorized personnel accounts."
            icon={<Icon.AlertTriangle size={38} style={{ color: "#ef4444" }} />}
          />
        </div>
      </div>
    );
  }

  const roleDisplayTitle =
    effectiveRoleScope === "admin"
      ? "Personnel Audit Logs"
      : effectiveRoleScope === "vet"
        ? "Veterinarian Audit Logs"
        : "Staff Personnel Audit Logs";

  const roleSubtitle =
    effectiveRoleScope === "admin"
      ? "Centralized immutable activity records across Admin, Veterinarian, and Staff personnel in Philippine Standard Time (Asia/Manila)"
      : effectiveRoleScope === "vet"
        ? "Immutable activity records of Veterinary personnel in Philippine Standard Time (Asia/Manila)"
        : "Immutable activity records of Staff personnel in Philippine Standard Time (Asia/Manila)";

  return (
    <div className="audit-logs-page records-page-container" style={{ width: "100%", padding: 0 }}>
      {/* Top Header & Filter Bar — Fixed, does NOT scroll */}
      <div
        className="records-fixed-header"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          flexShrink: 0,
          zIndex: 20,
        }}
      >
          {/* Row 1: Title + Role Filter Tabs */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "rgba(24, 122, 86, 0.12)",
                  color: "#187A56",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon.Clock size={17} />
              </span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--color-text)" }}>
                    {roleDisplayTitle}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--color-bg)",
                      color: "var(--color-text-muted)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {totalCount} {totalCount === 1 ? "record" : "records"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 1 }}>
                  {roleSubtitle}
                </div>
              </div>
            </div>

            {/* Role Filter (Left) + Search Input & Refresh (Right) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isAdminScope ? "space-between" : "flex-end",
                gap: 8,
                flexWrap: "wrap",
                flex: "1 1 100%",
              }}
            >
              {isAdminScope && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: 3,
                    borderRadius: 9,
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {[
                    { key: "all", label: "All Roles", count: roleStats.total },
                    { key: "admin", label: "Admin", count: roleStats.adminCount },
                    { key: "vet", label: "Veterinarian", count: roleStats.vetCount },
                    { key: "staff", label: "Staff", count: roleStats.staffCount },
                  ].map((tab) => {
                    const active = roleFilter === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => handleRoleFilterChange(tab.key)}
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 6,
                          border: "none",
                          fontSize: 12,
                          fontWeight: active ? 700 : 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: active ? "var(--color-surface)" : "transparent",
                          color: active ? "var(--color-text)" : "var(--color-text-muted)",
                          boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                          transition: "all 140ms ease",
                        }}
                      >
                        <span>{tab.label}</span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 999,
                            background: active ? "rgba(24, 122, 86, 0.14)" : "rgba(148, 163, 184, 0.14)",
                            color: active ? "var(--color-primary)" : "var(--color-text-muted)",
                          }}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 11,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted)",
                      display: "flex",
                      pointerEvents: "none",
                    }}
                  >
                    <Icon.Search size={14} />
                  </span>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={handleSearchChange}
                    placeholder="Search user, action, role, module..."
                    style={{
                      width: "100%",
                      height: 36,
                      padding: "0 30px 0 34px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      fontSize: 12.5,
                      outline: "none",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                    }}
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--color-text-muted)",
                        padding: 2,
                        display: "flex",
                      }}
                      title="Clear search"
                    >
                      <Icon.X size={13} />
                    </button>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchAuditLogs}
                  disabled={loading}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    flexShrink: 0,
                    cursor: loading ? "not-allowed" : "pointer",
                    color: "var(--color-text)",
                    borderColor: "var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                  title={loading ? "Refreshing audit logs..." : "Refresh audit logs"}
                  aria-label="Refresh audit logs"
                >
                  <Icon.RefreshCw size={15} className={loading ? "animate-spin" : ""} style={{ color: "currentColor" }} />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Query Error Feedback */}
        {queryError && (
          <div
            style={{
              margin: "12px 18px",
              padding: "14px 18px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "#ef4444",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon.AlertTriangle size={18} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{queryError}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAuditLogs}>
              Retry
            </Button>
          </div>
        )}

        {/* Audit Logs Table — Records scroll internally, headers remain fixed */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {loading && logs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 24px",
                gap: 12,
                color: "var(--color-text-muted)",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  border: "3px solid var(--color-border)",
                  borderTopColor: "#187A56",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loading audit logs...</span>
            </div>
          ) : logs.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
              <EmptyState
                title="No Audit Records Found"
                message={
                  hasActiveFilters
                    ? "No audit records match your current search and filter selections."
                    : "No operational or audit activities have been recorded yet."
                }
                icon={<Icon.Clock size={38} />}
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={handleResetFilters}>
                      Clear Filters
                    </Button>
                  ) : null
                }
              />
            </div>
          ) : (
            <div
              className="records-scrollable-content table-wrap"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "auto",
                border: "none",
                borderRadius: 0,
                background: "var(--color-surface)",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, textAlign: "left" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr style={{ background: "var(--color-bg)" }}>
                    <th style={thStyle}>User</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Module</th>
                    <th style={thStyle}>Date &amp; Time</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const fullName = log.user_full_name || log.user || "Authorized Personnel";
                    const rolePill = getRolePill(log.role_label || log.role);
                    const modBadge = getModuleBadge(log.module);
                    const dt = formatManilaDateAndTimes(log.timestamp || log.created_at);

                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLogId(log.id)}
                        style={{
                          transition: "background 120ms ease",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--lsmis-primary-subtle)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        title="Click to inspect full audit record details"
                      >
                        {/* 1. User: Full name of the person who performed the action */}
                        <td style={{ padding: "13px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                background: rolePill.gradient,
                                color: "#ffffff",
                                fontSize: 11.5,
                                fontWeight: 800,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {initials(fullName)}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                              {fullName}
                            </span>
                          </div>
                        </td>

                        {/* 2. Action: Activity performed */}
                        <td style={{ padding: "13px 16px", maxWidth: 460, borderBottom: "1px solid var(--color-border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--color-text)",
                                lineHeight: 1.4,
                              }}
                            >
                              {log.action || "Activity recorded"}
                            </span>
                            {log.tag_number && log.tag_number !== "—" && log.tag_number !== "null" && (
                              <TagBadge tag={log.tag_number} />
                            )}
                          </div>
                        </td>

                        {/* 3. Role: Actual role (Admin, Veterinarian, or Staff) */}
                        <td style={{ padding: "13px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border)" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              background: rolePill.bg,
                              color: rolePill.color,
                              border: `1px solid ${rolePill.border}`,
                            }}
                          >
                            {rolePill.label}
                          </span>
                        </td>

                        {/* 4. Module: Module where the activity occurred */}
                        <td style={{ padding: "13px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border)" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "3px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: modBadge.bg,
                              color: modBadge.color,
                              border: `1px solid ${modBadge.border}`,
                            }}
                          >
                            {log.module || "System"}
                          </span>
                        </td>

                        {/* 5. Date & Time: Exact date and time in Philippine time (Asia/Manila) */}
                        <td style={{ padding: "13px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border)" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>
                              {(() => {
                                const validTime =
                                  dt?.time12 && dt.time12 !== "undefined" && dt.time12 !== "null"
                                    ? dt.time12
                                    : dt?.time && dt.time !== "undefined" && dt.time !== "null"
                                      ? dt.time
                                      : "";
                                if (dt?.date && dt.date !== "undefined" && dt.date !== "null" && dt.full !== "Not recorded") {
                                  return validTime ? `${dt.date} • ${validTime}` : dt.date;
                                }
                                return formatManilaDateTime(log.timestamp || log.created_at);
                              })()}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>
                              Asia/Manila (PHT)
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Authoritative Detail Modal */}
      <AuditDetailModal
        logId={selectedLogId}
        open={Boolean(selectedLogId)}
        onClose={() => setSelectedLogId(null)}
      />
    </div>
  );
};
