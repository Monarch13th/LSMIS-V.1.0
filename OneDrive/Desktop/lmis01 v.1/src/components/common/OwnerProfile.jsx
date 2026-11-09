import { useState, useMemo } from "react";
import { Modal, Button } from "../ui";
import { Icon } from "../icons";
import { formatDate, initials, formatSex } from "../../utils/helpers";
import { formatOwnerId as baseFormatOwnerId } from "../../pages/admin/OwnerManagement";

/**
 * Robust formatOwnerId with safe fallback if base formatter fails or owner is null
 */
export const formatOwnerId = (owner, fallbackIndex = 1) => {
  if (!owner) return "REG-001-2026";
  try {
    return baseFormatOwnerId(owner, fallbackIndex);
  } catch (err) {
    const raw = String(owner.id || owner.owner_id || owner.temp_reg_id || "").trim();
    return raw ? `OWN-${raw.slice(0, 8)}` : "REG-001-2026";
  }
};

/**
 * Resolves full registered owner dossier details from any animal/batch/permit item
 * @param {Object} entity - The record containing owner identifiers or name
 * @param {Object} context - { owners, livestock, users }
 * @returns {Object|null} Consolidated owner profile object
 */
export const resolveOwnerProfile = (entity, { owners = [], livestock = [], users = [] } = {}) => {
  if (!entity) return null;

  const entityOwnerId = entity.owner_id || entity.ownerId || entity.animal?.owner_id || entity.id;
  const entityOwnerName =
    entity.owner_name ||
    entity.ownerName ||
    entity.name ||
    entity.animal?.owner_name ||
    (typeof entity.owner === "string" ? entity.owner : entity.owner?.name);
  const entityEmail = entity.email || entity.owner_email || entity.owner?.email;
  const entityContact = entity.contact || entity.phone || entity.owner_contact || entity.owner?.contact;
  const entityAddress = entity.owner_address || entity.address || entity.owner?.address;
  const entityAvatar = entity.owner_avatar || entity.avatar_url || entity.avatar || entity.owner?.avatar_url;

  let matchedOwner = null;

  if (Array.isArray(owners) && owners.length > 0) {
    if (entityOwnerId) {
      const targetIdStr = String(entityOwnerId).trim().toLowerCase();
      matchedOwner = owners.find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || o.temp_reg_id || "").trim().toLowerCase();
        return oId === targetIdStr || oOwnerId === targetIdStr;
      });
    }

    if (!matchedOwner && entityOwnerName && entityOwnerName !== "Unknown Owner") {
      const targetName = String(entityOwnerName).trim().toLowerCase();
      matchedOwner = owners.find((o) => String(o.name || "").trim().toLowerCase() === targetName);
    }

    if (!matchedOwner && entityEmail) {
      const targetEmail = String(entityEmail).trim().toLowerCase();
      matchedOwner = owners.find((o) => String(o.email || "").trim().toLowerCase() === targetEmail);
    }
  }

  // Look for matching user to grab avatar or enriched email
  let matchedUser = null;
  if (Array.isArray(users) && users.length > 0) {
    const searchId = matchedOwner?.id || entityOwnerId;
    const searchEmail = (matchedOwner?.email || entityEmail || "").trim().toLowerCase();
    matchedUser = users.find((u) => {
      const uId = String(u.id || u.owner_id || "").trim().toLowerCase();
      const uEmail = String(u.email || "").trim().toLowerCase();
      return (
        (searchId && uId === String(searchId).trim().toLowerCase()) ||
        (searchEmail && searchEmail.length > 2 && uEmail === searchEmail)
      );
    });
  }

  const finalAvatar = matchedOwner?.avatar_url || matchedUser?.avatar_url || entityAvatar || null;

  return {
    ...(matchedOwner || {}),
    id: matchedOwner?.id || entityOwnerId || entity.id || null,
    owner_id: matchedOwner?.owner_id || matchedOwner?.temp_reg_id || entityOwnerId || null,
    name: matchedOwner?.name || entityOwnerName || "Unknown Owner",
    contact: matchedOwner?.contact || matchedOwner?.phone || entityContact || "—",
    email: matchedOwner?.email || matchedUser?.email || entityEmail || "—",
    address: matchedOwner?.address || entityAddress || "—",
    status: matchedOwner?.status || "Approved",
    avatar_url: finalAvatar,
    registered_date: matchedOwner?.registered_date || matchedOwner?.created_at || entity.created_at || null,
    created_at: matchedOwner?.created_at || entity.created_at || null,
  };
};

/**
 * Filter all livestock belonging to an owner
 */
