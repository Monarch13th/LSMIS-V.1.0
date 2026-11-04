import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { TagBadge } from "./ui/TagBadge";
import {
  getAuditLogsPaginated,
  subscribeToAuditLogs,
  formatManilaDateAndTimes,
  formatManilaDateTime,
  formatRoleLabel,
  classifyAuditAction,
} from "../services/activityService";
import { initials } from "../utils/helpers";

const getRoleStyle = (role) => {
  const label = formatRoleLabel(role);
  if (label === "Admin") {
    return {
      bg: "rgba(139, 92, 246, 0.12)",
      color: "#8b5cf6",
      border: "rgba(139, 92, 246, 0.28)",
      gradient: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
      label: "Admin",
    };
  }
  if (label === "Veterinarian") {
    return {
      bg: "rgba(14, 165, 233, 0.12)",
      color: "#0284c7",
      border: "rgba(14, 165, 233, 0.28)",
      gradient: "linear-gradient(135deg, #0ea5e9, #0369a1)",
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

const getActionBadgeStyle = (actionCategory) => {
  switch (actionCategory) {
    case "Created":
    case "Registered":
      return { bg: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "rgba(16, 185, 129, 0.28)" };
    case "Approved":
    case "Issued":
      return { bg: "rgba(34, 197, 94, 0.12)", color: "#16a34a", border: "rgba(34, 197, 94, 0.28)" };
    case "Updated":
    case "Assigned":
      return { bg: "rgba(14, 165, 233, 0.12)", color: "#0284c7", border: "rgba(14, 165, 233, 0.28)" };
    case "Rejected":
    case "Deleted":
      return { bg: "rgba(239, 68, 68, 0.12)", color: "#ef4444", border: "rgba(239, 68, 68, 0.28)" };
    case "Logged In":
      return { bg: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6", border: "rgba(139, 92, 246, 0.28)" };
    case "Logged Out":
      return { bg: "rgba(245, 158, 11, 0.12)", color: "#d97706", border: "rgba(245, 158, 11, 0.28)" };
    default:
      return { bg: "rgba(100, 116, 139, 0.12)", color: "var(--color-text-muted)", border: "var(--color-border)" };
  }
};

const thStyle = {
  padding: "11px 14px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
  background: "var(--color-bg)",
  whiteSpace: "nowrap",
};

export const RecentActivity = ({ title = "Live System Activity", limit = 6 }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);

  const loadRecent = useCallback(async () => {
    const { data } = await getAuditLogsPaginated({
      page: 1,
      pageSize: limit,
      roleScope: "admin",
    });
    setRows(data || []);
  }, [limit]);

  useEffect(() => {
    loadRecent();
    const unsub = subscribeToAuditLogs(() => {
      loadRecent();
    }, "admin");
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [loadRecent]);

  return (
    <Card
      title={title}
      action={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="badge badge-approved" style={{ fontSize: 10 }}>
            Live
          </span>
          <Button size="sm" variant="ghost" onClick={() => navigate("/admin/audit-logs")}>
            Audit Logs →
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted text-sm" style={{ textAlign: "center", padding: 20 }}>
          No recent activity
        </p>
      ) : (
        <div className="table-wrap" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)" }}>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Module</th>
                <th style={thStyle}>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const fullName = r.user_full_name || r.user || "Authorized Personnel";
                const rolePill = getRoleStyle(r.role_label || r.role);
                const dt = formatManilaDateAndTimes(r.timestamp || r.created_at);

                return (
                  <tr
                    key={r.id || i}
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                  >
                    {/* 1. User */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: rolePill.gradient,
                            color: "#ffffff",
                            fontSize: 11,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {initials(fullName)}
                        </div>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>
                          {fullName}
                        </span>
                      </div>
                    </td>

                    {/* 2. Action */}
                    <td style={{ padding: "11px 14px", maxWidth: 380 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", lineHeight: 1.35 }}>
                          {r.action || "Activity recorded"}
                        </span>
                        {r.tag_number && r.tag_number !== "—" && r.tag_number !== "null" && (
                          <TagBadge tag={r.tag_number} />
                        )}
                      </div>
                    </td>

                    {/* 3. Role */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 9px",
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 700,
                          background: rolePill.bg,
                          color: rolePill.color,
                          border: `1px solid ${rolePill.border}`,
                        }}
                      >
                        {rolePill.label}
                      </span>
                    </td>

                    {/* 4. Module */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: 700,
                          background: "var(--color-bg)",
                          color: "var(--color-text)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {r.module || "System"}
                      </span>
                    </td>

                    {/* 5. Date & Time */}
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>
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
                          return formatManilaDateTime(r.timestamp || r.created_at);
                        })()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
