// All date/number formatting helpers in one place
export const formatCurrency = (n) => `₱${Number(n || 0).toLocaleString()}`;
export const formatNumber = (n) => Number(n || 0).toLocaleString();
export const truncate = (s, n = 50) => (s && s.length > n ? s.slice(0, n) + "..." : s);

/** Locale-aware short date (e.g. "Jan 20, 2024") */
export const formatDate = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** Locale-aware date + time (e.g. "1/20/2024, 9:15 AM") */
export const formatDateTime = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleString();
};

/** Formats ISO timestamp in Philippine Local Time (Asia/Manila, e.g. "September 27, 2026, 5:23 PM") */
export const formatPhDateTime = (isoStr) => {
  if (!isoStr || isoStr === "—") return "—";
  try {
    let dateObj;
    if (typeof isoStr === "number" || (/^\d+$/.test(String(isoStr).trim()) && String(isoStr).trim().length >= 10)) {
      dateObj = new Date(Number(isoStr));
    } else {
      const str = String(isoStr).trim();
      const hasTime = str.includes("T") || str.includes(":") || str.includes("Z");
      if (!hasTime) {
        return formatPhDate(str);
      }
      dateObj = new Date(str);
    }
    if (isNaN(dateObj.getTime())) return String(isoStr);
    const datePart = dateObj.toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timePart = dateObj.toLocaleTimeString("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart}, ${timePart}`;
  } catch (e) {
    return String(isoStr);
  }
};

/** Formats ISO timestamp for Certification (Asia/Manila, e.g. "October 10, 2026 · 8:15 PM") */
export const formatCertDateTime = (isoStr) => {
  if (!isoStr || isoStr === "—") return "—";
  try {
    const str = String(isoStr).trim();
    const dateObj = new Date(str);
    if (isNaN(dateObj.getTime())) return str;
    const datePart = dateObj.toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const hasTime = str.includes("T") || str.includes(":") || str.includes("Z");
    if (!hasTime) return datePart;
    const timePart = dateObj.toLocaleTimeString("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart} · ${timePart}`;
  } catch (e) {
    return String(isoStr);
  }
};

/** Formats ISO timestamp in Philippine Local Date (Asia/Manila, e.g. "October 6, 2026") */
export const formatPhDate = (isoStr) => {
  if (!isoStr || isoStr === "—") return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    return d.toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch (e) {
    return String(isoStr);
  }
};

/** Returns today's calendar date string in Philippine Standard Time (Asia/Manila, e.g. "YYYY-MM-DD") */
export const getManilaTodayDateString = (now = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Date().toISOString().split("T")[0];
  }
};

/** Checks whether a timestamp or date corresponds to today in Philippine Standard Time (Asia/Manila) */
export const isTodayInManila = (timestamp, referenceDate = new Date()) => {
  if (!timestamp) return false;
  const todayManila = getManilaTodayDateString(referenceDate);
  if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp.trim())) {
    return timestamp.trim() === todayManila;
  }
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const itemDateManila = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return itemDateManila === todayManila;
  } catch {
    return false;
  }
};


/** Time only, in Philippine Local Time (Asia/Manila, 12-hour, e.g. "10:43 PM") */
export const formatPhTime = (isoStr) => {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    return d
      .toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
// Some browsers/ICU versions separate the meridiem with U+202F or U+00A0
      // instead of a plain space; normalise so the output is always "10:43 PM".
      .replace(/[\u202f\u00a0]/g, " ")
      .toUpperCase();
  } catch (e) {
    return String(isoStr);
  }
};

