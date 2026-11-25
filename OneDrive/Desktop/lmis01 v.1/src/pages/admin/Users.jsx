import { useState, useEffect, useMemo } from "react";
import { Button, Modal, ConfirmDialog, EmptyState } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { TABLES } from "../../utils/constants";
import { adminService } from "../../services/adminService";
import { supabase } from "../../services/supabaseClient";
import { initials } from "../../utils/helpers";
import { formatDate } from "../../utils/formatters";
import { UserForm } from "../../components/forms/UserForm";
import { ConfirmAdminPasswordModal } from "../../components/admin/ConfirmAdminPasswordModal";
import { useAdminConfirmPassword } from "../../hooks/useAdminConfirmPassword";

export const formatPersonnelId = (u, fallbackIndex = 1) => {
  if (!u) return `STF-001-2026`;
  const rawId = String(u.employee_id || u.personnel_id || u.account_id || "").trim();
  if (rawId && /^(VET|STF|ADM|USR)-\d{3}-20\d{2}$/i.test(rawId)) {
    return rawId.toUpperCase();
  }
  const r = (u.role || "").toLowerCase().trim();
  const prefix = r === "vet" || r === "veterinarian" || r.includes("vet") ? "VET" : "STF";
  const year = new Date(u.created_at || Date.now()).getFullYear() || 2026;

  if (u.id) {
    const idStr = String(u.id);
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) {
      hash = (hash * 31 + idStr.charCodeAt(i)) % 900;
    }
    const num = Math.abs(hash) + 1;
    return `${prefix}-${String(num).padStart(3, "0")}-${year}`;
  }
  return `${prefix}-${String(fallbackIndex).padStart(3, "0")}-${year}`;
};

