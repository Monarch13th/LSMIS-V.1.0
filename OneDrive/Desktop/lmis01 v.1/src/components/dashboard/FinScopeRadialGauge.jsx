import React from "react";

/**
 * FinScopeRadialGauge
 * Semicircular radial arc gauge inspired by FinScope "Analytic view".
 * Displays a segmented semicircle (Passed/High, Partial/Medium, Condemned/Low)
 * with a center metric, subtitle, trend indicator, and legend.
 */
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
  // Semicircle dimensions:
  // Center (cx, cy) = (100, 95), Radius = 76
  // Angle spans from 180° to 0° (PI radians)
  // Arc length = PI * 76 ≈ 238.76
  const cx = 100;
  const cy = 95;
  const r = 76;
  const arcLength = Math.PI * r;

  // Clamped value 0 to 100
  const clampedVal = Math.max(0, Math.min(100, Number(value) || 0));
  // Progress strokeDashoffset: starts full (arcLength) and decreases as clampedVal increases
  const strokeOffset = arcLength - (clampedVal / 100) * arcLength;

  return (
    <div className="finscope-gauge-container">
      <div className="finscope-gauge-header">
        <span className="finscope-gauge-title">{title}</span>
        <button type="button" className="finscope-more-btn" title="View breakdown">
          •••
        </button>
      </div>

      <div className="finscope-gauge-svg-wrap">
        <svg viewBox="0 0 200 120" className="finscope-gauge-svg">
          <defs>
            {/* Linear gradient matching FinScope vibrant blue/emerald */}
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="50%" stopColor="#10b981" />
              <stop offset="85%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>

            {/* Subtle drop shadow */}
            <filter id="gaugeShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* Background Dotted / Tick Arc */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Segmented Guide Dots/Ticks */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="12"
            strokeDasharray="2 6"
            strokeLinecap="round"
          />

          {/* Active Gradient Arc */}
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

          {/* Needle / Value dot indicator */}
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
                stroke="#0284c7"
                strokeWidth="3.5"
                filter="url(#gaugeShadow)"
              />
            );
          })()}

          {/* Semicircle Labels: High / Medium / Low or Safe / Condemned */}
          <text x="18" y="108" fill="#94a3b8" fontSize="8" fontWeight="700">Safe</text>
          <text x="175" y="108" fill="#94a3b8" fontSize="8" fontWeight="700" textAnchor="end">Barred</text>
        </svg>

        {/* Center Overlay Metric */}
        <div className="finscope-gauge-center">
          <div className="finscope-gauge-val">
            {clampedVal.toFixed(1)}
            <span className="finscope-gauge-unit">{unit}</span>
          </div>
          <div className="finscope-gauge-sub">{subtitle}</div>
          {trend && (
            <div className="finscope-gauge-trend">
              <span className="trend-arrow">▲</span> {trend}
            </div>
          )}
        </div>
      </div>

      {/* Footer Segment Pills */}
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

