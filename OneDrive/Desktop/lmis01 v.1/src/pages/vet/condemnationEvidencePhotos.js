// Shared collector for Condemnation Evidence photos.
//
// WHY THIS EXISTS
// Evidence photos for one condemnation are spread across several places, and older
// records do not all use the same field. Nothing here may be treated as optional:
//
//   evidence_records          .file_url / .file_path        (1 per row, DB column)
//   condemnation_records      .photo_url / .file_url        (1 per record, DB column)
//   post_mortem_condemned_cuts.photo_url / .photo_name      (1 per condemned part, DB column)
//   evidence_records          .photos / .file_urls         (all photos, DB column)
//   post_mortem_inspections   .condemned_parts[].photos    (jsonb, browser-local shape)
//
// `photos` and `file_urls` on evidence_records ARE database columns and are the only
// place a full multi-photo set can be stored, because the other three locations above
// hold exactly one photo. Rows written before they were added to the insert, and rows
// whose insert dropped them, only ever have the singular column filled in, so this
// module reads every location above: a photo is found whichever field it landed in.

import { getCondemnationStage, matchesStage, evidenceMatchesStage } from "./condemnationStage";

// Existing module rule: allows up to 12 evidence photos per condemnation record.
export const MAX_EVIDENCE_PHOTOS = 12;

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const normTag = (v) => String(v == null ? "" : v).trim().toLowerCase();

const SUPABASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  "https://zwuoebmkapoywkpyaahw.supabase.co";

const EVIDENCE_BUCKET = "evidence";

// Field names that have been used to hold a photo across record generations,
// newest-first so the best-quality source wins.
const PHOTO_FIELDS = [
  "url", "file_url", "file_preview", "photo_url", "photo", "image_url", "image",
  "preview", "dataUrl", "data_url", "src", "file_path",
];

