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
      bg: "rgba(24, 122, 86, 0.12)",
      color: "#187A56",
      border: "rgba(24, 122, 86, 0.28)",
      label: "Admin",
      gradient: "linear-gradient(135deg, #187A56 0%, #0d543a 100%)",
    };
  }
  if (label === "Veterinarian") {
    return {
      bg: "rgba(24, 122, 86, 0.12)",
      color: "#187A56",
      border: "rgba(24, 122, 86, 0.28)",
      label: "Veterinarian",
      gradient: "linear-gradient(135deg, #187A56 0%, #10b981 100%)",
    };
  }
  return {
    bg: "rgba(16, 185, 129, 0.12)",
    color: "#059669",
    border: "rgba(16, 185, 129, 0.28)",
    label: "Staff",
    gradient: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
  };
};

const getActionIcon = (category, action) => {
  const text = `${category || ""} ${action || ""}`.toLowerCase();
  if (text.includes("auth") || text.includes("log") || text.includes("session")) {
    return <Icon.ShieldCheck size={20} style={{ color: "#187A56" }} />;
  }
  if (text.includes("inspect") || text.includes("ante") || text.includes("post")) {
    return <Icon.ClipboardCheck size={20} style={{ color: "#187A56" }} />;
  }
  if (text.includes("permit") || text.includes("receipt") || text.includes("issue")) {
    return <Icon.FileText size={20} style={{ color: "#187A56" }} />;
  }
  if (text.includes("weigh") || text.includes("slaughter") || text.includes("carcass")) {
    return <Icon.Layers size={20} style={{ color: "#187A56" }} />;
  }
  if (text.includes("condemn")) {
    return <Icon.AlertTriangle size={20} style={{ color: "#ef4444" }} />;
  }
  return <Icon.Activity size={20} style={{ color: "#187A56" }} />;
};