export const getOwnerLivestock = (owner, livestockList = []) => {
  if (!owner || !Array.isArray(livestockList)) return [];

  const ownerIdStr = String(owner.id || "").toLowerCase().trim();
  const ownerAltIdStr = String(owner.owner_id || owner.temp_reg_id || "").toLowerCase().trim();
  const formattedId = formatOwnerId(owner).toLowerCase().trim();
  const ownerNameStr = String(owner.name || "").toLowerCase().trim();

  return livestockList.filter((l) => {
    const lOwnerId = String(l.owner_id || "").toLowerCase().trim();
    const lOwnerName = String(l.owner_name || "").toLowerCase().trim();

    if (ownerIdStr && lOwnerId === ownerIdStr) return true;
    if (ownerAltIdStr && lOwnerId === ownerAltIdStr) return true;
    if (formattedId && lOwnerId === formattedId) return true;
    if (ownerNameStr && ownerNameStr !== "unknown owner" && lOwnerName === ownerNameStr) return true;
    return false;
  });
};

/**
 * Owner Profile Card (Compact or Expanded)
 */
export const OwnerProfileCard = ({
  owner,
  compact = false,
  onOpenModal,
  style = {},
  className = "",
}) => {
  const [avatarError, setAvatarError] = useState(false);

  if (!owner) return null;

  const displayId = formatOwnerId(owner);
  const isApproved = String(owner.status || "Approved").toLowerCase() === "approved";
  const avatarUrl = !avatarError && owner.avatar_url ? owner.avatar_url : null;

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        padding: compact ? "10px 14px" : "14px 18px",
        background: "var(--color-surface, #ffffff)",
        borderRadius: 10,
        border: "1px solid var(--color-border)",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {/* Avatar / Initials */}
        <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={owner.name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                objectFit: "cover",
                border: "1.5px solid var(--color-border)",
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 13,
                boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
              }}
            >
              {initials(owner.name || "Owner")}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                color: "var(--color-text)",
                letterSpacing: "-0.01em",
              }}
            >
              {owner.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#0ea5e9",
                background: "rgba(14, 165, 233, 0.12)",
                padding: "1px 6px",
                borderRadius: 4,
                fontWeight: 700,
              }}
            >
              {displayId}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 5,
                background: isApproved ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)",
                color: isApproved ? "#10b981" : "#f59e0b",
              }}
            >
              {owner.status || "Approved"}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 4,
              fontSize: 11.5,
              color: "var(--color-text-muted)",
              flexWrap: "wrap",
            }}
          >
            {owner.contact && owner.contact !== "—" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon.Phone size={12} style={{ color: "#0ea5e9" }} />
                <span>{owner.contact}</span>
              </span>
            )}
            {owner.address && owner.address !== "—" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: 260,
                }}
                className="truncate"
                title={owner.address}
              >
                <Icon.MapPin size={12} style={{ color: "#f59e0b" }} />
                <span className="truncate">{owner.address}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action / Dossier trigger */}
      {onOpenModal && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenModal(owner)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            padding: "5px 11px",
            borderColor: "var(--color-border)",
            flexShrink: 0,
          }}
        >
          <Icon.User size={13} style={{ color: "#0ea5e9" }} />
          <span>View Owner Dossier</span>
        </Button>
      )}
    </div>
  );
};

/**
 * Standardized Owner Profile Dossier Modal
 */
const getLivestockStatusStyle = (status) => {
  const s = String(status || "").toLowerCase();
  if (s.includes("condemn") || s.includes("reject") || s.includes("discard")) {
    return {
      background: "rgba(239, 68, 68, 0.12)",
      color: "#dc2626",
      border: "1px solid rgba(239, 68, 68, 0.3)",
    };
  }
  if (s.includes("weighed") || s.includes("permit issued") || s.includes("completed") || s.includes("dispatch") || s.includes("passed")) {
    return {
      background: "rgba(16, 185, 129, 0.12)",
      color: "#16a34a",
      border: "1px solid rgba(16, 185, 129, 0.3)",
    };
  }
  if (s.includes("inspection") || s.includes("processing") || s.includes("ante-mortem") || s.includes("post-mortem") || s.includes("slaughter")) {
    return {
      background: "rgba(59, 130, 246, 0.12)",
      color: "#2563eb",
      border: "1px solid rgba(59, 130, 246, 0.3)",
    };
  }
  return {
    background: "rgba(245, 158, 11, 0.12)",
    color: "#d97706",
    border: "1px solid rgba(245, 158, 11, 0.3)",
  };
};

