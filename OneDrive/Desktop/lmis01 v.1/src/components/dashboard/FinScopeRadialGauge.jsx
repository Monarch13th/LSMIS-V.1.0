import React from "react";

export const FinScopeRadialGauge = ({
  value = 98.4,
  unit = "%",
  title = "Analytic view",
  subtitle = "March 2026",
  trend = "+1.37% vs last week",
  segments = [
    { label: "Passed", color: "#10b981", percent: 85 },
    { label: "Partial", color: "#f59e0b", percent: 12 },
    { label: "Condemned", color: "#f43f5e", percent: 3 },
  ],
}) => {
  const cx = 100;
  const cy = 95;
  const r = 76;
  const arcLength = Math.PI * r;

  const clampedVal = Math.max(0, Math.min(100, Number(value) || 0));
  const strokeOffset = arcLength - (clampedVal / 100) * arcLength;

  return (
    <div className="finscope-gauge-container">
      <div className="finscope-gauge-header">
        <span className="finscope-gauge-title">{title}</span>
        <button type="button" className="finscope-more-btn" title="View breakdown">
          —
        </button>
      </div>

      <div className="finscope-gauge-svg-wrap">
        <svg viewBox="0 0 200 120" className="finscope-gauge-svg">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#187A56" />
              <stop offset="50%" stopColor="#10b981" />
              <stop offset="85%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>

            <filter id="gaugeShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1A201C" floodOpacity="0.08" />
            </filter>
          </defs>

          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#EFF2F0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#E2E6E3"
            strokeWidth="12"
            strokeDasharray="2 6"
            strokeLinecap="round"
          />

          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeOffset}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />

          {(() => {
            const angleRad = Math.PI - (clampedVal / 100) * Math.PI;
            const px = cx + r * Math.cos(angleRad);
            const py = cy - r * Math.sin(angleRad);
            return (
              <circle
                cx={px}
                cy={py}
                r="6"
                fill="#ffffff"
                stroke="#187A56"
                strokeWidth="3.5"
                filter="url(#gaugeShadow)"
              />
            );
          })()}

          <text x="18" y="108" fill="#9BA49E" fontSize="8" fontWeight="700">Safe</text>
          <text x="175" y="108" fill="#9BA49E" fontSize="8" fontWeight="700" textAnchor="end">Barred</text>
        </svg>

        <div className="finscope-gauge-center">
          <div className="finscope-gauge-val">
            {clampedVal.toFixed(1)}
            <span className="finscope-gauge-unit">{unit}</span>
          </div>
          <div className="finscope-gauge-sub">{subtitle}</div>
          {trend && (
            <div className="finscope-gauge-trend">
              <span className="trend-arrow">↑</span> {trend}
            </div>
          )}
        </div>
      </div>

      <div className="finscope-gauge-legend">
        {segments.map((s, idx) => (
          <div key={idx} className="finscope-legend-pill">
            <span className="finscope-legend-dot" style={{ backgroundColor: s.color }} />
            <span className="finscope-legend-label">{s.label}:</span>
            <span className="finscope-legend-val">{s.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

