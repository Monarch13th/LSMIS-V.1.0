import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Select, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { Modal, ConfirmDialog } from "../ui/Modal";
import { getCurrentActor } from "../../utils/processHistory";
import { formatSex } from "../../utils/formatters";
import { scrollToFirstError } from "../../utils/formValidation";

const CheckboxWithIndeterminate = ({ checked, indeterminate, onChange, style, id, disabled, title }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      id={id}
      type="checkbox"
      ref={ref}
      checked={Boolean(checked)}
      disabled={disabled}
      title={title}
      onChange={onChange}
      style={{
        width: 17,
        height: 17,
        accentColor: "var(--color-primary, #0284c7)",
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    />
  );
};

export const CARCASS_AREAS = [
  "Head",
  "Shoulder Meat",
  "Left Front Leg",
  "Right Front Leg",
  "Left Hind Leg",
  "Right Hind Leg",
  "Carcass Body"
];

export const SPECIFIC_PARTS_BY_AREA = {
  "Head": [
    "Right Cheek",
    "Left Cheek",
    "Jaw Lymph Nodes",
    "Whole Head",
    "Other"
  ],
  "Shoulder Meat": [
    "Right Shoulder",
    "Left Shoulder",
    "Right Upper Shoulder",
    "Left Upper Shoulder",
    "Other"
  ],
  "Left Front Leg": [
    "Elbow",
    "Front Knee",
    "Upper Front Leg",
    "Lower Front Leg / Hoof",
    "Other"
  ],
  "Right Front Leg": [
    "Elbow",
    "Front Knee",
    "Upper Front Leg",
    "Lower Front Leg / Hoof",
    "Other"
  ],
  "Left Hind Leg": [
    "Hock",
    "Back Knee",
    "Upper Hind Leg",
    "Lower Hind Leg / Hoof",
    "Other"
  ],
  "Right Hind Leg": [
    "Hock",
    "Back Knee",
    "Upper Hind Leg",
    "Lower Hind Leg / Hoof",
    "Other"
  ],
  "Carcass Body": [
    "Back",
    "Belly",
    "Chest",
    "Ribs",
    "Other"
  ]
};

export const CONDEMNED_PARTS_LIST = CARCASS_AREAS;

export const createNewCut = (area = "Head") => {
  const defaultArea = CARCASS_AREAS.includes(area) ? area : CARCASS_AREAS[0];
  const defaultSpecific = SPECIFIC_PARTS_BY_AREA[defaultArea]?.[0] || "Other";
  return {
    id: Date.now() + Math.random(),
    carcassArea: defaultArea,
    part: defaultArea,
    specificPart: defaultSpecific,
    customSpecificPart: "",
    location: defaultSpecific,
    weight: "",
    reason: CONDEMNED_REASONS_LIST[0],
    customReason: "",
    photo: null,
    photoName: "",
    photos: [],
    disposition: "Condemned / Rendered",
  };
};

export const CONDEMNED_REASONS_LIST = [
  "Abnormal Appearance",
  "Wounds or Lesions",
  "Parasites",
  "Signs of Disease",
  "Other (Specify)"
];

export const isOtherReason = (r) => {
  if (!r) return false;
  const s = String(r).trim().toLowerCase();
  return s === "other" || s === "other (specify)" || s === "other reason" || s.startsWith("other");
};

export const DISPOSITION_OPTIONS = [
  "Condemned / Rendered",
  "Incinerated",
  "Denatured / Buried",
  "Disposed of as Offal"
];

export const CONDEMNED_LOCATIONS = [
  "Left Quarter",
  "Right Quarter",
  "Thoracic Cavity",
  "Abdominal Cavity",
  "Offal / Viscera",
  "Head / Neck",
  "Carcass Surface",
  "General / Unspecified"
];

export const ANTE_CONDEMNED_REASONS = [
  "Dead on arrival",
  "Too sick or feverish",
  "Severely injured",
  "Unable to stand",
  "Other reason"
];

const ANTE_APPROVED_PRESETS = [
  "Normal vital signs, active and normal behavior, no gait abnormalities, fit for slaughter",
];

const ANTE_APPROVED_PRESET_CARDS = [
  {
    title: "Normal & Active",
    subtitle: "Active behavior, normal vitals, no gait defects — fit for slaughter",
    value: ANTE_APPROVED_PRESETS[0],
    iconName: "Check",
  },
];

const ANTE_CONDEMNED_PRESETS = [
  "Emaciation / Disease symptoms detected, unfit for slaughter (Condemned)",
  "Severe trauma / Moribund condition, unfit for slaughter (Condemned)",
  "Suspect infectious disease detected, moribund state, condemned",
  "High fever and systemic symptoms observed, unfit for slaughter (Condemned)",
];

const POST_APPROVED_PRESETS = [
  "No pathological lesions found, organs and carcass normal, fit for human consumption",
];

const POST_APPROVED_PRESET_CARDS = [
  {
    title: "Normal & Sound",
    subtitle: "No lesions, organs and carcass normal, passed fit for human consumption",
    value: POST_APPROVED_PRESETS[0],
    iconName: "Check",
  },
];

const POST_CONDEMNED_PRESETS = [
  "Systemic septicemic lesions, whole carcass and all organs condemned",
  "Severe generalized pathology detected, totally unfit for human consumption (Condemned)",
  "Extensive generalized granulomatous / tuberculosis lesions, whole carcass condemned",
  "Generalized jaundice / icterus and septicemia, totally condemned",
];

const compressImageToDataUrl = (file, maxDim = 1200, quality = 0.82) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

export const MultiEvidenceUploader = ({ photos = [], onChange, label = "Evidence Photos", hasError = false }) => {
  const { showToast } = useToast();
  const [previewPhoto, setPreviewPhoto] = useState(null);

  const MAX_PHOTOS = 3;
  const currentCount = (photos || []).length;
  const availableSlots = MAX_PHOTOS - currentCount;
  const isFull = currentCount >= MAX_PHOTOS;
  const showError = hasError && currentCount === 0;

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (availableSlots <= 0) {
      showToast("Maximum of 3 photos reached for this condemnation record.", "warning");
      e.target.value = "";
      return;
    }

    const validPhotos = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        showToast(`File "${file.name}" is not an image (JPG, PNG, WebP supported).`, "warning");
        continue;
      }
      if (file.size > 15 * 1024 * 1024) {
        showToast(`File "${file.name}" exceeds maximum size of 15MB.`, "warning");
        continue;
      }
      const dataUrl = await compressImageToDataUrl(file);
      if (!dataUrl) continue;

      validPhotos.push({
        id: Date.now() + Math.random(),
        file,
        name: file.name,
        size: file.size,
        preview: dataUrl,
        dataUrl,
        url: dataUrl,
      });
    }

    if (validPhotos.length > availableSlots) {
      showToast(`Maximum 3 photos allowed. Only ${availableSlots} photo(s) added to reach 3/3.`, "info");
    }

    const accepted = validPhotos.slice(0, availableSlots);
    if (accepted.length > 0) {
      onChange([...(photos || []), ...accepted]);
    }
    e.target.value = "";
  };

  const removePhoto = (photoId) => {
    onChange((photos || []).filter((p) => p.id !== photoId));
  };

  const formatSize = (bytes) => {
    if (!bytes) return "";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: showError ? "#fff5f5" : "#f8fafc", border: isFull ? "1px solid #cbd5e1" : showError ? "1.5px dashed #fca5a5" : "1px dashed #cbd5e1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.Camera size={14} style={{ color: isFull ? "#059669" : showError ? "#dc2626" : "#0284c7" }} />
          <span>{label}</span>
          <span style={{ color: "#ef4444" }}>*</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 999,
              background: isFull ? "#ecfdf5" : currentCount > 0 ? "#e0f2fe" : showError ? "#fee2e2" : "#f1f5f9",
              color: isFull ? "#059669" : currentCount > 0 ? "#0284c7" : showError ? "#dc2626" : "#64748b",
              border: isFull ? "1px solid #a7f3d0" : currentCount > 0 ? "1px solid #bae6fd" : showError ? "1px solid #fca5a5" : "1px solid #e2e8f0",
            }}
          >
            {currentCount}/{MAX_PHOTOS} Photos
          </span>
        </label>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 6,
            background: isFull ? "#94a3b8" : showError ? "#dc2626" : "#0284c7",
            color: "#ffffff",
            fontSize: 11.5,
            fontWeight: 700,
            cursor: isFull ? "not-allowed" : "pointer",
            boxShadow: isFull ? "none" : "0 1px 3px rgba(2, 132, 199, 0.2)",
            opacity: isFull ? 0.75 : 1,
            pointerEvents: isFull ? "none" : "auto",
          }}
          title={isFull ? "Maximum of 3 photos reached." : "Click to select evidence photos"}
        >
          <Icon.Upload size={13} />
          <span>{isFull ? "3/3 Max Reached" : "Add Evidence Photos"}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/jpg"
            multiple
            disabled={isFull}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {showError && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#dc2626", marginTop: 4, marginBottom: 4, display: "flex", alignItems: "center", gap: 6, background: "#fee2e2", padding: "6px 10px", borderRadius: 6, border: "1px solid #fca5a5" }}>
          <Icon.AlertTriangle size={14} /> At least 1 evidence photo is required for this condemnation before certifying.
        </div>
      )}

      {photos && photos.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, marginTop: 10 }}>
          {photos.map((photo) => (
            <div
              key={photo.id || photo.name}
              style={{
                position: "relative",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #cbd5e1",
                background: "#0f172a",
                height: 96,
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
              }}
              onClick={() => setPreviewPhoto(photo)}
              title="Click to preview enlarged photo"
            >
              <img
                src={photo.preview || photo.url}
                alt={photo.name}
                style={{ width: "100%", height: 72, objectFit: "cover" }}
              />
              <div
                style={{
                  padding: "2px 6px",
                  background: "#1e293b",
                  color: "#cbd5e1",
                  fontSize: 9.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span style={{ textOverflow: "ellipsis", overflow: "hidden" }}>{photo.name}</span>
                {photo.size ? <span style={{ color: "#94a3b8", marginLeft: 4 }}>{formatSize(photo.size)}</span> : null}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removePhoto(photo.id);
                }}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(239, 68, 68, 0.9)",
                  color: "#ffffff",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  zIndex: 2,
                }}
                title="Remove photo"
              >
                <Icon.X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "#94a3b8", textAlign: "center", padding: "6px 0" }}>
          No evidence photos attached (0/3). You can upload 1, 2, or up to 3 photos.
        </div>
      )}

      {isFull && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#059669", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon.CheckCircle size={13} color="#059669" />
          <span>Maximum of 3 photos reached. Remove an existing photo to upload another.</span>
        </div>
      )}

      {/* Lightbox Image Preview Modal */}
      {previewPhoto && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: 700,
              width: "100%",
              backgroundColor: "#0f172a",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#1e293b", color: "#ffffff" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8" }}>
                {previewPhoto.name} {photos && photos.length > 1 ? `(Photo ${photos.findIndex((p) => (p.id || p.name) === (previewPhoto.id || previewPhoto.name)) + 1} of ${photos.length})` : ""}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                style={{ background: "transparent", border: "none", color: "#ffffff", cursor: "pointer" }}
              >
                <Icon.X size={18} />
              </button>
            </div>
            <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", height: 380, maxHeight: "55vh", background: "#020617", padding: 12 }}>
              <img src={previewPhoto.preview || previewPhoto.url} alt={previewPhoto.name} style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            </div>

            {/* Thumbnail selector gallery if multiple photos */}
            {photos && photos.length > 1 && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center", padding: "10px 16px", background: "#0f172a", borderTop: "1px solid #1e293b" }}>
                {photos.map((p, idx) => {
                  const isSelected = (p.id || p.name) === (previewPhoto.id || previewPhoto.name);
                  return (
                    <div
                      key={p.id || p.name || idx}
                      onClick={() => setPreviewPhoto(p)}
                      style={{
                        width: 64,
                        height: 52,
                        borderRadius: 6,
                        overflow: "hidden",
                        border: isSelected ? "2.5px solid #38bdf8" : "1px solid #334155",
                        cursor: "pointer",
                        position: "relative",
                        background: "#020617",
                        boxShadow: isSelected ? "0 0 8px rgba(56, 189, 248, 0.5)" : "none",
                      }}
                    >
                      <img src={p.preview || p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: isSelected ? "#0284c7" : "rgba(15,23,42,0.8)", color: "#fff", fontSize: 8.5, fontWeight: 700, textAlign: "center", padding: "1px 0" }}>
                        Photo {idx + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const InspectionForm = ({
  type,
  livestock = [],
  initialTag = "",
  decision: propDecision,
  onDecisionChange,
  onSubmit,
  onCancel,
}) => {
  const { showToast } = useToast();
  const [selectedSingleTag, setSelectedSingleTag] = useState(initialTag || "");
  const [internalDecision, setInternalDecision] = useState(propDecision || "Approved");
  const decision = propDecision !== undefined ? propDecision : internalDecision;
  const setDecision = onDecisionChange || setInternalDecision;

  // Itemized condemned animals/carcasses state (Ante-Mortem & Whole Carcass Post-Mortem)
  const [anteCondemned, setAnteCondemned] = useState(() => {
    if ((propDecision || "Approved") === "Condemned") {
      const splitTags = String(initialTag || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (splitTags.length > 0) {
        const defaultReason = type === "Post-Mortem" ? CONDEMNED_REASONS_LIST[0] : ANTE_CONDEMNED_REASONS[0];
        const defaultPreset = type === "Post-Mortem" ? POST_CONDEMNED_PRESETS[0] : ANTE_CONDEMNED_PRESETS[0];
        return splitTags.map((tag) => ({
          id: Date.now() + Math.random(),
          tag_number: tag,
          reason: defaultReason,
          findings: defaultPreset,
          customReason: "",
          photos: [],
        }));
      }
    }
    return [];
  });

  // Multi-animal & multi-part Partial Condemnation state (Post-Mortem)
  const [partialAnimals, setPartialAnimals] = useState(() => {
    if ((propDecision || "") === "Partial") {
      const splitTags = String(initialTag || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (splitTags.length > 0) {
        return splitTags.map((tag) => ({
          id: Date.now() + Math.random(),
          tag_number: tag,
          parts: [createNewCut(CARCASS_AREAS[0])],
        }));
      }
    }
    return [];
  });

  const [selectedBatchTags, setSelectedBatchTags] = useState(() => {
    if ((propDecision || "Approved") === "Condemned" || (propDecision || "") === "Partial") {
      return [];
    }
    if (initialTag) {
      return String(initialTag)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return (livestock || []).map((l) => l.tag_number).filter(Boolean);
  });

  const [findings, setFindings] = useState(() => {
    if (decision === "Condemned") {
      return type === "Ante-Mortem" ? ANTE_CONDEMNED_PRESETS[0] : POST_CONDEMNED_PRESETS[0];
    }
    if (decision === "Partial") {
      return "Passed with Partial Condemnation";
    }
    return type === "Ante-Mortem" ? ANTE_APPROVED_PRESETS[0] : POST_APPROVED_PRESETS[0];
  });
  const [remarks, setRemarks] = useState("");
  const [validationErrors, setValidationErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formAlert, setFormAlert] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [activeExpandedOwner, setActiveExpandedOwner] = useState(null);
  const hasInitializedRef = useRef(false);

  const navigateToValidationError = (missingItems, errors) => {
    setValidationErrors(errors);
    setAttemptedSubmit(true);
    if (!missingItems || missingItems.length === 0) return;
    const first = missingItems[0];
    if (first.message) {
      showToast(first.message, "warning");
    }
    if (first.fieldId) {
      scrollToFirstError(first.fieldId, {
        offset: 110,
        delay: 90,
        onExpand: (targetEl) => {
          const ownerCard = targetEl.closest("[data-owner-name]");
          if (ownerCard) {
            const ownerName = ownerCard.getAttribute("data-owner-name");
            if (ownerName) setActiveExpandedOwner(ownerName);
          }
        },
      });
    }
  };

  // Get all tags currently selected or targeted across decisions without losing context
  const getCurrentSelectedTags = useCallback(() => {
    if (decision === "Condemned" && anteCondemned.length > 0) {
      return anteCondemned.map((c) => String(c.tag_number || "").trim()).filter(Boolean);
    }
    if (decision === "Partial" && partialAnimals.length > 0) {
      return partialAnimals.map((a) => String(a.tag_number || "").trim()).filter(Boolean);
    }
    if (selectedBatchTags.length > 0) {
      return selectedBatchTags.map((t) => String(t || "").trim()).filter(Boolean);
    }
    if (selectedSingleTag) {
      return [selectedSingleTag.trim()];
    }
    if (initialTag) {
      return String(initialTag)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return [];
  }, [decision, anteCondemned, partialAnimals, selectedBatchTags, selectedSingleTag, initialTag]);

  // Robust, tag-preserving category switching (Fit for Consumption <-> Condemned <-> Partially Condemned)
  const handleSelectDecision = useCallback((val) => {
    if (!val) return;
    setDecision(val);
    setInternalDecision(val);

    const activeTags = getCurrentSelectedTags();

    if (type === "Ante-Mortem") {
      if (val === "Approved") {
        setFindings(ANTE_APPROVED_PRESETS[0]);
        if (activeTags.length > 0) {
          setSelectedBatchTags(activeTags);
          setAnteCondemned([]);
        }
      } else if (val === "Condemned") {
        setFindings(ANTE_CONDEMNED_PRESETS[0]);
        if (activeTags.length > 0) {
          setSelectedBatchTags([]);
          const defaultReason = ANTE_CONDEMNED_REASONS[0];
          const defaultPreset = ANTE_CONDEMNED_PRESETS[0];
          setAnteCondemned(
            activeTags.map((tag) => ({
              id: Date.now() + Math.random(),
              tag_number: tag,
              reason: defaultReason,
              findings: defaultPreset,
              customReason: "",
              photos: [],
            }))
          );
        }
      }
    } else {
      // Post-Mortem
      if (val === "Approved") {
        setFindings(POST_APPROVED_PRESETS[0]);
        if (activeTags.length > 0) {
          setSelectedBatchTags(activeTags);
          setAnteCondemned([]);
          setPartialAnimals([]);
        }
      } else if (val === "Partial") {
        setFindings("Passed with Partial Condemnation");
        if (activeTags.length > 0) {
          setSelectedBatchTags([]);
          setAnteCondemned([]);
          setPartialAnimals(
            activeTags.map((tag) => ({
              id: Date.now() + Math.random(),
              tag_number: tag,
              parts: [createNewCut(CARCASS_AREAS[0])],
            }))
          );
        }
      } else if (val === "Condemned") {
        setFindings(POST_CONDEMNED_PRESETS[0]);
        if (activeTags.length > 0) {
          setSelectedBatchTags([]);
          setPartialAnimals([]);
          const defaultReason = CONDEMNED_REASONS_LIST[0];
          const defaultPreset = POST_CONDEMNED_PRESETS[0];
          setAnteCondemned(
            activeTags.map((tag) => ({
              id: Date.now() + Math.random(),
              tag_number: tag,
              reason: defaultReason,
              findings: defaultPreset,
              customReason: "",
              photos: [],
            }))
          );
        }
      }
    }
  }, [type, getCurrentSelectedTags, setDecision]);

  useEffect(() => {
    if (propDecision && propDecision !== internalDecision) {
      handleSelectDecision(propDecision);
    }
  }, [propDecision, internalDecision, handleSelectDecision]);

  const handleConfirmSubmit = async () => {
    if (!pendingConfirm || isSaved) return;
    setSubmitting(true);
    try {
      await onSubmit(pendingConfirm.payloadToSubmit);
      setIsSaved(true);
      setFormAlert({
        type: "success",
        message: pendingConfirm.successMessage,
      });
      // Preserve currently inspected record and tag
      setPendingConfirm(null);
    } catch (err) {
      console.error("Error saving inspection:", err);
      if (err?.succeededTags && err.succeededTags.length > 0) {
        const succSet = new Set(err.succeededTags.map((t) => String(t).trim().toLowerCase()));
        setSelectedBatchTags((prev) => prev.filter((t) => !succSet.has(String(t).trim().toLowerCase())));
        setAnteCondemned((prev) => prev.filter((c) => !succSet.has(String(c.tag_number).trim().toLowerCase())));
        setPartialAnimals((prev) => prev.filter((a) => !succSet.has(String(a.tag_number).trim().toLowerCase())));
      }
      setPendingConfirm(null);
      showToast(err.message || "Failed to record inspection", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const isOwnerExpanded = (ownerName) => {
    return Boolean(ownerName && activeExpandedOwner === ownerName);
  };

  const toggleOwnerExpand = (ownerName) => {
    setActiveExpandedOwner((prev) => (prev === ownerName ? null : ownerName));
  };

  const getOwnerInitials = (name) => {
    if (!name || name === "—" || name === "Unknown Owner") return "?";
    return name
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const groupLivestockByOwner = (list) => {
    const groups = {};
    (list || []).forEach((item) => {
      const owner = (item.owner_name && String(item.owner_name).trim()) || "Unknown Owner";
      if (!groups[owner]) {
        groups[owner] = {
          owner_name: owner,
          items: [],
          total: 0,
          maleCount: 0,
          femaleCount: 0,
          unspecifiedCount: 0,
        };
      }
      groups[owner].items.push(item);
      groups[owner].total += 1;

      const rawSex = String(item.sex || item.gender || getAnimalSex(item) || "").trim().toLowerCase();
      if (rawSex === "male" || rawSex === "m") {
        groups[owner].maleCount += 1;
      } else if (rawSex === "female" || rawSex === "f") {
        groups[owner].femaleCount += 1;
      } else {
        groups[owner].unspecifiedCount += 1;
      }
    });
    return Object.values(groups);
  };

  const getAnimalSex = useCallback((animalOrTag) => {
    if (!animalOrTag) return "Not specified";
    if (typeof animalOrTag === "object") {
      if (animalOrTag.sex) return formatSex(animalOrTag.sex);
      if (animalOrTag.gender) return formatSex(animalOrTag.gender);
      const tag = String(animalOrTag.tag_number || "").trim().toLowerCase();
      const match = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === tag);
      if (match?.sex) return formatSex(match.sex);
    }
    const cleanTag = String(animalOrTag).trim().toLowerCase();
    const found = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag);
    return formatSex(found?.sex);
  }, [livestock]);

  // Sync initialTag or livestock tags when provided
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    if (initialTag) {
      const splitTags = String(initialTag)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      setSelectedSingleTag(splitTags[0] || "");
      const match = (livestock || []).find(
        (l) => String(l.tag_number || "").trim().toLowerCase() === String(splitTags[0] || "").toLowerCase()
      );
      if (match?.owner_name) {
        setActiveExpandedOwner(String(match.owner_name).trim());
      } else {
        setActiveExpandedOwner(null);
      }
      if (decision === "Condemned") {
        setSelectedBatchTags([]);
        if (splitTags.length === 1) {
          const defaultReason = type === "Post-Mortem" ? CONDEMNED_REASONS_LIST[0] : ANTE_CONDEMNED_REASONS[0];
          const defaultPreset = type === "Post-Mortem" ? POST_CONDEMNED_PRESETS[0] : ANTE_CONDEMNED_PRESETS[0];
          setAnteCondemned([
            {
              id: Date.now(),
              tag_number: splitTags[0],
              reason: defaultReason,
              findings: defaultPreset,
              customReason: "",
              photos: [],
            },
          ]);
        }
      } else {
        setSelectedBatchTags(splitTags);
        setAnteCondemned([]);
      }
      setPartialAnimals([]);
      if (!propDecision) {
        setInternalDecision("Approved");
      }
      setFindings(() => {
        if (decision === "Condemned") {
          return type === "Ante-Mortem" ? ANTE_CONDEMNED_PRESETS[0] : POST_CONDEMNED_PRESETS[0];
        }
        return type === "Ante-Mortem" ? ANTE_APPROVED_PRESETS[0] : POST_APPROVED_PRESETS[0];
      });
      setRemarks("");
      setValidationErrors({});
      setAttemptedSubmit(false);
      setFormAlert(null);
    } else if (livestock && livestock.length > 0) {
      setSelectedBatchTags((prev) => (prev.length === 0 ? livestock.map((l) => l.tag_number).filter(Boolean) : prev));
      setActiveExpandedOwner(null);
    }
  }, [initialTag, type, livestock]);

  const sortedLivestock = useMemo(() => {
    return [...(livestock || [])].sort((a, b) =>
      (a.tag_number || "").localeCompare(b.tag_number || "", undefined, { numeric: true, sensitivity: "base" })
    );
  }, [livestock]);

  // Set of tags currently marked in whole condemnation entries
  const condemnedTagsSet = useMemo(() => {
    const s = new Set();
    anteCondemned.forEach((c) => {
      const raw = String(c.tag_number || "").trim();
      if (raw) {
        s.add(raw);
        s.add(raw.toLowerCase());
        s.add(raw.toUpperCase());
      }
    });
    return s;
  }, [anteCondemned]);

  // Set of tags currently marked in partial condemnation entries
  const partialTagsSet = useMemo(() => {
    const s = new Set();
    partialAnimals.forEach((a) => {
      const raw = String(a.tag_number || "").trim();
      if (raw) {
        s.add(raw);
        s.add(raw.toLowerCase());
        s.add(raw.toUpperCase());
      }
    });
    return s;
  }, [partialAnimals]);

  // Approved tags strictly excludes any tag selected for whole or partial condemnation
  const approvedTags = useMemo(() => {
    return selectedBatchTags.filter((tag) => {
      const clean = String(tag || "").trim().toLowerCase();
      return clean && !condemnedTagsSet.has(clean) && !partialTagsSet.has(clean);
    });
  }, [selectedBatchTags, condemnedTagsSet, partialTagsSet]);

  const approvedTagsSet = useMemo(() => {
    const s = new Set();
    approvedTags.forEach((t) => {
      const raw = String(t || "").trim();
      if (raw) {
        s.add(raw);
        s.add(raw.toLowerCase());
        s.add(raw.toUpperCase());
      }
    });
    return s;
  }, [approvedTags]);

  const isTagApproved = useCallback((tag) => {
    if (!tag) return false;
    const clean = String(tag).trim().toLowerCase();
    return approvedTagsSet.has(clean);
  }, [approvedTagsSet]);

  const isTagCondemned = useCallback((tag) => {
    if (!tag) return false;
    const clean = String(tag).trim().toLowerCase();
    return condemnedTagsSet.has(clean);
  }, [condemnedTagsSet]);

  const isTagPartial = useCallback((tag) => {
    if (!tag) return false;
    const clean = String(tag).trim().toLowerCase();
    return partialTagsSet.has(clean);
  }, [partialTagsSet]);

  // All active selected tags
  const selectedTags = useMemo(() => {
    if (type === "Post-Mortem" && decision === "Partial") {
      return partialAnimals.map((a) => a.tag_number).filter(Boolean);
    }
    if (decision === "Condemned") {
      return anteCondemned.map((c) => c.tag_number).filter(Boolean);
    }
    const all = [...approvedTags, ...anteCondemned.map((c) => c.tag_number).filter(Boolean)];
    return Array.from(new Set(all));
  }, [type, decision, partialAnimals, approvedTags, anteCondemned]);

  // --- MUTUAL EXCLUSIVITY OPERATORS ---
  // 1. Select for Fit to slaughter / Passed (Approved)
  // Automatically removes from Whole Condemnation and Partial Condemnation
  const selectFitToSlaughter = (tag) => {
    if (!tag) return;
    const clean = String(tag).trim().toLowerCase();
    setSelectedBatchTags((prev) => (prev.some((t) => String(t).trim().toLowerCase() === clean) ? prev : [...prev, tag]));
    setAnteCondemned((prev) => prev.filter((c) => String(c.tag_number).trim().toLowerCase() !== clean));
    setPartialAnimals((prev) => prev.filter((a) => String(a.tag_number).trim().toLowerCase() !== clean));
  };

  const deselectFitToSlaughter = (tag) => {
    const clean = String(tag).trim().toLowerCase();
    setSelectedBatchTags((prev) => prev.filter((t) => String(t).trim().toLowerCase() !== clean));
  };

  const toggleBatchTag = (tag) => {
    if (isTagApproved(tag)) {
      deselectFitToSlaughter(tag);
    } else {
      selectFitToSlaughter(tag);
    }
  };

  // 2. Select for Whole Condemnation
  // Automatically removes from Fit to Slaughter and Partial Condemnation
  const selectCondemned = (tag) => {
    if (!tag) return;
    const clean = String(tag).trim().toLowerCase();
    setSelectedBatchTags((prev) => prev.filter((t) => String(t).trim().toLowerCase() !== clean));
    setPartialAnimals((prev) => prev.filter((a) => String(a.tag_number).trim().toLowerCase() !== clean));
    const defaultReason = type === "Post-Mortem" ? CONDEMNED_REASONS_LIST[0] : ANTE_CONDEMNED_REASONS[0];
    const defaultPreset = type === "Post-Mortem" ? POST_CONDEMNED_PRESETS[0] : ANTE_CONDEMNED_PRESETS[0];
    setAnteCondemned((prev) => {
      if (prev.some((c) => String(c.tag_number).trim().toLowerCase() === clean)) return prev;
      return [
        ...prev,
        {
          id: Date.now() + Math.random(),
          tag_number: tag,
          reason: defaultReason,
          findings: defaultPreset,
          customReason: "",
          photos: [],
        },
      ];
    });
  };

  const deselectCondemned = (tag) => {
    const clean = String(tag).trim().toLowerCase();
    setAnteCondemned((prev) => prev.filter((c) => String(c.tag_number).trim().toLowerCase() !== clean));
  };

  const toggleCondemnedBatchTag = (tag) => {
    if (isTagCondemned(tag)) {
      deselectCondemned(tag);
    } else {
      selectCondemned(tag);
    }
  };

  // 3. Select for Partial Condemnation (Post-Mortem)
  // Automatically removes from Fit to Slaughter and Whole Condemnation
  const selectPartial = (tag) => {
    if (!tag) return;
    const clean = String(tag).trim().toLowerCase();
    setSelectedBatchTags((prev) => prev.filter((t) => String(t).trim().toLowerCase() !== clean));
    setAnteCondemned((prev) => prev.filter((c) => String(c.tag_number).trim().toLowerCase() !== clean));
    setPartialAnimals((prev) => {
      if (prev.some((a) => String(a.tag_number).trim().toLowerCase() === clean)) return prev;
      return [
        ...prev,
        {
          id: Date.now() + Math.random(),
          tag_number: tag,
          parts: [createNewCut(CARCASS_AREAS[0])],
        },
      ];
    });
  };

  const deselectPartial = (tag) => {
    const clean = String(tag).trim().toLowerCase();
    setPartialAnimals((prev) => prev.filter((a) => String(a.tag_number).trim().toLowerCase() !== clean));
  };

  const togglePartialTag = (tag) => {
    if (isTagPartial(tag)) {
      deselectPartial(tag);
    } else {
      selectPartial(tag);
    }
  };

  // Filtered livestock lists for each view - STRICT ISOLATION
  // 1. When in Fit for Slaughter / Consumption (Approved):
  // Do NOT show animals that are in Condemnation or Partial
  const displayedApprovedLivestock = useMemo(() => {
    return sortedLivestock.filter((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !condemnedTagsSet.has(clean) && !partialTagsSet.has(clean);
    });
  }, [sortedLivestock, condemnedTagsSet, partialTagsSet]);

  // 2. When in Condemnation (Condemned):
  // Do NOT show animals that are in Fit for Slaughter / Consumption or Partial
  const displayedCondemnedLivestock = useMemo(() => {
    return sortedLivestock.filter((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !approvedTagsSet.has(clean) && !partialTagsSet.has(clean);
    });
  }, [sortedLivestock, approvedTagsSet, partialTagsSet]);

  // 3. When in Partial Condemnation (Post-Mortem):
  // Do NOT show animals that are in Fit for Consumption or Whole Condemnation
  const displayedPartialLivestock = useMemo(() => {
    return sortedLivestock.filter((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !approvedTagsSet.has(clean) && !condemnedTagsSet.has(clean);
    });
  }, [sortedLivestock, approvedTagsSet, condemnedTagsSet]);

  // Owner-level selection toggles (select/deselect all livestock for an owner)
  const toggleOwnerApproved = (grp) => {
    const grpTags = (grp.items || []).map((a) => a.tag_number).filter(Boolean);
    const allSelected = grpTags.length > 0 && grpTags.every((t) => isTagApproved(t));
    const grpTagsLower = new Set(grpTags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setSelectedBatchTags((prev) => prev.filter((t) => !grpTagsLower.has(String(t).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => {
        const existingLower = new Set(prev.map((t) => String(t).trim().toLowerCase()));
        const toAdd = grpTags.filter((t) => !existingLower.has(String(t).trim().toLowerCase()));
        return [...prev, ...toAdd];
      });
      setAnteCondemned((prev) => prev.filter((c) => !grpTagsLower.has(String(c.tag_number).trim().toLowerCase())));
      setPartialAnimals((prev) => prev.filter((a) => !grpTagsLower.has(String(a.tag_number).trim().toLowerCase())));
    }
  };

  const toggleOwnerCondemned = (grp) => {
    const grpTags = (grp.items || []).map((a) => a.tag_number).filter(Boolean);
    const allSelected = grpTags.length > 0 && grpTags.every((t) => isTagCondemned(t));
    const grpTagsLower = new Set(grpTags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setAnteCondemned((prev) => prev.filter((c) => !grpTagsLower.has(String(c.tag_number).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => prev.filter((t) => !grpTagsLower.has(String(t).trim().toLowerCase())));
      setPartialAnimals((prev) => prev.filter((a) => !grpTagsLower.has(String(a.tag_number).trim().toLowerCase())));
      const defaultReason = type === "Post-Mortem" ? CONDEMNED_REASONS_LIST[0] : ANTE_CONDEMNED_REASONS[0];
      const defaultPreset = type === "Post-Mortem" ? POST_CONDEMNED_PRESETS[0] : ANTE_CONDEMNED_PRESETS[0];
      setAnteCondemned((prev) => {
        const existingLower = new Set(prev.map((c) => String(c.tag_number).trim().toLowerCase()));
        const toAdd = grpTags
          .filter((t) => !existingLower.has(String(t).trim().toLowerCase()))
          .map((t, idx) => ({
            id: Date.now() + idx + Math.random(),
            tag_number: t,
            reason: defaultReason,
            findings: defaultPreset,
            customReason: "",
            photos: [],
          }));
        return [...prev, ...toAdd];
      });
    }
  };

  const toggleOwnerPartial = (grp) => {
    const grpTags = (grp.items || []).map((a) => a.tag_number).filter(Boolean);
    const allSelected = grpTags.length > 0 && grpTags.every((t) => isTagPartial(t));
    const grpTagsLower = new Set(grpTags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setPartialAnimals((prev) => prev.filter((a) => !grpTagsLower.has(String(a.tag_number).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => prev.filter((t) => !grpTagsLower.has(String(t).trim().toLowerCase())));
      setAnteCondemned((prev) => prev.filter((c) => !grpTagsLower.has(String(c.tag_number).trim().toLowerCase())));
      grpTags.forEach((tag) => {
        if (!isTagPartial(tag)) {
          selectPartial(tag);
        }
      });
    }
  };

  const removeCondemnedEntryByTag = (tag) => {
    deselectCondemned(tag);
  };

  // Global selection helpers (Select All across all owners)
  const allApprovedGlobalSelected = useMemo(() => {
    const tags = (displayedApprovedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.length > 0 && tags.every((t) => isTagApproved(t));
  }, [displayedApprovedLivestock, isTagApproved]);

  const someApprovedGlobalSelected = useMemo(() => {
    const tags = (displayedApprovedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.some((t) => isTagApproved(t));
  }, [displayedApprovedLivestock, isTagApproved]);

  const allCondemnedGlobalSelected = useMemo(() => {
    const tags = (displayedCondemnedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.length > 0 && tags.every((t) => isTagCondemned(t));
  }, [displayedCondemnedLivestock, isTagCondemned]);

  const someCondemnedGlobalSelected = useMemo(() => {
    const tags = (displayedCondemnedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.some((t) => isTagCondemned(t));
  }, [displayedCondemnedLivestock, isTagCondemned]);

  const toggleGlobalApproved = () => {
    const tags = (displayedApprovedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    if (tags.length === 0) return;
    const allSelected = tags.every((t) => isTagApproved(t));
    const tagsLower = new Set(tags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setSelectedBatchTags((prev) => prev.filter((t) => !tagsLower.has(String(t).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => {
        const existingLower = new Set(prev.map((t) => String(t).trim().toLowerCase()));
        const toAdd = tags.filter((t) => !existingLower.has(String(t).trim().toLowerCase()));
        return [...prev, ...toAdd];
      });
      setAnteCondemned((prev) => prev.filter((c) => !tagsLower.has(String(c.tag_number).trim().toLowerCase())));
      setPartialAnimals((prev) => prev.filter((a) => !tagsLower.has(String(a.tag_number).trim().toLowerCase())));
    }
  };

  const toggleGlobalCondemned = () => {
    const tags = (displayedCondemnedLivestock || []).map((l) => l.tag_number).filter(Boolean);
    if (tags.length === 0) return;
    const allSelected = tags.every((t) => isTagCondemned(t));
    const tagsLower = new Set(tags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setAnteCondemned((prev) => prev.filter((c) => !tagsLower.has(String(c.tag_number).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => prev.filter((t) => !tagsLower.has(String(t).trim().toLowerCase())));
      setPartialAnimals((prev) => prev.filter((a) => !tagsLower.has(String(a.tag_number).trim().toLowerCase())));
      const defaultReason = type === "Post-Mortem" ? CONDEMNED_REASONS_LIST[0] : ANTE_CONDEMNED_REASONS[0];
      const defaultPreset = type === "Post-Mortem" ? POST_CONDEMNED_PRESETS[0] : ANTE_CONDEMNED_PRESETS[0];
      setAnteCondemned((prev) => {
        const existingLower = new Set(prev.map((c) => String(c.tag_number).trim().toLowerCase()));
        const toAdd = tags
          .filter((t) => !existingLower.has(String(t).trim().toLowerCase()))
          .map((t, idx) => ({
            id: Date.now() + idx + Math.random(),
            tag_number: t,
            reason: defaultReason,
            findings: defaultPreset,
            customReason: "",
            photos: [],
          }));
        return [...prev, ...toAdd];
      });
    }
  };

  const allPartialGlobalSelected = useMemo(() => {
    const tags = (displayedPartialLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.length > 0 && tags.every((t) => isTagPartial(t));
  }, [displayedPartialLivestock, isTagPartial]);

  const somePartialGlobalSelected = useMemo(() => {
    const tags = (displayedPartialLivestock || []).map((l) => l.tag_number).filter(Boolean);
    return tags.some((t) => isTagPartial(t));
  }, [displayedPartialLivestock, isTagPartial]);

  const toggleGlobalPartial = () => {
    const tags = (displayedPartialLivestock || []).map((l) => l.tag_number).filter(Boolean);
    if (tags.length === 0) return;
    const allSelected = tags.every((t) => isTagPartial(t));
    const tagsLower = new Set(tags.map((t) => String(t).trim().toLowerCase()));
    if (allSelected) {
      setPartialAnimals((prev) => prev.filter((a) => !tagsLower.has(String(a.tag_number).trim().toLowerCase())));
    } else {
      setSelectedBatchTags((prev) => prev.filter((t) => !tagsLower.has(String(t).trim().toLowerCase())));
      setAnteCondemned((prev) => prev.filter((c) => !tagsLower.has(String(c.tag_number).trim().toLowerCase())));
      tags.forEach((tag) => {
        if (!isTagPartial(tag)) {
          selectPartial(tag);
        }
      });
    }
  };

  // Partial Condemnation Helpers
  const addPartialAnimal = (tag = "") => {
    let resolvedTag = tag;
    if (!resolvedTag) {
      const candidate = sortedLivestock.find(
        (l) => !isTagPartial(l.tag_number) && !isTagCondemned(l.tag_number)
      );
      resolvedTag = candidate ? candidate.tag_number : "";
    }
    if (resolvedTag) {
      selectPartial(resolvedTag);
    }
  };

  const removePartialAnimal = (animalId) => {
    setPartialAnimals((prev) => prev.filter((a) => a.id !== animalId));
  };

  const updatePartialAnimalTag = (animalId, newTag) => {
    if (newTag) {
      const clean = String(newTag).trim().toLowerCase();
      setSelectedBatchTags((prev) => prev.filter((t) => String(t).trim().toLowerCase() !== clean));
      setAnteCondemned((prev) => prev.filter((c) => String(c.tag_number).trim().toLowerCase() !== clean));
    }
    setPartialAnimals((prev) =>
      prev.map((a) => (a.id === animalId ? { ...a, tag_number: newTag } : a))
    );
  };

  const addPartToAnimal = (animalId) => {
    setPartialAnimals((prev) =>
      prev.map((a) => {
        if (a.id !== animalId) return a;
        return {
          ...a,
          parts: [...a.parts, createNewCut(CARCASS_AREAS[0])],
        };
      })
    );
  };

  const removePartFromAnimal = (animalId, partId) => {
    setPartialAnimals((prev) =>
      prev.map((a) => {
        if (a.id !== animalId) return a;
        const newParts = a.parts.filter((p) => p.id !== partId);
        return {
          ...a,
          parts: newParts.length > 0 ? newParts : [createNewCut(CARCASS_AREAS[0])],
        };
      })
    );
  };

  const updateAnimalPart = (animalId, partId, field, value) => {
    setPartialAnimals((prev) =>
      prev.map((a) => {
        if (a.id !== animalId) return a;
        return {
          ...a,
          parts: a.parts.map((p) => {
            if (p.id !== partId) return p;
            if (field === "carcassArea" || field === "part") {
              const defaultSpecific = SPECIFIC_PARTS_BY_AREA[value]?.[0] || "Other";
              return {
                ...p,
                carcassArea: value,
                part: value,
                specificPart: defaultSpecific,
                customSpecificPart: "",
                location: defaultSpecific,
              };
            }
            if (field === "specificPart") {
              return {
                ...p,
                specificPart: value,
                location: value === "Other" ? (p.customSpecificPart || "") : value,
                customSpecificPart: value === "Other" ? p.customSpecificPart : "",
              };
            }
            if (field === "customSpecificPart") {
              return {
                ...p,
                customSpecificPart: value,
                location: value,
              };
            }
            return { ...p, [field]: value };
          }),
        };
      })
    );
  };

  const getAvailableTagsForPartialCard = (currentAnimalId) => {
    const otherPartialTags = new Set(
      partialAnimals
        .filter((a) => a.id !== currentAnimalId)
        .map((a) => String(a.tag_number || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return sortedLivestock.filter((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !otherPartialTags.has(clean) && !isTagApproved(clean) && !isTagCondemned(clean);
    });
  };

  const addCondemnedEntryWithTag = (tag) => {
    selectCondemned(tag);
  };

  const addCondemnedEntry = () => {
    const candidate = sortedLivestock.find((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !approvedTagsSet.has(clean) && !condemnedTagsSet.has(clean) && !partialTagsSet.has(clean);
    });
    if (candidate?.tag_number) {
      selectCondemned(candidate.tag_number);
    } else {
      showToast("No additional uninspected animals available to condemn.", "warning");
    }
  };

  const updateCondemnedEntry = (id, field, value) => {
    if (field === "tag_number" && value) {
      setSelectedBatchTags((prev) => prev.filter((t) => String(t).trim().toLowerCase() !== String(value).trim().toLowerCase()));
      setPartialAnimals((prev) => prev.filter((a) => String(a.tag_number).trim().toLowerCase() !== String(value).trim().toLowerCase()));
    }
    setAnteCondemned((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeCondemnedEntry = (id) => {
    setAnteCondemned((prev) => prev.filter((item) => item.id !== id));
  };

  const getAnimalDetails = (tag) => {
    if (!tag) return { tag_number: "—", species: "—", sex: "—", owner_name: "—" };
    const animal = (livestock || []).find(
      (l) => (l.tag_number || "").trim().toLowerCase() === String(tag).trim().toLowerCase()
    );
    return {
      tag_number: tag,
      species: animal?.species || "Unknown Species",
      sex: getAnimalSex(animal || tag),
      owner_name: animal?.owner_name || "Unknown Owner",
    };
  };

  const getAvailableTagsForCard = (currentId) => {
    const otherCondemned = new Set(
      anteCondemned
        .filter((c) => c.id !== currentId)
        .map((c) => String(c.tag_number || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return sortedLivestock.filter((l) => {
      const clean = String(l.tag_number || "").trim().toLowerCase();
      return clean && !approvedTagsSet.has(clean) && !otherCondemned.has(clean) && !partialTagsSet.has(clean);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttemptedSubmit(true);

    // Ante-Mortem Submission
    if (type === "Ante-Mortem") {
      const missing = [];
      const errors = {};

      const totalAnimals = approvedTags.length + anteCondemned.length;
      if (totalAnimals === 0) {
        missing.push({
          category: "Text Input",
          fieldId: "input-livestock-tags",
          label: "Animal Tag Selection",
          message: "Please select at least one animal tag to inspect.",
        });
        errors["input-livestock-tags"] = "Please select at least one animal tag.";
      }

      if (decision === "Approved" && approvedTags.length === 0 && anteCondemned.length === 0) {
        missing.push({
          category: "Text Input",
          fieldId: "input-livestock-tags",
          label: "Approved Livestock Selection",
          message: "No animals are checked for approval. Please check at least one animal tag.",
        });
        errors["input-livestock-tags"] = "Please check at least one animal tag for approval.";
      }


      if (decision === "Condemned" && anteCondemned.length === 0) {
        missing.push({
          category: "Text Input",
          fieldId: "input-livestock-tags",
          label: "Condemned Animal Selection",
          message: "Please select or add at least one animal tag to condemn.",
        });
        errors["input-livestock-tags"] = "Please select at least one animal to condemn.";
      }

      // Validate condemned entries
      const seen = new Set();
      for (let i = 0; i < anteCondemned.length; i++) {
        const entry = anteCondemned[i];
        if (!entry.tag_number) {
          missing.push({
            category: "Text Input",
            fieldId: `condemned-tag-${entry.id}`,
            label: `Animal Tag (Condemned Animal #${i + 1})`,
            message: `Please choose an animal tag for Condemned Animal #${i + 1}.`,
          });
          errors[`condemned-tag-${entry.id}`] = "Animal tag is required.";
        } else if (seen.has(entry.tag_number)) {
          missing.push({
            category: "Text Input",
            fieldId: `condemned-tag-${entry.id}`,
            label: `Duplicate Tag (${entry.tag_number})`,
            message: `Tag #${entry.tag_number} is selected multiple times in condemnation entries.`,
          });
          errors[`condemned-tag-${entry.id}`] = "Duplicate tag selected.";
        } else {
          seen.add(entry.tag_number);
        }

        const isCustom = isOtherReason(entry.reason);
        const r = isCustom ? (entry.customReason || "").trim() : entry.reason;
        if (!r) {
          const fieldId = isCustom ? `condemned-custom-reason-${entry.id}` : `condemned-reason-${entry.id}`;
          missing.push({
            category: "Text Input",
            fieldId,
            label: `Condemnation Reason (Tag #${entry.tag_number || `#${i + 1}`})`,
            message: `Please specify a condemnation reason for Tag #${entry.tag_number || `#${i + 1}`}.`,
          });
          errors[fieldId] = "Condemnation reason is required.";
        }

        const photos = entry.photos || [];
        if (!photos || photos.length === 0) {
          missing.push({
            category: "Photo Evidence",
            fieldId: `condemned-photos-${entry.id}`,
            label: `Evidence Photo (Tag #${entry.tag_number || `#${i + 1}`})`,
            message: `Please upload at least one evidence photo for Condemned Animal (Tag #${entry.tag_number || `#${i + 1}`}).`,
          });
          errors[`condemned-photos-${entry.id}`] = "At least 1 evidence photo is required.";
        }
      }

      if (missing.length > 0) {
        navigateToValidationError(missing, errors);
        return;
      }

      setValidationErrors({});

      const records = [];

      // Approved records
      for (const tag of approvedTags) {
        const details = getAnimalDetails(tag);
        records.push({
          tag_number: tag,
          decision: "Approved",
          findings: findings || ANTE_APPROVED_PRESETS[0],
          remarks: remarks || "",
          owner_name: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "",
          species: details?.species && details.species !== "Unknown Species" ? details.species : "",
        });
      }

      // Condemned records
      for (const entry of anteCondemned) {
        const details = getAnimalDetails(entry.tag_number);
        const isCustom = isOtherReason(entry.reason);
        const finalReason = isCustom && entry.customReason ? entry.customReason : entry.reason;
        records.push({
          tag_number: entry.tag_number,
          decision: "Condemned",
          reason: finalReason,
          findings: `Condemned: ${finalReason}`,
          photos: entry.photos || [],
          remarks: remarks || "",
          owner_name: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "",
          species: details?.species && details.species !== "Unknown Species" ? details.species : "",
        });
      }

      const allTags = records.map((r) => r.tag_number);
      const isCondemnationOnly = anteCondemned.length > 0 && approvedTags.length === 0;
      const isApprovedOnly = approvedTags.length > 0 && anteCondemned.length === 0;

      const actor = getCurrentActor();
      const officer = actor?.name || "Dr. Dave";

      const condemnedList = anteCondemned.map((entry) => {
        const details = getAnimalDetails(entry.tag_number);
        const isCustom = isOtherReason(entry.reason);
        const finalReason = isCustom && entry.customReason ? entry.customReason : entry.reason;
        return {
          tag: entry.tag_number,
          species: details?.species && details.species !== "Unknown Species" ? details.species : "Livestock",
          heads: 1,
          reason: finalReason,
          owner: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "—",
        };
      });

      const payloadToSubmit = {
        records,
        tag_number: allTags.join(","),
        decision: isCondemnationOnly ? "Condemned" : "Approved",
        findings: anteCondemned.length > 0
          ? `Ante-Mortem Condemned: ${anteCondemned.map((c) => `${c.tag_number} (${c.reason})`).join("; ")}`
          : (findings || ANTE_APPROVED_PRESETS[0]),
        remarks,
      };

      setPendingConfirm({
        payloadToSubmit,
        isCondemnation: isCondemnationOnly,
        successMessage: isCondemnationOnly
          ? (anteCondemned.length === 1 ? `Livestock condemned (${anteCondemned[0].tag_number})` : `Livestock condemned (${anteCondemned.length} head(s))`)
          : isApprovedOnly
          ? (approvedTags.length === 1 ? `Ante-mortem inspection saved (${approvedTags[0]})` : `Ante-mortem inspection saved (${approvedTags.length} head(s))`)
          : `Ante-Mortem inspection (${records.length} head(s)) successfully recorded and certified!`,
        onSuccess: () => {
          setSelectedBatchTags([]);
          setAnteCondemned([]);
        },
        summary: {
          title: isCondemnationOnly ? "Confirm Condemnation" : "Confirm Ante-Mortem Inspection",
          type: "Ante-Mortem",
          officer,
          heads: anteCondemned.length,
          condemnedList,
          tags: allTags,
          approvedCount: approvedTags.length,
          condemnedCount: anteCondemned.length,
          partialCount: 0,
        },
      });
      return;
    }

    // Post-Mortem Submission
    if (type === "Post-Mortem") {
      const missing = [];
      const errors = {};

      const totalAnimals = approvedTags.length + partialAnimals.length + anteCondemned.length;
      if (totalAnimals === 0) {
        missing.push({
          category: "Text Input",
          fieldId: "input-livestock-tags",
          label: "Carcass Tag Selection",
          message: "Please select at least one carcass tag to inspect.",
        });
        errors["input-livestock-tags"] = "Please select at least one carcass tag.";
      }

      // 1. Validate Partial Condemnation entries (if any)
      if (partialAnimals.length > 0) {
        const seenPartialTags = new Set();
        for (let i = 0; i < partialAnimals.length; i++) {
          const entry = partialAnimals[i];
          if (!entry.tag_number) {
            missing.push({
              category: "Text Input",
              fieldId: `partial-tag-${entry.id}`,
              label: `Carcass Tag (Partial #${i + 1})`,
              message: `Please choose a carcass tag for Partial Condemnation Carcass #${i + 1}.`,
            });
            errors[`partial-tag-${entry.id}`] = "Carcass tag is required.";
          } else if (seenPartialTags.has(entry.tag_number)) {
            missing.push({
              category: "Text Input",
              fieldId: `partial-tag-${entry.id}`,
              label: `Duplicate Tag (${entry.tag_number})`,
              message: `Tag #${entry.tag_number} is selected multiple times in partial condemnation.`,
            });
            errors[`partial-tag-${entry.id}`] = "Duplicate tag selected.";
          } else {
            seenPartialTags.add(entry.tag_number);
          }

          if (!entry.parts || entry.parts.length === 0) {
            missing.push({
              category: "Text Input",
              fieldId: `partial-carcass-${entry.id}`,
              label: `Condemned Cuts (Tag #${entry.tag_number || `#${i + 1}`})`,
              message: `Please add at least one condemned cut for Tag #${entry.tag_number || `#${i + 1}`}.`,
            });
            errors[`partial-carcass-${entry.id}`] = "At least one condemned cut is required.";
          }

          for (let j = 0; j < (entry.parts || []).length; j++) {
            const cut = entry.parts[j];
            const area = cut.carcassArea || cut.part;
            if (!area) {
              missing.push({
                category: "Text Input",
                fieldId: `cut-area-${cut.id}`,
                label: `Carcass Area (Tag #${entry.tag_number || `#${i + 1}`})`,
                message: "Please select a main carcass area.",
              });
              errors[`cut-area-${cut.id}`] = "Carcass area is required.";
            }
            if (!cut.specificPart) {
              missing.push({
                category: "Text Input",
                fieldId: `cut-specific-${cut.id}`,
                label: `Specific Part (Tag #${entry.tag_number || `#${i + 1}`})`,
                message: "Please select a specific condemned part.",
              });
              errors[`cut-specific-${cut.id}`] = "Specific part is required.";
            }
            if (cut.specificPart === "Other" && !(cut.customSpecificPart || cut.customPart || "").trim()) {
              missing.push({
                category: "Text Input",
                fieldId: `cut-custom-specific-${cut.id}`,
                label: `Custom Specific Part (Tag #${entry.tag_number || `#${i + 1}`})`,
                message: "Please specify the condemned part.",
              });
              errors[`cut-custom-specific-${cut.id}`] = "Please specify the condemned part.";
            }
            const w = parseFloat(cut.weight);
            if (isNaN(w) || w <= 0) {
              missing.push({
                category: "Text Input",
                fieldId: `cut-weight-${cut.id}`,
                label: `Cut Weight (Tag #${entry.tag_number || `#${i + 1}`})`,
                message: "Please enter a valid weight greater than 0 kg.",
              });
              errors[`cut-weight-${cut.id}`] = "Weight must be greater than 0 kg.";
            }
            const isCustomCut = isOtherReason(cut.reason);
            const r = isCustomCut ? (cut.customReason || "").trim() : cut.reason;
            if (!r) {
              missing.push({
                category: "Text Input",
                fieldId: `cut-reason-${cut.id}`,
                label: `Cut Pathology / Reason (Tag #${entry.tag_number || `#${i + 1}`})`,
                message: "Please select a pathology or reason.",
              });
              errors[`cut-reason-${cut.id}`] = "Pathology or reason is required.";
            }
            const cutPhotos = cut.photos || (cut.photo ? [cut.photo] : []);
            if (!cutPhotos || cutPhotos.length === 0) {
              missing.push({
                category: "Photo Evidence",
                fieldId: `cut-photos-${cut.id}`,
                label: `Cut Evidence Photo (Tag #${entry.tag_number || `#${i + 1}`} · ${cut.specificPart || area || "Cut"})`,
                message: "Please upload at least one evidence photo for each condemned cut.",
              });
              errors[`cut-photos-${cut.id}`] = "Evidence photo is required.";
            }
          }
        }
      }

      // 2. Validate Whole Condemnation entries (if any)
      if (anteCondemned.length > 0) {
        const seenCondemned = new Set();
        for (let i = 0; i < anteCondemned.length; i++) {
          const entry = anteCondemned[i];
          if (!entry.tag_number) {
            missing.push({
              category: "Text Input",
              fieldId: `condemned-tag-${entry.id}`,
              label: `Carcass Tag (Condemned Carcass #${i + 1})`,
              message: `Please choose a carcass tag for Condemned Carcass #${i + 1}.`,
            });
            errors[`condemned-tag-${entry.id}`] = "Carcass tag is required.";
          } else if (seenCondemned.has(entry.tag_number)) {
            missing.push({
              category: "Text Input",
              fieldId: `condemned-tag-${entry.id}`,
              label: `Duplicate Carcass Tag (${entry.tag_number})`,
              message: `Tag #${entry.tag_number} is selected multiple times in whole condemnation entries.`,
            });
            errors[`condemned-tag-${entry.id}`] = "Duplicate tag selected.";
          } else {
            seenCondemned.add(entry.tag_number);
          }

          const isCustomEntry = isOtherReason(entry.reason);
          const r = isCustomEntry ? (entry.customReason || "").trim() : entry.reason;
          if (!r) {
            const fieldId = isCustomEntry ? `condemned-custom-reason-${entry.id}` : `condemned-reason-${entry.id}`;
            missing.push({
              category: "Text Input",
              fieldId,
              label: `Condemnation Reason (Tag #${entry.tag_number || `#${i + 1}`})`,
              message: `Please select a pathology or reason for Tag #${entry.tag_number || `#${i + 1}`}.`,
            });
            errors[fieldId] = "Pathology or reason is required.";
          }
          const photos = entry.photos || [];
          if (!photos || photos.length === 0) {
            missing.push({
              category: "Photo Evidence",
              fieldId: `condemned-photos-${entry.id}`,
              label: `Evidence Photo (Tag #${entry.tag_number || `#${i + 1}`})`,
              message: `Please upload at least one evidence photo for whole carcass condemnation (Tag #${entry.tag_number || `#${i + 1}`}).`,
            });
            errors[`condemned-photos-${entry.id}`] = "At least 1 evidence photo is required.";
          }
        }
      }

      if (missing.length > 0) {
        navigateToValidationError(missing, errors);
        return;
      }

      setValidationErrors({});

      // 3. Assemble records across all categories
      const records = [];

      // Passed / Fit for Consumption records
      for (const tag of approvedTags) {
        const details = getAnimalDetails(tag);
        records.push({
          tag_number: tag,
          decision: "Approved",
          findings: findings || POST_APPROVED_PRESETS[0],
          remarks: remarks || "",
          owner_name: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "",
          species: details?.species && details.species !== "Unknown Species" ? details.species : "",
        });
      }

      // Partial Condemnation records
      for (const entry of partialAnimals) {
        const cutsPayload = entry.parts.map((p) => {
          const areaName = p.carcassArea || p.part || "Head";
          const specificPartName = p.specificPart === "Other"
            ? (p.customSpecificPart || p.customPart || "Other Cut").trim()
            : (p.specificPart || p.location || "").trim();
          const partDisplay = specificPartName ? `${areaName} - ${specificPartName}` : areaName;
          const reasonName = isOtherReason(p.reason) ? (p.customReason || "Other").trim() : p.reason;
          const weightVal = parseFloat(p.weight) || 0;
          return {
            part: areaName,
            carcass_area: areaName,
            specific_part: specificPartName,
            custom_part: p.specificPart === "Other" ? (p.customSpecificPart || p.customPart || "") : "",
            location: specificPartName,
            weight: weightVal,
            weight_kg: weightVal,
            reason: reasonName,
            photo: p.photo || (p.photos?.[0]?.preview || null),
            photoName: p.photoName || (p.photos?.[0]?.name || ""),
            photos: p.photos || (p.photo ? [{ preview: p.photo, name: p.photoName }] : []),
            disposition: "Condemned / Rendered",
            quantity: `${weightVal} kg`,
            notes: `Part: ${partDisplay} · Reason: ${reasonName}`,
          };
        });

        const partsSummary = cutsPayload
          .map((p) => `${p.specific_part ? `${p.part} (${p.specific_part})` : p.part} - ${p.weight_kg} kg [${p.reason}]`)
          .join("; ");

        const details = getAnimalDetails(entry.tag_number);
        records.push({
          tag_number: entry.tag_number,
          decision: "Passed with Partial Condemnation",
          raw_decision: "Partial",
          findings: `Passed with Partial Condemnation: ${partsSummary}`,
          condemned_parts: cutsPayload,
          remarks: remarks || "",
          owner_name: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "",
          species: details?.species && details.species !== "Unknown Species" ? details.species : "",
        });
      }

      // Whole Carcass Condemned records
      for (const entry of anteCondemned) {
        const details = getAnimalDetails(entry.tag_number);
        const finalReason = isOtherReason(entry.reason) && entry.customReason ? entry.customReason : entry.reason;
        records.push({
          tag_number: entry.tag_number,
          decision: "Condemned",
          reason: finalReason,
          findings: `Whole Carcass Condemned: ${finalReason}`,
          photos: entry.photos || [],
          condemned_parts: [],
          remarks: remarks || "",
          owner_name: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "",
          species: details?.species && details.species !== "Unknown Species" ? details.species : "",
        });
      }

      const totalCuts = records.reduce((s, r) => s + (r.condemned_parts?.length || 0), 0);
      const allTags = records.map((r) => r.tag_number);
      const mainDecision =
        anteCondemned.length > 0 && approvedTags.length === 0 && partialAnimals.length === 0
          ? "Condemned"
          : partialAnimals.length > 0 && approvedTags.length === 0 && anteCondemned.length === 0
          ? "Passed with Partial Condemnation"
          : "Approved";

      const payloadToSubmit = {
        records,
        tag_number: allTags.join(","),
        decision: mainDecision,
        raw_decision: partialAnimals.length > 0 ? "Partial" : decision,
        findings:
          partialAnimals.length > 0
            ? `Post-Mortem Partial Condemnation (${partialAnimals.length} carcass(es)): ${partialAnimals.map((r) => `#${r.tag_number} (${r.parts?.length || 0} cuts)`).join(", ")}`
            : anteCondemned.length > 0
            ? `Whole Carcass Condemned: ${anteCondemned.map((c) => `${c.tag_number} (${c.reason})`).join("; ")}`
            : (findings || POST_APPROVED_PRESETS[0]),
        remarks,
      };

      const isCondemnationOnly = anteCondemned.length > 0 && approvedTags.length === 0 && partialAnimals.length === 0;
      const isApprovedOnly = approvedTags.length > 0 && anteCondemned.length === 0 && partialAnimals.length === 0;
      const isPartialOnly = partialAnimals.length > 0 && approvedTags.length === 0 && anteCondemned.length === 0;

      const actor = getCurrentActor();
      const officer = actor?.name || "Dr. Dave";

      const condemnedList = anteCondemned.map((entry) => {
        const details = getAnimalDetails(entry.tag_number);
        const isCustom = isOtherReason(entry.reason);
        const finalReason = isCustom && entry.customReason ? entry.customReason : entry.reason;
        return {
          tag: entry.tag_number,
          species: details?.species && details.species !== "Unknown Species" ? details.species : "Livestock",
          heads: 1,
          reason: finalReason,
          owner: details?.owner_name && details.owner_name !== "Unknown Owner" ? details.owner_name : "—",
        };
      });

      setPendingConfirm({
        payloadToSubmit,
        isCondemnation: isCondemnationOnly,
        successMessage: isCondemnationOnly
          ? (anteCondemned.length === 1 ? `Carcass condemned (${anteCondemned[0].tag_number})` : `Carcasses condemned (${anteCondemned.length} head(s))`)
          : isApprovedOnly
          ? (approvedTags.length === 1 ? `Post-mortem inspection saved (${approvedTags[0]})` : `Post-mortem inspection saved (${approvedTags.length} head(s))`)
          : isPartialOnly
          ? (partialAnimals.length === 1 ? "Partial condemnation (1 carcass) saved successfully." : `Partial condemnation (${partialAnimals.length} carcasses) saved successfully.`)
          : (records.length === 1 ? "Post-Mortem inspection (1 carcass) successfully recorded and certified!" : `Post-Mortem inspection (${records.length} carcasses) successfully recorded and certified!`),
        onSuccess: () => {
          setSelectedBatchTags([]);
          setAnteCondemned([]);
          setPartialAnimals([]);
        },
        summary: {
          title: isCondemnationOnly
            ? "Confirm Condemnation"
            : isApprovedOnly
            ? "Confirm Post-Mortem Approval"
            : isPartialOnly
            ? "Confirm Partial Condemnation"
            : "Confirm Post-Mortem Inspection",
          type: "Post-Mortem",
          officer,
          heads: anteCondemned.length,
          condemnedList,
          tags: allTags,
          approvedCount: approvedTags.length,
          condemnedCount: anteCondemned.length,
          partialCount: partialAnimals.length,
          totalCuts,
        },
      });
      return;
    }
  };

  const presets = useMemo(() => {
    if (decision === "Condemned") {
      return type === "Ante-Mortem" ? ANTE_CONDEMNED_PRESETS : POST_CONDEMNED_PRESETS;
    }
    return type === "Ante-Mortem" ? ANTE_APPROVED_PRESETS : POST_APPROVED_PRESETS;
  }, [type, decision]);

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
      }}
    >
      {/* Scrollable Form Body Container */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          paddingRight: 4,
          scrollbarWidth: "thin",
        }}
      >
      {/* Intercepted Success State Alert Notification */}
      {formAlert && (
        <div
          role="alert"
          className="form-alert-notification"
          style={{
            padding: "12px 16px",
            background: "#ecfdf5",
            border: "1.5px solid #6ee7b7",
            borderRadius: 10,
            color: "#065f46",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 2px 8px rgba(5, 150, 105, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.CheckCircle size={18} color="#059669" />
            <span>{formAlert.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormAlert(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#065f46",
              cursor: "pointer",
              display: "flex",
              padding: 2,
            }}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <Icon.X size={14} />
          </button>
        </div>
      )}

      {/* Sticky Top Header: Keeps Banner & Veterinary Decision Pinned at Top (fallback only when propDecision not passed) */}
      {type !== "Ante-Mortem" && !propDecision && (
        <div
          style={{
            position: "sticky",
            top: -24,
            zIndex: 20,
            background: "var(--color-surface, #ffffff)",
            margin: "-24px -24px 0 -24px",
            padding: "16px 24px 14px 24px",
            borderBottom: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Header Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: type === "Ante-Mortem" ? "rgba(2, 132, 199, 0.08)" : "rgba(139, 92, 246, 0.08)",
              border: `1px solid ${type === "Ante-Mortem" ? "#bae6fd" : "#ddd6fe"}`,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: type === "Ante-Mortem" ? "#0284c7" : "#8b5cf6",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {type === "Ante-Mortem" ? <Icon.Stethoscope size={16} /> : <Icon.Activity size={16} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: "#0f172a" }}>
                {type === "Ante-Mortem" ? "Live Animal Ante-Mortem Inspection" : "Carcass & Viscera Post-Mortem Inspection"}
              </div>
              <div style={{ fontSize: 11.5, color: "#64748b" }}>
                {type === "Ante-Mortem"
                  ? "Examine animal behavior, posture, vital signs, and general health before slaughter"
                  : "Examine meat, visceral organs, lymph nodes, and carcass quality after slaughter"}
              </div>
            </div>
          </div>

          {/* Decision Radio Pills */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>
              Veterinary Decision <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {(type === "Ante-Mortem"
                ? [
                    { value: "Approved", label: "Fit for Slaughter", sub: "Animal healthy; proceed to slaughter queue", color: "#10b981", bg: "#f0fdf4", border: "#86efac", icon: <Icon.Check size={16} /> },
                    { value: "Condemned", label: "Condemned", sub: "Live animal unfit — rejected before slaughter", color: "#ef4444", bg: "#fef2f2", border: "#fca5a5", icon: <Icon.AlertTriangle size={16} /> },
                  ]
                : [
                    { value: "Approved", label: "Fit for Consumption", sub: "Carcass sound; proceed to carcass weighing", color: "#10b981", bg: "#f0fdf4", border: "#86efac", icon: <Icon.Check size={16} /> },
                    { value: "Partial", label: "Partial Condemnation", sub: "Specific cuts/organs condemned; carcass passes", color: "#f59e0b", bg: "#fffbeb", border: "#fde68a", icon: <Icon.Scale size={16} /> },
                    { value: "Condemned", label: "Condemnation", sub: "Severe systemic pathology; totally unfit", color: "#ef4444", bg: "#fef2f2", border: "#fca5a5", icon: <Icon.AlertTriangle size={16} /> },
                  ]
              ).map((opt) => {
                const isSel = decision === opt.value;
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelectDecision(opt.value)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: isSel ? `2px solid ${opt.color}` : "1px solid #e2e8f0",
                      background: isSel ? opt.bg : "#ffffff",
                      boxShadow: isSel ? `0 2px 10px ${opt.color}22` : "none",
                      transition: "all 0.14s ease",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: opt.color, fontWeight: 800, fontSize: 13.5 }}>
                      {opt.icon}
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{opt.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Select Animal/Carcass Tags (Batch Tag Selection Interface) */}
      {(decision === "Approved" || decision === "Condemned") && (
        <div
          id="input-livestock-tags"
          tabIndex={-1}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            outline: "none",
            borderRadius: 10,
            padding: validationErrors["input-livestock-tags"] ? "10px 12px" : "0",
            border: validationErrors["input-livestock-tags"] ? "1.5px solid #ef4444" : "none",
            background: validationErrors["input-livestock-tags"] ? "#fef2f2" : "transparent",
            transition: "all 0.15s ease",
          }}
        >
          {validationErrors["input-livestock-tags"] && (
            <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, background: "#fee2e2", padding: "6px 10px", borderRadius: 6, border: "1px solid #fca5a5" }}>
              <Icon.AlertTriangle size={14} /> {validationErrors["input-livestock-tags"]}
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              paddingBottom: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", margin: 0 }}>
                {decision === "Condemned"
                  ? (type === "Ante-Mortem" ? "Select Animal Tags to Reject / Condemn" : "Select Carcass Tags to Condemn")
                  : (type === "Ante-Mortem" ? "Select Animal Tags" : "Select Carcass Tags")
                } <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: decision === "Condemned"
                    ? (anteCondemned.length > 0 ? "#fee2e2" : "#f1f5f9")
                    : (approvedTags.length > 0 ? "#e0f2fe" : "#f1f5f9"),
                  color: decision === "Condemned"
                    ? (anteCondemned.length > 0 ? "#991b1b" : "#64748b")
                    : (approvedTags.length > 0 ? "#0369a1" : "#64748b"),
                }}
              >
                {decision === "Condemned" ? anteCondemned.length : approvedTags.length} of {(decision === "Condemned" ? displayedCondemnedLivestock : displayedApprovedLivestock).length} Selected
              </span>
            </div>

            {(() => {
              const currentList = decision === "Condemned" ? displayedCondemnedLivestock : displayedApprovedLivestock;
              if (currentList.length === 0) return null;
              const isAllSel = decision === "Condemned" ? allCondemnedGlobalSelected : allApprovedGlobalSelected;
              const isSomeSel = decision === "Condemned" ? someCondemnedGlobalSelected : someApprovedGlobalSelected;
              return (
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: decision === "Condemned" ? "#ef4444" : (type === "Ante-Mortem" ? "#0284c7" : "#10b981"),
                    userSelect: "none",
                  }}
                  title={isAllSel ? "Deselect all" : "Select all eligible"}
                >
                  <input
                    type="checkbox"
                    checked={isAllSel}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeSel && !isAllSel;
                    }}
                    onChange={decision === "Condemned" ? toggleGlobalCondemned : toggleGlobalApproved}
                    style={{
                      width: 14,
                      height: 14,
                      cursor: "pointer",
                      accentColor: decision === "Condemned"
                        ? "#ef4444"
                        : (type === "Ante-Mortem" ? "#0284c7" : "#10b981"),
                    }}
                  />
                  <span>Select All</span>
                </label>
              );
            })()}
          </div>

          {/* Animals/Carcasses List Grouped per Owner with Dropdown Accordion */}
          {(() => {
            const currentList = decision === "Condemned" ? displayedCondemnedLivestock : displayedApprovedLivestock;
            if (currentList.length === 0) {
              return (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px",
                    color: decision === "Condemned" ? "#991b1b" : "#065f46",
                    background: decision === "Condemned" ? "#fff5f5" : "#f0fdf4",
                    border: decision === "Condemned" ? "1.5px dashed #fca5a5" : "1.5px dashed #86efac",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  {decision === "Condemned"
                    ? `No ${type === "Ante-Mortem" ? "animals" : "carcasses"} currently available for condemnation.`
                    : `No ${type === "Ante-Mortem" ? "animals" : "carcasses"} currently available for fit for ${type === "Ante-Mortem" ? "slaughter" : "consumption"}.`}
                </div>
              );
            }

            const ownerGroups = groupLivestockByOwner(currentList);
            const isCondemned = decision === "Condemned";

            return (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: 440,
                  overflowY: "auto",
                  paddingRight: 4,
                }}
              >
                {ownerGroups.map((grp) => {
                  const isExpanded = isOwnerExpanded(grp.owner_name);
                  const grpTags = (grp.items || []).map((a) => a.tag_number).filter(Boolean);
                  const allOwnerSelected = grpTags.length > 0 && grpTags.every((t) =>
                    isCondemned ? isTagCondemned(t) : isTagApproved(t)
                  );
                  const someOwnerSelected = grpTags.some((t) =>
                    isCondemned ? isTagCondemned(t) : isTagApproved(t)
                  );
                  const selectedCount = grp.items.filter((a) =>
                    isCondemned ? isTagCondemned(a.tag_number) : isTagApproved(a.tag_number)
                  ).length;

                  return (
                    <div
                      key={grp.owner_name}
                      style={{
                        border: selectedCount > 0 ? (isCondemned ? "1.5px solid #ef4444" : "1.5px solid #0284c7") : "1px solid #e2e8f0",
                        borderRadius: 10,
                        background: "#ffffff",
                        overflow: "hidden",
                        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                        boxShadow: selectedCount > 0 ? (isCondemned ? "0 2px 8px rgba(239, 68, 68, 0.08)" : "0 2px 8px rgba(2, 132, 199, 0.08)") : "none",
                      }}
                    >
                      {/* Owner Card Header */}
                      <div
                        style={{
                          padding: "10px 14px",
                          background: selectedCount > 0 ? (isCondemned ? "rgba(239, 68, 68, 0.04)" : "rgba(2, 132, 199, 0.04)") : "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "nowrap",
                          gap: 12,
                          cursor: "pointer",
                        }}
                        onClick={() => toggleOwnerExpand(grp.owner_name)}
                      >
                        {/* Left: Checkbox + Owner Name */}
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CheckboxWithIndeterminate
                            checked={allOwnerSelected}
                            indeterminate={someOwnerSelected && !allOwnerSelected}
                            onChange={() => {
                              if (isCondemned) {
                                toggleOwnerCondemned(grp);
                              } else {
                                toggleOwnerApproved(grp);
                              }
                            }}
                            title={allOwnerSelected ? `Deselect all records for ${grp.owner_name}` : `Select all records for ${grp.owner_name}`}
                            style={{
                              width: 16,
                              height: 16,
                              accentColor: isCondemned ? "#ef4444" : "#0284c7",
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: "#0f172a",
                                letterSpacing: "-0.01em",
                              }}
                            >
                              {grp.owner_name}
                            </span>
                          </div>
                        </div>

                        {/* Right: Summary Badges + Expand Toggle */}
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Total Count Badge */}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "#f1f5f9",
                              color: "#334155",
                              border: "1px solid #e2e8f0",
                            }}
                            title="Total eligible records for this owner"
                          >
                            Total: <strong>{grp.total || grp.items.length}</strong>
                          </span>

                          {/* Male Count Badge */}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              border: "1px solid #bfdbfe",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                            title="Count of male records"
                          >
                            <span style={{ fontSize: 12 }}>♂</span> Male: <strong>{grp.maleCount || 0}</strong>
                          </span>

                          {/* Female Count Badge */}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "#fdf2f8",
                              color: "#be185d",
                              border: "1px solid #fbcfe8",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                            title="Count of female records"
                          >
                            <span style={{ fontSize: 12 }}>♀</span> Female: <strong>{grp.femaleCount || 0}</strong>
                          </span>

                          {grp.unspecifiedCount > 0 && (
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 600,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#f8fafc",
                                color: "#64748b",
                                border: "1px solid #cbd5e1",
                              }}
                              title="Records with unspecified or unknown sex"
                            >
                              Unspecified: <strong>{grp.unspecifiedCount}</strong>
                            </span>
                          )}

                          {/* Expand/Collapse Chevron */}
                          <span
                            onClick={() => toggleOwnerExpand(grp.owner_name)}
                            style={{
                              color: "#64748b",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 3,
                              cursor: "pointer",
                              marginLeft: 2,
                            }}
                            title={isExpanded ? "Collapse tags" : "Expand tags"}
                          >
                            {isExpanded ? <Icon.ChevronUp size={15} /> : <Icon.ChevronDown size={15} />}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Livestock List Under This Owner */}
                      {isExpanded && (
                        <div
                          style={{
                            borderTop: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            padding: "8px 10px",
                          }}
                        >
                          {/* List of Animals in Responsive Grid (Scrollable) */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                              gap: 6,
                              maxHeight: 180,
                              overflowY: "auto",
                              paddingRight: 4,
                              paddingBottom: 2,
                              scrollbarWidth: "thin",
                            }}
                          >
                            {grp.items.map((animal) => {
                              const tag = animal.tag_number;
                              const isCondemnedEntry = isTagCondemned(tag);
                              const isApproved = isTagApproved(tag);
                              const isChecked = isCondemned ? isCondemnedEntry : isApproved;
                              const rawSex = String(animal.sex || getAnimalSex(animal) || "").trim().toLowerCase();
                              const isMale = rawSex === "male" || rawSex === "m";
                              const isFemale = rawSex === "female" || rawSex === "f";

                              return (
                                <div
                                  key={animal.id || tag}
                                  onClick={() => {
                                    if (isCondemned) {
                                      toggleCondemnedBatchTag(tag);
                                    } else {
                                      toggleBatchTag(tag);
                                    }
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "5px 8px",
                                    borderRadius: 6,
                                    background: isChecked
                                      ? (isCondemned ? "rgba(239, 68, 68, 0.04)" : "rgba(2, 132, 199, 0.04)")
                                      : "#ffffff",
                                    border: isChecked
                                      ? (isCondemned ? "1.5px solid #ef4444" : "1.5px solid #0284c7")
                                      : "1px solid #cbd5e1",
                                    boxShadow: isChecked ? "0 1px 3px rgba(2, 132, 199, 0.1)" : "none",
                                    cursor: "pointer",
                                    transition: "all 0.12s ease",
                                    gap: 6,
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        if (isCondemned) {
                                          toggleCondemnedBatchTag(tag);
                                        } else {
                                          toggleBatchTag(tag);
                                        }
                                      }}
                                      style={{
                                        width: 14,
                                        height: 14,
                                        accentColor: isCondemned ? "#ef4444" : "#0284c7",
                                        cursor: "pointer",
                                        flexShrink: 0,
                                      }}
                                    />
                                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
                                        {tag}
                                      </span>
                                      <span style={{ fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                                        {animal.species || (type === "Ante-Mortem" ? "Livestock" : "Carcass")}{animal.breed ? ` • ${animal.breed}` : ""}
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                    {isMale ? (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          padding: "1px 5px",
                                          borderRadius: 4,
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          border: "1px solid #bfdbfe",
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        ♂ Male
                                      </span>
                                    ) : isFemale ? (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          padding: "1px 5px",
                                          borderRadius: 4,
                                          background: "#fdf2f8",
                                          color: "#be185d",
                                          border: "1px solid #fbcfe8",
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        ♀ Female
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 500,
                                          padding: "1px 5px",
                                          borderRadius: 4,
                                          background: "#f1f5f9",
                                          color: "#64748b",
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        {getAnimalSex(animal)}
                                      </span>
                                    )}

                                    {isCondemned && isChecked && (
                                      <span
                                        style={{
                                          fontSize: 9.5,
                                          fontWeight: 700,
                                          padding: "1px 4px",
                                          borderRadius: 4,
                                          background: "#fee2e2",
                                          color: "#b91c1c",
                                          border: "1px solid #fca5a5",
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        Condemned
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Multi-Animal & Multi-Part Condemnation Section for Post-Mortem */}
      {type === "Post-Mortem" && decision === "Partial" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Multi-Select Carcass Tags Checklist */}
          <div
            style={{
              border: "1.5px solid #fde68a",
              background: "#fffdf7",
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#334155", margin: 0 }}>
                  Select Carcass Tags for Partial Condemnation <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: partialAnimals.length > 0 ? "#fef3c7" : "#f1f5f9",
                    color: partialAnimals.length > 0 ? "#92400e" : "#64748b",
                  }}
                >
                  {partialAnimals.length} of {displayedPartialLivestock.length} Selected
                </span>
              </div>

              {displayedPartialLivestock.length > 0 && (
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#d97706",
                    userSelect: "none",
                  }}
                  title={allPartialGlobalSelected ? "Deselect all" : "Select all eligible"}
                >
                  <input
                    type="checkbox"
                    checked={allPartialGlobalSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = somePartialGlobalSelected && !allPartialGlobalSelected;
                    }}
                    onChange={toggleGlobalPartial}
                    style={{
                      width: 16,
                      height: 16,
                      cursor: "pointer",
                      accentColor: "#f59e0b",
                    }}
                  />
                  <span>Select All ({displayedPartialLivestock.length})</span>
                </label>
              )}
            </div>

              {/* Checkbox List Grouped per Owner with Dropdown Accordion */}
              {displayedPartialLivestock.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px",
                    color: "#92400e",
                    background: "#fffdf7",
                    border: "1.5px dashed #fde68a",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  No carcasses currently available for partial condemnation.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    maxHeight: 440,
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {groupLivestockByOwner(displayedPartialLivestock).map((grp) => {
                    const isExpanded = isOwnerExpanded(grp.owner_name);
                    const grpTags = (grp.items || []).map((a) => a.tag_number).filter(Boolean);
                    const allOwnerSelected = grpTags.length > 0 && grpTags.every((t) => isTagPartial(t));
                    const someOwnerSelected = grpTags.some((t) => isTagPartial(t));
                    const selectedCount = grp.items.filter((a) => isTagPartial(a.tag_number)).length;

                    return (
                      <div
                        key={grp.owner_name}
                        style={{
                          border: selectedCount > 0 ? "1.5px solid #d97706" : "1px solid #e2e8f0",
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "#ffffff",
                          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                          boxShadow: selectedCount > 0 ? "0 2px 8px rgba(217, 119, 6, 0.08)" : "none",
                        }}
                      >
                        {/* Owner Card Header */}
                        <div
                          onClick={() => toggleOwnerExpand(grp.owner_name)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: selectedCount > 0 ? "rgba(217, 119, 6, 0.04)" : "#ffffff",
                            cursor: "pointer",
                            userSelect: "none",
                            flexWrap: "wrap",
                            gap: 8,
                            transition: "background 0.14s ease",
                          }}
                        >
                          {/* Left: Checkbox + Owner Name */}
                          <div
                            style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150, flex: "1 1 auto" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <CheckboxWithIndeterminate
                              checked={allOwnerSelected}
                              indeterminate={someOwnerSelected && !allOwnerSelected}
                              onChange={() => toggleOwnerPartial(grp)}
                              title={allOwnerSelected ? `Deselect all carcasses for ${grp.owner_name}` : `Select all carcasses for ${grp.owner_name}`}
                              style={{ width: 15, height: 15, accentColor: "#d97706" }}
                            />
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span
                                style={{
                                  fontSize: 13.5,
                                  fontWeight: 700,
                                  color: "#0f172a",
                                  letterSpacing: "-0.01em",
                                }}
                              >
                                {grp.owner_name}
                              </span>
                            </div>
                          </div>

                          {/* Right: Summary Badges + Expand Toggle */}
                          <div
                            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Total Count Badge */}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#f1f5f9",
                                color: "#334155",
                                border: "1px solid #e2e8f0",
                              }}
                              title="Total carcasses for this owner"
                            >
                              Total: <strong>{grp.total || grp.items.length}</strong>
                            </span>

                            {/* Male Count Badge */}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                border: "1px solid #bfdbfe",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                              title="Count of male carcasses"
                            >
                              <span style={{ fontSize: 12 }}>♂</span> Male: <strong>{grp.maleCount || 0}</strong>
                            </span>

                            {/* Female Count Badge */}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "#fdf2f8",
                                color: "#be185d",
                                border: "1px solid #fbcfe8",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                              title="Count of female carcasses"
                            >
                              <span style={{ fontSize: 12 }}>♀</span> Female: <strong>{grp.femaleCount || 0}</strong>
                            </span>

                            {grp.unspecifiedCount > 0 && (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "#f8fafc",
                                  color: "#64748b",
                                  border: "1px solid #cbd5e1",
                                }}
                              >
                                Unspecified: <strong>{grp.unspecifiedCount}</strong>
                              </span>
                            )}

                            {/* Expand/Collapse Button */}
                            <button
                              type="button"
                              onClick={() => toggleOwnerExpand(grp.owner_name)}
                              style={{
                                background: "transparent",
                                border: "1px solid #cbd5e1",
                                borderRadius: 4,
                                padding: "2px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#475569",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                cursor: "pointer",
                                marginLeft: 2,
                              }}
                            >
                              {isExpanded ? (
                                <>Hide Tags <Icon.ChevronUp size={12} /></>
                              ) : (
                                <>View Tags <Icon.ChevronDown size={12} /></>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Dropdown Items (Scrollable Responsive Grid) */}
                        {isExpanded && (
                          <div
                            style={{
                              borderTop: "1px solid #e2e8f0",
                              background: "#f8fafc",
                              padding: "8px 10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 6,
                              }}
                            >
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                                Carcass Records ({selectedCount} of {grp.items.length} selected)
                              </span>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() => toggleOwnerPartial(grp)}
                                  style={{
                                    background: "#ffffff",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: 4,
                                    padding: "2px 7px",
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    color: "#d97706",
                                    cursor: "pointer",
                                  }}
                                >
                                  {allOwnerSelected ? "Deselect All" : "Select All"}
                                </button>
                              </div>
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                                gap: 6,
                                maxHeight: 180,
                                overflowY: "auto",
                                paddingRight: 4,
                                paddingBottom: 2,
                                scrollbarWidth: "thin",
                              }}
                            >
                              {grp.items.map((animal) => {
                                const tag = animal.tag_number;
                                const isPartialSelected = isTagPartial(tag);
                                const rawSex = String(animal.sex || getAnimalSex(animal) || "").trim().toLowerCase();
                                const isMale = rawSex === "male" || rawSex === "m";
                                const isFemale = rawSex === "female" || rawSex === "f";

                                return (
                                  <div
                                    key={animal.id || tag}
                                    onClick={() => {
                                      togglePartialTag(tag);
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "5px 8px",
                                      borderRadius: 6,
                                      border: isPartialSelected
                                        ? "1.5px solid #d97706"
                                        : "1px solid #cbd5e1",
                                      background: "#ffffff",
                                      boxShadow: isPartialSelected ? "0 1px 3px rgba(217, 119, 6, 0.1)" : "none",
                                      cursor: "pointer",
                                      transition: "all 0.12s ease",
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                                      <input
                                        type="checkbox"
                                        checked={isPartialSelected}
                                        onChange={() => {
                                          togglePartialTag(tag);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          width: 14,
                                          height: 14,
                                          accentColor: "#d97706",
                                          cursor: "pointer",
                                          flexShrink: 0,
                                        }}
                                      />
                                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                        <span
                                          style={{
                                            fontFamily: "monospace",
                                            fontWeight: 700,
                                            fontSize: 12,
                                            color: "#0f172a",
                                            lineHeight: 1.2,
                                          }}
                                        >
                                          {tag}
                                        </span>
                                        <span style={{ fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                                          {animal.species || "Carcass"}{animal.breed ? ` • ${animal.breed}` : ""}
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                      {isMale ? (
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            padding: "1px 5px",
                                            borderRadius: 4,
                                            background: "#eff6ff",
                                            color: "#1d4ed8",
                                            border: "1px solid #bfdbfe",
                                            lineHeight: 1.2,
                                          }}
                                        >
                                          ♂ Male
                                        </span>
                                      ) : isFemale ? (
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            padding: "1px 5px",
                                            borderRadius: 4,
                                            background: "#fdf2f8",
                                            color: "#be185d",
                                            border: "1px solid #fbcfe8",
                                            lineHeight: 1.2,
                                          }}
                                        >
                                          ♀ Female
                                        </span>
                                      ) : (
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 500,
                                            padding: "1px 5px",
                                            borderRadius: 4,
                                            background: "#f1f5f9",
                                            color: "#64748b",
                                            lineHeight: 1.2,
                                          }}
                                        >
                                          {getAnimalSex(animal)}
                                        </span>
                                      )}

                                      {isPartialSelected && (
                                        <span
                                          style={{
                                            fontSize: 9.5,
                                            fontWeight: 700,
                                            padding: "1px 4px",
                                            borderRadius: 4,
                                            background: "#fef3c7",
                                            color: "#92400e",
                                            border: "1px solid #fde68a",
                                            lineHeight: 1.2,
                                          }}
                                        >
                                          Partial
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          {/* Dedicated Partial Condemnation Card for Each Carcass */}
          {partialAnimals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", background: "#fffdf7", border: "1.5px dashed #fde68a", borderRadius: 10, color: "#92400e" }}>
              <Icon.Scale size={28} style={{ margin: "0 auto 8px", display: "block", opacity: 0.6 }} />
              <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                Check one or more carcass tags above to log condemned cuts.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {partialAnimals.map((animal, animalIdx) => {
                const details = getAnimalDetails(animal.tag_number);
                const availableTags = getAvailableTagsForPartialCard(animal.id);

                return (
                  <div
                    key={animal.id}
                    style={{
                      borderTop: animalIdx > 0 ? "1px solid var(--color-border, #e2e8f0)" : "none",
                      paddingTop: animalIdx > 0 ? 14 : 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    {/* Carcass Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-border, #fef3c7)", paddingBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            background: "#fef3c7",
                            color: "#92400e",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <Icon.Scale size={14} /> Carcass #{animalIdx + 1}
                        </span>
                        {animal.tag_number ? (
                          <span style={{ fontSize: 13.5, fontWeight: 800, color: "#92400e", fontFamily: "monospace" }}>
                            Tag #{animal.tag_number}
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309" }}>
                            (Select Tag Below)
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          ({details.sex} · Owner: {details.owner_name})
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removePartialAnimal(animal.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 9px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          border: "1px solid #fed7aa",
                          background: "#fff7ed",
                          color: "#c2410c",
                          cursor: "pointer",
                        }}
                        title="Remove this carcass from partial condemnation"
                      >
                        <Icon.Trash size={13} /> Remove Carcass
                      </button>
                    </div>

                    {/* Tag Dropdown (shown if unassigned or if user wants to reassign) */}
                    {!animal.tag_number && (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>
                          Select Carcass Tag <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <select
                          id={`partial-tag-${animal.id}`}
                          className="form-control"
                          value={animal.tag_number}
                          onChange={(e) => updatePartialAnimalTag(animal.id, e.target.value)}
                          required
                          style={{ width: "100%", height: 38, fontSize: 13, borderRadius: 6 }}
                        >
                          <option value="">-- Choose Carcass Tag --</option>
                          {availableTags.map((l) => (
                            <option key={l.id || l.tag_number} value={l.tag_number}>
                              Tag #{l.tag_number} — {getAnimalSex(l)} (Owner: {l.owner_name || "Unknown"})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Condemned Cuts for this Carcass */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {animal.parts.map((part, partIdx) => {
                        return (
                          <div
                            key={part.id}
                            style={{
                              background: "#ffffff",
                              border: "1.5px solid #fed7aa",
                              borderRadius: 9,
                              padding: "14px 16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: 12,
                            }}
                          >
                            {/* Grid Row 1: Carcass Area, Specific Part, Weight (kg), Pathology/Reason, Remove Button */}
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1.1fr 1.3fr 0.8fr 1.2fr 32px",
                                gap: 12,
                                alignItems: "start",
                              }}
                            >
                              {/* 1. Main Carcass Area */}
                              <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 3 }}>
                                  Carcass Area <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <select
                                  id={`cut-area-${part.id}`}
                                  className="form-control"
                                  value={part.carcassArea || part.part || CARCASS_AREAS[0]}
                                  onChange={(e) => updateAnimalPart(animal.id, part.id, "carcassArea", e.target.value)}
                                  style={{ height: 36, fontSize: 12.5, borderRadius: 6 }}
                                >
                                  {CARCASS_AREAS.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                  ))}
                                </select>
                              </div>

                              {/* 2. Specific Condemned Part */}
                              <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 3 }}>
                                  Specific Part <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <select
                                  id={`cut-specific-${part.id}`}
                                  className="form-control"
                                  value={part.specificPart || ""}
                                  onChange={(e) => updateAnimalPart(animal.id, part.id, "specificPart", e.target.value)}
                                  style={{
                                    height: 36,
                                    fontSize: 12.5,
                                    borderRadius: 6,
                                    borderColor: attemptedSubmit && !part.specificPart ? "#ef4444" : undefined,
                                    backgroundColor: attemptedSubmit && !part.specificPart ? "#fef2f2" : undefined,
                                  }}
                                >
                                  {(SPECIFIC_PARTS_BY_AREA[part.carcassArea || part.part || "Head"] || ["Other"]).map((sp) => (
                                    <option key={sp} value={sp}>{sp}</option>
                                  ))}
                                </select>

                                {part.specificPart === "Other" && (
                                  <div style={{ marginTop: 6 }}>
                                    <label style={{ fontSize: 10.5, fontWeight: 700, color: "#d97706", display: "block", marginBottom: 2 }}>
                                      Specify Condemned Part <span style={{ color: "#ef4444" }}>*</span>
                                    </label>
                                    <input
                                      id={`cut-custom-specific-${part.id}`}
                                      type="text"
                                      className="form-control"
                                      placeholder="Specify cut/part..."
                                      value={part.customSpecificPart || ""}
                                      onChange={(e) => updateAnimalPart(animal.id, part.id, "customSpecificPart", e.target.value)}
                                      style={{
                                        height: 34,
                                        fontSize: 12,
                                        borderRadius: 6,
                                        borderColor: attemptedSubmit && !(part.customSpecificPart || "").trim() ? "#ef4444" : "#f59e0b",
                                        backgroundColor: attemptedSubmit && !(part.customSpecificPart || "").trim() ? "#fef2f2" : undefined,
                                      }}
                                      required
                                    />
                                    {attemptedSubmit && !(part.customSpecificPart || "").trim() && (
                                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#ef4444", marginTop: 2, display: "block" }}>
                                        ⚠️ Please specify the condemned part.
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* 3. Weight (kg) */}
                              <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 3 }}>
                                  Weight (kg) <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <div style={{ position: "relative" }}>
                                  <input
                                    id={`cut-weight-${part.id}`}
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    className="form-control"
                                    placeholder="0.00"
                                    value={part.weight}
                                    onChange={(e) => updateAnimalPart(animal.id, part.id, "weight", e.target.value)}
                                    required
                                    style={{
                                      height: 36,
                                      fontSize: 12.5,
                                      borderRadius: 6,
                                      paddingRight: 28,
                                      fontWeight: 700,
                                      borderColor: attemptedSubmit && (!part.weight || isNaN(parseFloat(part.weight)) || parseFloat(part.weight) <= 0) ? "#ef4444" : undefined,
                                      backgroundColor: attemptedSubmit && (!part.weight || isNaN(parseFloat(part.weight)) || parseFloat(part.weight) <= 0) ? "#fef2f2" : undefined,
                                      boxShadow: attemptedSubmit && (!part.weight || isNaN(parseFloat(part.weight)) || parseFloat(part.weight) <= 0) ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                                    }}
                                  />
                                  <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#64748b", fontWeight: 700, pointerEvents: "none" }}>
                                    kg
                                  </span>
                                </div>
                                {attemptedSubmit && (!part.weight || isNaN(parseFloat(part.weight)) || parseFloat(part.weight) <= 0) && (
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#ef4444", marginTop: 3, display: "block" }}>
                                    ⚠️ Weight (kg) is required and must be &gt; 0 kg.
                                  </span>
                                )}
                              </div>

                              {/* 4. Pathology / Reason */}
                              <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 3 }}>
                                  Pathology / Reason <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <select
                                  id={`cut-reason-${part.id}`}
                                  className="form-control"
                                  value={part.reason}
                                  onChange={(e) => updateAnimalPart(animal.id, part.id, "reason", e.target.value)}
                                  style={{ height: 36, fontSize: 12.5, borderRadius: 6 }}
                                >
                                  {CONDEMNED_REASONS_LIST.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                                {isOtherReason(part.reason) && (
                                  <div style={{ marginTop: 6 }}>
                                    <label style={{ fontSize: 10.5, fontWeight: 700, color: "#d97706", display: "block", marginBottom: 2 }}>
                                      Specify Reason <span style={{ color: "#ef4444" }}>*</span>
                                    </label>
                                    <input
                                      id={`cut-custom-reason-${part.id}`}
                                      type="text"
                                      className="form-control"
                                      placeholder="Specify reason..."
                                      value={part.customReason || ""}
                                      onChange={(e) => updateAnimalPart(animal.id, part.id, "customReason", e.target.value)}
                                      style={{ height: 34, fontSize: 12, borderRadius: 6, borderColor: "#f59e0b" }}
                                      required
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Remove Cut Button */}
                              <div style={{ display: "flex", justifyContent: "center", paddingTop: 18 }}>
                                <button
                                  type="button"
                                  onClick={() => removePartFromAnimal(animal.id, part.id)}
                                  title="Remove this cut"
                                  style={{
                                    border: "none",
                                    background: "#fee2e2",
                                    color: "#ef4444",
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                  }}
                                >
                                  <Icon.Trash size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Row 2: Evidence Photo Upload */}
                            <div id={`cut-photos-${part.id}`} tabIndex={-1} style={{ paddingTop: 6, borderTop: "1px dashed #fed7aa", outline: "none" }}>
                              <MultiEvidenceUploader
                                photos={part.photos || []}
                                onChange={(newPhotos) => updateAnimalPart(animal.id, part.id, "photos", newPhotos)}
                                label={`Cut Evidence Photos (${part.specificPart || part.carcassArea || "Cut"})`}
                                hasError={attemptedSubmit}
                              />
                            </div>
                          </div>
                        );
                    })}

                      {/* Add Another Part Button (Matching Add Another Livestock Button) */}
                      <div style={{ marginTop: 6, marginBottom: 4 }}>
                        <button
                          type="button"
                          onClick={() => addPartToAnimal(animal.id)}
                          style={{
                            width: "100%",
                            padding: "11px 16px",
                            borderRadius: 8,
                            border: "1.5px dashed #f59e0b",
                            background: "rgba(245, 158, 11, 0.05)",
                            color: "#b45309",
                            fontSize: 13,
                            fontWeight: 750,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            transition: "all 0.15s ease",
                            boxSizing: "border-box",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(245, 158, 11, 0.12)";
                            e.currentTarget.style.borderColor = "#d97706";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(245, 158, 11, 0.05)";
                            e.currentTarget.style.borderColor = "#f59e0b";
                          }}
                        >
                          <Icon.Plus size={15} />
                          <span>Add Another Part</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}


            </div>
          )}
        </div>
      )}

      {/* Condemned Animals/Carcasses Section (Ante-Mortem & Whole Carcass Post-Mortem) */}
      {decision === "Condemned" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {anteCondemned.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "14px 16px",
                color: "#64748b",
                fontSize: 13,
                background: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: 10,
              }}
            >
              Check one or more {type === "Ante-Mortem" ? "animal" : "carcass"} tags above to specify condemnation reason and evidence photo.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {anteCondemned.map((entry) => {
                const details = getAnimalDetails(entry.tag_number);
                const availableTags = getAvailableTagsForCard(entry.id);

                return (
                  <div
                    key={entry.id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #fecaca",
                      borderRadius: 10,
                      padding: "14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                    }}
                  >
                    {/* Minimalist Card Header: Tag + Animal Info + Remove Icon */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: 800,
                            color: "#991b1b",
                            fontFamily: "monospace",
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            padding: "3px 9px",
                            borderRadius: 6,
                          }}
                        >
                          {entry.tag_number || "Select Tag"}
                        </span>
                        {entry.tag_number && (
                          <span style={{ fontSize: 12.5, color: "#64748b", fontWeight: 500 }}>
                            {details.species !== "—" ? details.species : ""}
                            {details.sex && details.sex !== "—" ? ` · ${details.sex}` : ""}
                            {details.owner_name && details.owner_name !== "—" ? ` · ${details.owner_name}` : ""}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCondemnedEntry(entry.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          border: "none",
                          background: "transparent",
                          color: "#94a3b8",
                          cursor: "pointer",
                        }}
                        title="Remove from condemnation"
                        aria-label="Remove from condemnation"
                      >
                        <Icon.X size={15} />
                      </button>
                    </div>

                    {/* Fallback Tag Selector only if entry has no tag_number */}
                    {!entry.tag_number && (
                      <div>
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>
                          {type === "Ante-Mortem" ? "Animal Tag Number" : "Carcass Tag Number"} <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <select
                          id={`condemned-tag-${entry.id}`}
                          className="form-control"
                          value={entry.tag_number || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateCondemnedEntry(entry.id, "tag_number", val);
                            setValidationErrors((prev) => {
                              const next = { ...prev };
                              delete next[`condemned-tag-${entry.id}`];
                              return next;
                            });
                          }}
                          style={{
                            width: "100%",
                            height: 38,
                            fontSize: 13,
                            borderRadius: 6,
                            borderColor: validationErrors[`condemned-tag-${entry.id}`] ? "#ef4444" : undefined,
                            backgroundColor: validationErrors[`condemned-tag-${entry.id}`] ? "#fef2f2" : undefined,
                          }}
                        >
                          <option value="">-- Choose Animal Tag --</option>
                          {availableTags.map((l) => (
                            <option key={l.tag_number} value={l.tag_number}>
                              {l.tag_number} ({getAnimalSex(l)} · Owner: {l.owner_name || "Unknown"})
                            </option>
                          ))}
                        </select>
                        {validationErrors[`condemned-tag-${entry.id}`] && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 3, display: "block" }}>
                            ⚠️ {validationErrors[`condemned-tag-${entry.id}`]}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Condemnation Reason */}
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 }}>
                        Condemnation Reason <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <select
                        id={`condemned-reason-${entry.id}`}
                        className="form-control"
                        value={entry.reason}
                        onChange={(e) => {
                          updateCondemnedEntry(entry.id, "reason", e.target.value);
                          setValidationErrors((prev) => {
                            const next = { ...prev };
                            delete next[`condemned-reason-${entry.id}`];
                            return next;
                          });
                        }}
                        required
                        style={{
                          width: "100%",
                          height: 38,
                          fontSize: 13,
                          borderRadius: 6,
                          borderColor: validationErrors[`condemned-reason-${entry.id}`] ? "#ef4444" : undefined,
                          backgroundColor: validationErrors[`condemned-reason-${entry.id}`] ? "#fef2f2" : undefined,
                        }}
                      >
                        {(type === "Post-Mortem" ? CONDEMNED_REASONS_LIST : ANTE_CONDEMNED_REASONS).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      {validationErrors[`condemned-reason-${entry.id}`] && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 3, display: "block" }}>
                          ⚠️ {validationErrors[`condemned-reason-${entry.id}`]}
                        </span>
                      )}
                      {isOtherReason(entry.reason) && (
                        <>
                          <input
                            id={`condemned-custom-reason-${entry.id}`}
                            type="text"
                            className="form-control"
                            placeholder="Specify custom condemnation reason..."
                            value={entry.customReason || ""}
                            onChange={(e) => {
                              updateCondemnedEntry(entry.id, "customReason", e.target.value);
                              setValidationErrors((prev) => {
                                const next = { ...prev };
                                delete next[`condemned-custom-reason-${entry.id}`];
                                return next;
                              });
                            }}
                            required
                            style={{
                              height: 34,
                              fontSize: 12.5,
                              borderRadius: 6,
                              marginTop: 6,
                              borderColor: validationErrors[`condemned-custom-reason-${entry.id}`] ? "#ef4444" : undefined,
                              backgroundColor: validationErrors[`condemned-custom-reason-${entry.id}`] ? "#fef2f2" : undefined,
                            }}
                          />
                          {validationErrors[`condemned-custom-reason-${entry.id}`] && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 3, display: "block" }}>
                              ⚠️ {validationErrors[`condemned-custom-reason-${entry.id}`]}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Multi-Evidence Upload Section (Ante-Mortem & Post-Mortem Condemnation) */}
                    <div id={`condemned-photos-${entry.id}`} tabIndex={-1} style={{ outline: "none" }}>
                      <MultiEvidenceUploader
                        photos={entry.photos || []}
                        onChange={(newPhotos) => {
                          updateCondemnedEntry(entry.id, "photos", newPhotos);
                          if (newPhotos && newPhotos.length > 0) {
                            setValidationErrors((prev) => {
                              const next = { ...prev };
                              delete next[`condemned-photos-${entry.id}`];
                              return next;
                            });
                          }
                        }}
                        label="Evidence Photos"
                        hasError={attemptedSubmit || !!validationErrors[`condemned-photos-${entry.id}`]}
                      />
                      {validationErrors[`condemned-photos-${entry.id}`] && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 3, display: "block" }}>
                          ⚠️ {validationErrors[`condemned-photos-${entry.id}`]}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Passed / Approved Animals & Carcasses Section deleted per user request to match Ante-Mortem layout */}

      </div>

      {/* Actions (Fixed Footer Pinned at Modal Bottom) */}
      <div
        className="inspection-form-fixed-actions"
        style={{
          marginTop: "auto",
          marginLeft: "-20px",
          marginRight: "-20px",
          marginBottom: 0,
          padding: "12px 20px",
          background: "var(--color-surface, #ffffff)",
          borderTop: "1px solid var(--color-border, #e2e8f0)",
          boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.04)",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          zIndex: 40,
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
          style={{ height: 36, padding: "0 16px", fontSize: 13, borderRadius: 8 }}
        >
          {isSaved ? "Close" : "Cancel"}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitting || isSaved}
          onClick={(e) => {
            e.preventDefault();
            if (isSaved) return;
            handleSubmit(e);
          }}
          style={{
            height: 36,
            background: isSaved
              ? "#94a3b8"
              : "linear-gradient(135deg, #10b981 0%, #047857 100%)",
            color: "#ffffff",
            fontWeight: 700,
            padding: "0 18px",
            fontSize: 13,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: isSaved ? "none" : "0 2px 6px rgba(16, 185, 129, 0.28)",
            cursor: isSaved ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? (
            <>
              <Icon.RefreshCw size={14} className="animate-spin" />
              <span>Recording Inspection...</span>
            </>
          ) : isSaved ? (
            <>
              <Icon.Check size={16} />
              <span>Inspection Recorded</span>
            </>
          ) : (
            <>
              <Icon.ClipboardCheck size={16} />
              <span>Record Inspection</span>
            </>
          )}
        </Button>
      </div>

      {/* Confirmation Modal prior to submitting inspection decisions */}
      <ConfirmDialog
        open={!!pendingConfirm}
        title={
          pendingConfirm?.isCondemnation || (pendingConfirm?.summary?.condemnedCount > 0 && pendingConfirm?.summary?.approvedCount === 0 && (pendingConfirm?.summary?.partialCount || 0) === 0)
            ? "Confirm Condemnation"
            : pendingConfirm?.summary?.approvedCount > 0 && pendingConfirm?.summary?.condemnedCount === 0 && (pendingConfirm?.summary?.partialCount || 0) === 0
            ? (type === "Ante-Mortem" ? "Confirm Ante-Mortem Approval" : "Confirm Post-Mortem Approval")
            : (pendingConfirm?.summary?.partialCount || 0) > 0 && pendingConfirm?.summary?.approvedCount === 0 && pendingConfirm?.summary?.condemnedCount === 0
            ? "Confirm Partial Condemnation"
            : pendingConfirm?.summary?.title || `Confirm ${type} Inspection Approval`
        }
        message={
          pendingConfirm?.summary ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pendingConfirm.isCondemnation || (pendingConfirm.summary.condemnedCount > 0 && pendingConfirm.summary.approvedCount === 0 && (pendingConfirm.summary.partialCount || 0) === 0) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8,
                      fontSize: 12.5,
                      color: "#991b1b",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Icon.AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0 }} />
                    <span>
                      {type === "Ante-Mortem"
                        ? "This action will officially condemn and reject the animal(s). They will NOT proceed to slaughter."
                        : "This action will officially condemn the carcass(es). They will NOT proceed to human consumption."}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, background: "#ffffff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr 1.5fr", fontWeight: 700, fontSize: 11, color: "#64748b", borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                      <span>Tag Number</span>
                      <span>Sex</span>
                      <span>Heads</span>
                      <span>Reason</span>
                    </div>
                    {(pendingConfirm.summary.condemnedList || []).map((item, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr 1.5fr", fontSize: 12, alignItems: "center", padding: "4px 0" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#991b1b" }}>{item.tag}</span>
                        <span style={{ color: "#334155" }}>{getAnimalSex(item.animal || item.tag) || item.sex || item.species}</span>
                        <span style={{ color: "#334155", fontWeight: 600 }}>{item.heads} head</span>
                        <span style={{ color: "#b91c1c", fontWeight: 600 }}>{item.reason}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#475569", paddingTop: 4 }}>
                    <div><strong>Inspecting Officer:</strong> {pendingConfirm.summary.officer || "Dr. Dave"}</div>
                    <div><strong>Total Condemned:</strong> {pendingConfirm.summary.heads || pendingConfirm.summary.condemnedCount} head(s)</div>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: 0, fontSize: 13.5, color: "#334155" }}>
                    {pendingConfirm.summary.approvedCount > 0 && pendingConfirm.summary.condemnedCount === 0 && (pendingConfirm.summary.partialCount || 0) === 0
                      ? (type === "Ante-Mortem"
                          ? "Are you sure you want to approve this livestock for slaughter?"
                          : "Are you sure you want to approve this carcass for human consumption?")
                      : `Are you sure you want to approve and certify this ${pendingConfirm.summary.type} inspection decision?`}
                  </p>
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "12px 14px",
                      fontSize: 12.5,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div>
                      <strong style={{ color: "#475569" }}>Inspection Stage:</strong> {pendingConfirm.summary.type}
                    </div>
                    {pendingConfirm.summary.approvedCount > 0 && (
                      <div style={{ color: "#166534", fontWeight: 600 }}>
                        ✓ Approved: {pendingConfirm.summary.approvedCount} {pendingConfirm.summary.type === "Ante-Mortem" ? (pendingConfirm.summary.approvedCount === 1 ? "head" : "heads") : (pendingConfirm.summary.approvedCount === 1 ? "carcass" : "carcasses")}
                      </div>
                    )}
                    {pendingConfirm.summary.condemnedCount > 0 && (
                      <div style={{ color: "#991b1b", fontWeight: 600 }}>
                        ✕ Condemned: {pendingConfirm.summary.condemnedCount} {pendingConfirm.summary.type === "Ante-Mortem" ? (pendingConfirm.summary.condemnedCount === 1 ? "head" : "heads") : (pendingConfirm.summary.condemnedCount === 1 ? "carcass" : "carcasses")}
                      </div>
                    )}
                    {pendingConfirm.summary.partialCount > 0 && (
                      <div style={{ color: "#92400e", fontWeight: 600 }}>
                        ⚠ Partial Condemnation: {pendingConfirm.summary.partialCount} {pendingConfirm.summary.partialCount === 1 ? "carcass" : "carcasses"} ({pendingConfirm.summary.totalCuts} {pendingConfirm.summary.totalCuts === 1 ? "condemned cut" : "condemned cuts"})
                      </div>
                    )}
                    <div style={{ paddingTop: 4, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
                      <strong>Inspecting Officer:</strong> {pendingConfirm.summary.officer || "Dr. Dave"}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                    Clicking confirm will officially record this decision and update animal status.
                  </p>
                </>
              )}
            </div>
          ) : ""
        }
        confirmText="Record Inspection"
        confirmVariant={
          pendingConfirm?.isCondemnation || (pendingConfirm?.summary?.condemnedCount > 0 && pendingConfirm?.summary?.approvedCount === 0)
            ? "danger"
            : (pendingConfirm?.summary?.partialCount || 0) > 0
            ? "warning"
            : "success"
        }
        loading={submitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setPendingConfirm(null)}
      />
    </form>
  );
};