export const Users = () => {
  const [data, setData] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failedWelcomeEmail, setFailedWelcomeEmail] = useState(null);
  const [resendingWelcomeEmail, setResendingWelcomeEmail] = useState(false);
  const { confirmModalProps, confirmAdminAction } = useAdminConfirmPassword();

  const refresh = async () => {
    if (data.length === 0) setLoading(true);
    try {
      const [users, logs] = await Promise.all([
        adminService.listUsers(),
        adminService.listAuditLogs(100)
      ]);
      const systemPersonnel = (users || []).filter((u) => {
        if (!u) return false;
        const r = (u.role || "").toLowerCase().trim();
        if (r === "admin" || r.includes("admin") || r === "owner" || u.owner_id) return false;
        return (
          r === "vet" ||
          r === "veterinarian" ||
          r === "staff" ||
          r === "meat_inspector" ||
          r.includes("vet") ||
          r.includes("staff")
        );
      });
      setData(systemPersonnel);
      setAuditLogs(logs || []);
    } catch (err) {
      console.error("Error loading personnel:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();

    const handleSync = () => {
      refresh();
    };

    window.addEventListener("lmis-db-change", handleSync);
    window.addEventListener("lmis_profile_updated", handleSync);
    window.addEventListener("storage", handleSync);

    const channel = supabase
      .channel("users-management-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLES.USERS },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener("lmis-db-change", handleSync);
      window.removeEventListener("lmis_profile_updated", handleSync);
      window.removeEventListener("storage", handleSync);
      supabase.removeChannel(channel);
    };
  }, []);

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const sortBy = "date_desc";
  const [copiedId, setCopiedId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const { showToast } = useToast();

  const handleCopyId = (e, formattedId, rawId) => {
    e.stopPropagation();
    const toCopy = formattedId || rawId;
    if (!toCopy) return;
    navigator.clipboard?.writeText(toCopy);
    setCopiedId(toCopy);
    showToast(`Copied ID: ${toCopy}`, "info");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleDeactivate = (user) => {
    const userName = user.full_name || user.username || user.email || "Personnel";
    const statusStr = (user.status || "Active").toLowerCase();
    const isDeactivated = statusStr === "inactive" || statusStr === "deactivated" || statusStr.startsWith("terminated");

    if (isDeactivated) {
      confirmAdminAction({
        title: "Confirm Account Activation",
        actionDescription: `You are about to activate the account for "${userName}" (${user.role === 'vet' ? 'Veterinary Inspector' : 'Staff Personnel'}). This will restore login and portal access immediately across all devices. Enter administrator password to authorize.`,
        confirmButtonText: "Activate Account",
        danger: false,
        actionContext: {
          action: `Activated account for ${userName}`,
          module: "Personnel Management",
        },
        onConfirm: async () => {
          try {
            await adminService.activateUserAccount({
              userId: user.id,
              email: user.email,
              role: user.role,
            });
            showToast(`Account for ${userName} has been activated`, "success");
            refresh();
          } catch (err) {
            console.error(err);
            showToast(err.message || "Failed to activate account", "error");
          }
        },
      });
    } else {
      confirmAdminAction({
        title: "Confirm Account Deactivation",
        actionDescription: `You are about to deactivate the account for "${userName}" (${user.role === 'vet' ? 'Veterinary Inspector' : 'Staff Personnel'}). Active sessions will be terminated and portal login access will be blocked until reactivated. Enter administrator password to authorize.`,
        confirmButtonText: "Deactivate Account",
        danger: true,
        actionContext: {
          action: `Deactivated account for ${userName}`,
          module: "Personnel Management",
          danger: true,
        },
        onConfirm: async () => {
          try {
            await adminService.deactivateUserAccount({
              userId: user.id,
              email: user.email,
              role: user.role,
            });
            showToast(`Account for ${userName} has been deactivated`, "success");
            refresh();
          } catch (err) {
            console.error(err);
            showToast(err.message || "Failed to deactivate account", "error");
          }
        },
      });
    }
  };

  const getUserStatus = (user) => {
    const userLogs = auditLogs.filter((l) =>
      l.user?.toLowerCase() === user.full_name?.toLowerCase() ||
      l.user?.toLowerCase() === user.username?.toLowerCase() ||
      l.user?.toLowerCase() === user.email?.toLowerCase()
    );
    if (!userLogs.length) return { online: false, lastActive: user.last_login || "Never" };

    const sorted = [...userLogs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const latest = sorted[0];

    const lastActiveTime = new Date(latest.timestamp).getTime();
    const minutesSinceActive = Math.round((Date.now() - lastActiveTime) / 60000);
    const isOnline = latest.action !== "User logged out" && minutesSinceActive <= 30;

    let relativeTime = "";
    if (minutesSinceActive < 1) relativeTime = "Active just now";
    else if (minutesSinceActive < 60) relativeTime = `${minutesSinceActive}m ago`;
    else if (minutesSinceActive < 1440) relativeTime = `${Math.floor(minutesSinceActive / 60)}h ago`;
    else relativeTime = new Date(latest.timestamp).toLocaleDateString();

    return { online: isOnline, lastActive: relativeTime, minutesSinceActive };
  };

  const totalPersonnel = data.length;
  const vetCount = data.filter((u) => {
    const r = (u.role || "").toLowerCase().trim();
    return r === "vet" || r === "veterinarian" || (r.includes("vet") && !r.includes("admin"));
  }).length;
  const staffCount = data.filter((u) => {
    const r = (u.role || "").toLowerCase().trim();
    return r === "staff" || r === "meat_inspector" || (r.includes("staff") && !r.includes("admin"));
  }).length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = data.filter((u, idx) => {
      if (!u) return false;
      const r = (u.role || "").toLowerCase().trim();
      if (r === "admin" || r.includes("admin") || r === "owner" || u.owner_id) return false;

      const displayId = formatPersonnelId(u, idx + 1);
      const fullName = u.full_name || u.name || "";
      const email = u.email || "";
      const username = u.username || "";
      const phone = u.phone || u.contact || "";

      const ms =
        !q ||
        displayId.toLowerCase().includes(q) ||
        fullName.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q) ||
        username.toLowerCase().includes(q) ||
        r.includes(q) ||
        phone.includes(q);

      if (!ms) return false;

      const statusStr = (u.status || "Active").toLowerCase();
      const isDeactivated = statusStr === "inactive" || statusStr === "deactivated" || statusStr.startsWith("terminated");

      if (filterRole === "vet") {
        return r === "vet" || r === "veterinarian" || (r.includes("vet") && !r.includes("admin"));
      }
      if (filterRole === "staff") {
        return r === "staff" || r === "meat_inspector" || (r.includes("staff") && !r.includes("admin"));
      }
      if (filterRole === "active") {
        return !isDeactivated;
      }
      if (filterRole === "inactive") {
        return isDeactivated;
      }
      return true;
    });

    result.sort((a, b) => {
      if (sortBy === "name_asc") {
        const nameA = a.full_name || a.name || a.username || "";
        const nameB = b.full_name || b.name || b.username || "";
        return nameA.localeCompare(nameB);
      }
      if (sortBy === "date_asc") {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB;
      }
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    return result;
  }, [data, search, filterRole, sortBy]);

  const save = async (payload) => {
    const isEdit = !!editing;
    const actionLabel = isEdit ? "Update Personnel Account" : "Create Personnel Account";
    const userName = payload.full_name || payload.name || payload.email || "Personnel";

    confirmAdminAction({
      title: actionLabel,
      actionDescription: `You are about to ${isEdit ? "update" : "register"} user account "${userName}". Please enter your password to authorize this action.`,
      confirmButtonText: isEdit ? "Confirm Update" : "Confirm Creation",
      danger: false,
      actionContext: {
        action: `${isEdit ? "Updated" : "Created"} personnel account for ${userName}`,
        module: "Personnel Management",
      },
      onConfirm: async () => {
        try {
          if (editing) {
            await adminService.updateUser(editing.id, { ...editing, ...payload });
            showToast("Personnel updated successfully", "success");
            setData((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...payload } : u)));
          } else {
            const created = await adminService.createUser(payload);
            if (created) {
              const r = (created.role || "").toLowerCase().trim();
              if (r !== "admin" && (r === "vet" || r === "staff" || r.includes("vet") || r.includes("staff"))) {
                setData((prev) => [created, ...prev]);
                const emailResult = await adminService.sendPersonnelWelcomeEmail({
                  fullName: created.full_name || payload.full_name,
                  email: created.email || payload.email,
                  role: created.role || payload.role,
                });
                if (emailResult?.emailSent) {
                  setFailedWelcomeEmail(null);
                  showToast(`Personnel account created and welcome email sent to ${created.email}.`, "success");
                } else {
                  setFailedWelcomeEmail({
                    fullName: created.full_name || payload.full_name,
                    email: created.email || payload.email,
                    role: created.role || payload.role,
                    error: emailResult?.error || "Email delivery failed.",
                  });
                  showToast(
                    `Personnel account created, but welcome email delivery failed for ${created.email}. Use "Resend Welcome Email" to retry.`,
                    "warning"
                  );
                }
              } else {
                showToast("Personnel created successfully", "success");
              }
            } else {
              showToast("Personnel created successfully", "success");
            }
          }
          setModalOpen(false);
          refresh();
        } catch (err) {
          console.error(err);
          showToast(err.message || "Failed to save personnel", "error");
        }
      },
    });
  };

  const handleResendWelcomeEmail = async () => {
    if (!failedWelcomeEmail || resendingWelcomeEmail) return;
    setResendingWelcomeEmail(true);
    try {
      const emailResult = await adminService.sendPersonnelWelcomeEmail({
        fullName: failedWelcomeEmail.fullName,
        email: failedWelcomeEmail.email,
        role: failedWelcomeEmail.role,
        isResend: true,
      });
      if (emailResult?.emailSent) {
        showToast(`Welcome email resent successfully to ${failedWelcomeEmail.email}.`, "success");
        setFailedWelcomeEmail(null);
      } else {
        const errMsg = emailResult?.error || "Email delivery failed.";
        setFailedWelcomeEmail((prev) => (prev ? { ...prev, error: errMsg } : null));
        showToast(`Failed to resend welcome email: ${errMsg}`, "warning");
      }
      refresh();
    } finally {
      setResendingWelcomeEmail(false);
    }
  };

  const del = async () => {
    if (!confirmDel) return;
    const userName = confirmDel.full_name || confirmDel.name || confirmDel.username || "Personnel";
    const targetId = confirmDel.id;

    confirmAdminAction({
      title: "Delete Personnel Account",
      actionDescription: `You are about to permanently delete user account "${userName}". This action cannot be undone. Enter password to confirm.`,
      confirmButtonText: "Confirm Permanent Delete",
      danger: true,
      actionContext: {
        action: `Deleted personnel account for ${userName}`,
        module: "Personnel Management",
        danger: true,
      },
      onConfirm: async () => {
        try {
          await adminService.deleteUser(targetId, confirmDel);
          showToast("Personnel deleted successfully from database", "success");
          setData((prev) => prev.filter((u) => u.id !== targetId));
          setConfirmDel(null);
          refresh();
        } catch (err) {
          console.error(err);
          showToast(err.message || "Failed to delete personnel", "error");
        }
      },
    });
  };

  const getRoleBadge = (r) => {
    switch (r) {
      case "admin":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--color-warning, #d97706)",
              background: "var(--color-warning-bg, rgba(245, 158, 11, 0.15))",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              padding: "2px 8px",
              borderRadius: "5px",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.ShieldCheck size={13} style={{ color: "var(--color-warning, #d97706)" }} />
            Administrator
          </span>
        );
      case "vet":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--color-info, #0284c7)",
              background: "var(--color-info-bg, rgba(14, 165, 233, 0.15))",
              border: "1px solid rgba(24, 122, 86, 0.3)",
              padding: "2px 8px",
              borderRadius: "5px",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.Stethoscope size={13} style={{ color: "var(--color-info, #0284c7)" }} />
            Veterinary Inspector
          </span>
        );
      default:
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--color-violet, #187A56)",
              background: "var(--color-violet-bg, rgba(24, 122, 86, 0.15))",
              border: "1px solid rgba(24, 122, 86, 0.3)",
              padding: "2px 8px",
              borderRadius: "5px",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.Cow size={13} style={{ color: "var(--color-violet, #187A56)" }} />
            Slaughterhouse Staff
          </span>
        );
    }
  };

  const getAvatarGradient = (r) => {
    switch (r) {
      case "admin":
        return "linear-gradient(135deg, #f59e0b, #d97706)";
      case "vet":
        return "#187A56";
      default:
        return "linear-gradient(135deg, #24966D, #136647)";
    }
  };

  return (
    <div className="users-page records-page-container" style={{ width: "100%", padding: 0 }}>
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 12,
          overflow: "hidden",
          border: "none",
          boxShadow: "none",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "nowrap",
            overflowX: "auto",
            scrollbarWidth: "none",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            minHeight: 54,
          }}
        >
          <div className="adm-seg-tabs">
            {[
              { id: "all", label: "All Personnel", count: totalPersonnel, icon: <Icon.Users size={14} /> },
              { id: "vet", label: "Veterinary", count: vetCount, icon: <Icon.Stethoscope size={14} /> },
              { id: "staff", label: "Staff", count: staffCount, icon: <Icon.Activity size={14} /> },
            ].map((tab) => {
              const active = filterRole === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`adm-seg-btn ${active ? "active" : ""}`}
                  onClick={() => { setFilterRole(tab.id); setPage(1); }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span className="adm-seg-badge">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ position: "relative", width: 240 }}>
              <Icon.Search
                size={13}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                placeholder="Search ID, name, email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{
                  width: "100%",
                  height: 36,
                  paddingLeft: 32,
                  paddingRight: search ? 26 : 12,
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: 12.5,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setPage(1); }}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: 2,
                  }}
                >
                  ?
                </button>
              )}
            </div>

            <button
              type="button"
              className="adm-toolbar-primary-btn"
              onClick={() => { setEditing(null); setModalOpen(true); }}
            >
              <Icon.Plus size={14} />
              <span>Add Personnel</span>
            </button>
          </div>
        </div>

        {failedWelcomeEmail && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: "12px 18px",
              background: "rgba(245, 158, 11, 0.12)",
              borderBottom: "1px solid rgba(217, 119, 6, 0.35)",
              color: "var(--color-text, #192420)",
              fontSize: "0.84rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <Icon.AlertTriangle size={18} style={{ color: "#d97706", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, color: "#92400e" }}>
                  Welcome email delivery failed for {failedWelcomeEmail.fullName} ({failedWelcomeEmail.email})
                </div>
                <div style={{ fontSize: "0.78rem", color: "#78350f", marginTop: 2 }}>
                  Account was created successfully without duplicates. {failedWelcomeEmail.error}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={resendingWelcomeEmail}
                onClick={handleResendWelcomeEmail}
              >
                {resendingWelcomeEmail ? (
                  <>
                    <Icon.RefreshCw size={14} className="spin-animation" />
                    <span>Resending...</span>
                  </>
                ) : (
                  <>
                    <Icon.Mail size={14} />
                    <span>Resend Welcome Email</span>
                  </>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resendingWelcomeEmail}
                onClick={() => setFailedWelcomeEmail(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <div className="records-scrollable-content table-wrap" style={{ width: "100%", overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
          <table
            className="table"
            style={{
              width: "100%",
              minWidth: "860px",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              margin: 0,
            }}
          >
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  PERSONNEL DETAILS
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  ROLE &amp; CONTACT
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  DATE REGISTERED
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  STATUS &amp; PRESENCE
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center", whiteSpace: "nowrap" }}>
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, idx) => {
                const tracking = getUserStatus(u);
                const statusStr = (u.status || "Active").toLowerCase();
                const isDeactivated = statusStr === "inactive" || statusStr === "deactivated" || statusStr.startsWith("terminated");
                const isUserActive = !isDeactivated;
                const displayId = formatPersonnelId(u, idx + 1);

                return (
                  <tr
                    key={u.id || idx}
                    onClick={() => { setEditing(u); setModalOpen(true); }}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid var(--color-border)",
                      transition: "background-color 0.15s ease",
                      background: isDeactivated ? "var(--color-danger-bg, rgba(239, 68, 68, 0.08))" : "transparent",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = isDeactivated ? "var(--color-danger-bg, rgba(239, 68, 68, 0.15))" : "var(--lsmis-primary-subtle)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isDeactivated ? "var(--color-danger-bg, rgba(239, 68, 68, 0.08))" : "transparent")
                    }
                    className="personnel-table-row"
                    title="Click to view or edit personnel profile"
                  >
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        {u.avatar_url ? (
                          <img
                            src={u.avatar_url}
                            alt={u.full_name || u.name || u.username || "Personnel"}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              if (e.currentTarget.nextSibling) {
                                e.currentTarget.nextSibling.style.display = "flex";
                              }
                            }}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "8px",
                              objectFit: "cover",
                              flexShrink: 0,
                              border: "1px solid var(--color-border)",
                            }}
                          />
                        ) : null}
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "8px",
                            background: u.role === "vet"
                              ? "#187A56"
                              : "#187A56",
                            color: "#ffffff",
                            fontWeight: 800,
                            fontSize: "0.82rem",
                            display: u.avatar_url ? "none" : "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {initials(u.full_name || u.name || u.username) || "PE"}
                        </div>
                        <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                          <div
                            style={{
                              fontSize: "0.86rem",
                              fontWeight: 700,
                              color: "var(--color-text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                            title={u.full_name || u.name || u.username}
                          >
                            <span>{u.full_name || u.name || u.username}</span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.74rem",
                              color: "var(--color-text-muted)",
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={`${u.username ? `@${u.username} • ` : ""}${u.email || ""}`}
                          >
                            {u.username && <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>@{u.username} • </span>}
                            <span>{u.email || "No email"}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: "12px 14px", verticalAlign: "middle", overflow: "hidden" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div>{getRoleBadge(u.role)}</div>
                        {(u.contact || u.phone) && (
                          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#187A56", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                            <Icon.Phone size={12} style={{ flexShrink: 0 }} />
                            <span>{u.contact || u.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon.Calendar size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                        <span>{formatDate(u.created_at) || "Oct 31, 2026"}</span>
                      </div>
                    </td>

                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {isUserActive ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "var(--color-success, #10b981)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon.Check size={13} style={{ strokeWidth: 3 }} />
                            Active
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "#dc2626",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#dc2626" }} />
                            Inactive
                          </span>
                        )}

                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.72rem" }}>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              backgroundColor: tracking.online ? "#10b981" : "#9ca3af",
                              boxShadow: tracking.online ? "0 0 6px #10b981" : "none",
                              animation: tracking.online ? "pulse 2s infinite" : "none",
                            }}
                          />
                          <span style={{ color: tracking.online ? "#10b981" : "#5D6660", fontWeight: 600 }}>
                            {tracking.online ? "Online Now" : tracking.lastActive || "Offline"}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="table-action-td">
                      <div onClick={(e) => e.stopPropagation()} className="table-action-group">
                        <button
                          type="button"
                          className="action-btn action-btn-outline"
                          onClick={() => { setEditing(u); setModalOpen(true); }}
                          title="Edit personnel profile"
                        >
                          <Icon.Edit size={13} />
                          <span>Edit</span>
                        </button>
                        {(u.role === "vet" || u.role === "staff") && (
                          isDeactivated ? (
                            <button
                              type="button"
                              className="action-btn action-btn-soft-success"
                              onClick={() => handleToggleDeactivate(u)}
                              title="Activate personnel account"
                            >
                              <Icon.CheckCircle size={14} />
                              <span>Activate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="action-btn action-btn-soft-danger"
                              onClick={() => handleToggleDeactivate(u)}
                              title="Deactivate personnel account"
                            >
                              <Icon.XCircle size={14} style={{ color: "#dc2626" }} />
                              <span>Deactivate</span>
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <EmptyState
            title="No personnel found"
            message={search || filterRole !== "all" ? "No personnel records match your current search or role filter criteria. Click 'Reset' to view all records." : "No internal abattoir personnel records registered."}
            icon={<Icon.Users size={36} />}
          />
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "10px",
                background: "rgba(24, 122, 86, 0.12)",
                color: "#187A56",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {editing ? <Icon.UserCheck size={20} /> : <Icon.UserPlus size={20} />}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--color-text, #192420)", lineHeight: 1.25 }}>
                {editing ? "Edit Personnel Profile" : "Register New Personnel"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted, #687D73)", fontWeight: 400, marginTop: "2px" }}>
                {editing ? "Update personnel credentials, contact details, or role assignment" : "Create internal abattoir staff or veterinary inspector portal access"}
              </div>
            </div>
          </div>
        }
        size="lg"
        dialogStyle={{ maxWidth: "780px", borderRadius: "16px" }}
        bodyStyle={{ padding: "18px 24px" }}
      >
        <UserForm initial={editing} onSubmit={save} onCancel={() => setModalOpen(false)} />
      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        onConfirm={del}
        onCancel={() => setConfirmDel(null)}
        title="Delete Personnel Account"
        message={`Are you sure you want to delete the account for ${confirmDel?.full_name || confirmDel?.name || confirmDel?.username}? This action will permanently revoke their portal access.`}
      />

      <ConfirmAdminPasswordModal {...confirmModalProps} />

      <style>{`
        .personnel-table-row:hover {
          background-color: var(--ag-row-hover, var(--color-bg)) !important;
        }
        .spin-animation {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `}</style>
    </div>
  );
};
