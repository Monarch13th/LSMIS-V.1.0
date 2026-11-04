// Generic, config-driven module page used to render the many list/record
// screens across Admin, Vet, and Staff modules without duplicating code.
import { useState } from "react";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { PageHeader } from "./ui/PageHeader";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./icons";
import { useToast } from "./notifications/Toast";

/**
 * props:
 *  - title, subtitle, icon
 *  - stats: [{ label, value, icon, color }]
 *  - columns: [{ key, label, badge?, mono?, render? }]
 *  - rows: array of data objects
 *  - searchKeys: array of keys to search
 *  - filters: [{ key, label, options: [{value,label}] }]
 *  - primaryAction: { label, icon, onClick }
 *  - rowActions: (row) => [{ icon, title, variant, onClick }]
 *  - emptyTitle, emptyMessage, emptyIcon
 */
export const ModulePage = ({
  title, subtitle, icon,
  stats = [],
  columns = [],
  rows = [],
  searchKeys = [],
  filters = [],
  primaryAction,
  secondaryAction,
  rowActions,
  emptyTitle = "No records found",
  emptyMessage = "There is nothing to display yet.",
  emptyIcon,
  children,
}) => {
  const [search, setSearch] = useState("");
  const [filterVals, setFilterVals] = useState({});
  const { showToast } = useToast();

  const q = search.toLowerCase();
  const filtered = rows.filter((row) => {
    const matchSearch = searchKeys.length === 0 || searchKeys.some((k) =>
      String(row[k] ?? "").toLowerCase().indexOf(q) >= 0
    );
    const matchFilters = filters.every((f) => {
      const v = filterVals[f.key];
      return !v || v === "all" || String(row[f.key]) === v;
    });
    return matchSearch && matchFilters;
  });

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          (primaryAction || secondaryAction) && (
            <>
              {secondaryAction && (
                <Button variant="outline" onClick={secondaryAction.onClick}>
                  {secondaryAction.icon} {secondaryAction.label}
                </Button>
              )}
              {primaryAction && (
                <Button onClick={primaryAction.onClick}>
                  {primaryAction.icon || <Icon.Plus />} {primaryAction.label}
                </Button>
              )}
            </>
          )
        }
      />

      {stats.length > 0 && (
        <div className={`grid grid-${Math.min(stats.length, 4)} mb-6`}>
          {stats.map((s, i) => {
            const isClickable = s.filterKey !== undefined || s.onClick !== undefined;
            const cardStyle = {
              ...(isClickable ? { cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s" } : {}),
              ...(s.style || {})
            };
            return (
              <div
                key={i}
                className={`stat-card ${s.color || "emerald"}`}
                style={cardStyle}
                onClick={() => {
                  if (s.onClick) {
                    s.onClick();
                  } else if (s.filterKey !== undefined) {
                    setFilterVals((prev) => ({
                      ...prev,
                      [s.filterKey]: s.filterValue
                    }));
                    if (s.toastMsg) {
                      showToast(s.toastMsg, "info");
                    }
                  }
                }}
                onMouseEnter={isClickable ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; } : undefined}
                onMouseLeave={isClickable ? (e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; } : undefined}
                title={isClickable ? `Click to filter` : undefined}
              >
                <div className="stat-card-body">
                  <div className="stat-card-label">{s.label}</div>
                  <div className="stat-card-value">{s.value}</div>
                  {s.trend && <div className="stat-card-trend">{s.trend}</div>}
                </div>
                <div className={`stat-card-icon stat-icon-${s.color || "emerald"}`}>{s.icon}</div>
              </div>
            );
          })}
        </div>
      )}

      {children}

      {columns.length > 0 && (
        <Card>
          {(searchKeys.length > 0 || filters.length > 0) && (
            <div className="filter-bar">
              {searchKeys.length > 0 && (
                <div style={{ position: "relative", minWidth: 220, maxWidth: 360, flex: 1 }}>
                  <input
                    className="form-control"
                    placeholder="Search records..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ paddingLeft: 38, height: 38, borderRadius: 8 }}
                  />
                  <Icon.Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: 13,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted, #94a3b8)",
                      pointerEvents: "none",
                      zIndex: 10
                    }}
                  />
                </div>
              )}
              {filters.map((f) => (
                <select key={f.key} className="form-control filter-select" value={filterVals[f.key] || "all"} onChange={(e) => setFilterVals({ ...filterVals, [f.key]: e.target.value })}>
                  <option value="all">{f.label}</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ))}
              {(search || Object.values(filterVals).some(v => v && v !== "all")) && (
                <Button variant="outline" size="sm" onClick={() => { setSearch(""); setFilterVals({}); }}><Icon.Filter /> Reset Filters</Button>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState title={emptyTitle} message={emptyMessage} icon={emptyIcon || icon} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                        {c.label}
                      </th>
                    ))}
                    {rowActions && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, ri) => (
                    <tr key={row.id || ri}>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={[c.mono && "mono", c.bold && "font-semibold", c.truncate && "truncate"].filter(Boolean).join(" ")}
                          style={{
                            ...(c.truncate ? { maxWidth: 220 } : {}),
                            ...(c.align ? { textAlign: c.align } : {})
                          }}
                        >
                          {c.render
                            ? c.render(row, ri)
                            : c.badge
                            ? <Badge status={row[c.key]} />
                            : typeof row[c.key] === "object" && row[c.key] !== null
                            ? (row[c.key].label ?? row[c.key].value ?? "—")
                            : (row[c.key] ?? "—")}
                        </td>
                      ))}
                      {rowActions && (
                        <td>
                          <div className="actions">
                            {rowActions(row).map((a, ai) => (
                              <button key={ai} className={`icon-btn ${a.variant || ""}`} onClick={() => a.onClick ? a.onClick(row) : showToast(a.toast || "Action performed", "info")} title={a.title}>
                                {a.icon}
                              </button>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