// Turns any stored value (full URL, data URI, blob, absolute path or a bare Supabase
// storage path) into something an <img src> can load.
export const resolveEvidencePhotoUrl = (val) => {
  if (typeof val !== "string") return null;
  const s = val.trim();
  if (!s || s === "undefined" || s === "null" || s === "[object Object]") return null;

  // Embedded data URI accidentally prefixed by a storage public URL
  const embeddedDataMatch = s.match(/(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+)/);
  if (embeddedDataMatch) return embeddedDataMatch[1];

  if (
    s.startsWith("data:") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("blob:") ||
    s.startsWith("/")
  ) {
    return s;
  }

  // Already a full storage URL but stored without the public object prefix.
  const objectMatch = s.match(/^storage\/v1\/object\/public\/(.+)$/i);
  if (objectMatch) return `${SUPABASE_URL}/storage/v1/object/public/${objectMatch[1]}`;

  // Bare storage path (e.g. "evidence/TAG-010-CARABAO/6f5bc669-f38e.jpg")
  const cleanPath = s.replace(/^\/+/, "");
  if (cleanPath.startsWith("evidence/")) {
    return `${SUPABASE_URL}/storage/v1/object/public/${EVIDENCE_BUCKET}/${cleanPath}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${EVIDENCE_BUCKET}/evidence/${cleanPath}`;
};

// Pulls the first usable photo out of a photo object or bare string.
const readPhotoSource = (value) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  for (const field of PHOTO_FIELDS) {
    const v = value[field];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
};

const photoNameFrom = (value, fallback) => {
  if (value && typeof value === "object") {
    const n = value.name || value.photo_name || value.photoName || value.file_name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  if (typeof value === "string" && value.trim()) {
    const parts = value.split("?")[0].split("/");
    return parts[parts.length - 1] || fallback;
  }
  return fallback;
};

// `file_urls` holds plain URLs with no key of its own. The sibling `photos` array is
// written in the same order, so index i maps to photos[i].file_path. A URL can also
// arrive as an object that carries its own file_path.
const readPhotoFilePath = (value, index) => {
  if (value && typeof value === "object") {
    const p = value.file_path || value.path;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return null;
};

const photoPathAtIndex = (row, index) => {
  const photos = Array.isArray(row?.photos) ? row.photos : [];
  const entry = photos[index];
  if (entry && typeof entry === "object") {
    const p = entry.file_path || entry.path;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return readPhotoFilePath(entry, index);
};

// A partial condemnation's part is written into the evidence note, e.g.
//   "Condemnation (Primal Cut): Abnormal appearance"
//   "Post-Mortem Partial Condemnation (Forequarter): Abnormal appearance"
//   "Partial Condemnation: Forequarter (0.23 kg) - Abnormal appearance. Location: ..."
// evidence_records has no part column, so this is the only thing that ties an evidence
// photo back to the specific cut it was taken for.
const PART_NOTE_PATTERNS = [
  /(?:partial\s+condemnation|condemnation|rejection|rejected)\s*\(\s*([^)]+?)\s*\)\s*:/i,
  /partial\s+condemnation\s*:\s*([^(:]+?)\s*(?:\(|:)/i,
];

// Resolves a part name from a note, but only accepts it when it really is one of this
// condemnation's parts - a wrong guess is worse than no attribution.
const partFromNotes = (notes, knownParts) => {
  if (typeof notes !== "string" || !notes.trim() || !knownParts.size) return "";
  for (const re of PART_NOTE_PATTERNS) {
    const m = notes.match(re);
    if (!m) continue;
    const canonical = knownParts.get(m[1].trim().toLowerCase());
    if (canonical) return canonical;
  }
  return "";
};

/**
 * Collects every stored evidence photo for one condemnation, in stage order and
 * de-duplicated, capped at MAX_EVIDENCE_PHOTOS.
 *
 * @param target     the record whose details are open (evidence row or synthetic row)
 * @param type       "Ante-Mortem" | "Post-Mortem" - scopes every lookup to this stage
 * @param evidence   evidence_records rows
 * @param post       post_mortem_inspections rows
 * @param condemned  condemnation_records rows
 * @param postCuts   post_mortem_condemned_cuts rows (Post-Mortem only by nature)
 */
export const collectCondemnationEvidencePhotos = ({
  target,
  type,
  evidence = [],
  post = [],
  condemned = [],
  postCuts = [],
}) => {
  if (!target) return [];

  const seen = new Set();
  const cleanTag = normTag(target.tag_number);

  // Parts actually condemned for this animal, used to attribute evidence photos.
  const knownParts = new Map();
  condemned.forEach((c) => {
    if (!c || !c.part) return;
    if (cleanTag && normTag(c.tag_number) !== cleanTag) return;
    if (matchesStage(c, type)) knownParts.set(norm(c.part), c.part);
  });

  // Photos are bucketed per condemned part, then interleaved. A partial condemnation
  // can have more than 3 stored photos; interleaving guarantees every condemned part is
  // represented instead of one part filling all 3 slots.
  const buckets = [];
  const bucketFor = (label) => {
    const key = label || "";
    let b = buckets.find((x) => x.key === key);
    if (!b) { b = { key, items: [] }; buckets.push(b); }
    return b;
  };

  const push = (rawUrl, name, notes, owner, partLabel, filePath) => {
    if (!rawUrl) return;
    const url = resolveEvidencePhotoUrl(rawUrl);
    if (!url) return;

    // Same physical photo can be referenced by several fields/rows - keep one copy.
    const key = url.startsWith("data:")
      ? url.slice(0, 150)
      : url.split("?")[0].toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const part = partLabel || owner?.part || "";
    // Carry the Storage key with the photo. Re-saving a condemnation re-sends its
    // photos, and without the key the upload cannot tell an already-stored object
    // from a browser preview.
    const own = typeof filePath === "string" && filePath.trim() ? filePath.trim() : "";
    const rowPath =
      typeof owner?.file_path === "string" && owner.file_path.trim() ? owner.file_path.trim() : "";
    bucketFor(part).items.push({
      id: owner?.id || key,
      url,
      name: name || (part ? `${part} Photo` : `Photo ${bucketFor(part).items.length + 1}`),
      notes: notes || owner?.notes || "",
      part,
      file_path: own || rowPath || null,
      record: owner || target,
    });
  };

  // Adds every photo a single row carries (array form and singular form alike).
  const pushFromRow = (row, partLabel) => {
    if (!row) return;

    if (Array.isArray(row.photos)) {
      row.photos.forEach((p, idx) => {
        const src = readPhotoSource(p);
        if (src) push(src, photoNameFrom(p, `${partLabel ? `${partLabel} ` : ""}Photo ${idx + 1}`), row.notes, row, partLabel, p?.file_path);
      });
    }

    if (Array.isArray(row.file_urls)) {
      row.file_urls.forEach((u, idx) => {
        const src = readPhotoSource(u);
        if (src) push(src, `${partLabel ? `${partLabel} ` : ""}Photo ${idx + 1}`, row.notes, row, partLabel, photoPathAtIndex(row, idx));
      });
    }

    // Singular fields: photo_url / file_url / file_path / ... Older records persist
    // exactly one photo here, so this branch is the only thing that finds them.
    for (const field of PHOTO_FIELDS) {
      const v = row[field];
      if (typeof v === "string" && v.trim()) {
        push(v, row.file_name || row.photo_name || (partLabel ? `${partLabel} Photo` : "Evidence Photo 1"), row.notes, row, partLabel);
      }
    }
  };

  // 1. Photos carried by the record being opened.
  pushFromRow(target, target.part);

  // 2. Other evidence_records rows for the same animal, this inspection stage only.
  if (cleanTag) {
    // Never pull in evidence for a condemnation that belongs to the other stage.
    const otherStageTags = new Set(
      condemned
        .filter((c) => c && c.tag_number && getCondemnationStage(c) && getCondemnationStage(c) !== type)
        .map((c) => normTag(c.tag_number))
    );

    evidence.forEach((evItem) => {
      if (!evItem) return;
      if (normTag(evItem.tag_number) !== cleanTag) return;

      const evType = String(evItem.inspection_type || "").trim();
      // Untyped/legacy evidence is skipped when the same tag is condemned in the other stage.
      if (!evType && otherStageTags.has(cleanTag)) return;
      if (!evidenceMatchesStage(evItem, type, (t) => normTag(t) === cleanTag)) return;

      // evidence_records has no part column, so the note is what identifies the cut.
      // When the note gives no part and this condemnation only condemns one thing
      // (whole carcass, or the live animal at ante), that single part is the answer.
      let evPart = evItem.part || partFromNotes(evItem.notes, knownParts);
      if (!evPart && knownParts.size === 1) evPart = knownParts.values().next().value;
      pushFromRow(evItem, evPart);
    });
  }

  // 3. Condemned parts on the Post-Mortem inspection (Post-Mortem only).
  if (cleanTag && (!type || type === "Post-Mortem")) {
    post.forEach((p) => {
      if (normTag(p.tag_number) !== cleanTag) return;

      const parts = Array.isArray(p.condemned_parts) ? p.condemned_parts : [];
      parts.forEach((cp) => {
        // Keep the part label so a partial condemnation's photo stays attributed to its cut.
        pushFromRow(cp, cp.part);
        pushFromRow(p, cp.part);
      });
      if (!parts.length) pushFromRow(p, p.part);
    });
  }

  // 4. Condemnation records of this inspection stage - including the singular
  //    photo_url / file_url that older records rely on.
  if (cleanTag) {
    condemned.forEach((c) => {
      if (type && !matchesStage(c, type)) return;
      if (normTag(c.tag_number) !== cleanTag) return;
      pushFromRow(c, c.part);
    });
  }

  // 5. post_mortem_condemned_cuts - one row per condemned part, written by the
  //    inspection save but never read anywhere else. Post-Mortem data only.
  if (cleanTag && (!type || type === "Post-Mortem")) {
    postCuts.forEach((cut) => {
      if (!cut) return;
      if (normTag(cut.tag_number) !== cleanTag) return;
      if (type && cut.inspection_type && getCondemnationStage(cut) !== "Post-Mortem") return;
      pushFromRow(cut, cut.part);
    });
  }

  // Interleave the per-part buckets, then apply the 3-photo cap. With a single part
  // this is just natural order; with several parts it stops one cut from consuming
  // every slot.
  const out = [];
  const deepest = buckets.reduce((max, b) => Math.max(max, b.items.length), 0);
  for (let i = 0; i < deepest && out.length < MAX_EVIDENCE_PHOTOS; i++) {
    for (const b of buckets) {
      if (out.length >= MAX_EVIDENCE_PHOTOS) break;
      if (b.items[i]) out.push(b.items[i]);
    }
  }
  return out;
};