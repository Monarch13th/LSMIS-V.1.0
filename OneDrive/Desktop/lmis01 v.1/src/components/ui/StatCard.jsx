// Reusable stat card with optional trend
import { Icon } from "../icons";

const TrendUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const TrendDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const StatCard = ({
  label,
  value,
  icon,
  color = "emerald",
  trend,
  trendDown,
  onClick,
  style = {},
  active = false,
  className = "",
  neutralIcon = false,
}) => (
  <div 
    className={`stat-card ${color} ${active ? "active" : ""} ${neutralIcon ? "neutral-icon" : ""} ${className}`.trim()} 
    onClick={onClick} 
    style={onClick ? { cursor: "pointer", ...style } : style}
  >
    <div className="stat-card-body">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {trend && (
        <div className={`stat-card-trend ${trendDown ? "down" : ""}`}>
          {trendDown ? <TrendDown /> : <TrendUp />}
          <span>{trend}</span>
        </div>
      )}
    </div>
    {icon && (
      <div
        className={`stat-card-icon stat-icon-${color}`}
        style={
          neutralIcon
            ? {
                background: "var(--color-bg)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                boxShadow: "none",
                pointerEvents: "none",
              }
            : undefined
        }
      >
        {icon}
      </div>
    )}
  </div>
);
