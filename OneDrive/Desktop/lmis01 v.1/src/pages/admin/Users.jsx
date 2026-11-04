import { useState, useEffect, useMemo } from "react";
import { Card, StatCard, Button, Input, Select, Modal, ConfirmDialog, PageHeader, EmptyState, Pagination } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { TABLES, ROLE_LABELS } from "../../utils/constants";
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
  const { confirmModalProps, confirmAdminAction } = useAdminConfirmPassword();

  const refresh = async () => {
    if (data.length === 0) setLoading(true);
    try {
      const [users, logs] = await Promise.all([
        adminService.listUsers(),
        adminService.listAuditLogs(100)
      ]);
      // Strict classification: operational personnel ONLY (Veterinarian and Staff; never Admin or Owner accounts)
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

    // Live Supabase subscription for real-time synchronization across devices & tabs
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

  // Counts (Veterinarian and Staff only)
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
      // default: date_desc
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
            showToast("Personnel created successfully", "success");
            if (created) {
              const r = (created.role || "").toLowerCase().trim();
              if (r !== "admin" && (r === "vet" || r === "staff" || r.includes("vet") || r.includes("staff"))) {
                setData((prev) => [created, ...prev]);
              }
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
              border: "1px solid rgba(14, 165, 233, 0.3)",
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
              color: "var(--color-violet, #7c3aed)",
              background: "var(--color-violet-bg, rgba(139, 92, 246, 0.15))",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              padding: "2px 8px",
              borderRadius: "5px",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.Cow size={13} style={{ color: "var(--color-violet, #7c3aed)" }} />
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
        return "linear-gradient(135deg, #0284c7, #0369a1)";
      default:
        return "linear-gradient(135deg, #8b5cf6, #6d28d9)";
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
        {/* Single-line Header Toolbar matching Reference Standard */}
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
          {/* Left: Status / Role Segmented Nav Tabs */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
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
                  onClick={() => { setFilterRole(tab.id); setPage(1); }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: active ? 700 : 600,
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    background: active ? "var(--color-primary, #059669)" : "var(--color-surface-hover, rgba(0,0,0,0.04))",
                    color: active ? "#fff" : "var(--color-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 10,
                      background: active ? "rgba(255,255,255,0.25)" : "var(--color-bg)",
                      color: active ? "#fff" : "var(--color-text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Toolbar Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* Search Input */}
            <div style={{ position: "relative", width: 230 }}>
              <Icon.Search
                size={13}
                style={{
                  position: "absolute",
                  left: 10,
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
                  height: 34,
                  paddingLeft: 30,
                  paddingRight: search ? 24 : 10,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: 12,
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
                  ✕
                </button>
              )}
            </div>

            {/* Add Personnel Button */}
            <button
              type="button"
              onClick={() => { setEditing(null); setModalOpen(true); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                borderRadius: 6,
                background: "var(--color-primary)",
                color: "#fff",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <Icon.Plus size={14} />
              <span>Add Personnel</span>
            </button>
          </div>
        </div>

        {/* Responsive Table Container */}
        <div className="records-scrollable-content table-wrap" style={{ width: "100%", overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
          <table
            className="table"
            style={{
              width: "100%",
              minWidth: "1060px",
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
                      (e.currentTarget.style.background = isDeactivated ? "var(--color-danger-bg, rgba(239, 68, 68, 0.15))" : "var(--color-bg)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isDeactivated ? "var(--color-danger-bg, rgba(239, 68, 68, 0.08))" : "transparent")
                    }
                    className="personnel-table-row"
                    title="Click to view or edit personnel profile"
                  >
                    {/* Column 1: Personnel Details */}
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
                              ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                              : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
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
                            title={`${u.username ? `@${u.username} · ` : ""}${u.email || ""}`}
                          >
                            {u.username && <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>@{u.username} · </span>}
                            <span>{u.email || "No email"}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Role & Contact */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", overflow: "hidden" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div>{getRoleBadge(u.role)}</div>
                        {(u.contact || u.phone) && (
                          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0284c7", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                            <Icon.Phone size={12} style={{ flexShrink: 0 }} />
                            <span>{u.contact || u.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Column 3: Date Registered */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon.Calendar size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                        <span>{formatDate(u.created_at) || "Oct 31, 2026"}</span>
                      </div>
                    </td>

                    {/* Column 4: Status & Presence */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {/* Status Checkmark */}
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

                        {/* Live Presence */}
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
                          <span style={{ color: tracking.online ? "#10b981" : "#64748b", fontWeight: 600 }}>
                            {tracking.online ? "Online Now" : tracking.lastActive || "Offline"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Column 5: Actions */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "center", whiteSpace: "nowrap" }}>
                      <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: "6px", justifyContent: "center", alignItems: "center", flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
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
                              className="btn btn-success btn-sm"
                              onClick={() => handleToggleDeactivate(u)}
                              title="Activate personnel account"
                            >
                              <Icon.CheckCircle size={13} />
                              <span>Activate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleToggleDeactivate(u)}
                              title="Deactivate personnel account"
                            >
                              <Icon.XCircle size={13} />
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

      {/* Add / Edit Personnel Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Personnel Profile" : "Register New Personnel"}
        size="lg"
        dialogStyle={{ maxWidth: "780px" }}
        bodyStyle={{ padding: "16px 22px" }}
      >
        <UserForm initial={editing} onSubmit={save} onCancel={() => setModalOpen(false)} />
      </Modal>

      {/* Confirm Delete Dialog */}
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
          background-color: #f8fafc !important;
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
