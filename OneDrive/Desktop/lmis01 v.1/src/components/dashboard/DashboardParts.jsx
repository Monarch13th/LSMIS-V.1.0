// Small presentational building blocks shared by the three dashboards.
import "../../styles/dashboard.css";

export const DashBanner = ({ tone = "amber", icon, title, text, action, onClick }) => (
  <div
    className={`dash-banner ${tone}`}
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
  >
    <div className="dash-banner-left">
      <div className="dash-banner-icon">{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="dash-banner-title">{title}</div>
        {text && <div className="dash-banner-text">{text}</div>}
      </div>
    </div>
    {action}
  </div>
);

/** A workflow stage tile. `max` scales the progress bar relative to the busiest stage. */
export const StageTile = ({ label, value, max = 0, tone = "emerald", onClick }) => (
  <button type="button" className={`dash-stage ${tone}`} onClick={onClick} aria-label={`${label}: ${value}`}>
    <span className="dash-stage-value">{value}</span>
    <span className="dash-stage-label">{label}</span>
    <span className="dash-stage-bar"><span style={{ width: `${max > 0 ? Math.max(value > 0 ? 6 : 0, Math.round((value / max) * 100)) : 0}%` }} /></span>
  </button>
);

export const ListRow = ({ gradient, icon, title, sub, end, onClick }) => (
  <div
    className={`dash-list-item ${onClick ? "clickable" : ""}`}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
    style={onClick ? { cursor: "pointer" } : undefined}
  >
    <div className="dash-list-icon" style={{ background: gradient }}>{icon}</div>
    <div className="dash-list-body">
      <div className="dash-list-title" title={typeof title === "string" ? title : undefined}>{title}</div>
      {sub && <div className="dash-list-sub" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
    </div>
    {end && <div className="dash-list-end">{end}</div>}
  </div>
);

export const DashSkeleton = () => (
  <div className="dash" aria-busy="true">
    <div className="dash-skeleton" style={{ height: 110 }} />
    <div className="dash-grid-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="dash-skeleton" style={{ height: 96 }} />)}
    </div>
    <div className="dash-grid-main">
      <div className="dash-skeleton" style={{ height: 280 }} />
      <div className="dash-skeleton" style={{ height: 280 }} />
    </div>
  </div>
);
