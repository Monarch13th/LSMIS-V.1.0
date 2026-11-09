import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";

export const OwnerBottomNav = () => {
  const location = useLocation();
  const { ownerId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread notifications for this owner
  const fetchUnread = async () => {
    try {
      let targetId = ownerId;
      if (!targetId) {
        const { data: authUser } = await supabase.auth.getUser();
        const email = authUser?.user?.email;
        if (email) {
          const { data: oData } = await supabase
            .from(TABLES.OWNERS)
            .select("id")
            .ilike("email", email.trim())
            .maybeSingle();
          if (oData?.id) targetId = oData.id;
        }
      }
      if (!targetId) return;

      const { count, error } = await supabase
        .from(TABLES.NOTIFICATIONS)
        .select("id", { count: "exact", head: true })
        .eq("owner_id", targetId)
        .eq("read", false);

      if (!error && typeof count === "number") {
        setUnreadCount(count);
      }
    } catch (err) {
      console.warn("Bottom nav unread fetch error:", err);
    }
  };

  useEffect(() => {
    fetchUnread();
    const onRefresh = () => fetchUnread();
    window.addEventListener("storage", onRefresh);
    window.addEventListener("lmis-db-change", onRefresh);
    window.addEventListener("lmis-notif-read", onRefresh);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("lmis-db-change", onRefresh);
      window.removeEventListener("lmis-notif-read", onRefresh);
    };
  }, [ownerId]);

  // Exactly 5 Essential Navigation Sections for Livestock Owners in exact specified order:
  // 1. Home, 2. Today Livestock, 3. Records, 4. Notification, 5. Profile
  const navItems = [
    {
      to: "/owner",
      label: "Home",
      icon: <Icon.Home size={20} />,
      exact: true,
    },
    {
      to: "/owner/animals",
      label: "Today Livestock",
      icon: <Icon.Tag size={20} />,
      exact: false,
    },
    {
      to: "/owner/records",
      label: "Records",
      icon: <Icon.ClipboardList size={20} />,
      exact: false,
      altPaths: ["/owner/payments", "/owner/permits"],
    },
    {
      to: "/owner/notifications",
      label: "Notification",
      icon: <Icon.Bell size={20} />,
      exact: false,
      badge: unreadCount,
    },
    {
      to: "/owner/profile",
      label: "Profile",
      icon: <Icon.User size={20} />,
      exact: false,
      altPaths: ["/owner/settings"],
    },
  ];

  return (
    <nav className="owner-bottom-bar" aria-label="Mobile Navigation">
      <div className="owner-bottom-grid">
        {navItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to) ||
              (item.altPaths && item.altPaths.some((p) => location.pathname.startsWith(p)));

          return (
            <Link
              key={item.to}
              to={item.to}
              className={`owner-nav-item ${isActive ? "active" : ""}`}
              aria-label={item.label}
            >
              <div className="owner-nav-icon-wrap">
                {item.icon}
                {item.badge > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -8,
                      minWidth: 16,
                      height: 16,
                      padding: "0 4px",
                      borderRadius: 8,
                      backgroundColor: "#ef4444",
                      color: "#ffffff",
                      fontSize: 9.5,
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1.5px solid var(--color-surface, #ffffff)",
                    }}
                  >
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </div>
              <span className="owner-nav-text">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
