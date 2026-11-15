import { useState } from "react";

/**
 * Interactive Dual-Series Smooth Area Chart
 * - Hovering any stage column, point, or axis pill highlights that stage,
 *   draws a vertical crosshair line, enlarges both series dots, and displays
 *   a floating tooltip with both series values and percentage details.
 * - Hovering either legend item highlights that series (primary vs secondary)
 *   across the entire chart.
 * - Clicking a stage point, hit column, or axis pill triggers `p.onClick` if provided.
 */
export const InteractiveAreaChart = ({
  points = [],
  primaryLabel = "All-time volume",
  secondaryLabel = "Current period",
  ariaLabel = "Operations throughput",
}) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [hoveredSeries, setHoveredSeries] = useState(null); // 'primary' | 'secondary' | null

  const safePoints = points.length > 0 ? points : [{ label: "—", v: 0, sub: 0 }];
  const max = Math.max(...safePoints.map((p) => Math.max(Number(p.v) || 0, Number(p.sub) || 0)), 1);
  const totalPrimary = safePoints.reduce((s, p) => s + (Number(p.v) || 0), 0);
  const totalSecondary = safePoints.reduce((s, p) => s + (Number(p.sub) || 0), 0);

  const W = 440;
  const H = 152;
  const padX = 32;
  const padT = 28;
  const padB = 12;

  const toCoords = (getter) =>
    safePoints.map((p, i) => [
      safePoints.length > 1 ? padX + (i * (W - padX * 2)) / (safePoints.length - 1) : W / 2,
      padT + (1 - (Number(getter(p)) || 0) / max) * (H - padT - padB),
    ]);

  const smoothPath = (xy) => {
    if (!xy.length) return "";
    let d = `M ${xy[0][0]} ${xy[0][1]}`;
    for (let i = 1; i < xy.length; i++) {
      const [x0, y0] = xy[i - 1];
      const [x1, y1] = xy[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return d;
  };

  const primaryXY = toCoords((p) => p.v);
  const secondaryXY = toCoords((p) => p.sub);
  const dPrimary = smoothPath(primaryXY);
  const dSecondary = smoothPath(secondaryXY);
  const areaPrimary = `${dPrimary} L ${primaryXY[primaryXY.length - 1][0]} ${H} L ${primaryXY[0][0]} ${H} Z`;
  const areaSecondary = `${dSecondary} L ${secondaryXY[secondaryXY.length - 1][0]} ${H} L ${secondaryXY[0][0]} ${H} Z`;

  let peakIdx = 0;
  safePoints.forEach((p, idx) => {
    if ((Number(p.v) || 0) > (Number(safePoints[peakIdx].v) || 0)) peakIdx = idx;
  });

  const activeIdx = hoveredIdx !== null ? hoveredIdx : peakIdx;
  const [activeX, activeY] = primaryXY[activeIdx] || [0, 0];
  const [, activeSubY] = secondaryXY[activeIdx] || [0, 0];
  const activePoint = safePoints[activeIdx] || { label: "", v: 0, sub: 0 };
  const activeSharePct = totalPrimary > 0 ? Math.round(((Number(activePoint.v) || 0) / totalPrimary) * 100) : 0;

  // Tooltip horizontal clamping so it never clips off the left/right edges
  const tooltipLeftPct = Math.min(Math.max((activeX / W) * 100, 18), 82);

  return (
    <div className="ag-chart-interactive-wrap">
      <div className="ag-legend-inline">
        <span
          className={`ag-legend-series-pill ${hoveredSeries === "primary" ? "is-active" : ""} ${hoveredSeries === "secondary" ? "is-dimmed" : ""}`}
          onMouseEnter={() => setHoveredSeries("primary")}
          onMouseLeave={() => setHoveredSeries(null)}
          title={`${primaryLabel}: ${totalPrimary.toLocaleString()} total across stages`}
        >
          <i className="dk" />
          <span>{primaryLabel}</span>
          <b className="ag-legend-series-val">{totalPrimary.toLocaleString()}</b>
        </span>
        <span
          className={`ag-legend-series-pill ${hoveredSeries === "secondary" ? "is-active" : ""} ${hoveredSeries === "primary" ? "is-dimmed" : ""}`}
          onMouseEnter={() => setHoveredSeries("secondary")}
          onMouseLeave={() => setHoveredSeries(null)}
          title={`${secondaryLabel}: ${totalSecondary.toLocaleString()} total`}
        >
          <i className="lt" />
          <span>{secondaryLabel}</span>
          <b className="ag-legend-series-val">{totalSecondary.toLocaleString()}</b>
        </span>
      </div>

      <div
        className="ag-linechart"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <div className="ag-chart-stage-canvas">
          {/* Floating Interactive Tooltip */}
          {hoveredIdx !== null && (
            <div
              className="ag-chart-floating-tooltip"
              style={{ left: `${tooltipLeftPct}%` }}
              role="status"
            >
              <div className="ag-chart-tt-head">
                <strong>{activePoint.label}</strong>
                <span>{activeSharePct}% of total</span>
              </div>
              <div className="ag-chart-tt-row">
                <span className="ag-chart-tt-dot dk" />
                <span className="ag-chart-tt-label">{activePoint.primaryTag || primaryLabel}:</span>
                <b>{Number(activePoint.v || 0).toLocaleString()}</b>
              </div>
              <div className="ag-chart-tt-row">
                <span className="ag-chart-tt-dot lt" />
                <span className="ag-chart-tt-label">{activePoint.secondaryTag || secondaryLabel}:</span>
                <b>{Number(activePoint.sub || 0).toLocaleString()}</b>
              </div>
              {activePoint.hint && (
                <div className="ag-chart-tt-hint">{activePoint.hint}</div>
              )}
            </div>
          )}

          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
            <defs>
              <linearGradient id="agGradPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#187A56" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#187A56" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="agGradSecondary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75].map((t) => (
              <line
                key={t}
                x1="0"
                x2={W}
                y1={padT + t * (H - padT - padB)}
                y2={padT + t * (H - padT - padB)}
                className="ag-grid"
              />
            ))}

            {/* Vertical guide line on active/hovered stage */}
            <line
              x1={activeX}
              x2={activeX}
              y1={padT - 10}
              y2={H}
              className={`ag-hover-guide ${hoveredIdx !== null ? "visible" : ""}`}
            />

            <path
              d={areaSecondary}
              className={`ag-area-secondary ${hoveredSeries === "primary" ? "is-dimmed" : ""} ${hoveredSeries === "secondary" ? "is-emphasized" : ""}`}
            />
            <path
              d={dSecondary}
              className={`ag-line-secondary ${hoveredSeries === "primary" ? "is-dimmed" : ""} ${hoveredSeries === "secondary" ? "is-emphasized" : ""}`}
            />
            <path
              d={areaPrimary}
              className={`ag-area-primary ${hoveredSeries === "secondary" ? "is-dimmed" : ""} ${hoveredSeries === "primary" ? "is-emphasized" : ""}`}
            />
            <path
              d={dPrimary}
              className={`ag-line-primary ${hoveredSeries === "secondary" ? "is-dimmed" : ""} ${hoveredSeries === "primary" ? "is-emphasized" : ""}`}
            />

            {/* Secondary series dots */}
            {secondaryXY.map(([x, y], i) => {
              const isAct = i === activeIdx && (hoveredIdx !== null || hoveredSeries === "secondary");
              return (
                <circle
                  key={`sub-${safePoints[i].label}`}
                  cx={x}
                  cy={y}
                  r={isAct ? 4.5 : 2.8}
                  className={`ag-dot-sub ${isAct ? "active" : ""}`}
                />
              );
            })}

            {/* Primary series dots */}
            {primaryXY.map(([x, y], i) => {
              const isAct = i === activeIdx;
              return (
                <g key={safePoints[i].label}>
                  {isAct && (
                    <circle
                      cx={x}
                      cy={y}
                      r={9}
                      className="ag-dot-halo"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isAct ? 5 : 3.5}
                    className={`ag-dot ${isAct ? "peak" : ""}`}
                  />
                </g>
              );
            })}

            {/* Callout pill above active point */}
            <g
              transform={`translate(${activeX}, ${Math.max((hoveredSeries === "secondary" ? activeSubY : activeY) - 24, 3)})`}
              className="ag-peak-group"
            >
              <rect x="-22" y="0" width="44" height="17" rx="5.5" className="ag-peak-tag" />
              <text x="0" y="11.5" textAnchor="middle" className="ag-peak-text">
                {hoveredSeries === "secondary" ? activePoint.sub : activePoint.v}
              </text>
            </g>

            {/* Invisible interactive hover/click columns for smooth cursor tracking */}
            {primaryXY.map(([x], i) => {
              const colW = W / safePoints.length;
              return (
                <rect
                  key={`hit-${safePoints[i].label}`}
                  x={Math.max(0, x - colW / 2)}
                  y={0}
                  width={colW}
                  height={H}
                  fill="transparent"
                  style={{ cursor: safePoints[i].onClick ? "pointer" : "crosshair" }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onClick={() => safePoints[i].onClick?.()}
                />
              );
            })}
          </svg>
        </div>

        <div className="ag-chart-axis">
          {safePoints.map((p, i) => {
            const isAct = i === activeIdx;
            return (
              <span
                key={p.label}
                className={`${isAct ? "on" : ""} ${p.onClick ? "clickable" : ""}`}
                onMouseEnter={() => setHoveredIdx(i)}
                onClick={() => p.onClick?.()}
                title={`${p.label}: ${p.v} (${primaryLabel}) • ${p.sub} (${secondaryLabel})`}
              >
                {p.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Interactive Concentric Ring Gauge
 * - Hovering any legend item or ring highlights that ring, dims the others,
 *   and dynamically updates the center SVG readout to show the hovered item's
 *   percentage share or count and label.
 */
export const InteractiveRings = ({
  rows = [],
  centerValue = "0%",
  centerCaption = "ACTIVE",
  ariaLabel = "Distribution by category",
}) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const radii = [48, 37, 26];
  const colors = ["#187A56", "#10b981", "#24966D"];

  const hoveredRow = hoveredIdx !== null ? rows[hoveredIdx] : null;
  const hoveredPct = hoveredRow
    ? total > 0
      ? `${Math.round(((Number(hoveredRow.count) || 0) / total) * 100)}%`
      : "0%"
    : centerValue;
  const hoveredCap = hoveredRow
    ? String(hoveredRow.shortLabel || hoveredRow.label || "").toUpperCase().slice(0, 12)
    : centerCaption;

  return (
    <div
      className="ag-rings"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <ul className="ag-legend">
        {rows.map((r, i) => {
          const isHovered = hoveredIdx === i;
          const isDimmed = hoveredIdx !== null && hoveredIdx !== i;
          const sharePct = total > 0 ? Math.round(((Number(r.count) || 0) / total) * 100) : 0;
          return (
            <li
              key={r.label}
              className={`ag-legend-item ${isHovered ? "is-hovered" : ""} ${isDimmed ? "is-dimmed" : ""} ${r.onClick ? "clickable" : ""}`}
              onMouseEnter={() => setHoveredIdx(i)}
              onClick={() => r.onClick?.()}
              data-ag-tip={`${r.label}: ${r.count} (${sharePct}% of ${total || 0} total)${r.hint ? ` • ${r.hint}` : ""}`}
            >
              <span
                className="ag-legend-dot"
                style={{
                  background: colors[i % colors.length],
                  transform: isHovered ? "scale(1.35)" : "scale(1)",
                  boxShadow: isHovered ? `0 0 0 3px ${colors[i % colors.length]}33` : "none",
                }}
              />
              <span className="ag-legend-name">{r.label}</span>
              <b>{r.count}</b>
            </li>
          );
        })}
      </ul>

      <div className="ag-rings-svg-wrap">
        <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel}>
          {rows.map((r, i) => {
            const radius = radii[i] || 26;
            const c = 2 * Math.PI * radius;
            const pct = total ? Math.max((Number(r.count) || 0) / total, 0.06) : 0;
            const isHovered = hoveredIdx === i;
            const isDimmed = hoveredIdx !== null && hoveredIdx !== i;
            return (
              <g
                key={r.label}
                transform="rotate(-90 60 60)"
                style={{ cursor: r.onClick ? "pointer" : "default" }}
                onMouseEnter={() => setHoveredIdx(i)}
                onClick={() => r.onClick?.()}
              >
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  className="ag-ring-bg"
                  style={{ opacity: isDimmed ? 0.45 : 1 }}
                />
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  className={`ag-ring ${isHovered ? "is-hovered" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                  stroke={colors[i % colors.length]}
                  strokeWidth={isHovered ? 8.5 : 7}
                  strokeDasharray={`${c * pct} ${c}`}
                />
              </g>
            );
          })}
          <text x="60" y="59" textAnchor="middle" className="ag-ring-num">
            {hoveredPct}
          </text>
          <text x="60" y="72" textAnchor="middle" className="ag-ring-cap">
            {hoveredCap}
          </text>
        </svg>
      </div>
    </div>
  );
};

