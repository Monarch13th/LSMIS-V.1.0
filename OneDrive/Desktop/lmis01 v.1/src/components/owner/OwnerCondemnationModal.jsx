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
        backgroundColor: "rgba(15, 23, 42, 0.88)",
        backdropFilter: "blur(8px)",
        zIndex: 4000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{
          position: "relative",
          maxWidth: 860,
          width: "100%",
          backgroundColor: "#0f172a",
          borderRadius: 20,
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            backgroundColor: "#1e293b",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#38bdf8", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Pathology Evidence Photo
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>· {photo.part || "Condemned Part"}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            title="Close Photo Preview"
          >
            <Icon.X size={18} />
          </button>
        </div>

        {/* Enlarged Photo Container */}
        <div style={{ backgroundColor: "#020617", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 320, maxHeight: "65vh", padding: 16 }}>
          <img
            src={photo.url}
            alt={photo.fileName || "Condemnation evidence"}
            style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}
            onError={(e) => {
              e.target.style.display = "none";
              e.target.parentNode.innerHTML = `<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 40px;">⚠️ Evidence photo file is unavailable or no longer accessible.</div>`;
            }}
          />
        </div>

        {/* Footer Details */}
        <div style={{ padding: "16px 20px", backgroundColor: "#1e293b", color: "#f8fafc", fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ color: "#38bdf8", fontSize: 14 }}>{photo.part}</strong>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{photo.date}</span>
          </div>
          {photo.notes && (
            <p style={{ margin: 0, fontSize: 12.5, color: "#cbd5e1" }}>
              <span style={{ fontWeight: 700, color: "#94a3b8" }}>Veterinarian Note:</span> {photo.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Condemnation Details & Evidence Photo Modal for Owners.
 */
export const OwnerCondemnationModal = ({ open, onClose, details }) => {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  if (!open || !details) return null;

  const isWhole = details.scope === "whole" || details.scope.includes("ante");
  const resultBg = isWhole ? "#fef2f2" : "#fffbeb";
  const resultBorder = isWhole ? "#fecaca" : "#fde68a";
  const resultColor = isWhole ? "#dc2626" : "#d97706";

  return (
    <>
      <div
        className="modal-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(15, 23, 42, 0.7)",
          backdropFilter: "blur(6px)",
          zIndex: 3000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        onClick={onClose}
        role="presentation"
      >
        <div
          className="modal owner-condemnation-modal-card"
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 20,
            maxWidth: 620,
            width: "100%",
            maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            border: "1px solid #e2e8f0",
            position: "relative",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="owner-condemnation-modal-header"
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              position: "sticky",
              top: 0,
              backgroundColor: "#ffffff",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: resultBg,
                  color: resultColor,
                  border: `1px solid ${resultBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon.AlertTriangle size={22} />
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#0284c7", letterSpacing: "0.04em" }}>
                  Official Veterinary Inspection Record
                </span>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>
                  Tag #{details.tagNumber}
                </h3>
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
              }}
              aria-label="Close"
            >
              <Icon.X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="owner-condemnation-modal-body" style={{ padding: 24 }}>
            {/* Result Alert Banner */}
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 14,
                backgroundColor: resultBg,
                border: `1.5px solid ${resultBorder}`,
                color: resultColor,
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.85, display: "block" }}>
                  Condemnation Status
                </span>
                <strong style={{ fontSize: 16, fontWeight: 900 }}>
                  {details.resultLabel}
                </strong>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                {details.species}
              </span>
            </div>

            {/* 11 Required Fields Grid */}
            <div style={{ backgroundColor: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0", padding: 18, marginBottom: 20 }}>
              <h4 style={{ margin: "0 0 14px 0", fontSize: 13, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.FileText size={15} style={{ color: "#0284c7" }} /> Inspection &amp; Condemnation Summary
              </h4>

              <div className="owner-condemnation-fields-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12.5 }}>
                {/* 1. Tag Number */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>1. Livestock Tag Number</span>
                  <strong style={{ color: "#0f172a", fontFamily: "monospace", fontSize: 13 }}>{details.tagNumber}</strong>
                </div>

                {/* 2. Species & Sex */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>2. Species &amp; Sex</span>
                  <strong style={{ color: "#0f172a" }}>{details.species} ({details.sex || "Not specified"})</strong>
                </div>

                {/* 3. Condemnation Result */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>3. Condemnation Result</span>
                  <strong style={{ color: resultColor }}>{details.resultLabel}</strong>
                </div>

                {/* 4. Condemned Part */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>4. Condemned Part(s)</span>
                  <strong style={{ color: "#0f172a" }}>
                    {details.condemnedParts.map((p) => p.part).join(", ") || "Whole Carcass"}
                  </strong>
                </div>

                {/* 5. Location / Area */}
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>5. Inspection Location / Area</span>
                  <strong style={{ color: "#0f172a" }}>{details.locationArea}</strong>
                </div>

                {/* 6. Weight or Quantity */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>6. Condemned Weight / Quantity</span>
                  <strong style={{ color: "#0f172a" }}>{details.totalWeightQty}</strong>
                </div>

                {/* 7. Date and time of inspection */}
                <div>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>7. Inspection Date &amp; Time</span>
                  <strong style={{ color: "#0f172a" }}>{details.inspectionDateFormatted}</strong>
                </div>

                {/* 8. Veterinarian Decision */}
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>8. Veterinarian Decision &amp; Inspector</span>
                  <strong style={{ color: "#0369a1" }}>{details.vetName}</strong>
                </div>

                {/* 9. Pathology / Reason */}
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>9. Pathology / Cause of Rejection</span>
                  <div style={{ color: "#7f1d1d", backgroundColor: "#fef2f2", border: "1px solid #fecaca", padding: "8px 12px", borderRadius: 8, marginTop: 4, fontWeight: 700 }}>
                    {details.pathologyReasons}
                  </div>
                </div>

                {/* 10. Inspection Findings */}
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>10. Clinical &amp; Post-Mortem Findings</span>
                  <p style={{ margin: "4px 0 0 0", color: "#334155", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", padding: "8px 12px", borderRadius: 8, lineHeight: 1.5 }}>
                    {details.inspectionFindings}
                  </p>
                </div>

                {/* 11. Disposition */}
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, display: "block" }}>11. Final Disposition &amp; Disposal Method</span>
                  <strong style={{ color: "#059669", display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Icon.CheckCircle size={15} color="#059669" /> {details.dispositionSummary}
                  </strong>
                </div>
              </div>
            </div>

            {/* Itemized Condemned Parts Breakdown */}
            {details.condemnedParts.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ margin: "0 0 10px 0", fontSize: 12.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Itemized Condemnation Breakdown
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {details.condemnedParts.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <strong style={{ color: "#0f172a", fontSize: 13 }}>{item.part}</strong>
                        <div style={{ color: "#64748b", marginTop: 2 }}>{item.reason}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontWeight: 800, color: "#dc2626", backgroundColor: "#fef2f2", padding: "2px 8px", borderRadius: 6, border: "1px solid #fecaca" }}>
                          {item.quantityWeight}
                        </span>
                        <div style={{ fontSize: 10.5, color: "#059669", marginTop: 3 }}>{item.disposition}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Evidence Photos Gallery */}
            <div>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.Camera size={15} style={{ color: "#0284c7" }} /> Veterinary Evidence Photos
              </h4>

              {details.hasPhotos ? (
                <div className="owner-condemnation-photos-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                  {details.evidencePhotos.map((photo) => (
                    <div
                      key={photo.id}
                      onClick={() => setSelectedPhoto(photo)}
                      style={{
                        borderRadius: 12,
                        border: "1px solid #cbd5e1",
                        overflow: "hidden",
                        backgroundColor: "#f8fafc",
                        cursor: "pointer",
                        transition: "transform 0.15s ease, box-shadow 0.15s ease",
                        position: "relative",
                      }}
                      className="evidence-photo-card"
                      title="Click to expand photo"
                    >
                      <div style={{ height: 110, backgroundColor: "#020617", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img
                          src={photo.url}
                          alt={photo.part}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      </div>
                      <div style={{ padding: "8px 10px", fontSize: 11 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {photo.part}
                        </div>
                        <div style={{ color: "#0284c7", fontSize: 10, fontWeight: 700, marginTop: 2 }}>
                          🔍 Click to View
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: "16px 20px",
                    borderRadius: 12,
                    backgroundColor: "#f8fafc",
                    border: "1.5px dashed #cbd5e1",
                    color: "#64748b",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Icon.Info size={18} color="#94a3b8" />
                  <span>No evidence photo available.</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              backgroundColor: "#f8fafc",
              display: "flex",
              justifyContent: "flex-end",
              borderBottomLeftRadius: 20,
              borderBottomRightRadius: 20,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 20px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#334155",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Close Record
            </button>
          </div>
        </div>
      </div>

      {/* Enlarged Photo Preview Lightbox */}
      {selectedPhoto && (
        <ImageLightboxModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </>
  );
};
