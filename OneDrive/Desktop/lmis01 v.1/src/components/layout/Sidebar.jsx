import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { ROLE_LABELS } from "../../utils/constants";
import logoImg from "../../assets/logo.jpg";

const NavItem = ({ it, onClose }) => {
  const location = useLocation();
  const isAdminActive =
    (it.path === "/admin/slaughter/records" && location.pathname.startsWith("/admin/slaughter")) ||
    (it.path === "/admin/inspection/records" && location.pathname.startsWith("/admin/inspection")) ||
    (it.path === "/admin/finance/records" && location.pathname.startsWith("/admin/finance"));
  const isReportsActive =
    (it.path === "/admin/reports" && location.pathname.startsWith("/admin/reports")) ||
    (it.path === "/vet/reports" && location.pathname.startsWith("/vet/reports")) ||
    (it.path === "/staff/reports" && location.pathname.startsWith("/staff/reports"));
  const isSettingsActive =
    it.path.endsWith("/settings") &&
    location.pathname.startsWith(it.path.slice(0, it.path.lastIndexOf("/"))) &&
    (location.pathname.includes("/settings") ||
      location.pathname.includes("/profile") ||
      location.pathname.includes("/notifications") ||
      location.pathname.includes("/security") ||
      location.pathname.includes("/permit-config"));

  return (
    <NavLink
      to={it.path}
      end={it.end !== false}
      onClick={onClose}
      className={({ isActive }) => `nav-item ${isActive || isAdminActive || isReportsActive || isSettingsActive ? "active" : ""}`}
    >
      <span className="nav-item-icon">{it.icon}</span>
      <span className="nav-item-label">{it.label}</span>
      {it.badge ? (
        <span className={`nav-badge ${typeof it.badge === "string" && isNaN(Number(it.badge)) ? "nav-badge-pill" : "nav-badge-count"}`}>
          {it.badge}
        </span>
      ) : null}
    </NavLink>
  );
};

const NavGroup = ({ group, onClose }) => {
  const location = useLocation();
  const currentPath = location.pathname + location.search;
  
  // A group item counts as active only if its exact path matches, or path without query matches, or is nested.
  const hasActive = group.items.some((i) => currentPath === i.path || (location.pathname === i.path && !location.search && !i.path.includes("?")) || location.pathname.startsWith(i.path + "/"));
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="nav-group">
      <button className={`nav-group-head ${hasActive ? "has-active" : ""}`} title={group.label} onClick={() => setOpen(!open)}>
        <span className="nav-group-icon">{group.icon}</span>
        <span className="nav-group-label">{group.label}</span>
        <span className={`nav-group-chevron ${open ? "open" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </span>
      </button>
      {open && (
        <div className="nav-group-items">
          {group.items.map((it) => {
            const isActive = currentPath === it.path;
            return (
              <NavLink
                key={it.path}
                to={it.path}
                onClick={onClose}
                className={({ isActive }) => `nav-sub-item ${currentPath === it.path ? "active" : ""}`}
              >
                <span className="nav-sub-dot" />
                <span>{it.label}</span>
                {it.badge ? (
                  <span className={`nav-badge ${typeof it.badge === "string" && isNaN(Number(it.badge)) ? "nav-badge-pill" : "nav-badge-count"}`}>
                    {it.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Sidebar = ({ items, open, onClose }) => {
  const { signOut, session } = useAuth();
  const { role } = useRole();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const brandStyle = session?.cover_gradient ? {
    background: `linear-gradient(135deg, ${session.cover_gradient.from} 0%, ${session.cover_gradient.to} 100%)`
  } : undefined;

  return (
    <>
      {open && <div className="app-overlay" onClick={onClose} />}
      <aside className={`app-sidebar ${open ? "open" : ""}`}>
        <div className="app-sidebar-brand" style={brandStyle}>
          <div className="logo">
            <img src={logoImg} alt="LSMIS Logo" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>LSMIS</h1>
            <p>{role ? ROLE_LABELS[role] || "Meat Inspection System" : "Meat Inspection System"}</p>
          </div>
          {open && (
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={onClose}
              aria-label="Close navigation sidebar"
              title="Close menu"
            >
              <Icon.X size={18} />
            </button>
          )}
        </div>
        <nav className="app-sidebar-nav">
          {items.map((entry, i) => {
            if (entry.header || entry.section) {
              return (
                <div key={`section-${i}`} className="nav-section-title">
                  {entry.header || entry.section}
                </div>
              );
            }
            if (entry.group) {
              return <NavGroup key={i} group={entry} onClose={onClose} />;
            }
            return <NavItem key={entry.path || i} it={entry} onClose={onClose} />;
          })}
        </nav>
        <div className="app-sidebar-foot" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="nav-foot-btn" onClick={signOut}>
            <Icon.LogOut />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};
