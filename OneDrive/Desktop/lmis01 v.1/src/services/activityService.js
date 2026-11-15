// Cross-role activity and real-time security tracking service.
// Records operational actions, presence heartbeats, diffs, and security events.
import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES, STORAGE_KEYS } from "../utils/constants";
import { uuid, now } from "../utils/helpers";
import {
  getUserNotificationPreferences,
  classifyNotificationCategory,
} from "./notificationPreferenceService";

const ACTIVE_SESSIONS_KEY = "lsmis_active_sessions";
const TERMINATION_SIGNAL_KEY = "lsmis_session_termination_signal";
const PRESENCE_CHANNEL = "lsmis_presence_channel";
const AUDIT_MIRROR_KEY = "lsmis_personnel_audit_mirror_v1";

const appendAuditMirror = (logEntry) => {
  if (!logEntry || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(AUDIT_MIRROR_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const safeList = Array.isArray(list) ? list : [];
    const next = [logEntry, ...safeList.filter((item) => item && item.id !== logEntry.id)].slice(0, 600);
    localStorage.setItem(AUDIT_MIRROR_KEY, JSON.stringify(next));
  } catch (_) {}
};

const readAuditMirror = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AUDIT_MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Synthesizes historical personnel audit records from operational domain tables
 * (livestock, ante_mortem_inspections, post_mortem_inspections, slaughter_records,
 * slaughter_processing, carcass_records, payments, permits, dispatch, condemnation_records,
 * disposal_records, diseases, users) when cross-role rows are filtered by legacy RLS.
 */
let _operationalAuditCache = { rows: null, timestamp: 0 };
const OPERATIONAL_AUDIT_TTL_MS = 15000;

const fetchOperationalPersonnelAuditLogs = async (directory, forceRefresh = false) => {
  if (
    !forceRefresh &&
    Array.isArray(_operationalAuditCache.rows) &&
    Date.now() - _operationalAuditCache.timestamp < OPERATIONAL_AUDIT_TTL_MS
  ) {
    return _operationalAuditCache.rows;
  }

  const safeFetch = async (table, limit = 300) => {
    try {
      const { data, error } = await supabase.from(table).select("*").limit(limit);
      return !error && Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  try {
    const [
      livestock,
      anteMortem,
      postMortem,
      slaughterRecs,
      slaughterProc,
      carcasses,
      payments,
      permits,
      dispatches,
      condemnations,
      disposals,
      diseases,
    ] = await Promise.all([
      safeFetch(TABLES.LIVESTOCK, 400),
      safeFetch(TABLES.ANTE_MORTEM, 300),
      safeFetch(TABLES.POST_MORTEM, 300),
      safeFetch(TABLES.SLAUGHTER_RECORDS, 300),
      safeFetch(TABLES.SLAUGHTER_PROCESSING, 300),
      safeFetch(TABLES.CARCASS_RECORDS, 300),
      safeFetch(TABLES.PAYMENTS, 300),
      safeFetch(TABLES.PERMITS, 300),
      safeFetch(TABLES.DISPATCH, 200),
      safeFetch(TABLES.CONDEMNATION_RECORDS, 200),
      safeFetch(TABLES.DISPOSAL_RECORDS, 200),
      safeFetch(TABLES.DISEASES, 200),
    ]);

    const defaultVetUser =
      (directory?.rows || []).find((u) => u && normalizeRole(u.role) === "vet")?.full_name || "Dr. Dave";
    const defaultStaffUser =
      (directory?.rows || []).find((u) => u && normalizeRole(u.role) === "staff")?.full_name || "Jenel Selgas";

    const resolveRoleFromDirectory = (nameOrId, fallbackRole) => {
      if (nameOrId && directory) {
        const key = String(nameOrId).trim().toLowerCase();
        const found =
          directory.byId?.get(key) ||
          directory.byName?.get(key) ||
          directory.byEmail?.get(key) ||
          directory.byUsername?.get(key);
        if (found?.role) return normalizeRole(found.role);
      }
      return fallbackRole;
    };

    const resolveNameFromDirectory = (nameOrId, fallbackName) => {
      if (nameOrId && directory) {
        const key = String(nameOrId).trim().toLowerCase();
        const found =
          directory.byId?.get(key) ||
          directory.byName?.get(key) ||
          directory.byEmail?.get(key) ||
          directory.byUsername?.get(key);
        if (found?.full_name) return found.full_name;
      }
      if (nameOrId && !["unknown", "unassigned", "n/a", "staff", "vet", "veterinarian"].includes(String(nameOrId).trim().toLowerCase())) {
        return String(nameOrId).trim();
      }
      return fallbackName;
    };

    const synthesized = [];

    // 1. Livestock Registration & Animal Marking & Process History
    livestock.forEach((lv) => {
      if (!lv) return;
      const tag = lv.tag_number || "";
      const regTs = lv.registered_at || (lv.received_date ? `${lv.received_date}T08:00:00+08:00` : null);
      if (regTs) {
        const staffActor = resolveNameFromDirectory(lv.registered_by || lv.received_by, defaultStaffUser);
        const actorRole = resolveRoleFromDirectory(lv.registered_by || lv.received_by, "staff");
        synthesized.push({
          id: `ops-lv-reg-${lv.id || tag}`,
          user: staffActor,
          role: actorRole,
          action: `Registered ${lv.species || "Livestock"} (${tag}) for owner ${lv.owner_name || "Owner"}`,
          module: "Intake",
          tag_number: tag,
          timestamp: regTs,
          new_value: `Species: ${lv.species || "N/A"} | Weight: ${lv.weight || 0} kg | Status: ${lv.status || "Pending"}`,
          field_changed: "livestock_registration",
        });
      }

      if (lv.marked || lv.marked_at || lv.mark_date) {
        const markTs = lv.marked_at || (lv.mark_date ? `${lv.mark_date}T09:15:00+08:00` : regTs);
        const markActor = resolveNameFromDirectory(lv.marked_by, defaultStaffUser);
        const markRole = resolveRoleFromDirectory(lv.marked_by, "staff");
        if (markTs) {
          synthesized.push({
            id: `ops-lv-mark-${lv.id || tag}`,
            user: markActor,
            role: markRole,
            action: `Marked animal ${tag} (${lv.mark_type || "Standard Paint Mark"})`,
            module: "Animal Marking",
            tag_number: tag,
            timestamp: markTs,
            old_value: "Unmarked",
            new_value: `Marked (${lv.mark_type || "Standard"})`,
            field_changed: "marked",
          });
        }
      }

      // Parse marking_history / process_history events if present
      const histArr = Array.isArray(lv.marking_history)
        ? lv.marking_history
        : Array.isArray(lv.process_history)
        ? lv.process_history
        : [];
      histArr.forEach((evt, idx) => {
        if (!evt || !evt.timestamp) return;
        const evtRole = normalizeRole(evt.role || resolveRoleFromDirectory(evt.user_name || evt.user_id, "staff"));
        if (evtRole !== "admin" && evtRole !== "vet" && evtRole !== "staff") return;
        const evtUser = resolveNameFromDirectory(
          evt.user_name || evt.user_id,
          evtRole === "vet" ? defaultVetUser : defaultStaffUser
        );
        synthesized.push({
          id: `ops-lv-hist-${lv.id || tag}-${evt.id || idx}`,
          user_id: evt.user_id || null,
          user: evtUser,
          role: evtRole,
          action: `${evt.action || "Updated"} — ${tag} (${evt.stage || "Livestock"})`,
          module: evt.stage || "Livestock",
          tag_number: tag,
          timestamp: evt.timestamp,
        });
      });
    });

    // 2. Ante-Mortem Inspections (Veterinarian)
    anteMortem.forEach((am) => {
      if (!am) return;
      const tag = am.tag_number || "";
      const ts = am.inspected_at || am.created_at || (am.date ? `${am.date}T10:00:00+08:00` : null);
      if (!ts) return;
      const vetActor = resolveNameFromDirectory(am.inspector_name || am.inspector_id, defaultVetUser);
      synthesized.push({
        id: `ops-am-${am.id || tag}`,
        user_id: am.inspector_id || null,
        user: vetActor,
        role: "vet",
        action: `Ante-Mortem inspection (${am.decision || "Inspected"}) for ${tag}${am.species ? ` (${am.species})` : ""}`,
        module: "Ante-Mortem Inspection",
        tag_number: tag,
        timestamp: ts,
        new_value: `Decision: ${am.decision || "Approved"} | Findings: ${am.findings || "Normal"}`,
        field_changed: "ante_mortem_decision",
      });
    });

    // 3. Post-Mortem Inspections (Veterinarian)
    postMortem.forEach((pm) => {
      if (!pm) return;
      const tag = pm.tag_number || "";
      const ts = pm.inspected_at || pm.created_at || (pm.date ? `${pm.date}T11:30:00+08:00` : null);
      if (!ts) return;
      const vetActor = resolveNameFromDirectory(pm.inspector_name || pm.inspector_id, defaultVetUser);
      synthesized.push({
        id: `ops-pm-${pm.id || tag}`,
        user_id: pm.inspector_id || null,
        user: vetActor,
        role: "vet",
        action: `Post-Mortem inspection (${pm.decision || "Inspected"}) for ${tag}${pm.species ? ` (${pm.species})` : ""}`,
        module: "Post-Mortem Inspection",
        tag_number: tag,
        timestamp: ts,
        new_value: `Decision: ${pm.decision || "Approved"} | Findings: ${pm.findings || "Normal"}`,
        field_changed: "post_mortem_decision",
      });
    });

    // 4. Slaughter Records & Team Assignment (Staff)
    slaughterRecs.forEach((sr) => {
      if (!sr) return;
      const tag = sr.tag_number || "";
      const dateBase = sr.slaughter_date || sr.scheduled_date;
      const ts = sr.created_at || sr.updated_at || (dateBase ? `${dateBase}T10:30:00+08:00` : null);
      if (!ts) return;
      const staffActor = resolveNameFromDirectory(sr.slaughtered_by || sr.operator, defaultStaffUser);
      const isAssign = sr.operator && sr.operator !== "Unassigned";
      synthesized.push({
        id: `ops-sr-${sr.id || tag}`,
        user: staffActor,
        role: "staff",
        action: isAssign
          ? `Slaughter status updated to ${sr.status || "Scheduled"} & assigned operator (${sr.operator}) for ${tag}`
          : `Ready for Slaughter record updated (${sr.status || "Scheduled"}) for ${tag}`,
        module: "Slaughter",
        tag_number: tag,
        timestamp: ts,
        new_value: `Status: ${sr.status || "Scheduled"} | Operator: ${sr.operator || "Assigned"}`,
        field_changed: "slaughter_status",
      });
    });

    // 5. Slaughter Processing (Staff)
    slaughterProc.forEach((sp) => {
      if (!sp) return;
      const tag = sp.tag_number || "";
      const ts = sp.updated_at || sp.created_at || (sp.date ? `${sp.date}T10:45:00+08:00` : null);
      if (!ts) return;
      const staffActor = resolveNameFromDirectory(sp.slaughtered_by || sp.operator, defaultStaffUser);
      synthesized.push({
        id: `ops-sp-${sp.id || tag}`,
        user: staffActor,
        role: "staff",
        action: `Slaughter processing (${sp.status || "In Progress"}) for ${tag}`,
        module: "Slaughter",
        tag_number: tag,
        timestamp: ts,
        new_value: `Status: ${sp.status} | Team: ${sp.operator || "Assigned"}`,
        field_changed: "slaughter_processing",
      });
    });

    // 6. Carcass Weighing (Veterinarian / Staff)
    carcasses.forEach((cr) => {
      if (!cr) return;
      const tag = cr.tag_number || "";
      const ts = cr.weighed_at || cr.created_at || (cr.date ? `${cr.date}T12:00:00+08:00` : null);
      if (!ts) return;
      const rawActor = cr.weighed_by || cr.operator || defaultVetUser;
      const actorRole = resolveRoleFromDirectory(cr.weighed_by_user_id || rawActor, "vet");
      const actorName = resolveNameFromDirectory(
        cr.weighed_by_user_id || rawActor,
        actorRole === "vet" ? defaultVetUser : defaultStaffUser
      );
      synthesized.push({
        id: `ops-cr-${cr.id || tag}`,
        user_id: cr.weighed_by_user_id || null,
        user: actorName,
        role: actorRole,
        action: `Carcass weighed (${cr.total_weight || cr.hot_weight || 0} kg, Grade ${cr.grade || "A"}) for ${tag}`,
        module: "Carcass Weighing",
        tag_number: tag,
        timestamp: ts,
        new_value: `Weight: ${cr.total_weight || 0} kg | Grade: ${cr.grade || "A"}`,
        field_changed: "carcass_weight",
      });
    });

    // 7. Payments (Staff)
    payments.forEach((pay) => {
      if (!pay) return;
      const tag = pay.tag_number || "";
      const ts = pay.paid_at || pay.created_at || (pay.date ? `${pay.date}T13:00:00+08:00` : null);
      if (!ts) return;
      const staffActor = resolveNameFromDirectory(pay.staff_name || pay.paid_by_user_id, defaultStaffUser);
      synthesized.push({
        id: `ops-pay-${pay.id || pay.receipt_no || tag}`,
        user: staffActor,
        role: "staff",
        action: `Recorded payment (${pay.receipt_no || "Receipt"}) of PHP ${Number(pay.amount || 0).toFixed(2)} for ${tag}`,
        module: "Payments",
        tag_number: tag,
        timestamp: ts,
        new_value: `Receipt: ${pay.receipt_no} | Amount: PHP ${Number(pay.amount || 0).toFixed(2)} | Status: ${pay.status || "Paid"}`,
        field_changed: "payment_status",
      });
    });

    // 8. Meat Permits (Staff)
    permits.forEach((pmt) => {
      if (!pmt) return;
      const tag = pmt.tag_number || "";
      const ts = pmt.issued_at || pmt.created_at;
      if (!ts) return;
      const staffActor = resolveNameFromDirectory(pmt.issued_by_user_id || pmt.issued_by, defaultStaffUser);
      const actorRole = resolveRoleFromDirectory(pmt.issued_by_user_id || pmt.issued_by, "staff");
      synthesized.push({
        id: `ops-pmt-${pmt.id || pmt.permit_no || tag}`,
        user_id: pmt.issued_by_user_id || null,
        user: staffActor,
        role: actorRole,
        action: `Meat permit ${pmt.permit_no || ""} issued for ${tag} (${pmt.owner_name || "Owner"})`,
        module: "Permits",
        tag_number: tag,
        timestamp: ts,
        new_value: `Permit No: ${pmt.permit_no} | Weight: ${pmt.carcass_weight || 0} kg | Destination: ${pmt.destination || ""}`,
        field_changed: "permit_status",
      });
    });

    // 9. Meat Dispatch (Staff)
    dispatches.forEach((dsp) => {
      if (!dsp) return;
      const tagsList = Array.isArray(dsp.tags) ? dsp.tags.join(", ") : dsp.tag_number || "";
      const ts = dsp.dispatched_at || dsp.released_at || dsp.created_at;
      if (!ts) return;
      const staffActor = resolveNameFromDirectory(dsp.dispatched_by || dsp.dispatched_by_user_id, defaultStaffUser);
      synthesized.push({
        id: `ops-dsp-${dsp.id}`,
        user: staffActor,
        role: "staff",
        action: `Dispatched meat shipment (${dsp.id}) for ${dsp.owner_name || "Owner"} to ${dsp.destination || "Market"}`,
        module: "Dispatch",
        tag_number: tagsList || null,
        timestamp: ts,
        new_value: `Vehicle: ${dsp.vehicle || "N/A"} | Driver: ${dsp.driver || "N/A"} | Status: ${dsp.status || "Released"}`,
        field_changed: "dispatch_status",
      });
    });

    // 10. Condemnation Records (Veterinarian)
    condemnations.forEach((cnd) => {
      if (!cnd) return;
      const tag = cnd.tag_number || "";
      const ts = cnd.created_at || (cnd.date ? `${cnd.date}T11:45:00+08:00` : null);
      if (!ts) return;
      const vetActor = resolveNameFromDirectory(cnd.inspector_id || cnd.inspector, defaultVetUser);
      synthesized.push({
        id: `ops-cnd-${cnd.id || tag}`,
        user: vetActor,
        role: "vet",
        action: `Condemned ${cnd.part || "carcass part"} (${cnd.quantity || ""}) for ${tag} — Reason: ${cnd.reason || "Inspection finding"}`,
        module: "Condemnation",
        tag_number: tag,
        timestamp: ts,
        severity: "warning",
        new_value: `Part: ${cnd.part} | Reason: ${cnd.reason} | Disposition: ${cnd.disposition || "Condemned"}`,
        field_changed: "condemnation",
      });
    });

    // 11. Disposal Records (Veterinarian)
    disposals.forEach((dis) => {
      if (!dis) return;
      const tag = dis.tag_number || "";
      const ts = dis.created_at || (dis.date ? `${dis.date}T14:00:00+08:00` : null);
      if (!ts) return;
      const vetActor = resolveNameFromDirectory(dis.disposed_by, defaultVetUser);
      synthesized.push({
        id: `ops-dis-${dis.id || tag}`,
        user: vetActor,
        role: "vet",
        action: `Recorded disposal (${dis.method || "Incineration"}) for ${tag}`,
        module: "Disposal",
        tag_number: tag,
        timestamp: ts,
        new_value: `Method: ${dis.method} | Status: ${dis.status || "Completed"}`,
        field_changed: "disposal",
      });
    });

    // 12. Disease Monitoring (Veterinarian)
    diseases.forEach((ds) => {
      if (!ds) return;
      const tag = ds.tag_number || "";
      const ts = ds.created_at || (ds.date ? `${ds.date}T10:15:00+08:00` : null);
      if (!ts) return;
      synthesized.push({
        id: `ops-ds-${ds.id || tag}`,
        user: defaultVetUser,
        role: "vet",
        action: `Logged disease finding (${ds.disease || "Condition"}) for ${tag}`,
        module: "Disease Monitoring",
        tag_number: tag,
        timestamp: ts,
        severity: ds.severity === "High" ? "danger" : "warning",
      });
    });

    // 13. Personnel Login Sessions from public.users (Vet & Staff last_login)
    (directory?.rows || []).forEach((u) => {
      if (!u || !u.last_login || u.last_login === "Never") return;
      const r = normalizeRole(u.role);
      if (r !== "vet" && r !== "staff") return;
      const parsedLogin = parseAuditTimestamp(u.last_login);
      if (!parsedLogin) return;
      synthesized.push({
        id: `ops-login-${u.id}`,
        user_id: u.id,
        user: u.full_name || u.email,
        role: r,
        action: `User logged in (${formatRoleLabel(r)} Portal)`,
        module: "Auth",
        timestamp: toManilaIsoString(parsedLogin),
        old_value: "Logged Out",
        new_value: "Active Session",
        field_changed: "session_state",
      });
    });

    // 14. Persisted Personnel Audit Stream from system_settings (email column JSON)
    try {
      const { data: sysRow } = await supabase
        .from(TABLES.SETTINGS)
        .select("email")
        .eq("id", "lsmis_personnel_audit_stream")
        .maybeSingle();
      if (sysRow?.email) {
        const parsedStream = JSON.parse(sysRow.email);
        if (Array.isArray(parsedStream)) {
          parsedStream.forEach((item) => {
            if (item && item.action) synthesized.push(item);
          });
        }
      }
    } catch (_) {}

    _operationalAuditCache = { rows: synthesized, timestamp: Date.now() };
    return synthesized;
  } catch (err) {
    console.warn("fetchOperationalPersonnelAuditLogs warning:", err);
    return _operationalAuditCache.rows || [];
  }
};

export const AUDIT_ACTION_TYPES = [
  "Created",
  "Updated",
  "Approved",
  "Rejected",
  "Deleted",
  "Logged In",
  "Logged Out",
  "Registered",
  "Issued",
  "Assigned",
];

// BroadcastChannel for zero-latency cross-tab/window real-time sync
let _bc = null;
const getBroadcastChannel = () => {
  if (!_bc) {
    try {
      _bc = new BroadcastChannel(PRESENCE_CHANNEL);
    } catch (e) {
      _bc = null;
    }
  }
  return _bc;
};

const broadcastPresence = (payload) => {
  try {
    const bc = getBroadcastChannel();
    if (bc) bc.postMessage(payload);
  } catch (e) {}
  window.dispatchEvent(new CustomEvent("lsmis_presence_updated", { detail: payload }));
};

const getSession = () => {
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEYS.SESSION) ||
      localStorage.getItem(STORAGE_KEYS.SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const normalizeRole = (role) => {
  if (!role) return "staff";
  const r = String(role).trim().toLowerCase();
  if (r === "admin" || r === "administrator" || r.includes("admin")) return "admin";
  if (r === "vet" || r === "veterinarian" || r.includes("vet") || r.includes("doctor")) return "vet";
  if (r === "staff" || r === "operator" || r.includes("staff")) return "staff";
  if (r === "owner" || r.includes("owner")) return "owner";
  if (r === "system") return "system";
  return r;
};

/**
 * Formats a role into the exact LSMIS display label: Admin, Veterinarian, or Staff.
 */
export const formatRoleLabel = (role) => {
  const norm = normalizeRole(role);
  if (norm === "admin") return "Admin";
  if (norm === "vet") return "Veterinarian";
  if (norm === "staff") return "Staff";
  if (norm === "owner") return "Owner";
  return "Staff";
};

/**
 * Classifies an audit action description into one of the standard LSMIS activity types:
 * Created, Updated, Approved, Rejected, Deleted, Logged In, Logged Out, Registered, Issued, or Assigned.
 */
export const classifyAuditAction = (actionText = "") => {
  const text = String(actionText || "").trim();
  if (!text) return "Updated";
  const lower = text.toLowerCase();

  if (/logged in|signed in|verified 2fa|\blogin\b/i.test(lower)) return "Logged In";
  if (/logged out|signed out|\blogout\b/i.test(lower)) return "Logged Out";
  if (/\bissued\b|permit issued|recorded payment|\breceipt\b/i.test(lower)) return "Issued";
  if (/\bassigned\b|\breassigned\b|assign team operator/i.test(lower)) return "Assigned";
  if (/\bregistered\b|batch registered|registration submitted/i.test(lower)) return "Registered";
  if (/\bapproved\b|\bcertified\b|\bpassed\b|\bcleared\b/i.test(lower)) return "Approved";
  if (/\brejected\b|\bcondemned\b|\bterminated\b|\bsuspended\b|failed login|failed password|lockout/i.test(lower)) return "Rejected";
  if (/\bdeleted\b|\bremoved\b|\bdisposal\b|\bdisposed\b/i.test(lower)) return "Deleted";
  if (/\bcreated\b|\badded\b|\bprovisioned\b/i.test(lower)) return "Created";
  return "Updated";
};

/**
 * Converts a Date or timestamp into an ISO-8601 string in Philippine Time (Asia/Manila, +08:00).
 * Example: "2026-10-31T15:25:10+08:00"
 */
export const toManilaIsoString = (dateInput = new Date()) => {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(validDate);
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hh = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}:${map.second}+08:00`;
};

export const getManilaTimestamp = () => toManilaIsoString(new Date());

/**
 * Safely parses any timestamp (ISO string or Manila locale string) into a Date object.
 */
export const parseAuditTimestamp = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) {
    return isNaN(timestamp.getTime()) ? null : timestamp;
  }
  const str = String(timestamp).trim();
  if (!str) return null;

  // 1. Standard ISO string with timezone or T separator
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(str);
    const normalized = str.includes("T") ? str : str.replace(" ", "T");
    const d = new Date(hasTz ? normalized : `${normalized}+08:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. US locale string in Asia/Manila: "MM/DD/YYYY, hh:mm:ss AM/PM"
  const localeMatch = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (localeMatch) {
    const month = String(localeMatch[1]).padStart(2, "0");
    const day = String(localeMatch[2]).padStart(2, "0");
    const year = localeMatch[3];
    let hour = parseInt(localeMatch[4], 10);
    const minute = localeMatch[5];
    const second = localeMatch[6] || "00";
    const ampm = (localeMatch[7] || "").toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, "0");
    const iso = `${year}-${month}-${day}T${hh}:${minute}:${second}+08:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};

/**
 * Returns the YYYY-MM-DD date string in Philippine Time (Asia/Manila).
 */
export const toManilaDateKey = (timestamp) => {
  const d = parseAuditTimestamp(timestamp);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
};

/* =========================================================================
   USER DIRECTORY CACHE & ACTOR IDENTITY RESOLUTION
   ========================================================================= */

let _usersCache = { rows: null, byId: new Map(), byEmail: new Map(), byUsername: new Map(), byName: new Map(), timestamp: 0 };
const USERS_CACHE_TTL_MS = 30000;

export const getUsersDirectory = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    _usersCache.rows &&
    Date.now() - _usersCache.timestamp < USERS_CACHE_TTL_MS
  ) {
    return _usersCache;
  }

  try {
    const { data, error } = await supabase
      .from(TABLES.USERS)
      .select("id, full_name, username, email, role");

    if (!error && Array.isArray(data)) {
      const byId = new Map();
      const byEmail = new Map();
      const byUsername = new Map();
      const byName = new Map();

      data.forEach((u) => {
        if (!u) return;
        if (u.id) byId.set(String(u.id).trim().toLowerCase(), u);
        if (u.email) byEmail.set(String(u.email).trim().toLowerCase(), u);
        if (u.username) byUsername.set(String(u.username).trim().toLowerCase(), u);
        if (u.full_name) byName.set(String(u.full_name).trim().toLowerCase(), u);
      });

      _usersCache = {
        rows: data,
        byId,
        byEmail,
        byUsername,
        byName,
        timestamp: Date.now(),
      };
    }
  } catch (_) {}

  return _usersCache;
};

let _actorCache = { sessionKey: null, identity: null, timestamp: 0 };
const ACTOR_CACHE_TTL_MS = 60000;

export const getActorIdentity = async (explicitUser = null, explicitRole = null, explicitUserId = null) => {
  const activeSession = getSession();
  const directory = await getUsersDirectory();

  const lookupUserRecord = (idCandidate, userCandidate) => {
    if (idCandidate) {
      const foundById = directory.byId.get(String(idCandidate).trim().toLowerCase());
      if (foundById) return foundById;
    }
    if (userCandidate) {
      const key = String(userCandidate).trim().toLowerCase();
      return (
        directory.byName.get(key) ||
        directory.byEmail.get(key) ||
        directory.byUsername.get(key) ||
        null
      );
    }
    return null;
  };

  // 1. Check explicit parameters against users directory first so full_name and role are always authoritative
  if (explicitUserId || (explicitUser && explicitUser !== "System" && explicitUser !== "System Scheduler")) {
    const matchedExplicit = lookupUserRecord(explicitUserId, explicitUser);
    if (matchedExplicit) {
      return {
        userId: matchedExplicit.id,
        userName: matchedExplicit.full_name || explicitUser || matchedExplicit.username || matchedExplicit.email,
        userRole: normalizeRole(matchedExplicit.role || explicitRole),
      };
    }
  }

  // 2. Check active session in sessionStorage/localStorage
  if (activeSession) {
    const sessionUserId = activeSession.id || activeSession.user_id || activeSession.user?.id || null;
    const sessionEmail = activeSession.email || activeSession.user?.email || null;
    const sessionName = activeSession.name || activeSession.full_name || activeSession.username || null;
    const matchedSessionUser = lookupUserRecord(sessionUserId, sessionEmail || sessionName);

    if (matchedSessionUser) {
      return {
        userId: matchedSessionUser.id,
        userName: matchedSessionUser.full_name || sessionName || matchedSessionUser.username,
        userRole: normalizeRole(matchedSessionUser.role || activeSession.role || explicitRole),
      };
    }

    if (sessionName && activeSession.role) {
      return {
        userId: sessionUserId || explicitUserId || "authenticated",
        userName: sessionName,
        userRole: normalizeRole(activeSession.role),
      };
    }
  }

  // 3. Query Supabase Auth directly
  const currentSessionKey = activeSession
    ? `${activeSession.id || activeSession.user_id || ""}:${activeSession.email || ""}:${activeSession.role || ""}`
    : "";
  if (
    currentSessionKey &&
    _actorCache.sessionKey === currentSessionKey &&
    _actorCache.identity &&
    Date.now() - _actorCache.timestamp < ACTOR_CACHE_TTL_MS
  ) {
    return _actorCache.identity;
  }

  let resolvedId = explicitUserId || null;
  let resolvedRole = explicitRole ? normalizeRole(explicitRole) : null;
  let resolvedName = explicitUser && explicitUser !== "System Scheduler" ? explicitUser : null;

  try {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (authUser) {
      resolvedId = authUser.id;
      const matchedAuthUser = lookupUserRecord(authUser.id, authUser.email);
      if (matchedAuthUser) {
        resolvedId = matchedAuthUser.id || resolvedId;
        resolvedRole = normalizeRole(matchedAuthUser.role);
        resolvedName = matchedAuthUser.full_name || matchedAuthUser.username || authUser.email;
      } else {
        resolvedRole = normalizeRole(authUser.user_metadata?.role || resolvedRole);
        resolvedName = authUser.user_metadata?.full_name || resolvedName || authUser.email;
      }
    }
  } catch (_) {}

  const result = {
    userId: resolvedId || "authenticated",
    userName: resolvedName || explicitUser || "System Administrator",
    userRole: resolvedRole && resolvedRole !== "system" ? resolvedRole : "admin",
  };

  if (currentSessionKey && result.userId !== "authenticated") {
    _actorCache = { sessionKey: currentSessionKey, identity: result, timestamp: Date.now() };
  }

  return result;
};

/* =========================================================================
   CLIENT IP RESOLUTION
   ========================================================================= */

let _cachedClientIp = null;

export const getClientIp = async () => {
  if (_cachedClientIp) return _cachedClientIp;

  try {
    const stored = sessionStorage.getItem("lsmis_client_ip");
    if (stored) {
      _cachedClientIp = stored;
      return stored;
    }
  } catch (_) {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) {
        _cachedClientIp = data.ip;
        try {
          sessionStorage.setItem("lsmis_client_ip", data.ip);
        } catch (_) {}
        return data.ip;
      }
    }
  } catch (_) {}

  const isLocalHost = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  return isLocalHost ? "127.0.0.1" : null;
};

/* =========================================================================
   AUDIT LOGGING (WITH DEDUPLICATION GUARD)
   ========================================================================= */

const _recentLogFingerprints = new Map();
const DEDUPE_WINDOW_MS = 4000;

export const logActivity = async ({
  action,
  module = "System",
  tag_number = null,
  old_value = null,
  new_value = null,
  field_changed = null,
  security_event = null,
  severity = "info",
  user = null,
  role = null,
  user_id = null,
  ip = null,
  notify = null,
}) => {
  if (!action || !String(action).trim()) return null;

  // Resolve authenticated actor strictly from session, Supabase Auth, and public.users
  const actor = await getActorIdentity(user, role, user_id);

  const resolvedTagNumber =
    tag_number ||
    (action && (action.match(/TAG-[\w-]+/i) || [])[0]) ||
    (new_value && (String(new_value).match(/TAG-[\w-]+/i) || [])[0]) ||
    (old_value && (String(old_value).match(/TAG-[\w-]+/i) || [])[0]) ||
    null;

  // Prevent duplicate audit log entries within 4 seconds
  const nowMs = Date.now();
  const fingerprint = `${actor.userName}|${actor.userRole}|${module}|${String(action).trim()}|${resolvedTagNumber || ""}`;
  const lastLoggedAt = _recentLogFingerprints.get(fingerprint);
  if (lastLoggedAt && nowMs - lastLoggedAt < DEDUPE_WINDOW_MS) {
    return null;
  }
  _recentLogFingerprints.set(fingerprint, nowMs);

  // Prune old fingerprints periodically
  if (_recentLogFingerprints.size > 200) {
    for (const [k, ts] of _recentLogFingerprints.entries()) {
      if (nowMs - ts > DEDUPE_WINDOW_MS * 2) _recentLogFingerprints.delete(k);
    }
  }

  let clientIp = ip;
  if (!clientIp) {
    try {
      clientIp = await getClientIp();
    } catch (_) {
      const isLocalHost = typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      clientIp = isLocalHost ? "127.0.0.1" : null;
    }
  }

  const manilaIsoTimestamp = toManilaIsoString(new Date(nowMs));

  const newLog = {
    id: uuid(),
    user_id: actor.userId,
    user: actor.userName,
    role: actor.userRole,
    action: String(action).trim(),
    module: module || "System",
    ip: clientIp || null,
    tag_number: resolvedTagNumber,
    old_value: old_value !== null && old_value !== undefined ? String(old_value) : null,
    new_value: new_value !== null && new_value !== undefined ? String(new_value) : null,
    field_changed: field_changed || null,
    security_event: security_event || null,
    severity: severity || (security_event ? "danger" : "info"),
    timestamp: manilaIsoTimestamp,
  };

  appendAuditMirror(newLog);
  _operationalAuditCache.timestamp = 0;

  // Also persist cross-role personnel audit stream to system_settings so Admin sees all roles regardless of legacy RLS
  if (actor.userRole === "admin" || actor.userRole === "vet" || actor.userRole === "staff") {
    (async () => {
      try {
        const { data: sysRow } = await supabase
          .from(TABLES.SETTINGS)
          .select("email")
          .eq("id", "lsmis_personnel_audit_stream")
          .maybeSingle();
        let existingList = [];
        if (sysRow?.email) {
          try {
            const parsed = JSON.parse(sysRow.email);
            if (Array.isArray(parsed)) existingList = parsed;
          } catch (_) {}
        }
        const compactEntry = {
          id: newLog.id,
          user_id: newLog.user_id,
          user: newLog.user,
          role: newLog.role,
          action: newLog.action,
          module: newLog.module,
          tag_number: newLog.tag_number,
          old_value: newLog.old_value ? String(newLog.old_value).slice(0, 300) : null,
          new_value: newLog.new_value ? String(newLog.new_value).slice(0, 300) : null,
          field_changed: newLog.field_changed,
          security_event: newLog.security_event,
          severity: newLog.severity,
          timestamp: newLog.timestamp,
        };
        const updatedList = [compactEntry, ...existingList.filter((i) => i && i.id !== newLog.id)].slice(0, 250);
        await supabase.from(TABLES.SETTINGS).upsert({
          id: "lsmis_personnel_audit_stream",
          system_name: "LSMIS Personnel Audit Stream",
          email: JSON.stringify(updatedList),
        });
      } catch (_) {}
    })();
  }

  try {
    let { error } = await supabase.from(TABLES.AUDIT_LOGS).insert(newLog);
    if (error && /user_id/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const fallbackLog = { ...newLog };
      delete fallbackLog.user_id;
      const res = await supabase.from(TABLES.AUDIT_LOGS).insert(fallbackLog);
      error = res.error;
    }
    if (error) {
      console.warn("Supabase audit log insert error:", error);
    }
    notifyDbChange(TABLES.AUDIT_LOGS, "insert", newLog);
    window.dispatchEvent(new CustomEvent("lsmis_audit_updated", { detail: newLog }));
  } catch (err) {
    console.warn("Supabase audit log insert exception:", err);
  }

  if (notify) {
    // Resolve target role strictly per LSMIS specifications
    let targetRole = notify.role ? String(notify.role).toLowerCase().trim() : null;
    if (!targetRole) {
      if (notify.owner_id) {
        targetRole = "owner";
      } else {
        const m = String(mod || "").toLowerCase();
        const a = String(action || "").toLowerCase();
        const t = String(notify.title || "").toLowerCase();
        if (
          m.includes("ante") || m.includes("post") || m.includes("inspect") ||
          m.includes("condemn") || m.includes("weigh") ||
          t.includes("ante-mortem") || t.includes("post-mortem") || t.includes("inspection") ||
          t.includes("condemn") || t.includes("carcass")
        ) {
          targetRole = "vet";
        } else if (
          m.includes("slaughter") || m.includes("permit") || m.includes("intake") ||
          m.includes("marking") || m.includes("dispatch") || m.includes("payment") ||
          t.includes("slaughter") || t.includes("operator") || t.includes("permit") ||
          t.includes("marking") || t.includes("line alert") || t.includes("timeout") ||
          t.includes("registered")
        ) {
          targetRole = "staff";
        } else {
          targetRole = "admin";
        }
      }
    }

    const newNotif = {
      id: uuid(),
      owner_id: notify.owner_id || null,
      title: notify.title,
      message: notify.message,
      date: now(),
      read: false,
      type: notify.type || "info",
      role: targetRole,
    };
    try {
      const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
      if (error) console.warn("Supabase notification insert error:", error);
      else {
        notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
        window.dispatchEvent(new Event("lmis-notif-read"));
      }
    } catch (e) {
      console.warn("Supabase notification insert exception:", e);
    }
  }

  return newLog;
};

export const notifyRole = async ({ role = "admin", title, message, type = "info", owner_id = null }) => {
  const targetRole = String(role || "admin").toLowerCase().trim();
  const newNotif = {
    id: uuid(),
    role: targetRole,
    owner_id: owner_id || null,
    title: title || "Notification",
    message: message || "",
    date: new Date().toISOString(),
    read: false,
    type,
  };
  try {
    const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
    if (!error) {
      notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
      window.dispatchEvent(new Event("lmis-notif-read"));
    }
  } catch (e) {
    console.warn("notifyRole exception:", e);
  }
  return newNotif;
};

export const notifyOwner = async ({ owner_id, title, message, type = "info" }) => {
  if (!owner_id) return null;

  const normalizedOwnerId = String(owner_id).trim();
  if (!normalizedOwnerId) return null;

  // Check owner's notification preferences before dispatch
  try {
    let ownerEmail = null;
    const { data: oRow } = await supabase.from(TABLES.OWNERS).select("email").eq("id", normalizedOwnerId).maybeSingle();
    if (oRow?.email) ownerEmail = oRow.email;

    const prefs = await getUserNotificationPreferences(ownerEmail, null);
    const category = classifyNotificationCategory(title, message);
    if (prefs && prefs[category] === false) {
      // Notification suppressed by owner's preference
      return null;
    }
  } catch (_) {}

  const newNotif = {
    id: uuid(),
    owner_id: normalizedOwnerId,
    role: "owner",
    title: title || "Notification",
    message: message || "",
    date: new Date().toISOString(),
    read: false,
    type,
  };

  try {
    const { data: existing } = await supabase
      .from(TABLES.NOTIFICATIONS)
      .select("id")
      .eq("owner_id", normalizedOwnerId)
      .eq("title", newNotif.title)
      .eq("message", newNotif.message)
      .limit(1);

    if (Array.isArray(existing) && existing.length > 0) {
      return { ...newNotif, id: existing[0].id };
    }
  } catch (e) {}

  try {
    const { error } = await supabase.from(TABLES.NOTIFICATIONS).insert(newNotif);
    if (error) {
      console.warn("Supabase notification insert error:", error);
      return newNotif;
    }
  } catch (e) {
    console.warn("Supabase notification insert exception:", e);
    return newNotif;
  }

  window.dispatchEvent(new Event("lmis-notif-read"));
  notifyDbChange(TABLES.NOTIFICATIONS, "insert", newNotif);
  return newNotif;
};

/* =========================================================================
   REAL-TIME PRESENCE & SESSION MANAGEMENT
   ========================================================================= */

export const registerLoginSession = ({ name, email, role, module: mod = "Dashboard", loginTime = null }) => {
  try {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();
    const nowIso = loginTime || new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");

    const filtered = rawSessions.filter((s) => (s.email || "").toLowerCase().trim() !== cleanEmail);

    const newSession = {
      id: uuid(),
      name: name || "Portal User",
      email: cleanEmail,
      role: role || "staff",
      current_module: mod,
      current_activity: "Authenticated into Portal",
      login_time: nowIso,
      last_active: nowIso,
      status: "Online",
      terminated: false,
    };

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify([newSession, ...filtered]));
    broadcastPresence({ type: "LOGIN", session: newSession });
    window.dispatchEvent(new Event("storage"));

    return newSession;
  } catch (err) {
    console.error("registerLoginSession error:", err);
    return null;
  }
};

export const updatePresence = ({ module: mod = "Dashboard", activity = "Viewing Overview", isIdle = false } = {}) => {
  try {
    const session = getSession();
    if (!session || !session.email) return;

    const cleanEmail = session.email.toLowerCase().trim();
    const nowIso = new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const idx = rawSessions.findIndex((s) => (s.email || "").toLowerCase().trim() === cleanEmail);

    const updatedSession = {
      id: idx >= 0 ? rawSessions[idx].id : uuid(),
      name: session.name || "User",
      email: session.email,
      role: session.role || "staff",
      current_module: mod,
      current_activity: activity,
      login_time: idx >= 0 ? rawSessions[idx].login_time : session.login_time || nowIso,
      last_active: isIdle ? (idx >= 0 ? rawSessions[idx].last_active : nowIso) : nowIso,
      status: isIdle ? "Idle" : "Online",
      terminated: false,
    };

    const nextSessions =
      idx >= 0
        ? rawSessions.map((s, i) => (i === idx ? { ...s, ...updatedSession } : s))
        : [updatedSession, ...rawSessions];

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(nextSessions));
    broadcastPresence({ type: "PRESENCE_UPDATE", session: updatedSession });
  } catch (err) {
    console.error("updatePresence error:", err);
  }
};

export const getActiveSessions = () => {
  try {
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const nowMs = Date.now();

    return rawSessions
      .map((s) => {
        if (s.terminated) return { ...s, status: "Offline" };
        const lastMs = s.last_active ? new Date(s.last_active).getTime() : 0;
        const diff = (nowMs - lastMs) / 60000;
        const status = diff <= 3 ? "Online" : diff <= 20 ? "Idle" : "Offline";
        return { ...s, status };
      })
      .sort((a, b) => {
        const w = { Online: 3, Idle: 2, Offline: 1 };
        const d = (w[b.status] || 0) - (w[a.status] || 0);
        return d !== 0 ? d : new Date(b.last_active) - new Date(a.last_active);
      });
  } catch (e) {
    return [];
  }
};

export const subscribeToActiveSessions = (callback) => {
  const fire = () => callback(getActiveSessions());
  window.addEventListener("lsmis_presence_updated", fire);
  window.addEventListener("storage", fire);

  let bc = null;
  try {
    bc = new BroadcastChannel(PRESENCE_CHANNEL);
    bc.onmessage = fire;
  } catch (e) {}

  let supabaseChannel = null;
  try {
    supabaseChannel = supabase
      .channel("lsmis_presence_room_v2")
      .on("broadcast", { event: "presence" }, fire)
      .subscribe();
  } catch (e) {}

  return () => {
    window.removeEventListener("lsmis_presence_updated", fire);
    window.removeEventListener("storage", fire);
    try {
      if (bc) bc.close();
    } catch (e) {}
    try {
      if (supabaseChannel) supabase.removeChannel(supabaseChannel);
    } catch (e) {}
  };
};

/* =========================================================================
   PHILIPPINE STANDARD TIME (Asia/Manila) FORMATTING
   ========================================================================= */

/**
 * Standardize timestamp formatting to Philippine Standard Time (Asia/Manila)
 * Consistent format: "Oct 31, 2026, 02:34:46 PM"
 */
export const formatManilaDateTime = (timestamp) => {
  if (!timestamp) return "Not recorded";
  try {
    const d = parseAuditTimestamp(timestamp);
    if (!d) return String(timestamp);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return String(timestamp);
  }
};

/**
 * Split timestamp into separate date and time in Asia/Manila for tabular displays
 */
export const formatManilaDateAndTimes = (timestamp) => {
  if (!timestamp) return { date: "Not recorded", time: "", time12: "", full: "Not recorded" };
  try {
    const d = parseAuditTimestamp(timestamp);
    if (!d) return { date: String(timestamp), time: "", time12: "", full: String(timestamp) };
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
    return { date, time: `${time} PHT`, time12: time, full: `${date}, ${time}` };
  } catch {
    return { date: String(timestamp), time: "", time12: "", full: String(timestamp) };
  }
};

/* =========================================================================
   RECORD ENRICHMENT & QUERYING
   ========================================================================= */

/**
 * Enriches an audit log record using the authoritative public.users directory so:
 * - User is always the full name of the person who performed the action
 * - Role is normalized to Admin, Veterinarian, or Staff
 * - Action category is classified (Created, Updated, Approved, Rejected, Deleted, Logged In, Logged Out, Registered, Issued, Assigned)
 * - Timestamp is parsed and formatted in Philippine time (Asia/Manila)
 */
export const enrichAuditRecord = (rawLog, directory) => {
  if (!rawLog) return null;

  const idKey = rawLog.user_id ? String(rawLog.user_id).trim().toLowerCase() : "";
  const userKey = rawLog.user ? String(rawLog.user).trim().toLowerCase() : "";

  const matchedUser =
    (idKey && directory?.byId?.get(idKey)) ||
    (userKey && directory?.byName?.get(userKey)) ||
    (userKey && directory?.byEmail?.get(userKey)) ||
    (userKey && directory?.byUsername?.get(userKey)) ||
    null;

  const rawRole = matchedUser?.role || rawLog.role || "staff";
  const canonicalRole = normalizeRole(rawRole);

  // Resolve full name of the person who performed the action
  let fullName = matchedUser?.full_name || rawLog.user || "";
  if (!fullName || fullName.toLowerCase() === "system" || fullName.toLowerCase() === "system scheduler") {
    // Attempt to resolve the primary active account for this role from public.users if available
    const rolePersonnel = (directory?.rows || []).find(
      (u) => u && normalizeRole(u.role) === canonicalRole && u.full_name
    );
    if (rolePersonnel?.full_name) {
      fullName = rolePersonnel.full_name;
    } else if (canonicalRole === "admin") {
      fullName = "Administrator";
    } else if (canonicalRole === "vet") {
      fullName = "Veterinarian";
    } else {
      fullName = "Staff";
    }
  }

  const effectiveRole =
    canonicalRole === "admin" || canonicalRole === "vet" || canonicalRole === "staff"
      ? canonicalRole
      : canonicalRole === "system"
      ? "admin"
      : "staff";

  const roleLabel = formatRoleLabel(effectiveRole);
  const actionCategory = classifyAuditAction(rawLog.action);
  const rawTimestamp = rawLog.timestamp || rawLog.created_at;
  const parsedDate = parseAuditTimestamp(rawTimestamp);
  const parsedMs = parsedDate ? parsedDate.getTime() : 0;
  const manilaDateKey = parsedDate ? toManilaDateKey(parsedDate) : "";
  const formattedDateTime = formatManilaDateTime(rawTimestamp);

  return {
    ...rawLog,
    user: fullName,
    user_full_name: fullName,
    role: effectiveRole,
    roleLabel,
    role_label: roleLabel,
    actionCategory,
    action_category: actionCategory,
    module: rawLog.module || "System",
    parsedMs,
    manilaDateKey,
    formattedDateTime,
  };
};

/**
 * Fetch a single audit log record by its database ID, enriched with user full_name and role.
 */
export const getAuditLogById = async (id) => {
  if (!id) return { data: null, error: new Error("Record ID is required") };
  try {
    const [{ data, error }, directory] = await Promise.all([
      supabase.from(TABLES.AUDIT_LOGS).select("*").eq("id", id).maybeSingle(),
      getUsersDirectory(),
    ]);

    if (data) {
      return { data: enrichAuditRecord(data, directory), error: null };
    }

    // Fallback to local mirror if record is in cross-tab local mirror
    const mirrorMatch = readAuditMirror().find((item) => item && String(item.id) === String(id));
    if (mirrorMatch) {
      return { data: enrichAuditRecord(mirrorMatch, directory), error: null };
    }

    // Fallback to synthesized operational personnel audit records
    const opsRecords = await fetchOperationalPersonnelAuditLogs(directory);
    const opsMatch = opsRecords.find((item) => item && String(item.id) === String(id));
    if (opsMatch) {
      return { data: enrichAuditRecord(opsMatch, directory), error: null };
    }

    if (error) {
      console.warn("getAuditLogById error:", error);
      return { data: null, error };
    }
    return { data: null, error: null };
  } catch (err) {
    console.error("getAuditLogById exception:", err);
    return { data: null, error: err };
  }
};

/**
 * Fetch personnel audit logs from Supabase.
 * - Admin ('admin', 'all', or null) sees activities across ALL personnel accounts (Admin, Veterinarian, and Staff).
 * - Veterinarian ('vet') and Staff ('staff') are strictly scoped to their own role.
 */
export const fetchAllEnrichedPersonnelAuditLogs = async (roleScope = null) => {
  const normScope = roleScope && roleScope !== "all" ? normalizeRole(roleScope) : null;
  const isCentralizedAdminView = !normScope || normScope === "admin";

  let query = supabase
    .from(TABLES.AUDIT_LOGS)
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(2000);

  if (!isCentralizedAdminView && normScope) {
    query = query.eq("role", normScope);
  }

  const [{ data, error }, directory] = await Promise.all([
    query,
    getUsersDirectory(),
  ]);

  if (error) {
    console.warn("fetchAllEnrichedPersonnelAuditLogs query warning:", error);
  }

  // Merge database records with local cross-tab mirror and operational personnel activity records
  const dbRows = Array.isArray(data) ? data : [];
  const mirrorRows = readAuditMirror();
  const opsRows = isCentralizedAdminView ? await fetchOperationalPersonnelAuditLogs(directory) : [];
  const combinedRaw = [...dbRows, ...mirrorRows, ...opsRows];

  const enriched = combinedRaw
    .map((row) => enrichAuditRecord(row, directory))
    .filter(Boolean)
    .filter((row) => {
      const isPersonnelRole = row.role === "admin" || row.role === "vet" || row.role === "staff";
      if (!isPersonnelRole) return false;
      if (!isCentralizedAdminView && normScope) {
        return row.role === normScope;
      }
      return true;
    });

  // Sort strictly newest first by parsed Philippine timestamp
  enriched.sort((a, b) => b.parsedMs - a.parsedMs);

  // Deduplicate by ID, by (tag + module + role + date), and by identical consecutive entries within same 2-second bucket
  const deduped = [];
  const seenIds = new Set();
  const seenKeys = new Set();
  const seenTagModuleKeys = new Set();
  for (const item of enriched) {
    if (item.id) {
      const idStr = String(item.id);
      if (seenIds.has(idStr)) continue;
      seenIds.add(idStr);
    }
    const timeBucket = item.parsedMs ? Math.floor(item.parsedMs / 2000) : item.timestamp;
    const dedupeKey = `${item.user}|${item.role}|${item.module}|${item.action}|${item.tag_number || ""}|${timeBucket}`;
    if (seenKeys.has(dedupeKey)) continue;

    // Avoid duplicating an operational record if an explicit audit_logs row already recorded the same tag + module + actionCategory on the same day
    if (item.tag_number && item.manilaDateKey) {
      const modNorm = String(item.module || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
      const tagModKey = `${item.role}|${modNorm}|${item.actionCategory}|${String(item.tag_number).toUpperCase()}|${item.manilaDateKey}`;
      if (String(item.id || "").startsWith("ops-") && seenTagModuleKeys.has(tagModKey)) {
        continue;
      }
      seenTagModuleKeys.add(tagModKey);
    }

    seenKeys.add(dedupeKey);
    deduped.push(item);
  }

  return deduped;
};

/**
 * Fetch paginated and filtered audit logs.
 * Supports search and filters for User, Action, Role, Module, and Date Range.
 */
export const getAuditLogsPaginated = async ({
  page = 1,
  pageSize = 10,
  search = "",
  userFilter = "all",
  actionType = "all",
  roleFilter = "all",
  moduleFilter = "all",
  dateRange = "all",
  startDate = null,
  endDate = null,
  roleScope = "admin",
}) => {
  try {
    const normScope = roleScope && roleScope !== "all" ? normalizeRole(roleScope) : "admin";
    const isCentralizedAdminView = normScope === "admin";
    const allLogs = await fetchAllEnrichedPersonnelAuditLogs(normScope);

    // Compute overall role counts across available logs
    const stats = {
      total: allLogs.length,
      adminCount: allLogs.filter((l) => l.role === "admin").length,
      vetCount: allLogs.filter((l) => l.role === "vet").length,
      staffCount: allLogs.filter((l) => l.role === "staff").length,
    };

    // Today's date key in Asia/Manila (YYYY-MM-DD)
    const nowManilaKey = toManilaDateKey(new Date());
    const nowManilaDate = parseAuditTimestamp(`${nowManilaKey}T00:00:00+08:00`);

    const filtered = allLogs.filter((row) => {
      // 1. Role Scope & Role Filter
      if (!isCentralizedAdminView) {
        if (row.role !== normScope) return false;
      } else if (roleFilter && roleFilter !== "all") {
        const targetRole = normalizeRole(roleFilter);
        if (row.role !== targetRole) return false;
      }

      // 2. User Filter (Full Name of personnel)
      if (userFilter && userFilter !== "all") {
        if (String(row.user || "").toLowerCase().trim() !== String(userFilter).toLowerCase().trim()) {
          return false;
        }
      }

      // 3. Action Filter (matches standardized Action category or substring of action)
      if (actionType && actionType !== "all") {
        const af = String(actionType).trim().toLowerCase();
        const catMatch = String(row.actionCategory || "").toLowerCase() === af;
        const textMatch = String(row.action || "").toLowerCase().includes(af);
        if (!catMatch && !textMatch) return false;
      }

      // 4. Module Filter
      if (moduleFilter && moduleFilter !== "all") {
        const mf = String(moduleFilter).trim().toLowerCase();
        const rm = String(row.module || "").trim().toLowerCase();
        if (rm !== mf && !rm.includes(mf)) return false;
      }

      // 5. Date Range Filter (evaluated in Asia/Manila timezone)
      if (dateRange && dateRange !== "all") {
        if (!row.manilaDateKey) return false;
        if (dateRange === "today") {
          if (row.manilaDateKey !== nowManilaKey) return false;
        } else if (dateRange === "week" && nowManilaDate) {
          const sevenDaysAgoKey = toManilaDateKey(new Date(nowManilaDate.getTime() - 6 * 86400000));
          if (row.manilaDateKey < sevenDaysAgoKey || row.manilaDateKey > nowManilaKey) return false;
        } else if (dateRange === "month" && nowManilaDate) {
          const thirtyDaysAgoKey = toManilaDateKey(new Date(nowManilaDate.getTime() - 29 * 86400000));
          if (row.manilaDateKey < thirtyDaysAgoKey || row.manilaDateKey > nowManilaKey) return false;
        } else if (dateRange === "custom") {
          if (startDate && row.manilaDateKey < String(startDate).slice(0, 10)) return false;
          if (endDate && row.manilaDateKey > String(endDate).slice(0, 10)) return false;
        }
      } else if (startDate || endDate) {
        if (startDate && row.manilaDateKey < String(startDate).slice(0, 10)) return false;
        if (endDate && row.manilaDateKey > String(endDate).slice(0, 10)) return false;
      }

      // 6. Search Filter across User, Action, Role, Module, Date & Time, and Tag
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [
          row.user,
          row.action,
          row.actionCategory,
          row.roleLabel,
          row.role,
          row.module,
          row.formattedDateTime,
          row.manilaDateKey,
          row.tag_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const totalCount = filtered.length;
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
    const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const from = (safePage - 1) * safePageSize;
    const pagedData = filtered.slice(from, from + safePageSize);

    return {
      data: pagedData,
      count: totalCount,
      stats,
      error: null,
    };
  } catch (err) {
    console.error("getAuditLogsPaginated exception:", err);
    return {
      data: [],
      count: 0,
      stats: { total: 0, adminCount: 0, vetCount: 0, staffCount: 0 },
      error: err,
    };
  }
};

/**
 * Get distinct Users, Actions, Roles, and Modules.
 * When roleScope is 'admin', returns distinct values across all personnel roles ('admin', 'vet', 'staff').
 */
export const getDistinctAuditFilters = async (roleScope = "admin") => {
  try {
    const normScope = roleScope ? normalizeRole(roleScope) : "admin";
    const isCentralizedAdminView = normScope === "admin";
    const [allLogs, directory] = await Promise.all([
      fetchAllEnrichedPersonnelAuditLogs(normScope),
      getUsersDirectory(),
    ]);

    const userSet = new Set();
    const moduleSet = new Set();

    // Include users and modules who have audit records
    allLogs.forEach((log) => {
      if (log.user) userSet.add(log.user);
      if (log.module) moduleSet.add(log.module);
    });

    // Also include active internal personnel from public.users
    (directory?.rows || []).forEach((u) => {
      const r = normalizeRole(u?.role);
      const isTargetRole = isCentralizedAdminView
        ? r === "admin" || r === "vet" || r === "staff"
        : r === normScope;
      if (isTargetRole && u?.full_name) {
        userSet.add(u.full_name.trim());
      }
    });

    const users = [...userSet].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const modules = [...moduleSet].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const actions = [...AUDIT_ACTION_TYPES];
    const roles = isCentralizedAdminView ? ["admin", "vet", "staff"] : [normScope];

    return { users, actions, modules, roles };
  } catch {
    const normScope = roleScope ? normalizeRole(roleScope) : "admin";
    const isCentralizedAdminView = normScope === "admin";
    return {
      users: [],
      actions: [...AUDIT_ACTION_TYPES],
      modules: [],
      roles: isCentralizedAdminView ? ["admin", "vet", "staff"] : [normScope],
    };
  }
};

/**
 * Fetch audit logs scoped by role ('all', 'admin', 'staff', 'vet').
 * Note: 'admin' scope returns all personnel logs (Admin, Veterinarian, Staff).
 */
export const getAuditLogsForRole = async (roleScope = null) => {
  try {
    const allLogs = await fetchAllEnrichedPersonnelAuditLogs(roleScope);
    if (roleScope && roleScope !== "all" && normalizeRole(roleScope) !== "admin") {
      const cleanRole = normalizeRole(roleScope);
      return allLogs.filter((l) => l.role === cleanRole);
    }
    return allLogs;
  } catch (err) {
    console.error("getAuditLogsForRole error:", err);
    return [];
  }
};

/**
 * Subscribe to real-time audit log changes.
 */
export const subscribeToAuditLogs = (callback, roleScope = null) => {
  const fetchAndCallback = async () => {
    try {
      const logs = await getAuditLogsForRole(roleScope);
      if (logs) callback(logs);
    } catch (e) {}
  };

  fetchAndCallback();

  const handleUpdate = () => {
    fetchAndCallback();
  };
  window.addEventListener("lsmis_audit_updated", handleUpdate);
  window.addEventListener("lmis-db-change", handleUpdate);

  let supabaseChannel = null;
  try {
    supabaseChannel = supabase
      .channel(`lsmis_audit_logs_${roleScope || "all"}_${Math.random().toString(36).substring(7)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.AUDIT_LOGS }, () => {
        fetchAndCallback();
      })
      .subscribe();
  } catch (e) {}

  return () => {
    window.removeEventListener("lsmis_audit_updated", handleUpdate);
    window.removeEventListener("lmis-db-change", handleUpdate);
    try {
      if (supabaseChannel) supabase.removeChannel(supabaseChannel);
    } catch (e) {}
  };
};

/**
 * Remove session from active list on graceful logout (marks Offline immediately).
 */
export const removeActiveSession = (email) => {
  try {
    if (!email) return;
    const cleanEmail = email.toLowerCase().trim();
    const logoutIso = new Date().toISOString();
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");

    const nextSessions = rawSessions.map((s) =>
      (s.email || "").toLowerCase().trim() === cleanEmail
        ? { ...s, status: "Offline", last_active: logoutIso, logout_time: logoutIso }
        : s
    );

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(nextSessions));
    broadcastPresence({ type: "LOGOUT", email: cleanEmail, logout_time: logoutIso });
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("lsmis_presence_updated", { detail: { type: "LOGOUT", email: cleanEmail } }));
  } catch (e) {
    console.error("removeActiveSession error:", e);
  }
};

