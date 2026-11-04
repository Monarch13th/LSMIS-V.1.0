import React from "react";
import { Icon } from "../icons";

export const Pagination = ({
  page = 1,
  pageSize = 10,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  itemLabel = "records",
  showPageSize = true,
  style = {},
}) => {
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const fromItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toItem = Math.min(currentPage * pageSize, totalItems);

  if (totalItems === 0 || totalPages <= 1) return null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        padding: "12px 20px",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        ...style,
      }}
    >
      {/* Range and page size control */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          Showing <strong>{fromItem}</strong> to <strong>{toItem}</strong> of{" "}
          <strong>{totalItems}</strong> {itemLabel}
        </span>

        {showPageSize && onPageSizeChange && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--color-text-muted)" }}>
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                if (onPageSizeChange) onPageSizeChange(newSize);
                if (onPageChange) onPageChange(1);
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                fontSize: 12.5,
                fontWeight: 600,
                background: "var(--color-bg)",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Page Navigation */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => onPageChange && onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: currentPage === 1 ? "var(--color-text-muted)" : "var(--color-text)",
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              opacity: currentPage === 1 ? 0.6 : 1,
            }}
          >
            <Icon.ChevronLeft size={14} /> Prev
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
            .map((p, idx, arr) => {
              const prevP = arr[idx - 1];
              const showEllipsis = prevP && p - prevP > 1;
              return (
                <React.Fragment key={p}>
                  {showEllipsis && (
                    <span style={{ padding: "0 4px", color: "var(--color-text-muted)", fontSize: 12.5 }}>
                      ...
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onPageChange && onPageChange(p)}
                    style={{
                      minWidth: 34,
                      height: 34,
                      padding: "0 8px",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 700,
                      border: "1px solid",
                      borderColor: p === currentPage ? "var(--color-primary)" : "var(--color-border)",
                      background: p === currentPage ? "var(--color-primary)" : "var(--color-bg)",
                      color: p === currentPage ? "#ffffff" : "var(--color-text)",
                      cursor: "pointer",
                      transition: "all 140ms ease",
                    }}
                  >
                    {p}
                  </button>
                </React.Fragment>
              );
            })}

          <button
            type="button"
            onClick={() => onPageChange && onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: currentPage === totalPages ? "var(--color-text-muted)" : "var(--color-text)",
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              opacity: currentPage === totalPages ? 0.6 : 1,
            }}
          >
            Next <Icon.ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default Pagination;
