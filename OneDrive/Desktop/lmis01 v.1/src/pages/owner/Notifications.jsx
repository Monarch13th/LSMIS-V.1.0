import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate } from "../../utils/formatters";

export const OwnerNotifications = () => {
  const { ownerId } = useAuth();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email;
      let targetOwnerId = null;

      if (email) {
        const { data: oData } = await supabase
          .from(TABLES.OWNERS)
          .select("id")
          .ilike("email", email.trim())
          .maybeSingle();
        if (oData?.id) {
          targetOwnerId = oData.id;
        } else {
          const { data: uData } = await supabase
            .from(TABLES.USERS)
            .select("owner_id")
            .ilike("email", email.trim())
            .maybeSingle();
          if (uData?.owner_id) targetOwnerId = uData.owner_id;
        }
      }

      if (!targetOwnerId) {
        targetOwnerId = ownerId || null;
      }

      let notifList = [];
      if (targetOwnerId) {
        try {
          const { data, error } = await supabase
            .from(TABLES.NOTIFICATIONS)
            .select("*")
            .eq("owner_id", targetOwnerId)
            .order("date", { ascending: false });

          if (!error && data) {
            notifList = data;
          }
        } catch (e) {}
      }

      setNotifs(notifList);
    } catch (err) {
      console.warn("Error fetching owner notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifs();
    const onRefresh = () => fetchNotifs();
    window.addEventListener("lmis-notif-read", onRefresh);
    window.addEventListener("lmis-db-change", onRefresh);
    window.addEventListener("storage", onRefresh);
    return () => {
      window.removeEventListener("lmis-notif-read", onRefresh);
      window.removeEventListener("lmis-db-change", onRefresh);
      window.removeEventListener("storage", onRefresh);
    };
  }, [ownerId]);

  const markAllAsRead = async () => {
    try {
      await supabase
        .from(TABLES.NOTIFICATIONS)
        .update({ read: true })
        .eq("owner_id", ownerId);

      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
      window.dispatchEvent(new Event("lmis-notif-read"));
    } catch (err) {
      console.warn("Failed marking notifications read:", err);
    }
  };

  const markOneRead = async (id) => {
    try {
      await supabase
        .from(TABLES.NOTIFICATIONS)
        .update({ read: true })
        .eq("id", id);

      setNotifs((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      window.dispatchEvent(new Event("lmis-notif-read"));
    } catch (err) {}
  };

  const getNotifCategory = (n) => {
    const text = ((n.title || "") + " " + (n.message || "")).toLowerCase();
    if (text.includes("pay") || text.includes("fee") || text.includes("receipt") || text.includes("permit") || text.includes("release")) {
      return "payment";
    }
    if (text.includes("ante") || text.includes("post") || text.includes("inspect") || text.includes("condemn") || text.includes("vet") || text.includes("health")) {
      return "inspection";
    }
    return "general";
  };

  const getNotifIconInfo = (n) => {
    const cat = getNotifCategory(n);
    if (cat === "payment") {
      return {
        icon: <Icon.Receipt size={18} />,
        bg: "rgba(16, 185, 129, 0.12)",
        color: "#10b981",
        label: "Billing & Release",
        route: null,
        routeLabel: null,
      };
    }
    if (cat === "inspection") {
      return {
        icon: <Icon.Stethoscope size={18} />,
        bg: "rgba(245, 158, 11, 0.12)",
        color: "#f59e0b",
        label: "Veterinary Inspection",
        route: "/owner/animals",
        routeLabel: "View in Today's Livestock →",
      };
    }
    return {
      icon: <Icon.Bell size={18} />,
      bg: "rgba(14, 165, 233, 0.12)",
      color: "#0ea5e9",
      label: "Abattoir Notice",
      route: null,
      routeLabel: null,
    };
  };

  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. COMPACT TOP CONTROLS (Title + Badge + Mark Read + Refresh) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 2px 4px 2px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 17 }}>🔔</span>
          <h1 style={{ fontSize: 15, fontWeight: 900, margin: 0, color: "var(--color-text, #0f172a)", letterSpacing: "-0.01em" }}>
            Notifications
          </h1>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 999,
              background: unreadCount > 0 ? "rgba(239, 68, 68, 0.12)" : "rgba(2, 132, 199, 0.12)",
              color: unreadCount > 0 ? "#ef4444" : "#0284c7",
            }}
          >
            {unreadCount > 0 ? `${unreadCount} New` : `${notifs.length} Total`}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAllAsRead}
              style={{
                background: "rgba(14, 165, 233, 0.1)",
                border: "1px solid rgba(14, 165, 233, 0.25)",
                borderRadius: 8,
                padding: "4px 8px",
                color: "#0284c7",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 700,
                height: 28,
              }}
              title="Mark all notifications as read"
            >
              <Icon.CheckCheck size={13} />
              <span>Mark read</span>
            </button>
          ) : (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#10b981",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(16, 185, 129, 0.08)",
                padding: "3px 8px",
                borderRadius: 8,
                border: "1px solid rgba(16, 185, 129, 0.2)",
                height: 28,
                boxSizing: "border-box",
              }}
            >
              <Icon.CheckCircle size={12} />
              <span>Caught up</span>
            </span>
          )}

          <button
            type="button"
            onClick={fetchNotifs}
            title="Refresh notifications"
            style={{
              background: "var(--color-bg, #f8fafc)",
              border: "1px solid var(--color-border, #e2e8f0)",
              borderRadius: 8,
              padding: "4px 8px",
              color: "var(--color-text-muted, #64748b)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              height: 28,
            }}
          >
            <Icon.RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 2. NOTIFICATIONS LIST */}
      {loading ? (
        <div className="owner-section-card" style={{ textAlign: "center", padding: 32, color: "#94a3b8", fontSize: 12 }}>
          Loading alerts...
        </div>
      ) : notifs.length === 0 ? (
        <div className="owner-section-card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
          <h3 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 4px 0", color: "var(--color-text, #0f172a)" }}>
            No notifications
          </h3>
          <p style={{ fontSize: 11.5, color: "#94a3b8", margin: 0, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
            You're all caught up! New inspection and payment notices will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="owner-notif-list">
          {notifs.map((n) => {
            const info = getNotifIconInfo(n);
            return (
              <div
                key={n.id}
                onClick={() => markOneRead(n.id)}
                className={`owner-notif-card ${!n.read ? "unread" : ""}`}
                title={!n.read ? "Tap to mark as read" : undefined}
              >
                <div className="owner-notif-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div className="owner-notif-icon-box" style={{ backgroundColor: info.bg, color: info.color }}>
                      {info.icon}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="owner-notif-title-row">
                        <span className="owner-notif-title">{n.title || "Notification"}</span>
                        {!n.read && <span className="owner-notif-new-badge">NEW</span>}
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: info.color, display: "block", marginTop: 2 }}>
                        {info.label}
                      </span>
                    </div>
                  </div>
                  <span className="owner-notif-time">{formatDate(n.date)}</span>
                </div>

                <p className="owner-notif-body">{n.message}</p>

                {info.route && (
                  <div className="owner-notif-footer">
                    <span style={{ color: "#94a3b8" }}>Official Record Attached</span>
                    <Link
                      to={info.route}
                      onClick={(e) => {
                        e.stopPropagation();
                        markOneRead(n.id);
                      }}
                      className="owner-notif-link"
                    >
                      <span>{info.routeLabel}</span>
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
