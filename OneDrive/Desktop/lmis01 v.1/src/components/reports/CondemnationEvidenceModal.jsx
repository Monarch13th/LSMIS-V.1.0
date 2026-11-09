import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

  // Reset state when target record changes
  useEffect(() => {
    setActivePhotoIndex(0);
    setZoomLevel(1);
    setIsEnlarged(false);
    setImgLoadState("loading");
  }, [record?.id, record?.tag_number]);

  // Collect all photos across database tables for this record
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

    // Fallback: check record and record.raw directly
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

  // Determine file kind (image, document, or none)
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
    return "image"; // Default to image if URL exists
  }, [currentPhoto]);

  // Keyboard navigation for multi-photo sets
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

  // Source entity lookups
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

  // 1. Owner Display - prioritizes master owners directory
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

  // 2. Tag Value
  const tagValue =
    String(record.tag_number || displayRecord.tag_number || matchedAnimal?.tag_number || "").trim();

  // 3. Species
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

  // 4. Condemnation Scope & Parts extraction from Supabase
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

  // 6. Findings / Pathology Notes
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

  // 7. Condemnation Date & Time
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

  // 8. Inspector / Condemned By
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

  // Image load & failure states
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
            {/* ── LEFT COLUMN: PHOTO & FILE VIEWER ── */}
            <div className="vet-evidence-viewer-media-col">
              {/* Top Bar: Counter & Zoom Controls */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#1e293b",
                  borderBottom: "1px solid #334155",
                  color: "#f8fafc",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: "#e2e8f0",
                      background: "#0f172a",
                      padding: "3px 9px",
                      borderRadius: 6,
                      border: "1px solid #334155",
                    }}
                    data-testid="evidence-photo-counter"
                  >
                    {tagPhotos.length > 0
                      ? `${currentPhotoIndex + 1} of ${tagPhotos.length}`
                      : "0 of 0"}
                  </span>
                  {currentPhoto?.part && (
                    <span style={{ color: "#94a3b8", fontSize: 11.5, fontWeight: 600 }}>
                      Part: <strong style={{ color: "#f1f5f9" }}>{currentPhoto.part}</strong>
                    </span>
                  )}
                  {tagPhotos.length > 1 && (
                    <span style={{ color: "#64748b", fontSize: 11 }} className="vet-ev-kbd-hint">
                      Use ← / → keys to navigate
                    </span>
                  )}
                </div>

                {/* Controls (Zoom & Open) */}
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
                        border: "1px solid #475569",
                        background: zoomLevel <= 1 ? "#0f172a" : "#334155",
                        color: zoomLevel <= 1 ? "#475569" : "#f8fafc",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: zoomLevel <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomLevel(1)}
                      title="Reset zoom to 100%"
                      style={{
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 5,
                        border: "1px solid #475569",
                        background: "#0f172a",
                        color: "#e2e8f0",
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
                        border: "1px solid #475569",
                        background: zoomLevel >= 2.5 ? "#0f172a" : "#334155",
                        color: zoomLevel >= 2.5 ? "#475569" : "#f8fafc",
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
                        border: "1px solid #0284c7",
                        background: "#0284c7",
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
                        border: "1px solid #475569",
                        background: "#334155",
                        color: "#f8fafc",
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

              {/* Primary Stage */}
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 200,
                  maxHeight: "270px",
                  background: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: zoomLevel > 1 ? "auto" : "hidden",
                  padding: 10,
                }}
              >
                {/* State 1: No evidence file */}
                {currentFileKind === "none" ? (
                  <div
                    data-testid="evidence-empty-state"
                    style={{
                      padding: "36px 24px",
                      textAlign: "center",
                      color: "#cbd5e1",
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
                        color: "#94a3b8",
                      }}
                    >
                      <Icon.FileText size={26} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
                      No evidence file exists for this record
                    </div>
                    <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                      No photo or document file is attached to this condemnation record.
                    </div>
                  </div>
                ) : currentFileKind === "document" ? (
                  /* State 2: Document */
                  <div
                    data-testid="evidence-document-state"
                    style={{
                      padding: "36px 24px",
                      textAlign: "center",
                      color: "#e2e8f0",
                      maxWidth: 420,
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 12,
                        background: "rgba(2, 132, 199, 0.16)",
                        border: "1px solid rgba(2, 132, 199, 0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 12px",
                        color: "#38bdf8",
                      }}
                    >
                      <Icon.FileText size={28} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", wordBreak: "break-word" }}>
                      {currentPhoto.name || displayRecord.file_name || "Evidence Document"}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                      {displayRecord.type || "Document"} · Non-image evidence file
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
                  /* State 3: Load failed */
                  <div
                    data-testid="evidence-error-state"
                    style={{
                      padding: "32px 24px",
                      textAlign: "center",
                      color: "#cbd5e1",
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
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
                      Unable to load evidence photo
                    </div>
                    <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                      The image file could not be loaded from storage. The file may have been removed or the URL is temporarily unreachable.
                    </div>
                    {currentPhoto.name && (
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 8, wordBreak: "break-all" }}>
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
                  /* State 4 & 5: Loading & Image Display */
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
                          background: "rgba(15, 23, 42, 0.82)",
                          color: "#e2e8f0",
                          zIndex: 3,
                          gap: 10,
                        }}
                      >
                        <span className="spinner" style={{ width: 28, height: 28 }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#cbd5e1" }}>
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

                {/* Left/Right Navigation Arrows */}
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
                        background: "rgba(15, 23, 42, 0.82)",
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
                        background: "rgba(15, 23, 42, 0.82)",
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

              {/* Thumbnails strip for multi-photo */}
              {tagPhotos.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#1e293b",
                    borderTop: "1px solid #334155",
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
                          border: isSelected ? "2px solid #38bdf8" : "1px solid #475569",
                          background: "#0f172a",
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

            {/* ── RIGHT COLUMN: TWO-LINE LABELED DETAILS LIST ── */}
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
                {/* 1. Owner */}
                <div className="vet-evidence-viewer-row">
                  <dt>Owner</dt>
                  <dd>{ownerDisplay}</dd>
                </div>

                {/* 2. Tag Number */}
                <div className="vet-evidence-viewer-row">
                  <dt>{stage === "Post-Mortem" ? "Carcass Tag #" : "Livestock Tag #"}</dt>
                  <dd>
                    {tagValue ? <TagBadge tag={tagValue} /> : <span>Not recorded</span>}
                  </dd>
                </div>

                {/* 3. Species */}
                <div className="vet-evidence-viewer-row">
                  <dt>Species</dt>
                  <dd>{resolvedSpecies}</dd>
                </div>

                {/* 4. Condemnation Classification */}
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

                {/* 5. Condemned Parts & Quantities */}
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

                {/* 6. Findings / Reasons */}
                <div className="vet-evidence-viewer-row">
                  <dt>Inspection Findings & Pathology Notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, fontSize: 12.5 }}>{findingsDisplay}</dd>
                </div>

                {/* 7. Condemnation Date & Time */}
                <div className="vet-evidence-viewer-row">
                  <dt>Condemnation Date & Time</dt>
                  <dd>{condemnationDateTimeDisplay}</dd>
                </div>

                {/* 8. Condemned By */}
                <div className="vet-evidence-viewer-row" style={{ borderBottom: "none" }}>
                  <dt>Condemned By (Veterinarian / Inspector)</dt>
                  <dd style={{ fontWeight: 600 }}>{condemnedInspector}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Modal Actions Footer */}
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

        {/* Fullscreen Enlarge Lightbox */}
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
                  color: "#f8fafc",
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
            background: #0f172a;
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
