import React from "react";
import { useAuth } from "../../hooks/useAuth";
import { greeting } from "../../utils/helpers";
import { Icon } from "../icons";

/**
 * UnifiedDashboardShell
 * Provides the consistent top greeting header, role badge, quick action button,
 * and 2-column one-screen layout wrapper inspired by the FinScope reference dashboard.
 */
export const UnifiedDashboardShell = ({
  roleLabel = "Personnel",
  roleTone = "emerald",
  actionLabel = "Quick Action",
  actionIcon = null,
  onAction = null,
  children,
}) => {
  const { session } = useAuth();
  const rawName = session?.name || "Personnel";
  const firstName = rawName.split(" ")[0] || "User";

  return (
    <div className="lsmis-unified-dashboard">
      {/* Top Header & Greeting Bar (Matches FinScope 'Good Morning, Rachel!' + 'Customize' button) */}
      <header className="finscope-dash-header">
        <div className="finscope-dash-title-group">
          <div className="finscope-greeting-row">
            <h1 className="finscope-greeting-text">
              {greeting()}, {firstName}!
            </h1>
            <span className={`finscope-role-badge ${roleTone}`}>
              {roleLabel}
            </span>
          </div>
          <p className="finscope-sub-greeting">
            <span className="finscope-status-dot" />
            <span className="font-semibold text-slate-700">Tinaan Abattoir</span>
            <span className="text-slate-400">·</span>
            <span>City of Naga, Cebu, Philippines</span>
          </p>
        </div>

        <div className="finscope-dash-actions">
          {actionLabel && (
            <button
              type="button"
              className="finscope-action-btn"
              onClick={onAction}
            >
              {actionIcon || <Icon.Plus size={15} />}
              <span>{actionLabel}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main 2-Column Content Grid (Fits within one screen on desktop) */}
      <div className="finscope-dash-grid">
        {children}
      </div>
    </div>
  );
};