export const OwnerProfileModal = ({ open, onClose, owner, livestock = [] }) => {
  const [avatarError, setAvatarError] = useState(false);

  const ownerAnimals = useMemo(() => {
    return getOwnerLivestock(owner, livestock);
  }, [owner, livestock]);

  if (!open || !owner) return null;

  const displayId = formatOwnerId(owner);
  const isApproved = String(owner.status || "Approved").toLowerCase() === "approved";
  const avatarUrl = !avatarError && owner.avatar_url ? owner.avatar_url : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Owner Dossier - ${owner.name || "Livestock Owner"}`}
      size="lg"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="outline" size="sm" onClick={onClose} style={{ minWidth: 80, fontWeight: 700 }}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Profile Header Banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            background: "var(--color-bg)",
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={owner.name}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 15,
                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.3)",
                  }}
                >
                  {initials(owner.name || "Owner")}
                </div>
              )}
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--color-text)" }}>
                {owner.name}
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span
                  style={{
                    fontSize: 11.5,
                    fontFamily: "monospace",
                    color: "#0ea5e9",
                    background: "rgba(14, 165, 233, 0.12)",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontWeight: 700,
                  }}
                >
                  {displayId}
                </span>
                {owner.id && (
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    System ID: {owner.id}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              background: isApproved ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)",
              color: isApproved ? "#10b981" : "#f59e0b",
              border: `1px solid ${isApproved ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isApproved ? "#10b981" : "#f59e0b",
              }}
            />
            {owner.status || "Approved"}
          </span>
        </div>

        {/* 4-Stat Particulars Card */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon.Phone size={12} style={{ color: "#0ea5e9" }} /> Contact Number
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text)",
                marginTop: 4,
                fontFamily: "monospace",
              }}
            >
              {owner.contact || "—"}
            </div>
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon.Mail size={12} style={{ color: "#a855f7" }} /> Account Email
            </div>
            <div
              style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginTop: 4 }}
              className="truncate"
              title={owner.email}
            >
              {owner.email || "—"}
            </div>
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon.MapPin size={12} style={{ color: "#f59e0b" }} /> Address
            </div>
            <div
              style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", marginTop: 4 }}
              className="truncate"
              title={owner.address}
            >
              {owner.address || "—"}
            </div>
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon.Calendar size={12} style={{ color: "#10b981" }} /> Registration Date
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", marginTop: 4 }}>
              {formatDate(owner.registered_date || owner.created_at) || "—"}
            </div>
          </div>
        </div>

        {/* Livestock Table Section */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
              padding: "0 2px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 800,
                color: "var(--color-text)",
              }}
            >
              <Icon.Cow size={15} style={{ color: "#10b981" }} />
              <span>Tracked Livestock in Abattoir ({ownerAnimals.length} Heads)</span>
            </div>
          </div>

          {ownerAnimals.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                border: "1px dashed var(--color-border)",
                borderRadius: 10,
                background: "var(--color-bg)",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>🐾</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                No livestock registered yet
              </div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0 0" }}>
                This owner does not have any active livestock in the abattoir queue.
              </p>
            </div>
          ) : (
            <div
              style={{
                maxHeight: 240,
                overflowY: "auto",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
              }}
            >
              <table className="table" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--color-bg)" }}>
                    <th style={{ padding: "8px 12px", fontSize: 11 }}>Tag Number</th>
                    <th style={{ padding: "8px 12px", fontSize: 11 }}>Species</th>
                    <th style={{ padding: "8px 12px", fontSize: 11 }}>Sex</th>
                    <th style={{ padding: "8px 12px", fontSize: 11 }}>Breed</th>
                    <th style={{ padding: "8px 12px", fontSize: 11, textAlign: "center" }}>Weight</th>
                    <th style={{ padding: "8px 12px", fontSize: 11, textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                      {ownerAnimals.map((a, idx) => {
                        const stStyle = getLivestockStatusStyle(a.status || a.health_status);
                        return (
                          <tr
                            key={a.id || a.tag_number || idx}
                            style={{
                              borderBottom: "1px solid var(--color-border, #f1f5f9)",
                              background: idx % 2 === 0 ? "transparent" : "var(--color-surface-subtle, #fcfcfc)",
                            }}
                          >
                            <td style={{ padding: "8px 12px", fontWeight: 700, fontFamily: "monospace", color: "var(--color-text)" }}>
                              {a.tag_number || a.id}
                            </td>
                            <td style={{ padding: "8px 12px", color: "var(--color-text)" }}>
                              <span>{a.species || "—"}</span>
                            </td>
                            <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--color-text)" }}>
                              {formatSex(a.sex)}
                            </td>
                            <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>
                              {a.breed || "Standard"}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: a.weight ? 700 : 500, color: a.weight ? "var(--color-text)" : "var(--color-text-muted)" }}>
                              {a.weight ? `${a.weight} kg` : "Pending scale"}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  lineHeight: 1.25,
                                  maxWidth: 180,
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  ...stStyle,
                                }}
                              >
                                {a.status || a.health_status || "Registered"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default OwnerProfileCard;