/** "Friday, January 20, 2024" for welcome banners */
export const formatLongDate = (d) => {
  return new Date(d || Date.now()).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

/** "September 24, 2026" full month day year format */
export const formatFullDate = (d) => {
  if (!d) return "—";
  try {
    const str = String(d).trim();
    const dateObj = new Date(str.includes("T") ? str : `${str}T00:00:00`);
    if (isNaN(dateObj.getTime())) return str;
    return dateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch (_) {
    return String(d);
  }
};

/** Locale-aware short time (e.g. "03:25 PM") */
export const formatTime = (t) => {
  if (!t || t === "—") return "—";
  if (typeof t === "string" && (t.includes("AM") || t.includes("PM"))) return t;
  if (typeof t === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
    const parts = t.split(":");
    const h = parseInt(parts[0], 10);
    const m = parts[1] || "00";
    const s = parts[2] ? `:${parts[2]}` : ":00";
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, "0")}:${m}${s} ${ampm}`;
  }
  try {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
  } catch (_) {}
  return String(t);
};

/** Current ISO date string YYYY-MM-DD */
export const today = () => new Date().toISOString().split("T")[0];

/**
 * Normalizes any account ID into standard "REG-001-2026" or "OWN-001-2026" format.
 * Correctly transforms formats like OWN-2026-0018 -> OWN-018-2026, OWN-2026-0019 -> OWN-019-2026, etc.
 */
export const formatOwnerId = (o, fallbackIndex = 1) => {
  if (!o) return `REG-001-2026`;
  const idStr = String(o.id || o.temp_reg_id || o.owner_id || "").trim();

  const matchTwoParts = idStr.match(/^(OWN|REG|OWNER)-(\d+)-(\d+)$/i);
  if (matchTwoParts) {
    const rawPrefix = matchTwoParts[1].toUpperCase();
    const prefix = rawPrefix === "OWNER" ? "OWN" : rawPrefix;
    const p1 = matchTwoParts[2];
    const p2 = matchTwoParts[3];

    let year = 2026;
    let num = 1;

    if (/^20\d{2}$/.test(p1) && !/^20\d{2}$/.test(p2)) {
      year = parseInt(p1, 10);
      num = parseInt(p2, 10);
    } else if (/^20\d{2}$/.test(p2)) {
      year = parseInt(p2, 10);
      num = parseInt(p1, 10);
    } else {
      num = parseInt(p1, 10);
      year = parseInt(p2, 10);
    }

    const compactNum = num > 999 ? (num % 1000) || 1 : num;
    return `${prefix}-${String(compactNum).padStart(3, "0")}-${year}`;
  }

  const legacyOwnerMatch = idStr.match(/^OWNER-(\d+)$/i);
  if (legacyOwnerMatch) {
    const num = parseInt(legacyOwnerMatch[1], 10);
    return `OWN-${String(num).padStart(3, "0")}-2026`;
  }

  const singlePartMatch = idStr.match(/^(OWN|REG)-(\d+)$/i);
  if (singlePartMatch) {
    const prefix = singlePartMatch[1].toUpperCase();
    const num = parseInt(singlePartMatch[2], 10);
    return `${prefix}-${String(num).padStart(3, "0")}-2026`;
  }

  if (idStr.length > 15 || idStr.includes("test") || idStr.includes("-")) {
    const isApproved = String(o.status || "").toLowerCase() === "approved";
    const prefix = isApproved ? "OWN" : "REG";
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) {
      hash = (hash * 31 + idStr.charCodeAt(i)) % 900;
    }
    const num = Math.abs(hash) + 1;
    const year = new Date(o.registered_date || o.created_at || Date.now()).getFullYear() || 2026;
    return `${prefix}-${String(num).padStart(3, "0")}-${year}`;
  }

  return idStr || `REG-${String(fallbackIndex).padStart(3, "0")}-2026`;
};

/**
 * Formats livestock sex to standard "Male", "Female", or "Not specified"
 */
export const formatSex = (val) => {
  if (!val) return "Not specified";
  const s = String(val).trim().toLowerCase();
  if (s === "male" || s === "m") return "Male";
  if (s === "female" || s === "f") return "Female";
  return String(val).trim() || "Not specified";
};

/**
 * Generate the next sequential tag number independently for each animal species
 */
export const generateNextTag = (rows, species) => {
  if (!species) return "";
  const targetSpecies = String(species).trim();
  const speciesUpper = targetSpecies.toUpperCase();

  const speciesRows = (rows || []).filter((r) => {
    const rSpecies = String(r.species || "").trim().toUpperCase();
    const tagUpper = String(r.tag_number || "").trim().toUpperCase();
    return rSpecies === speciesUpper || tagUpper.endsWith(`-${speciesUpper}`);
  });

  const nums = speciesRows
    .map((r) => {
      const tagStr = String(r.tag_number || "");
      const m = tagStr.match(/TAG-(?:(\d+)-(?:[A-Z]+|\d{4})|(?:[A-Z]+|\d{4})-(\d+)|(\d+))/i) 
             || tagStr.match(/(\d+)/);
      return m ? parseInt(m[1] || m[2] || m[3] || m[0], 10) : 0;
    })
    .filter((n) => !isNaN(n));

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `TAG-${String(next).padStart(3, "0")}-${speciesUpper}`;
};


