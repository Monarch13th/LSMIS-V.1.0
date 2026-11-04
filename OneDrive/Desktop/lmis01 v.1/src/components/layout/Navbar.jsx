import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { NotificationBell } from "../notifications/NotificationBell";
import { initials, greeting } from "../../utils/helpers";
import { formatDate } from "../../utils/formatters";
import { ROLE_LABELS, ROLE_COLORS, TABLES } from "../../utils/constants";
import { supabase } from "../../services/supabaseClient";

// Friendly page titles for the breadcrumb / header
const PAGE_TITLES = {
  dashboard: "Dashboard",
  users: "User Management",
  reports: "Reports",
  notifications: "Notifications",
  "audit-logs": "Audit Logs",
  settings: "Settings",
  backups: "Backup Management",
  profile: "My Profile",
  "ante-mortem": "Ante-Mortem Inspection",
  "post-mortem": "Post-Mortem Inspection",
  approval: "Inspection Approval",
  history: "Inspection History",
  owners: "Livestock Owners",
  "livestock-registration": "Livestock Registration",
  "animal-marking": "Animal Marking",
  "slaughter-processing": "Slaughter Processing",
  "slaughter-records": "Slaughter Records",
  evisceration: "Evisceration Recording",
  "carcass-weighing": "Carcass Weighing",
  fees: "Fee Computation",
  payments: "Payments",
  "payment-processing": "Payment Processing",
  "payment-records": "Payment Records",
  permits: "Meat Permit",
  "permit-dispatch": "Meat Permit",
  "weight-slip": "Meat Inspection & Weighing Permit",
  "permit-config": "Meat Permit Configuration",
};

export const Navbar = ({ onMenuClick, theme, onToggleTheme }) => {
  const { session } = useAuth();
  const location = useLocation();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [profileAvatar, setProfileAvatar] = useState(session?.avatar_url || null);
  const [profileName, setProfileName] = useState(session?.name || "");

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync avatar and name from session
  useEffect(() => {
    if (session?.avatar_url) setProfileAvatar(session.avatar_url);
    if (session?.name) setProfileName(session.name);
  }, [session?.avatar_url, session?.name]);

  // Reactive listener for profile updates & direct database fetch
  useEffect(() => {
    const handleProfileUpdate = (e) => {
      const updated = e?.detail;
      if (updated?.avatar_url) setProfileAvatar(updated.avatar_url);
      if (updated?.name) setProfileName(updated.name);
    };

    const fetchLatestAvatar = async () => {
      const email = session?.email;
      if (!email) return;
      try {
        const { data: userRow } = await supabase
          .from(TABLES.USERS)
          .select("avatar_url, full_name")
          .ilike("email", email)
          .maybeSingle();
        if (userRow?.avatar_url) setProfileAvatar(userRow.avatar_url);
        if (userRow?.full_name) setProfileName(userRow.full_name);

        if (!userRow) {
          const { data: ownerRow } = await supabase
            .from(TABLES.OWNERS)
            .select("avatar_url, name")
            .ilike("email", email)
            .maybeSingle();
          if (ownerRow?.avatar_url) setProfileAvatar(ownerRow.avatar_url);
          if (ownerRow?.name) setProfileName(ownerRow.name);
        }
      } catch (_) {}
    };

    fetchLatestAvatar();

    window.addEventListener("lmis_profile_updated", handleProfileUpdate);
    window.addEventListener("storage", fetchLatestAvatar);
    return () => {
      window.removeEventListener("lmis_profile_updated", handleProfileUpdate);
      window.removeEventListener("storage", fetchLatestAvatar);
    };
  }, [session?.email]);

  const pageKey = location.pathname.split("/").filter(Boolean).pop() || "dashboard";
  const colors = session ? ROLE_COLORS[session.role] : ROLE_COLORS.admin;
  const roleLabel = session ? ROLE_LABELS[session.role] : "";
  const displayName = profileName || session?.name || "User";
  const firstName = displayName.split(" ")[0] || "User";

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button className="icon-btn-header sidebar-trigger" onClick={onMenuClick} aria-label="Open menu">
          <Icon.Menu />
        </button>
        <div>
          <h2 style={{ textTransform: "none" }}>{greeting()}, {firstName}</h2>
          <p>{formatDate(currentTime)} · {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </div>
      </div>
      <div className="app-header-right">
        <button className="icon-btn-header" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
        </button>
        <NotificationBell />
        <div className="user-menu-wrap">
          <div className="user-pill" style={{ border: "none", background: "transparent", cursor: "default", boxShadow: "none" }}>
            <div
              className="avatar"
              style={{
                position: "relative",
                overflow: "hidden",
                background: session?.cover_gradient
                  ? `linear-gradient(135deg, ${session.cover_gradient.from}, ${session.cover_gradient.to})`
                  : `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
              }}
            >
              {profileAvatar ? (
                <img
                  src={profileAvatar}
                  alt={displayName}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                  onError={() => setProfileAvatar(null)}
                />
              ) : (
                initials(displayName)
              )}
            </div>
            <div className="user-meta">
              <span className="user-name">{firstName}</span>
              <span className="user-role">{roleLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