export const AuditDetailModal = ({ logId, open, onClose }) => {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (!open || !logId) {
      setRecord(null);
      setError(null);
      setLoading(false);
      setCopiedId(false);
      return;
    }

    let isCurrent = true;
    setLoading(true);
    setError(null);
    setRecord(null);
    setCopiedId(false);

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

  const copyRecordId = () => {
    if (record?.id) {
      navigator.clipboard?.writeText(record.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    }
  };

  const roleStyle = getRoleBadgeStyle(record?.role_label || record?.role);
  const actionCategory = record ? record.action_category || record.actionCategory || classifyAuditAction(record.action) : "";
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
              width: 34,
              height: 34,
              border: "3px solid var(--color-border)",
              borderTopColor: "var(--color-primary, #10b981)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Fetching authoritative audit record...</span>
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: "24px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            borderRadius: 12,
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

      {!loading && !error && record && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              padding: "16px 18px",
              background: "linear-gradient(135deg, rgba(24, 122, 86, 0.06) 0%, rgba(24, 122, 86, 0.02) 100%)",
              border: "1px solid rgba(24, 122, 86, 0.2)",
              borderLeft: "4px solid #187A56",
              borderRadius: 12,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 240 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "rgba(24, 122, 86, 0.12)",
                  border: "1px solid rgba(24, 122, 86, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {getActionIcon(actionCategory, record.action)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
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
                        fontWeight: 700,
                        background: "rgba(24, 122, 86, 0.12)",
                        color: "#187A56",
                        border: "1px solid rgba(24, 122, 86, 0.28)",
                      }}
                    >
                      {actionCategory}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-text)", lineHeight: 1.35 }}>
                  {record.action || actionCategory || "Not recorded"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: 7,
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
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    background: record.severity === "danger" ? "rgba(239, 68, 68, 0.12)" : "rgba(245, 158, 11, 0.12)",
                    color: record.severity === "danger" ? "#ef4444" : "#d97706",
                    border: `1px solid ${record.severity === "danger" ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                    textTransform: "capitalize",
                  }}
                >
                  {record.severity}
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: roleStyle.gradient,
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.1)",
                }}
              >
                {initials(fullName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Icon.User size={12} style={{ color: "#187A56" }} />
                  <span>User / Actor</span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginTop: 2,
                  }}
                  title={fullName}
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

            <div
              style={{
                padding: "14px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon.Clock size={12} style={{ color: "#187A56" }} />
                <span>Date &amp; Time (Asia/Manila)</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)", marginTop: 2 }}>
                {formatManilaDateTime(record.timestamp || record.created_at)}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                <Icon.Check size={12} style={{ color: "#10b981", strokeWidth: 3 }} />
                <span>Official Philippine Standard Time (PHT)</span>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "14px 16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <Icon.Database size={12} style={{ color: "#187A56" }} />
              <span>Affected Record &amp; Identifiers</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", background: "var(--color-bg)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)" }}>Target Entity:</span>
              {tags.length > 0 ? (
                tags.map((t) => <TagBadge key={t} tag={t} />)
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                  {record.tag_number || "Not recorded"}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 2 }}>
              <div style={{ padding: "8px 12px", background: "var(--color-bg)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>Field Modified</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", fontFamily: "monospace", marginTop: 3 }}>
                  {record.field_changed || "None"}
                </div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>Security Event</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: record.security_event && record.security_event !== "None" ? "#ef4444" : "var(--color-text)", marginTop: 3 }}>
                  {record.security_event || "None"}
                </div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg)", borderRadius: 8, border: "1px solid var(--color-border)", minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase" }}>Actor User ID</div>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    fontFamily: "monospace",
                    marginTop: 3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={record.user_id || "Not recorded"}
                >
                  {record.user_id ? record.user_id : "Not recorded"}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <Icon.GitCommit size={13} style={{ color: "#187A56" }} />
              <span>State Transition (Before / After)</span>
            </div>

            {record.old_value !== null || record.new_value !== null ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: 10,
                  alignItems: "stretch",
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    background: "rgba(239, 68, 68, 0.05)",
                    border: "1px solid rgba(239, 68, 68, 0.22)",
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                    <span>Previous State (Before)</span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      maxHeight: 180,
                      overflowY: "auto",
                      flex: 1,
                    }}
                  >
                    {record.old_value !== null && record.old_value !== undefined ? String(record.old_value) : "Not recorded"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-text-muted)",
                    }}
                    title="Transition flow"
                  >
                    <Icon.ArrowRight size={14} />
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    background: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.22)",
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: "#059669", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                    <span>Subsequent State (After)</span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      maxHeight: 180,
                      overflowY: "auto",
                      flex: 1,
                    }}
                  >
                    {record.new_value !== null && record.new_value !== undefined ? String(record.new_value) : "Not recorded"}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--color-bg)",
                  borderRadius: 10,
                  border: "1px dashed var(--color-border)",
                  fontSize: 12.5,
                  color: "var(--color-text-muted)",
                  fontStyle: "italic",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon.Info size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                <span>No value modifications or before/after diffs were recorded for this operational event.</span>
              </div>
            )}
          </div>

          <div
            style={{
              padding: "10px 14px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 11.5,
              color: "var(--color-text-muted)",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.ShieldCheck size={14} style={{ color: "#10b981", flexShrink: 0 }} />
              <span>Audit Record ID:</span>
              <span
                onClick={copyRecordId}
                style={{
                  fontFamily: "monospace",
                  color: "var(--color-text)",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "var(--color-surface)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--color-border)",
                }}
                title="Click to copy full ID"
              >
                {record.id || "Not recorded"}
                {copiedId ? (
                  <span style={{ color: "#10b981", fontSize: 10, fontWeight: 700 }}>Copied!</span>
                ) : (
                  <Icon.Copy size={11} style={{ opacity: 0.6 }} />
                )}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Globe size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
              <span>Network Trace:</span>
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--color-text)" }}>
                {record.ip ? record.ip : "Zero IP Tracking Policy"}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
