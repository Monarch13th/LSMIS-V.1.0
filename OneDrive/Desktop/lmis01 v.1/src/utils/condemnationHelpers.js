/**
 * condemnationHelpers.js
 * Compiles condemnation details, pathology findings, disposition, and evidence photos for livestock owners.
 * Strictly read-only data normalization.
 */

import { formatDate } from "./formatters";

/**
 * Compiles complete condemnation details and evidence photos for a given livestock record.
 * @param {object} params
 * @param {object} params.animal - Livestock record
 * @param {object} [params.ante] - Ante-Mortem inspection record for this tag
 * @param {object} [params.post] - Post-Mortem inspection record for this tag
 * @param {object|array} [params.condemnation] - Condemnation record(s) for this tag
 * @param {array} [params.evidence] - Evidence records array for this tag
 * @returns {object|null} Detailed condemnation object or null if no condemnation exists.
 */
export const getOwnerCondemnationDetails = ({
  animal,
  ante,
  post,
  condemnation,
  evidence = [],
}) => {
  if (!animal && !ante && !post && !condemnation) return null;

  const tagNumber = animal?.tag_number || ante?.tag_number || post?.tag_number || (Array.isArray(condemnation) ? condemnation[0]?.tag_number : condemnation?.tag_number) || "—";
  const species = animal?.species || ante?.species || post?.species || (Array.isArray(condemnation) ? condemnation[0]?.species : condemnation?.species) || "Livestock";

  // Normalize condemnation records into array
  const condList = Array.isArray(condemnation)
    ? condemnation
    : condemnation
    ? [condemnation]
    : [];

  const rawAnimalStatus = String(animal?.status || "").toLowerCase();
  const anteDecision = String(ante?.decision || ante?.result || "").toLowerCase();
  const postDecision = String(post?.decision || post?.result || "").toLowerCase();

  const isAntePassed = anteDecision.includes("approv") || anteDecision.includes("pass");
  const isAnteRejected =
    (rawAnimalStatus.includes("ante-mortem") && (rawAnimalStatus.includes("condemn") || rawAnimalStatus.includes("reject"))) ||
    rawAnimalStatus === "rejected" ||
    anteDecision.includes("reject") ||
    anteDecision.includes("condemn") ||
    condList.some((c) => c.stage === "Ante-Mortem" || c.inspection_type === "Ante-Mortem" || c.part === "Live Animal");

  const isPostPartialCondemned =
    rawAnimalStatus.includes("partial") ||
    postDecision.includes("partial") ||
    (Array.isArray(post?.condemned_parts) && post.condemned_parts.length > 0) ||
    condList.some((c) => c.type === "Partial" || (c.part && c.part !== "Whole Carcass" && c.part !== "Live Animal"));

  const isPostWholeCondemned =
    !isPostPartialCondemned &&
    !isAnteRejected &&
    (postDecision === "condemned" ||
      postDecision === "rejected" ||
      postDecision.includes("whole") ||
      postDecision.includes("total") ||
      (postDecision.includes("condemn") && !postDecision.includes("partial")) ||
      (rawAnimalStatus.includes("post-mortem") && (rawAnimalStatus.includes("condemn") || rawAnimalStatus.includes("reject")) && !rawAnimalStatus.includes("partial")) ||
      (rawAnimalStatus === "condemned" && (isAntePassed || Boolean(post))) ||
      condList.some((c) => (c.stage === "Post-Mortem" || c.inspection_type === "Post-Mortem" || c.part === "Whole Carcass" || c.part === "Entire Carcass") && c.part !== "Live Animal"));

  const isAnteCondemned =
    !isPostWholeCondemned &&
    !isPostPartialCondemned &&
    (isAnteRejected || anteDecision.includes("condemn") || (rawAnimalStatus === "condemned" && !isAntePassed && !post));

  const hasCondRecords = condList.length > 0;

  const isCondemned = isAnteRejected || isAnteCondemned || isPostWholeCondemned || isPostPartialCondemned || hasCondRecords;

  if (!isCondemned) return null;

  // Determine Scope & Result
  let resultLabel = "Condemned";
  let scope = "whole";

  if (isAnteRejected || isAnteCondemned) {
    resultLabel = ante?.decision || ante?.result || "Ante-Mortem Whole Carcass Condemned";
    scope = "ante_condemned";
  } else if (isPostPartialCondemned) {
    resultLabel = post?.decision || post?.result || "Passed with Partial Condemnation";
    scope = "partial";
  } else if (isPostWholeCondemned) {
    resultLabel = post?.decision || post?.result || "Post-Mortem Whole Carcass Condemned";
    scope = "whole";
  } else if (hasCondRecords) {
    const isPartialCond = condList.some(
      (c) => c.type === "Partial" || (c.part && c.part !== "Whole Carcass" && c.part !== "Live Animal")
    );
    const isAnteRecord = condList.some((c) => c.stage === "Ante-Mortem" || c.inspection_type === "Ante-Mortem" || c.part === "Live Animal");
    resultLabel = isAnteRecord
      ? "Ante-Mortem Whole Carcass Condemned"
      : isPartialCond
      ? "Passed with Partial Condemnation"
      : "Post-Mortem Whole Carcass Condemned";
    scope = isAnteRecord ? "ante_condemned" : isPartialCond ? "partial" : "whole";
  } else if (hasEvidence) {
    const hasAnteEvidence = evidence.some((e) => String(e.inspection_type || "").toLowerCase().includes("ante"));
    if (hasAnteEvidence) {
      resultLabel = "Ante-Mortem Whole Carcass Condemned";
      scope = "ante_condemned";
    } else {
      resultLabel = "Passed with Partial Condemnation";
      scope = "partial";
    }
  }


  // Determine Location / Area
  let locationArea = "Tinaan, City of Naga, Cebu, Philippines";
  if (scope.includes("ante")) {
    locationArea = "Ante-Mortem Holding Pen / Intake Area — Tinaan, City of Naga, Cebu, Philippines";
  } else if (scope === "partial") {
    locationArea = "Post-Mortem Inspection Bay & Dressing Line — Tinaan, City of Naga, Cebu, Philippines";
  } else {
    locationArea = "Post-Mortem Examination Station — Tinaan, City of Naga, Cebu, Philippines";
  }

  // Compile Itemized Condemned Parts
  const parts = [];

  if (scope.includes("ante")) {
    const anteWeight =
      animal?.weight ||
      animal?.live_weight ||
      ante?.weight_kg ||
      ante?.weight ||
      (condList.find((c) => String(c.stage || c.inspection_type || c.part || "").toLowerCase().includes("ante") || String(c.part || "").toLowerCase() === "live animal")?.weight_kg) ||
      (condList.find((c) => String(c.stage || c.inspection_type || c.part || "").toLowerCase().includes("ante") || String(c.part || "").toLowerCase() === "live animal")?.weight) ||
      null;

    parts.push({
      part: "Live Animal",
      quantityWeight: anteWeight ? `${anteWeight} kg` : "Live Animal",
      reason: ante?.reason || ante?.findings || animal?.rejection_reason || animal?.remarks || "Unfit for slaughter on clinical examination",
      findings: ante?.findings || ante?.remarks || "Clinical signs detected during ante-mortem inspection",
      disposition: ante?.disposition || "Condemned & Returned / Disposed per NMIS Regulations",
    });
  } else if (scope === "whole") {
    const mainCond = condList.find((c) => c.part === "Whole Carcass" || c.part === "Entire Carcass") || condList[0];
    parts.push({
      part: "Whole Carcass",
      quantityWeight: mainCond?.weight_kg || mainCond?.weight ? `${mainCond.weight_kg || mainCond.weight} kg` : (animal?.weight ? `${animal.weight} kg` : "Entire Carcass"),
      reason: mainCond?.reason || post?.findings || post?.remarks || "Generalized pathological condition / Systemic disease",
      findings: post?.findings || post?.remarks || mainCond?.notes || "Carcass totally unfit for human consumption",
      disposition: mainCond?.disposition || mainCond?.disposal_method || post?.disposition || "Denatured & Incinerated in Municipal Pit",
    });
  } else {
    // Partial Condemnation — compile all excised cuts/organs
    if (Array.isArray(post?.condemned_parts) && post.condemned_parts.length > 0) {
      post.condemned_parts.forEach((cp) => {
        parts.push({
          part: cp.part || "Excised Cut",
          quantityWeight: cp.weight_kg || cp.weight ? `${cp.weight_kg || cp.weight} kg` : (cp.quantity ? `${cp.quantity} pcs` : "N/A"),
          reason: cp.reason || cp.pathology || post?.findings || "Localized pathological lesion",
          findings: cp.findings || post?.findings || "Pathological organ damage detected",
          disposition: cp.disposition || cp.disposal || "Denatured & Disposed per NMIS Guidelines",
        });
      });
    }

    condList.forEach((c) => {
      const partName = c.part || "Condemned Cut";
      if (!parts.some((p) => p.part.toLowerCase() === partName.toLowerCase())) {
        parts.push({
          part: partName,
          quantityWeight: c.weight_kg || c.weight ? `${c.weight_kg || c.weight} kg` : (c.quantity ? `${c.quantity} pcs` : "N/A"),
          reason: c.reason || c.findings || "Localized condemnation",
          findings: c.notes || c.findings || c.reason || "Excised during post-mortem inspection",
          disposition: c.disposition || c.disposal_method || "Denatured & Incinerated",
        });
      }
    });

    if (parts.length === 0) {
      parts.push({
        part: post?.part || "Viscera / Offal Cut",
        quantityWeight: "N/A",
        reason: post?.findings || post?.remarks || "Partial organ condemnation",
        findings: post?.findings || "Pathological findings recorded during post-mortem",
        disposition: "Denatured & Disposed",
      });
    }
  }

  // Total Weight / Quantity Summary
  let totalWeightQty = "N/A";
  let totalKg = 0;
  parts.forEach((p) => {
    const num = parseFloat(String(p.quantityWeight).replace(/[^0-9.]/g, ""));
    if (!isNaN(num) && num > 0) totalKg += num;
  });

  if (totalKg > 0) {
    totalWeightQty = `${totalKg.toFixed(1)} kg total condemned`;
  } else if (parts.length > 0) {
    totalWeightQty = parts.map((p) => `${p.part}: ${p.quantityWeight}`).join(", ");
  }

  // Combined Pathology & Findings
  const pathologyReasons = Array.from(new Set(parts.map((p) => p.reason).filter(Boolean))).join("; ") || "Pathological lesion / Clinical rejection";
  const inspectionFindings = post?.findings || ante?.findings || Array.from(new Set(parts.map((p) => p.findings).filter(Boolean))).join("; ") || "Recorded during veterinary examination";
  const dispositionSummary = Array.from(new Set(parts.map((p) => p.disposition).filter(Boolean))).join("; ") || "Denatured & Disposed per NMIS Regulations";

  // Date and Time
  const inspectionDateRaw = post?.date || ante?.date || (condList[0]?.date) || post?.created_at || ante?.created_at || animal?.received_date || new Date().toISOString();
  const inspectionDateFormatted = formatDate(inspectionDateRaw);

  // Veterinarian Inspector
  const vetName = post?.inspector_name || ante?.inspector_name || (condList[0]?.inspector) || "Dr. Dave (City Veterinary Inspector)";

  // Helper to normalize and clean tag numbers for case/format agnostic matching
  const cleanTagStr = (t) => String(t || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const targetTagClean = cleanTagStr(tagNumber);

  // Helper to extract all valid image URLs/previews from any object or array
  const extractPhotoUrls = (item) => {
    if (!item) return [];
    const found = [];

    const resolvePhotoUrl = (val) => {
      if (typeof val !== "string") return null;
      const s = val.trim();
      if (!s) return null;

      if (
        s.startsWith("data:image/") ||
        s.startsWith("http://") ||
        s.startsWith("https://") ||
        s.startsWith("blob:") ||
        s.startsWith("/")
      ) {
        return s;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://zwuoebmkapoywkpyaahw.supabase.co";
      const pathInBucket = s.startsWith("evidence/") ? s : `evidence/${s}`;
      return `${supabaseUrl}/storage/v1/object/public/evidence/${pathInBucket}`;
    };

    const isValPhoto = (val) => {
      if (typeof val !== "string") return false;
      const s = val.trim();
      if (!s) return false;
      if (
        s.startsWith("data:image/") ||
        s.startsWith("http://") ||
        s.startsWith("https://") ||
        s.startsWith("blob:") ||
        s.startsWith("/")
      ) {
        return true;
      }
      return (
        /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(s) ||
        s.includes("evidence/") ||
        s.includes("storage/v1/object") ||
        s.length > 5
      );
    };

    const addIfPhoto = (val) => {
      if (!val) return;
      if (typeof val === "string" && isValPhoto(val)) {
        const resolved = resolvePhotoUrl(val);
        if (resolved) found.push(resolved);
      } else if (typeof val === "object") {
        const u =
          val.dataUrl ||
          val.data_url ||
          val.url ||
          val.preview ||
          val.file_url ||
          val.file_preview ||
          val.file_data ||
          val.image_url ||
          val.photo_url ||
          val.src ||
          val.photo;
        if (typeof u === "string" && isValPhoto(u)) {
          const resolved = resolvePhotoUrl(u);
          if (resolved) found.push(resolved);
        }
      }
    };

    if (Array.isArray(item)) {
      item.forEach(addIfPhoto);
    } else if (typeof item === "object") {
      let foundInArray = false;
      const arrFields = ["photos", "file_urls", "attachments", "images", "photos_urls"];
      arrFields.forEach((f) => {
        if (Array.isArray(item[f]) && item[f].length > 0) {
          item[f].forEach(addIfPhoto);
          foundInArray = true;
        }
      });
      // Only check scalar fallback fields if NO array field had valid photos
      if (!foundInArray) {
        const scalarFields = [
          "dataUrl",
          "data_url",
          "file_url",
          "file_preview",
          "file_data",
          "image_url",
          "evidence_url",
          "photo_url",
          "url",
          "preview",
          "photo",
          "image",
          "img",
          "src",
          "attachment",
        ];
        scalarFields.forEach((f) => addIfPhoto(item[f]));
      }
    }

    return found;
  };

  // Compile Evidence Photos (Strict single-source fallback hierarchy with signature deduplication)
  const evidencePhotos = [];
  const seenUrls = new Set();
  const seenSignatures = new Set();
  const seenPartPhotos = new Set();
  const urlToPhotoMap = new Map();

  const isGenericFileName = (name) => {
    if (!name || typeof name !== "string") return true;
    const lower = name.trim().toLowerCase();
    return (
      /^evidence.*\.png$/i.test(lower) ||
      /^photo.*\.png$/i.test(lower) ||
      /^image.*\.png$/i.test(lower) ||
      /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(lower) ||
      lower === "evidence.png" ||
      lower === "photo.png"
    );
  };

  const getPhotoKey = (urlStr) => {
    if (!urlStr || typeof urlStr !== "string") return null;
    const s = urlStr.trim();
    if (!s) return null;
    if (s.startsWith("data:")) return `data:${s.length}:${s.slice(0, 40)}`;
    const clean = s.split("?")[0].toLowerCase();
    const storageMatch = clean.match(/evidence\/+([^/]+)\/+([^/]+)$/i);
    if (storageMatch) {
      return `${storageMatch[1]}:${storageMatch[2]}`;
    }
    const filenameMatch = clean.match(/\/([^/]+\.[a-z0-9]+)$/i);
    if (filenameMatch) {
      return filenameMatch[1];
    }
    return clean;
  };

  const addPhoto = ({ id, url, fileName, fileSize, notes, part, inspectionType, date }) => {
    if (!url) return;
    const key = getPhotoKey(url);
    if (!key) return;

    const partClean = (part || "").toLowerCase().trim();
    const partKey = `${partClean}:${key}`;
    const sizeSig = fileSize && Number(fileSize) > 0 ? `${partClean}:size:${Number(fileSize)}` : null;
    const nameSig = fileName && !isGenericFileName(fileName) ? `${partClean}:name:${String(fileName).trim().toLowerCase()}` : null;

    // If we've already added this exact URL, enrich its metadata if available
    if (seenUrls.has(key)) {
      const existing = urlToPhotoMap.get(key);
      if (existing) {
        if (fileName && (!existing.fileName || isGenericFileName(existing.fileName))) {
          existing.fileName = fileName;
        }
        if (fileSize && !existing.fileSize) {
          existing.fileSize = fileSize;
        }
      }
      if (sizeSig) seenSignatures.add(sizeSig);
      if (nameSig) seenSignatures.add(nameSig);
      return;
    }

    if (seenPartPhotos.has(partKey)) return;
    if (sizeSig && seenSignatures.has(sizeSig)) return;
    if (nameSig && seenSignatures.has(nameSig)) return;

    seenUrls.add(key);
    seenPartPhotos.add(partKey);
    if (sizeSig) seenSignatures.add(sizeSig);
    if (nameSig) seenSignatures.add(nameSig);

    const newPhoto = {
      id: id || `photo-${evidencePhotos.length + 1}`,
      url,
      fileName: fileName || `${tagNumber}_evidence.png`,
      part: part || (scope === "whole" ? "Whole Carcass" : scope.includes("ante") ? "Live Animal" : parts[0]?.part || "Condemned Part"),
      notes: notes || pathologyReasons,
      inspectionType: inspectionType || (scope.includes("ante") ? "Ante-Mortem" : "Post-Mortem"),
      date: formatDate(date || inspectionDateRaw),
      fileSize: fileSize || null,
    };

    urlToPhotoMap.set(key, newPhoto);
    evidencePhotos.push(newPhoto);
  };

  // 1. Primary Source: If Post-Mortem inspection record exists, extract photos from post & condemned_parts
  if (post) {
    if (Array.isArray(post.condemned_parts) && post.condemned_parts.length > 0) {
      post.condemned_parts.forEach((cp, idx) => {
        const urls = extractPhotoUrls(cp);
        urls.forEach((u, uIdx) => {
          addPhoto({
            id: `post-cp-${idx}-${uIdx}`,
            url: u,
            fileName: cp.photoName || `${tagNumber}_${cp.part || "cut"}_photo_${uIdx + 1}.png`,
            notes: cp.notes || cp.reason || cp.findings || `Evidence for ${cp.part || "Cut"}`,
            part: cp.part || "Condemned Cut",
            inspectionType: "Post-Mortem",
            date: post.date || post.created_at,
          });
        });
      });
    }

    const postRootUrls = extractPhotoUrls(post);
    postRootUrls.forEach((u, uIdx) => {
      addPhoto({
        id: `post-root-${uIdx}`,
        url: u,
        fileName: `${tagNumber}_post_mortem_evidence.png`,
        notes: post.findings || "Post-Mortem Pathology Evidence Photo",
        part: scope === "whole" ? "Whole Carcass" : parts[0]?.part || "Condemned Carcass",
        inspectionType: "Post-Mortem",
        date: post.date || post.created_at,
      });
    });
  }

  // 2. Condemnation Records: Direct cut-level condemnation photos matching individual parts
  if (Array.isArray(condList) && condList.length > 0) {
    condList.forEach((c, idx) => {
      if (scope.includes("ante")) {
        const isAnteRec =
          String(c.stage || c.inspection_type || "").toLowerCase().includes("ante") ||
          String(c.part || "").toLowerCase().includes("live") ||
          String(c.part || "").toLowerCase().includes("animal");
        if (!isAnteRec && c.stage && !String(c.stage).toLowerCase().includes("ante")) return;
      } else {
        if (c.part === "Live Animal" || String(c.stage || "").toLowerCase().includes("ante")) return;
      }
      const urls = extractPhotoUrls(c);
      urls.forEach((u, uIdx) => {
        addPhoto({
          id: c.id ? `${c.id}-${uIdx}` : `cond-photo-${idx}-${uIdx}`,
          url: u,
          fileName: c.photoName || c.file_name || `${tagNumber}_${c.part || "cut"}_photo_${uIdx + 1}.png`,
          fileSize: c.file_size || null,
          notes: c.reason || c.findings || "Condemnation Record Photo",
          part: c.part || (scope === "whole" ? "Whole Carcass" : "Condemned Cut"),
          inspectionType: c.stage || (scope.includes("ante") ? "Ante-Mortem" : "Post-Mortem"),
          date: c.date || c.created_at,
        });
      });
    });
  }

  // 3. Evidence Records: Inspect evidence_records with signature deduplication
  if (Array.isArray(evidence) && evidence.length > 0) {
    evidence.forEach((ev, idx) => {
      if (ev.tag_number && targetTagClean && cleanTagStr(ev.tag_number) !== targetTagClean) {
        return;
      }
      if (scope.includes("ante") && ev.inspection_type && !ev.inspection_type.toLowerCase().includes("ante")) {
        return;
      }
      if (!scope.includes("ante") && ev.inspection_type && ev.inspection_type.toLowerCase().includes("ante")) {
        return;
      }
      const urls = extractPhotoUrls(ev);
      urls.forEach((u, uIdx) => {
        let partLabel = null;
        const notesLower = `${ev.notes || ""} ${ev.file_name || ""}`.toLowerCase();
        parts.forEach((p) => {
          if (p.part && notesLower.includes(p.part.toLowerCase())) {
            partLabel = p.part;
          }
        });
        addPhoto({
          id: ev.id ? `${ev.id}-${uIdx}` : `ev-photo-${idx}-${uIdx}`,
          url: u,
          fileName: ev.file_name || `${tagNumber}_evidence_${uIdx + 1}.png`,
          fileSize: ev.file_size || null,
          notes: ev.notes,
          part: partLabel || (scope === "whole" ? "Whole Carcass" : parts[0]?.part || "Excised Cut"),
          inspectionType: ev.inspection_type || (scope.includes("ante") ? "Ante-Mortem" : "Post-Mortem"),
          date: ev.date || ev.created_at,
        });
      });
    });
  }

  // 4. Fallback Source: Ante-Mortem rejection photos if no post-mortem photos exist
  if (evidencePhotos.length === 0 && ante) {
    if (Array.isArray(ante.condemned_parts)) {
      ante.condemned_parts.forEach((cp, idx) => {
        const urls = extractPhotoUrls(cp);
        urls.forEach((u, uIdx) => {
          addPhoto({
            id: `ante-cp-${idx}-${uIdx}`,
            url: u,
            fileName: `${tagNumber}_ante_evidence_${uIdx + 1}.png`,
            notes: cp.reason || cp.findings || "Ante-Mortem Evidence Photo",
            part: "Live Animal",
            inspectionType: "Ante-Mortem",
            date: ante.date || ante.created_at,
          });
        });
      });
    }

    const anteRootUrls = extractPhotoUrls(ante);
    anteRootUrls.forEach((u, uIdx) => {
      addPhoto({
        id: `ante-root-${uIdx}`,
        url: u,
        fileName: `${tagNumber}_ante_mortem_evidence.png`,
        notes: ante.findings || "Ante-Mortem Clinical Rejection Photo",
        part: "Live Animal",
        inspectionType: "Ante-Mortem",
        date: ante.date || ante.created_at,
      });
    });
  }

  // If remote storage (http/https) URLs exist, filter out duplicate pre-upload base64 data URLs
  const hasStoragePhotos = evidencePhotos.some((p) => p.url && (p.url.startsWith("http://") || p.url.startsWith("https://")));
  const finalEvidencePhotos = hasStoragePhotos
    ? evidencePhotos.filter((p) => p.url && !p.url.startsWith("data:"))
    : evidencePhotos;

  return {
    tagNumber,
    species,
    sex: animal?.sex || animal?.gender ? (String(animal?.sex || animal?.gender).toLowerCase().startsWith("f") ? "Female" : String(animal?.sex || animal?.gender).toLowerCase().startsWith("m") ? "Male" : String(animal?.sex || animal?.gender)) : "Not specified",
    resultLabel,
    scope,
    condemnationStage: scope.includes("ante") ? "Ante-Mortem" : scope === "partial" ? "Post-Mortem (Partial)" : "Post-Mortem",
    isPartial: scope === "partial",
    condemnedParts: parts,
    locationArea,
    totalWeightQty,
    pathologyReasons,
    inspectionFindings,
    dispositionSummary,
    inspectionDateFormatted,
    vetName,
    evidencePhotos: finalEvidencePhotos,
    hasPhotos: finalEvidencePhotos.length > 0,
    photoCount: finalEvidencePhotos.length,
  };
};
