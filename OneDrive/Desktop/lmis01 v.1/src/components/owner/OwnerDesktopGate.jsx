import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../icons";
import logoImg from "../../assets/logo.jpg";

export const OwnerDesktopGate = ({ onSimulateMobile }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const mobileUrl = (() => {
    if (typeof window === "undefined") return "";
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const lanOrigin =
      import.meta.env?.VITE_DEV_LAN_URL ||
      (typeof __DEV_LAN_ORIGIN__ !== "undefined" ? __DEV_LAN_ORIGIN__ : "") ||
      "";
    const baseOrigin = isLocalhost && lanOrigin ? String(lanOrigin).replace(/\/+$/, "") : window.location.origin;
    return `${baseOrigin}/owner`;
  })();

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && mobileUrl) {
        await navigator.clipboard.writeText(mobileUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch (e) {
      console.warn("Copy failed:", e);
    }
  };

  const handleOfficeLogin = () => {
    navigate("/?login=true");
  };

  return (
    <div className="owner-desktop-gate">
      <div className="owner-gate-card">
        {/* Abattoir Crest / Badge */}
        <div className="owner-gate-badge">
          <img
            src={logoImg}
            alt="LSMIS"
            style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "contain" }}
          />
          <span>City Veterinary Abattoir • Mobile Portal</span>
        </div>

        {/* Device Restriction Icon */}
        <div className="owner-gate-icon-wrapper">
          <Icon.Smartphone size={36} />
          <div className="owner-gate-icon-badge" title="Smartphone Only">
            <Icon.Lock size={12} />
          </div>
        </div>

        <h1 className="owner-gate-title">Mobile Device Required</h1>
        <p className="owner-gate-desc">
          The <strong>Livestock Owner Portal</strong> is strictly designed for handheld mobile phones (Android &amp; iOS). Desktop browser access is disabled to ensure the intended mobile workflow for livestock raisers in the field.
        </p>

        {/* QR Code Section */}
        <div className="owner-gate-qr-box">
          <div className="owner-gate-qr-label">
            <Icon.Camera size={14} />
            <span>Scan with Phone Camera to Open</span>
          </div>

          <div className="owner-gate-qr-card">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                mobileUrl
              )}&margin=4`}
              alt="Scan to open on smartphone"
              style={{ width: 148, height: 148, borderRadius: 8, objectFit: "contain" }}
              onError={(e) => {
                // Fallback if offline
                e.target.style.display = "none";
                const fallback = e.target.nextSibling;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            {/* Fallback container if offline */}
            <div
              style={{
                display: "none",
                width: 148,
                height: 148,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#f8fafc",
                borderRadius: 8,
                color: "#64748b",
                textAlign: "center",
                padding: 10,
                fontSize: 11,
              }}
            >
              <Icon.Smartphone size={32} style={{ color: "#0284c7", marginBottom: 6 }} />
              <strong>Open on Mobile</strong>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>Use your phone browser</span>
            </div>
          </div>

          {/* Copyable Link Chip */}
          <div className="owner-gate-url-chip">
            <Icon.Globe size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />
            <span className="owner-gate-url-text" title={mobileUrl}>
              {mobileUrl}
            </span>
            <button
              type="button"
              className="owner-gate-copy-btn"
              onClick={handleCopyLink}
              title="Copy mobile link to clipboard"
            >
              {copied ? (
                <span style={{ color: "#34d399", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                  <Icon.Check size={13} /> Copied
                </span>
              ) : (
                <Icon.Copy size={13} />
              )}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="owner-gate-actions">
          <button
            type="button"
            className="owner-gate-btn-staff"
            onClick={handleOfficeLogin}
          >
            <Icon.Building2 size={16} />
            <span>Go to Office Staff Sign In (Desktop)</span>
          </button>

          {onSimulateMobile && (
            <button
              type="button"
              className="owner-gate-btn-preview"
              onClick={onSimulateMobile}
              title="Simulate smartphone screen on desktop for evaluation or testing"
            >
              <Icon.Eye size={15} />
              <span>Simulate Mobile Phone (Preview Mode)</span>
            </button>
          )}
        </div>
      </div>

      <div className="owner-gate-footer">
        Tinaan, City of Naga, Cebu, Philippines
      </div>
    </div>
  );
};
