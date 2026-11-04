import { useState, useEffect } from "react";
import { Modal, Button } from "../ui";
import { TagBadge } from "../ui/TagBadge";
import { Icon } from "../icons";
import {
  getAuditLogById,
  formatManilaDateTime,
  formatRoleLabel,
  classifyAuditAction,
} from "../../services/activityService";
import { initials } from "../../utils/helpers";

/**
 * Resolves any livestock tag numbers or record identifiers embedded in the log.
 */
const resolveTagNumbers = (log) => {
  if (!log) return [];
  const found = new Set();
  if (log.tag_number && log.tag_number !== "—" && log.tag_number !== "null") {
    log.tag_number.split(",").forEach((t) => {
      const trimmed = t.trim();
      if (trimmed) found.add(trimmed);
    });
  }
  const matches = (
    `${log.action || ""} ${log.old_value || ""} ${log.new_value || ""}`
  ).match(/TAG-[\w-]+/gi);
  if (matches) {
    matches.forEach((m) => found.add(m.trim()));
  }
  return Array.from(found);
};

const getRoleBadgeStyle = (role) => {
  const label = formatRoleLabel(role);
  if (label === "Admin") {
    return {
      bg: "rgba(139, 92, 246, 0.14)",
      color: "#8b5cf6",
      border: "rgba(139, 92, 246, 0.3)",
      label: "Admin",
      gradient: "linear-gradient(135deg, #7c3aed, #6d28d9)",
    };
  }
  if (label === "Veterinarian") {
    return {
      bg: "rgba(14, 165, 233, 0.14)",
      color: "#0284c7",
      border: "rgba(14, 165, 233, 0.3)",
      label: "Veterinarian",
      gradient: "linear-gradient(135deg, #0284c7, #0369a1)",
    };
  }
  return {
    bg: "rgba(16, 185, 129, 0.14)",
    color: "#10b981",
    border: "rgba(16, 185, 129, 0.3)",
    label: "Staff",
    gradient: "linear-gradient(135deg, #16a34a, #15803d)",
  };
};

