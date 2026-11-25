import { useState, useEffect, useMemo, useCallback } from "react";
import { Icon } from "../icons";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { TagBadge } from "../ui/TagBadge";
import {
  collectCondemnationEvidencePhotos,
  resolveEvidencePhotoUrl,
} from "../../pages/vet/condemnationEvidencePhotos";
import {
  formatManilaDateTime,
  resolveCondemningPersonnel,
} from "../../pages/vet/VetExtra";
import { matchesStage } from "../../pages/vet/condemnationStage";
import { getCondemnationRecordParts } from "../../pages/vet/condemnationEvidenceIndex";

export const CondemnationEvidenceModal = ({
  open,
  onClose,
  record,
  livestock = [],
  owners = [],
  ante = [],
  post = [],
  condemned = [],
  postCuts = [],
  evidence = [],
  users = [],
}) => {
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const [imgLoadState, setImgLoadState] = useState("loading");
  const [missingPhotoUrls, setMissingPhotoUrls] = useState(() => new Set());
  const [retryCount, setRetryCount] = useState(0);

  const cleanTag = useMemo(() => {
    return String(record?.tag_number || record?.raw?.tag_number || "").trim().toLowerCase();
  }, [record]);

  const cleanId = useMemo(() => {
    return String(record?.livestock_id || record?.raw?.livestock_id || "").trim();
  }, [record]);

  const stage = useMemo(() => {
    return (
      record?.stageLabel ||
      record?.raw?.inspection_type ||
      (record?.reportTitle && record.reportTitle.toLowerCase().includes("ante")
        ? "Ante-Mortem"
        : record?.raw?.part === "Live Animal"
        ? "Ante-Mortem"
        : "Post-Mortem")
    );
  }, [record]);

  useEffect(() => {
    setActivePhotoIndex(0);
    setZoomLevel(1);
    setIsEnlarged(false);
    setImgLoadState("loading");
  }, [record?.id, record?.tag_number]);

  const tagPhotos = useMemo(() => {
    if (!record) return [];

    const targetObj = record.raw || record;
    const collected = collectCondemnationEvidencePhotos({
      target: targetObj,
      type: stage,
      evidence: evidence || [],
      post: post || [],
      condemned: condemned || [],
      postCuts: postCuts || [],
    });

    if (collected && collected.length > 0) return collected;

    const candidates = [
      targetObj?.photo_url,
      targetObj?.file_url,
      targetObj?.file_preview,
      targetObj?.file_path,
      record?.photo_url,
      record?.file_url,
      record?.file_preview,
    ].filter(Boolean);

    for (const cand of candidates) {
      const resolved = resolveEvidencePhotoUrl(cand);
      if (resolved) {
        return [
          {
            id: targetObj?.id || record?.id || "fallback-0",
            url: resolved,
            name: targetObj?.file_name || record?.file_name || "Evidence Photo",
            notes: targetObj?.reason || targetObj?.findings || targetObj?.notes || record?.details || "",
            part: targetObj?.part || record?.part || "",
            record: targetObj,
          },
        ];
      }
    }

    return [];
  }, [record, stage, evidence, post, condemned, postCuts]);

  const currentPhotoIndex = activePhotoIndex < tagPhotos.length ? activePhotoIndex : 0;
  const currentPhoto = tagPhotos[currentPhotoIndex] || null;

  const isPhotoMissing = useCallback(
    (url) => Boolean(url && missingPhotoUrls.has(String(url).split("?")[0])),
    [missingPhotoUrls]
  );

  const markPhotoMissing = useCallback((url) => {
    if (!url) return;
    const key = String(url).split("?")[0];
    setMissingPhotoUrls((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const unmarkPhotoMissing = useCallback((url) => {
    if (!url) return;
    const key = String(url).split("?")[0];
    setMissingPhotoUrls((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const currentFileKind = useMemo(() => {
    if (!currentPhoto?.url) return "none";
    const urlLower = String(currentPhoto.url).toLowerCase();
    const nameLower = String(currentPhoto.name || "").toLowerCase();
    if (urlLower.startsWith("data:image/") || urlLower.startsWith("blob:")) return "image";
    if (/\.(jpg|jpeg|png|webp|gif|svg|avif)(\?|$)/i.test(urlLower) || /\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(nameLower)) {
      return "image";
    }
    if (/\.(pdf|doc|docx|xls|xlsx|txt)(\?|$)/i.test(urlLower) || /\.(pdf|doc|docx|xls|xlsx|txt)$/i.test(nameLower)) {
      return "document";
    }
    return "image";
  }, [currentPhoto]);

  useEffect(() => {
    if (!open || tagPhotos.length <= 1) return;
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft") {
        setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : tagPhotos.length - 1));
      } else if (e.key === "ArrowRight") {
        setActivePhotoIndex((prev) => (prev < tagPhotos.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, tagPhotos.length]);

  if (!open || !record) return null;

  const displayRecord = currentPhoto?.record || record.raw || record;

  const matchedAnimal = (livestock || []).find((l) => {
    const lId = String(l.id || "").trim();
    const lTag = String(l.tag_number || "").trim().toLowerCase();
    return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
  });

  const matchedAnte = (ante || []).find((a) => {
    const aTag = String(a.tag_number || "").trim().toLowerCase();
    const aId = String(a.livestock_id || "").trim();
    return (cleanTag && aTag === cleanTag) || (cleanId && aId === cleanId);
  });

  const matchedPost = (post || []).find((p) => {
    const pTag = String(p.tag_number || "").trim().toLowerCase();
    const pId = String(p.livestock_id || "").trim();
    return (cleanTag && pTag === cleanTag) || (cleanId && pId === cleanId);
  });

  const matchedInspection = stage === "Post-Mortem" ? (matchedPost || matchedAnte) : (matchedAnte || matchedPost);

  const matchedCondemnedRows = (condemned || []).filter(
    (c) => cleanTag && String(c.tag_number || "").trim().toLowerCase() === cleanTag && matchesStage(c, stage)
  );

  const matchedCut = (postCuts || []).find(
    (c) => cleanTag && String(c?.tag_number || "").trim().toLowerCase() === cleanTag
  );

  const resolvedOwnerId =
    record.owner_id ||
    displayRecord.owner_id ||
    matchedAnimal?.owner_id;

  const matchedOwner = resolvedOwnerId
    ? (owners || []).find((o) => {
        const cleanTarget = String(resolvedOwnerId).trim().toLowerCase();
        return (
          String(o.id || "").trim().toLowerCase() === cleanTarget ||
          String(o.owner_id || "").trim().toLowerCase() === cleanTarget ||
          String(o.temp_reg_id || "").trim().toLowerCase() === cleanTarget ||
          String(o.auth_user_id || "").trim().toLowerCase() === cleanTarget
        );
      })
    : null;

  const ownerDisplay =
    matchedOwner?.name ||
    record.owner_name ||
    displayRecord.owner_name ||
    displayRecord.owner ||
    "Not recorded";

  const tagValue =
    String(record.tag_number || displayRecord.tag_number || matchedAnimal?.tag_number || "").trim();

  const isRealSpecies = (val) => {
    if (!val || typeof val !== "string") return false;
    const s = val.trim().toLowerCase();
    return s !== "" && s !== "—" && s !== "-" && s !== "livestock" && s !== "carcass" && s !== "unknown" && s !== "n/a";
  };
  const speciesCandidates = [
    record.species,
    displayRecord.species,
    matchedAnimal?.species,
    matchedInspection?.species,
    matchedCondemnedRows[0]?.species,
  ];
  const resolvedSpecies = speciesCandidates.find(isRealSpecies)?.trim() || "Not recorded";

  const condPartsInfo = getCondemnationRecordParts({
    record: displayRecord,
    stage,
    ante,
    post,
    livestock,
    condemned,
    postCuts,
  });
  const isWhole = condPartsInfo.isWhole;
  const condemnationTypeDisplay = condPartsInfo.scopeLabel;

  const cleanEvidenceNotes = (rawNotes) => {
    if (!rawNotes) return "";
    let str = String(rawNotes).trim();
    str = str.replace(/\[Whole Carcass Condemnation\]\s*/gi, "");
    str = str.replace(/\[Partial Condemnation[^\]]*\]\s*/gi, "");
    return str.trim();
  };

  const rawPhotoNotes = cleanEvidenceNotes(currentPhoto?.notes);
  const rawInspFindings = String(matchedInspection?.findings || matchedInspection?.remarks || "").trim();
  const rawCondReason = matchedCondemnedRows
    .map((c) => String(c?.reason || c?.notes || "").trim())
    .filter(Boolean)
    .join("; ");
  const fallbackRecordNotes = cleanEvidenceNotes(displayRecord?.reason || displayRecord?.notes || record?.details);
  const findingsCandidates = [rawPhotoNotes, rawInspFindings, rawCondReason, fallbackRecordNotes]
    .map((s) => String(s || "").trim())
    .filter((s) => s && s !== "—" && s !== "-");
  const findingsDisplay = findingsCandidates[0] || "Not recorded";

  const rawTimestamp =
    (stage === "Post-Mortem"
      ? (matchedCut?.created_at || matchedAnimal?.post_inspected_at || matchedCondemnedRows[0]?.created_at)
      : (matchedAnimal?.ante_inspected_at || matchedCondemnedRows[0]?.created_at)) ||
    currentPhoto?.record?.created_at ||
    matchedInspection?.created_at ||
    displayRecord?.created_at ||
    matchedCondemnedRows[0]?.date ||
    displayRecord?.date ||
    matchedInspection?.date ||
    record.date ||
    null;
  const condemnationDateTimeDisplay = formatManilaDateTime(rawTimestamp);

  const condemnedInspector =
    resolveCondemningPersonnel({
      record: matchedCondemnedRows[0] || displayRecord,
      livestock: matchedAnimal,
      inspection: matchedInspection,
      cut: matchedCut,
      users,
    }) ||
    record.personnel ||
    displayRecord.inspector ||
    "Veterinary Inspector";

  const isCurrentFailed =
    currentFileKind === "image" &&
    (imgLoadState === "error" || (currentPhoto?.url && isPhotoMissing(currentPhoto.url)));
  const isCurrentLoading =
    currentFileKind === "image" && !isCurrentFailed && imgLoadState === "loading";

  const handleRetryPhoto = () => {
    if (!currentPhoto?.url) return;
    unmarkPhotoMissing(currentPhoto.url);
    setImgLoadState("loading");
    setRetryCount((c) => c + 1);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Condemnation Evidence Viewer"
        size="lg"
        dialogStyle={{
          maxWidth: "860px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
        bodyStyle={{
          padding: "16px 20px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
        closeOnBackdropClick
      >
        <div className="vet-evidence-viewer-root" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="vet-evidence-viewer-grid">
            <div className="vet-evidence-viewer-media-col">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#2D332F",
                  borderBottom: "1px solid #444C47",
                  color: "#F9FAF8",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: "#E2E6E3",
                      background: "#1A201C",
                      padding: "3px 9px",
                      borderRadius: 6,
                      border: "1px solid #444C47",
                    }}
                    data-testid="evidence-photo-counter"
                  >
                    {tagPhotos.length > 0
                      ? `${currentPhotoIndex + 1} of ${tagPhotos.length}`
                      : "0 of 0"}
                  </span>
                  {currentPhoto?.part && (
                    <span style={{ color: "#9BA49E", fontSize: 11.5, fontWeight: 600 }}>
                      Part: <strong style={{ color: "#EFF2F0" }}>{currentPhoto.part}</strong>
                    </span>
                  )}
                  {tagPhotos.length > 1 && (
                    <span style={{ color: "#5D6660", fontSize: 11 }} className="vet-ev-kbd-hint">
                      Use ? / ? keys to navigate
                    </span>
                  )}
                </div>

                {currentFileKind === "image" && currentPhoto?.url && !isCurrentFailed && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                      disabled={zoomLevel <= 1}
                      title="Zoom out"
                      aria-label="Zoom out"
                      style={{
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 5,
                        border: "1px solid #5D6660",
                        background: zoomLevel <= 1 ? "#1A201C" : "#444C47",
                        color: zoomLevel <= 1 ? "#5D6660" : "#F9FAF8",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: zoomLevel <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomLevel(1)}
                      title="Reset zoom to 100%"
                      style={{
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 5,
                        border: "1px solid #5D6660",
                        background: "#1A201C",
                        color: "#E2E6E3",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        minWidth: 46,
                      }}
                    >
                      {Math.round(zoomLevel * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.5).toFixed(1)))}
                      disabled={zoomLevel >= 2.5}
                      title="Zoom in"
                      aria-label="Zoom in"
                      style={{
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 5,
                        border: "1px solid #5D6660",
                        background: zoomLevel >= 2.5 ? "#1A201C" : "#444C47",
                        color: zoomLevel >= 2.5 ? "#5D6660" : "#F9FAF8",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: zoomLevel >= 2.5 ? "not-allowed" : "pointer",
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEnlarged(true)}
                      title="Enlarge image to full screen"
                      style={{
                        height: 26,
                        padding: "0 9px",
                        borderRadius: 5,
                        border: "1px solid #187A56",
                        background: "#187A56",
                        color: "#ffffff",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icon.Eye size={12} /> Enlarge
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
                      title="Open original file in a new tab"
                      style={{
                        height: 26,
                        padding: "0 9px",
                        borderRadius: 5,
                        border: "1px solid #5D6660",
                        background: "#444C47",
                        color: "#F9FAF8",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icon.ExternalLink size={12} /> Open
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 200,
                  maxHeight: "270px",
                  background: "#1A201C",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: zoomLevel > 1 ? "auto" : "hidden",
                  padding: 10,
                }}
              >
                {currentFileKind === "none" ? (
                  <div
                    data-testid="evidence-empty-state"
                    style={{
                      padding: "36px 24px",
                      textAlign: "center",
                      color: "#C2CAC4",
                      maxWidth: 380,
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: "50%",
                        background: "rgba(148, 163, 184, 0.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 12px",
                        color: "#9BA49E",
                      }}
                    >
                      <Icon.FileText size={26} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#F9FAF8" }}>
                      No evidence file exists for this record
                    </div>
                    <div style={{ fontSize: 12.5, color: "#9BA49E", marginTop: 6, lineHeight: 1.5 }}>
                      No photo or document file is attached to this condemnation record.
                    </div>
                  </div>
                ) : currentFileKind === "document" ? (
                  <div
                    data-testid="evidence-document-state"
                    style={{
                      padding: "36px 24px",
                      textAlign: "center",
                      color: "#E2E6E3",
                      maxWidth: 420,
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 12,
                        background: "rgba(24, 122, 86, 0.16)",
                        border: "1px solid rgba(24, 122, 86, 0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 12px",
                        color: "#24966D",
                      }}
                    >
                      <Icon.FileText size={28} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#F9FAF8", wordBreak: "break-word" }}>
                      {currentPhoto.name || displayRecord.file_name || "Evidence Document"}
                    </div>
                    <div style={{ fontSize: 12, color: "#9BA49E", marginTop: 4 }}>
                      {displayRecord.type || "Document"} • Non-image evidence file
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
                      <Button
                        size="sm"
                        onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
                      >
                        <Icon.ExternalLink size={14} /> Open Document
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = currentPhoto.url;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          a.download = currentPhoto.name || displayRecord.file_name || "evidence-document";
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                      >
                        <Icon.Download size={14} /> Download File
                      </Button>
                    </div>
                  </div>
                ) : isCurrentFailed ? (
                  <div
                    data-testid="evidence-error-state"
                    style={{
                      padding: "32px 24px",
                      textAlign: "center",
                      color: "#C2CAC4",
                      maxWidth: 440,
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: "50%",
                        background: "rgba(245, 158, 11, 0.14)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 12px",
                        color: "#f59e0b",
                      }}
                    >
                      <Icon.AlertTriangle size={26} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#F9FAF8" }}>
                      Unable to load evidence photo
                    </div>
                    <div style={{ fontSize: 12.5, color: "#9BA49E", marginTop: 6, lineHeight: 1.5 }}>
                      The image file could not be loaded from storage. The file may have been removed or the URL is temporarily unreachable.
                    </div>
                    {currentPhoto.name && (
                      <div style={{ fontSize: 11.5, color: "#5D6660", marginTop: 8, wordBreak: "break-all" }}>
                        File: {currentPhoto.name}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
                      <Button size="sm" onClick={handleRetryPhoto}>
                        <Icon.RefreshCw size={13} /> Retry Load
                      </Button>
                      {currentPhoto.url && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
                        >
                          <Icon.ExternalLink size={13} /> Open Link Directly
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {isCurrentLoading && (
                      <div
                        data-testid="evidence-loading-state"
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(26, 32, 28, 0.82)",
                          color: "#E2E6E3",
                          zIndex: 3,
                          gap: 10,
                        }}
                      >
                        <span className="spinner" style={{ width: 28, height: 28 }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#C2CAC4" }}>
                          Loading evidence photo...
                        </span>
                      </div>
                    )}
                    <img
                      key={`${displayRecord.id || tagValue}-${currentPhotoIndex}-${currentPhoto.url}-${retryCount}`}
                      src={currentPhoto.url}
                      alt={currentPhoto.name || `Evidence photo for ${tagValue || "record"}`}
                      onClick={() => setIsEnlarged(true)}
                      onLoad={() => setImgLoadState("loaded")}
                      onError={() => {
                        markPhotoMissing(currentPhoto.url);
                        setImgLoadState("error");
                      }}
                      title="Click to enlarge photo"
                      style={{
                        width: zoomLevel > 1 ? `${zoomLevel * 100}%` : "100%",
                        height: zoomLevel > 1 ? "auto" : "100%",
                        maxWidth: zoomLevel > 1 ? "none" : "100%",
                        maxHeight: zoomLevel > 1 ? "none" : "250px",
                        objectFit: "contain",
                        borderRadius: 6,
                        cursor: "zoom-in",
                        transition: "opacity 0.15s ease",
                        opacity: isCurrentLoading ? 0.25 : 1,
                      }}
                    />
                  </>
                )}

                {tagPhotos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : tagPhotos.length - 1))
                      }
                      aria-label="Previous photo"
                      title="Previous photo (Left arrow)"
                      style={{
                        position: "absolute",
                        left: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "rgba(26, 32, 28, 0.82)",
                        color: "#ffffff",
                        border: "1px solid rgba(255,255,255,0.25)",
                        borderRadius: "50%",
                        width: 38,
                        height: 38,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
                        zIndex: 4,
                      }}
                    >
                      <Icon.ChevronLeft size={20} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePhotoIndex((prev) => (prev < tagPhotos.length - 1 ? prev + 1 : 0))
                      }
                      aria-label="Next photo"
                      title="Next photo (Right arrow)"
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "rgba(26, 32, 28, 0.82)",
                        color: "#ffffff",
                        border: "1px solid rgba(255,255,255,0.25)",
                        borderRadius: "50%",
                        width: 38,
                        height: 38,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
                        zIndex: 4,
                      }}
                    >
                      <Icon.ChevronRight size={20} />
                    </button>
                  </>
                )}
              </div>

              {tagPhotos.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#2D332F",
                    borderTop: "1px solid #444C47",
                    overflowX: "auto",
                  }}
                >
                  {tagPhotos.map((photo, idx) => {
                    const isSelected = idx === currentPhotoIndex;
                    const thumbFailed = isPhotoMissing(photo.url);
                    return (
                      <button
                        key={photo.id || idx}
                        type="button"
                        onClick={() => setActivePhotoIndex(idx)}
                        title={photo.part ? `${photo.part} (${idx + 1} of ${tagPhotos.length})` : `Photo ${idx + 1} of ${tagPhotos.length}`}
                        style={{
                          width: 58,
                          height: 42,
                          padding: 0,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: isSelected ? "2px solid #24966D" : "1px solid #5D6660",
                          background: "#1A201C",
                          cursor: "pointer",
                          flexShrink: 0,
                          position: "relative",
                          opacity: isSelected ? 1 : 0.72,
                        }}
                      >
                        {!thumbFailed && photo.url ? (
                          <img
                            src={photo.url}
                            alt={photo.name || `Thumbnail ${idx + 1}`}
                            onError={() => markPhotoMissing(photo.url)}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "100%",
                              height: "100%",
                              fontSize: 9,
                              fontWeight: 700,
                              color: "#f59e0b",
                            }}
                          >
                            N/A
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="vet-evidence-viewer-details-col">
              <div
                className="vet-evidence-viewer-details-header"
                style={{
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--color-text-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <span>Condemnation Details</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: isWhole ? "#dc2626" : "#d97706",
                    background: isWhole ? "rgba(220, 38, 38, 0.08)" : "rgba(217, 119, 6, 0.08)",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {isWhole ? "Whole Condemnation" : `${condPartsInfo.totalParts} Parts Rejected`}
                </span>
              </div>

              <dl className="vet-evidence-viewer-dl">
                <div className="vet-evidence-viewer-row">
                  <dt>Owner</dt>
                  <dd>{ownerDisplay}</dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <dt>{stage === "Post-Mortem" ? "Carcass Tag #" : "Livestock Tag #"}</dt>
                  <dd>
                    {tagValue ? <TagBadge tag={tagValue} /> : <span>Not recorded</span>}
                  </dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <dt>Species</dt>
                  <dd>{resolvedSpecies}</dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <dt>Condemnation Classification</dt>
                  <dd>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontWeight: 750,
                        fontSize: 12.5,
                        color: isWhole ? "#dc2626" : "#d97706",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: isWhole ? "#dc2626" : "#d97706",
                        }}
                      />
                      {condemnationTypeDisplay}
                    </span>
                  </dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <dt>Condemned Parts & Quantities</dt>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: isWhole ? "#dc2626" : "#b45309",
                      }}
                    >
                      Total: {condPartsInfo.totalParts} {condPartsInfo.totalParts === 1 ? "Part" : "Parts"}
                    </span>
                  </div>
                  <dd style={{ marginTop: 4 }}>
                    {condPartsInfo.parts.length === 0 ? (
                      <span style={{ color: "var(--color-text-muted)" }}>Not recorded</span>
                    ) : isWhole ? (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(220, 38, 38, 0.05)",
                          border: "1px solid rgba(220, 38, 38, 0.2)",
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "#dc2626", fontSize: 12.5 }}>
                          • {condPartsInfo.parts[0].part}
                        </span>
                        <span style={{ fontWeight: 800, color: "#dc2626", fontSize: 12.5 }}>
                          {condPartsInfo.parts[0].quantity}
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {condPartsInfo.parts.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              padding: "6px 9px",
                              borderRadius: 6,
                              background: "var(--color-bg)",
                              border: "1px solid var(--color-border)",
                              gap: 8,
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 12 }}>
                                  {idx + 1}. {p.part}
                                </span>
                                {p.location && (
                                  <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                                    ({p.location})
                                  </span>
                                )}
                              </div>
                              {p.reason && (
                                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                  Reason: <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>{p.reason}</strong>
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <span
                                style={{
                                  fontWeight: 800,
                                  fontSize: 11.5,
                                  color: "#b45309",
                                  background: "rgba(217, 119, 6, 0.1)",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  border: "1px solid rgba(217, 119, 6, 0.25)",
                                  display: "inline-block",
                                }}
                              >
                                {p.quantity || p.weight || "1 pc"}
                              </span>
                              {p.disposition && (
                                <div style={{ fontSize: 9.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                                  {p.disposition}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <dt>Inspection Findings & Pathology Notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, fontSize: 12.5 }}>{findingsDisplay}</dd>
                </div>

                <div className="vet-evidence-viewer-row">
                  <dt>Condemnation Date & Time</dt>
                  <dd>{condemnationDateTimeDisplay}</dd>
                </div>

                <div className="vet-evidence-viewer-row" style={{ borderBottom: "none" }}>
                  <dt>Condemned By (Veterinarian / Inspector)</dt>
                  <dd style={{ fontWeight: 600 }}>{condemnedInspector}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div
            className="form-actions"
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {isEnlarged && currentPhoto?.url && !isCurrentFailed && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged evidence photo"
            onClick={() => setIsEnlarged(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2, 6, 23, 0.92)",
              zIndex: 1200,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                maxWidth: "94vw",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <img
                src={currentPhoto.url}
                alt={currentPhoto.name || "Enlarged evidence photo"}
                style={{
                  maxWidth: "94vw",
                  maxHeight: "84vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                }}
              />
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  color: "#F9FAF8",
                  fontSize: 12.5,
                }}
              >
                {tagPhotos.length > 1 && (
                  <span>
                    Photo {currentPhotoIndex + 1} of {tagPhotos.length}
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={() => setIsEnlarged(false)}>
                  Close Enlarged View
                </Button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          .vet-evidence-viewer-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(320px, 1.15fr);
            gap: 14px;
            align-items: start;
            flex: 1;
            min-height: 0;
          }
          @media (max-width: 820px) {
            .vet-evidence-viewer-grid {
              grid-template-columns: 1fr;
              overflow-y: auto;
            }
            .vet-ev-kbd-hint {
              display: none;
            }
          }
          .vet-evidence-viewer-media-col {
            display: flex;
            flex-direction: column;
            border: 1px solid var(--color-border);
            border-radius: 10px;
            overflow: hidden;
            background: #1A201C;
            flex-shrink: 0;
          }
          .vet-evidence-viewer-details-col {
            display: flex;
            flex-direction: column;
            border: 1px solid var(--color-border);
            border-radius: 10px;
            background: var(--color-surface);
            overflow: hidden;
            max-height: min(400px, calc(85vh - 175px));
            min-height: 0;
          }
          @media (max-width: 820px) {
            .vet-evidence-viewer-details-col {
              max-height: 280px;
            }
          }
          .vet-evidence-viewer-dl {
            margin: 0;
            padding: 0;
            overflow-y: auto;
            flex: 1;
            min-height: 0;
            scrollbar-width: thin;
            overscroll-behavior: contain;
          }
          .vet-evidence-viewer-dl::-webkit-scrollbar {
            width: 6px;
          }
          .vet-evidence-viewer-dl::-webkit-scrollbar-track {
            background: transparent;
          }
          .vet-evidence-viewer-dl::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.4);
            border-radius: 4px;
          }
          .vet-evidence-viewer-dl::-webkit-scrollbar-thumb:hover {
            background: rgba(148, 163, 184, 0.7);
          }
          .vet-evidence-viewer-row {
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--color-border);
            font-size: 12.5px;
          }
          .vet-evidence-viewer-row:last-child {
            border-bottom: none;
          }
          .vet-evidence-viewer-row dt {
            margin: 0;
            font-size: 10.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--color-text-muted);
          }
          .vet-evidence-viewer-row dd {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
            color: var(--color-text);
            word-break: break-word;
            line-height: 1.4;
          }
        `}</style>
      </Modal>
    </>
  );
};
