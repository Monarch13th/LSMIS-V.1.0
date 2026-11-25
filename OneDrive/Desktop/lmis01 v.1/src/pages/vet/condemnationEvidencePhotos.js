
import { getCondemnationStage, matchesStage, evidenceMatchesStage } from "./condemnationStage";

export const MAX_EVIDENCE_PHOTOS = 12;

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const normTag = (v) => String(v == null ? "" : v).trim().toLowerCase();

const SUPABASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  "https://zwuoebmkapoywkpyaahw.supabase.co";

const EVIDENCE_BUCKET = "evidence";

const PHOTO_FIELDS = [
  "url", "file_url", "file_preview", "photo_url", "photo", "image_url", "image",
  "preview", "dataUrl", "data_url", "src", "file_path",
];

export const resolveEvidencePhotoUrl = (val) => {
  if (typeof val !== "string") return null;
  const s = val.trim();
  if (!s || s === "undefined" || s === "null" || s === "[object Object]") return null;

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

  const objectMatch = s.match(/^storage\/v1\/object\/public\/(.+)$/i);
  if (objectMatch) return `${SUPABASE_URL}/storage/v1/object/public/${objectMatch[1]}`;

  const cleanPath = s.replace(/^\/+/, "");
  if (cleanPath.startsWith("evidence/")) {
    return `${SUPABASE_URL}/storage/v1/object/public/${EVIDENCE_BUCKET}/${cleanPath}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${EVIDENCE_BUCKET}/evidence/${cleanPath}`;
};

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

const PART_NOTE_PATTERNS = [
  /(?:partial\s+condemnation|condemnation|rejection|rejected)\s*\(\s*([^)]+?)\s*\)\s*:/i,
  /partial\s+condemnation\s*:\s*([^(:]+?)\s*(?:\(|:)/i,
];

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

  const knownParts = new Map();
  condemned.forEach((c) => {
    if (!c || !c.part) return;
    if (cleanTag && normTag(c.tag_number) !== cleanTag) return;
    if (matchesStage(c, type)) knownParts.set(norm(c.part), c.part);
  });

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

    const key = url.startsWith("data:")
      ? url.slice(0, 150)
      : url.split("?")[0].toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const part = partLabel || owner?.part || "";
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

    for (const field of PHOTO_FIELDS) {
      const v = row[field];
      if (typeof v === "string" && v.trim()) {
        push(v, row.file_name || row.photo_name || (partLabel ? `${partLabel} Photo` : "Evidence Photo 1"), row.notes, row, partLabel);
      }
    }
  };

  pushFromRow(target, target.part);

  if (cleanTag) {
    const otherStageTags = new Set(
      condemned
        .filter((c) => c && c.tag_number && getCondemnationStage(c) && getCondemnationStage(c) !== type)
        .map((c) => normTag(c.tag_number))
    );

    evidence.forEach((evItem) => {
      if (!evItem) return;
      if (normTag(evItem.tag_number) !== cleanTag) return;

      const evType = String(evItem.inspection_type || "").trim();
      if (!evType && otherStageTags.has(cleanTag)) return;
      if (!evidenceMatchesStage(evItem, type, (t) => normTag(t) === cleanTag)) return;

      let evPart = evItem.part || partFromNotes(evItem.notes, knownParts);
      if (!evPart && knownParts.size === 1) evPart = knownParts.values().next().value;
      pushFromRow(evItem, evPart);
    });
  }

  if (cleanTag && (!type || type === "Post-Mortem")) {
    post.forEach((p) => {
      if (normTag(p.tag_number) !== cleanTag) return;

      const parts = Array.isArray(p.condemned_parts) ? p.condemned_parts : [];
      parts.forEach((cp) => {
        pushFromRow(cp, cp.part);
        pushFromRow(p, cp.part);
      });
      if (!parts.length) pushFromRow(p, p.part);
    });
  }

  if (cleanTag) {
    condemned.forEach((c) => {
      if (type && !matchesStage(c, type)) return;
      if (normTag(c.tag_number) !== cleanTag) return;
      pushFromRow(c, c.part);
    });
  }

  if (cleanTag && (!type || type === "Post-Mortem")) {
    postCuts.forEach((cut) => {
      if (!cut) return;
      if (normTag(cut.tag_number) !== cleanTag) return;
      if (type && cut.inspection_type && getCondemnationStage(cut) !== "Post-Mortem") return;
      pushFromRow(cut, cut.part);
    });
  }

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