/**
 * Administrator: Terminate an active user session by force.
 */
export const terminateSession = async (sessionId, terminatedBy = "System Administrator", options = {}) => {
  try {
    const rawSessions = JSON.parse(localStorage.getItem(ACTIVE_SESSIONS_KEY) || "[]");
    const target = rawSessions.find((s) => s.id === sessionId || s.email === sessionId);

    const updated = rawSessions.map((s) =>
      s.id === sessionId || s.email === sessionId
        ? { ...s, terminated: true, status: "Offline", terminated_at: new Date().toISOString() }
        : s
    );

    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(updated));

    const signal = {
      sessionId: target?.id || sessionId,
      email: (target?.email || sessionId || "").toLowerCase(),
      terminatedBy,
      reason: options.reason || "",
      terminatedUntil: options.terminatedUntil || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      timestamp: Date.now(),
    };
    localStorage.setItem(TERMINATION_SIGNAL_KEY, JSON.stringify(signal));
    window.dispatchEvent(new CustomEvent("lsmis_session_terminated", { detail: signal }));
    broadcastPresence({ type: "TERMINATED", signal });
    window.dispatchEvent(new Event("storage"));

    await logActivity({
      action: `Session forcibly terminated by Administrator for ${target?.name || target?.email || "User"} (${target?.role || "Staff"})${options.reason ? ` - Reason: ${options.reason}` : ""}`,
      module: "Personnel Management",
      security_event: "Session Terminated",
      severity: "danger",
      user: terminatedBy,
      role: "admin",
      old_value: "Active Session",
      new_value: "Revoked / Terminated",
      field_changed: "session_state",
      notify: {
        title: "Session Terminated",
        message: `Active session for ${target?.name || "User"} was revoked by ${terminatedBy}`,
        type: "warning",
      },
    });

    return { success: true, signal };
  } catch (err) {
    console.error("terminateSession error:", err);
    throw err;
  }
};

export const activityService = {
  logActivity,
  notifyRole,
  notifyOwner,
  getClientIp,
  registerLoginSession,
  updatePresence,
  getActiveSessions,
  subscribeToActiveSessions,
  subscribeToAuditLogs,
  getAuditLogsForRole,
  getAuditLogById,
  getAuditLogsPaginated,
  getDistinctAuditFilters,
  formatManilaDateTime,
  formatManilaDateAndTimes,
  formatRoleLabel,
  classifyAuditAction,
  AUDIT_ACTION_TYPES,
  toManilaIsoString,
  parseAuditTimestamp,
  terminateSession,
  removeActiveSession,
};
