import { useState } from "react";
import { Icon } from "../icons";

/**
 * Image Lightbox Modal for enlarged photo viewing.
 */
export const ImageLightboxModal = ({ photo, onClose }) => {
  if (!photo) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(8px)",
        zIndex: 4000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{
          position: "relative",
          maxWidth: 680,
          width: "100%",
          backgroundColor: "#0f172a",
          borderRadius: 20,
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            backgroundColor: "#1e293b",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#38bdf8", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Evidence Photo
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>· {photo.part || "Carcass Part"}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              border: "none",
              color: "#ffffff",
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title="Close Preview"
          >
            <Icon.X size={16} />
          </button>
        </div>

        {/* Enlarged Photo */}
        <div style={{ backgroundColor: "#020617", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 260, maxHeight: "65vh", padding: 12 }}>
          <img
            src={photo.url}
            alt={photo.fileName || "Condemnation evidence"}
            style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 8 }}
            onError={(e) => {
              e.target.style.display = "none";
              e.target.parentNode.innerHTML = `<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 40px;">⚠️ Evidence photo file is unavailable or no longer accessible.</div>`;
            }}
          />
        </div>

        {/* Footer info */}
        <div style={{ padding: "12px 18px", backgroundColor: "#1e293b", color: "#f8fafc", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong style={{ color: "#38bdf8" }}>{photo.part}</strong>
          {photo.date && <span style={{ color: "#94a3b8", fontSize: 11.5 }}>{photo.date}</span>}
        </div>
      </div>
    </div>
  );
};

/**
 * Concise & Compact Condemnation Evidence Modal for Owners.
 */
export const OwnerCondemnationModal = ({ open, onClose, details }) => {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  if (!open || !details) return null;

  const isPartial =
    details.scope === "partial" ||
    String(details.resultLabel || "").toLowerCase().includes("partial");

  const resultBg = isPartial ? "#fffbeb" : "#fef2f2";
  const resultBorder = isPartial ? "#fde68a" : "#fecaca";
  const resultColor = isPartial ? "#b45309" : "#dc2626";
  const statusLabel = isPartial ? "Partially Condemned" : "Condemned";

  // Clean rejected parts array
  const rejectedPartsList = Array.isArray(details.condemnedParts) ? details.condemnedParts : [];

  return (
    <>
      <div
        className="modal-backdrop owner-condemnation-overlay"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(6px)",
          zIndex: 3000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
        }}
        onClick={onClose}
        role="presentation"
      >
        <div
          className="modal owner-condemnation-modal-card"
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 20,
            maxWidth: 460,
            width: "100%",
            maxHeight: "calc(100dvh - 32px)",
            overflowY: "auto",
            boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.3)",
            border: "1px solid #e2e8f0",
            position: "relative",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="owner-condemnation-modal-header"
            style={{
              padding: "16px 18px 12px 18px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "#ffffff",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    color: "var(--color-text, #0f172a)",
                    fontFamily: "monospace",
                  }}
                >
                  {details.tagNumber}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#0284c7",
                    background: "rgba(2, 132, 199, 0.08)",
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  {details.species}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                {details.inspectionDateFormatted || "Date recorded"}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "#f1f5f9",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label="Close"
              title="Close"
            >
              <Icon.X size={16} />
            </button>
          </div>

          {/* Modal Content */}
          <div className="owner-condemnation-modal-body" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Status Pill Card */}
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                backgroundColor: resultBg,
                border: `1.5px solid ${resultBorder}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: resultColor,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: resultColor }}>
                  {statusLabel}
                </span>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: resultColor, opacity: 0.9 }}>
                {isPartial
                  ? "Post-Mortem Partial"
                  : details.scope?.includes("ante")
                  ? "Ante-Mortem Condemnation"
                  : "Post-Mortem Condemnation"}
              </span>
            </div>

            {/* Condemnation Reason */}
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.04em", marginBottom: 3 }}>
                Reason
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>
                {details.pathologyReasons || details.inspectionFindings || "Abnormal appearance noted during veterinary inspection."}
              </div>
            </div>

            {/* Rejected Weight (Shown for Condemned Livestock) */}
            {!isPartial && (
              <div
                style={{
                  padding: "11px 14px",
                  borderRadius: 12,
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#991b1b", letterSpacing: "0.04em" }}>
                  Rejected Weight
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "#dc2626" }}>
                  {(() => {
                    const raw = details.totalWeightQty || details.condemnedParts?.[0]?.quantityWeight || details.weight;
                    if (!raw || raw === "N/A" || raw === "—") return "Whole Animal";
                    const clean = String(raw).trim();
                    return clean.toLowerCase().includes("kg") ? clean : `${clean} kg`;
                  })()}
                </span>
              </div>
            )}

            {/* Rejected Carcass Parts (Shown for Partial Condemnation) */}
            {isPartial && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fde68a",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#b45309", letterSpacing: "0.04em", marginBottom: 6 }}>
                  Rejected Carcass Parts
                </div>
                {rejectedPartsList.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {rejectedPartsList.map((item, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          backgroundColor: "#ffffff",
                          color: "#92400e",
                          border: "1px solid #fcd34d",
                          padding: "3px 9px",
                          borderRadius: 8,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {item.part}
                        {item.quantityWeight && (
                          <span style={{ color: "#dc2626", fontWeight: 800 }}>({item.quantityWeight})</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e" }}>
                    {details.condemnedParts?.map((p) => p.part).join(", ") || "Specific cuts rejected"}
                  </div>
                )}
              </div>
            )}

            {/* Evidence Photos Gallery */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon.Camera size={13} style={{ color: "#0284c7" }} />
                  Evidence Photos {details.hasPhotos ? `(${details.evidencePhotos.length})` : ""}
                </span>
                {details.hasPhotos && (
                  <span style={{ fontSize: 10.5, color: "#0284c7", fontWeight: 700 }}>
                    Tap to enlarge
                  </span>
                )}
              </div>

              {details.hasPhotos ? (
                <div
                  className="owner-condemnation-photos-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: details.evidencePhotos.length === 1 ? "1fr" : "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 10,
                  }}
                >
                  {details.evidencePhotos.map((photo) => (
                    <div
                      key={photo.id}
                      onClick={() => setSelectedPhoto(photo)}
                      style={{
                        borderRadius: 12,
                        border: "1px solid #cbd5e1",
                        overflow: "hidden",
                        backgroundColor: "#020617",
                        cursor: "pointer",
                        position: "relative",
                      }}
                      title="Tap to enlarge photo"
                    >
                      <div
                        style={{
                          height: details.evidencePhotos.length === 1 ? 160 : 110,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.part || "Evidence photo"}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      </div>
                      <div
                        style={{
                          padding: "6px 10px",
                          backgroundColor: "#ffffff",
                          fontSize: 11,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderTop: "1px solid #e2e8f0",
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {photo.part || "Evidence"}
                        </span>
                        <span style={{ color: "#0284c7", fontWeight: 700, fontSize: 10.5 }}>
                          🔍 Enlarge
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    backgroundColor: "#f8fafc",
                    border: "1.5px dashed #cbd5e1",
                    color: "#64748b",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icon.Info size={16} color="#94a3b8" />
                  <span>No evidence photo uploaded for this record.</span>
                </div>
              )}
            </div>

            {/* Clear Close Button */}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: 12,
                backgroundColor: "#f1f5f9",
                color: "#334155",
                border: "1px solid #cbd5e1",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                marginTop: 2,
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Full-size Image Lightbox */}
      {selectedPhoto && (
        <ImageLightboxModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      )}
    </>
  );
};