export const AuditDetailModal = ({ logId, open, onClose }) => {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !logId) {
      setRecord(null);
      setError(null);
      setLoading(false);
      return;
    }

    let isCurrent = true;
    setLoading(true);
    setError(null);
    setRecord(null);

    getAuditLogById(logId).then(({ data, error: err }) => {
      if (!isCurrent) return;
      setLoading(false);
      if (err) {
        setError(err.message || "Failed to load audit record from server");
      } else if (!data) {
        setError("Audit record not found or access denied.");
      } else {
        setRecord(data);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [logId, open]);

  const handleClose = () => {
    setRecord(null);
    setError(null);
    setLoading(false);
    onClose?.();
  };

  const roleStyle = getRoleBadgeStyle(record?.role_label || record?.role);
  const actionCategory = record ? record.action_category || classifyAuditAction(record) : "";
  const fullName = record ? record.user_full_name || record.user || "Authorized Personnel" : "";
  const tags = resolveTagNumbers(record);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Audit Trail Record Details"
      size="lg"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* Loading State */}
      {loading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
            gap: 12,
            color: "var(--color-text-muted)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid var(--color-border)",
              borderTopColor: "#10b981",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Fetching authoritative audit record...</span>
        </div>
      )}

      {/* Error / Not Found State */}
      {!loading && error && (
        <div
          style={{
            padding: "24px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 10,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            color: "#ef4444",
          }}
        >
          <Icon.AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Unable to load audit details</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{error}</div>
            <Button
              variant="outline"
              size="sm"
              style={{ marginTop: 12 }}
              onClick={() => {
                if (logId) {
                  setLoading(true);
                  setError(null);
                  getAuditLogById(logId).then(({ data, error: err }) => {
                    setLoading(false);
                    if (err) setError(err.message || "Failed to load audit record");
                    else if (!data) setError("Audit record not found or access denied.");
                    else setRecord(data);
                  });
                }
              }}
            >
              Retry Query
            </Button>
          </div>
        </div>
      )}

      {/* Strictly Read-Only Detail View */}
      {!loading && !error && record && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Header Action Banner */}
          <div
            style={{
              padding: "16px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Action
                </span>
                {actionCategory && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 800,
                      background: "rgba(14, 165, 233, 0.14)",
                      color: "#0284c7",
                      border: "1px solid rgba(14, 165, 233, 0.3)",
                    }}
                  >
                    {actionCategory}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-text)", lineHeight: 1.4 }}>
                {record.action || actionCategory || "Not recorded"}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {record.module || "System"}
              </span>
              {record.severity && record.severity !== "info" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    background: record.severity === "danger" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                    color: record.severity === "danger" ? "#ef4444" : "#f59e0b",
                    border: `1px solid ${record.severity === "danger" ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                    textTransform: "capitalize",
                  }}
                >
                  {record.severity}
                </span>
              )}
            </div>
          </div>

          {/* Actor & Metadata Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {/* Actor Card */}
            <div
              style={{
                padding: "14px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: roleStyle.gradient,
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {initials(fullName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                  User
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fullName}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: roleStyle.bg,
                      color: roleStyle.color,
                      border: `1px solid ${roleStyle.border}`,
                    }}
                  >
                    {roleStyle.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Manila Timestamp Card */}
            <div
              style={{
                padding: "14px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
                Date &amp; Time (Asia/Manila)
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--color-text)" }}>
                {formatManilaDateTime(record.timestamp || record.created_at)}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                Official Philippine Standard Time (PHT)
              </div>
            </div>
          </div>

          {/* Record Identifiers & Clinical / Operational Context */}
          <div
            style={{
              padding: "14px 16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
              Affected Record &amp; Identifiers
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>Livestock / Entity:</span>
              {tags.length > 0 ? (
                tags.map((t) => <TagBadge key={t} tag={t} />)
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  {record.tag_number || "Not recorded"}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 4 }}>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>Field Modified: </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)", fontFamily: "monospace" }}>
                  {record.field_changed || "Not recorded"}
                </span>
              </div>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>Security Event: </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>
                  {record.security_event || "None"}
                </span>
              </div>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>Actor User ID: </span>
                <span
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-text-muted)", fontFamily: "monospace" }}
                  title={record.user_id || "Not recorded"}
                >
                  {record.user_id ? record.user_id : "Not recorded"}
                </span>
              </div>
            </div>
          </div>

          {/* Before & After Values (Diff Card) */}
          <div
            style={{
              padding: "16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>
              State Transition (Before / After)
            </div>

            {record.old_value !== null || record.new_value !== null ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                {/* Previous Value */}
                <div
                  style={{
                    padding: "12px",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", textTransform: "uppercase" }}>
                    Previous State (Before)
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      color: "var(--color-text)",
                      fontFamily: "monospace",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      maxHeight: 180,
                      overflowY: "auto",
                    }}
                  >
                    {record.old_value !== null && record.old_value !== undefined ? String(record.old_value) : "Not recorded"}
                  </div>
                </div>

                {/* New Value */}
                <div
                  style={{
                    padding: "12px",
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", textTransform: "uppercase" }}>
                    Subsequent State (After)
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      color: "var(--color-text)",
                      fontFamily: "monospace",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      maxHeight: 180,
                      overflowY: "auto",
                    }}
                  >
                    {record.new_value !== null && record.new_value !== undefined ? String(record.new_value) : "Not recorded"}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--color-bg)",
                  borderRadius: 8,
                  border: "1px dashed var(--color-border)",
                  fontSize: 12.5,
                  color: "var(--color-text-muted)",
                  fontStyle: "italic",
                }}
              >
                No value modifications or before/after diffs were recorded for this operational event.
              </div>
            )}
          </div>

          {/* Audit Integrity Metadata */}
          <div
            style={{
              padding: "10px 14px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 11,
              color: "var(--color-text-muted)",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              Audit Record ID: <span style={{ fontFamily: "monospace", color: "var(--color-text)" }}>{record.id || "Not recorded"}</span>
            </div>
            <div>
              Network Trace: <span style={{ fontFamily: "monospace" }}>{record.ip ? record.ip : "Zero IP Tracking Policy"}</span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
