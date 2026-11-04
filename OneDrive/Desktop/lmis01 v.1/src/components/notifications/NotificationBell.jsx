import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../icons";
import { useSupabase } from "../../hooks/useSupabase";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate } from "../../utils/formatters";

// Category styling and iconography
const BELL_TYPE_META = {
  marking:     { icon: <Icon.Tag size={15} />, color: "#f59e0b", label: "Marking" },
  vetapproval: { icon: <Icon.Check size={15} />, color: "#10b981", label: "Vet OK" },
  inspection:  { icon: <Icon.Stethoscope size={15} />, color: "#8b5cf6", label: "Inspect" },
  slaughter:   { icon: <Icon.Activity size={15} />, color: "#ef4444", label: "Slaughter" },
  schedule:    { icon: <Icon.Calendar size={15} />, color: "#6366f1", label: "Schedule" },
  weighing:    { icon: <Icon.Scale size={15} />, color: "#0ea5e9", label: "Weighing" },
  payment:     { icon: <Icon.Cash size={15} />, color: "#10b981", label: "Payment" },
  permit:      { icon: <Icon.FileText size={15} />, color: "#0284c7", label: "Permit" },
  dispatch:    { icon: <Icon.Truck size={15} />, color: "#f59e0b", label: "Dispatch" },
  account:     { icon: <Icon.User size={15} />, color: "#10b981", label: "Account" },
  warning:     { icon: <Icon.AlertTriangle size={15} />, color: "#ef4444", label: "Alert" },
  system:      { icon: <Icon.Bell size={15} />, color: "#64748b", label: "System" },
};

/**
 * Format timestamp into friendly relative or calendar string
 */
function timeAgo(dateVal) {
  if (!dateVal) return "";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 45) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return "Yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch (_) {
    return "";
  }
}

/**
 * Robust role-based destination resolver that links directly to the specific
 * module and record based on notification type and extracted entity IDs.
 */
export function resolveNotificationDestination(item, userRole) {
  const role = String(userRole || "").toLowerCase().trim();
  const title = String(item?.title || "").toLowerCase();
  const message = String(item?.message || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  const fullText = `${title} ${message} ${category} ${type}`;

  // 1. Extract Tag Number if present (e.g. TAG-001-HOG, TAG-123, or stored item tag)
  const tagMatch =
    (item?.tag_number ? [item.tag_number, item.tag_number] : null) ||
    fullText.match(/\b(TAG-[A-Z0-9]+(?:-[A-Z0-9]+)?)\b/i);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : (item?.tag_number || "");

  // 2. Extract Owner ID or Owner Name
  const ownerIdMatch = fullText.match(/\b(OWN-[A-Z0-9]+(?:-[A-Z0-9]+)?)\b/i);
  const ownerId = item?.owner_id || (ownerIdMatch ? ownerIdMatch[1].toUpperCase() : "");

  const ownerNameMatch = `${item?.title || ""} ${item?.message || ""}`.match(/Owner:\s*([^),.\n]+)/i);
  const ownerName = ownerNameMatch ? ownerNameMatch[1].trim() : (item?.owner_name || "");

  const searchTarget = tag || ownerName || ownerId || "";

  const isAdmin = role === "admin";
  const isVet = role === "vet" || role === "veterinarian";
  const isStaff = role === "staff";
  const isOwner = role === "owner";

  // Scenario 1: Animal Marking timeout / returned to marking
  if (
    category === "marking" ||
    type === "marking_timeout" ||
    type === "marking" ||
    fullText.includes("returned to animal marking") ||
    fullText.includes("returned to marking") ||
    fullText.includes("marking timeout") ||
    (fullText.includes("marking") && fullText.includes("timeout"))
  ) {
    if (isAdmin) return `/admin/livestock${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/ante-mortem?tab=queue${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/owners?tab=marking${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 2: Slaughter assignment / Team Operator reassignment
  if (
    fullText.includes("operator reassignment") ||
    fullText.includes("assign team operator") ||
    fullText.includes("operator assigned") ||
    fullText.includes("team operator")
  ) {
    if (isAdmin) return `/admin/slaughter/records${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/ante-mortem?tab=queue${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/slaughter-processing?tab=awaiting${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 3: Ready for Slaughter / Slaughter Line Alert
  if (
    fullText.includes("ready for slaughter") ||
    fullText.includes("slaughter line alert")
  ) {
    if (isAdmin) return `/admin/slaughter/records${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/ante-mortem?tab=queue${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/slaughter-processing?tab=active${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 4: Ante-Mortem approval / inspection
  if (
    fullText.includes("ante-mortem") ||
    fullText.includes("antemortem") ||
    (category === "vetapproval" && fullText.includes("ante"))
  ) {
    if (isAdmin) return `/admin/inspection/antemortem${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/ante-mortem?tab=inspected${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/slaughter-processing?tab=awaiting${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 5: Meat Condemned (Ante or Post)
  if (
    fullText.includes("condemned") ||
    fullText.includes("meat condemned") ||
    category === "inspection"
  ) {
    if (isAdmin) return `/admin/inspection/condemnation${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/ante-mortem/condemned${tag ? `&search=${encodeURIComponent(tag)}` : ""}`;
    if (isStaff) return `/staff/inspection/result${tag ? `&search=${encodeURIComponent(tag)}` : ""}`;
    return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 6: Post-Mortem approval / inspection
  if (
    fullText.includes("post-mortem") ||
    fullText.includes("postmortem") ||
    (category === "vetapproval" && fullText.includes("post"))
  ) {
    if (isAdmin) return `/admin/inspection/postmortem${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/post-mortem?tab=inspected${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/permits?tab=pending${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 7: Carcass Weighing & Branding
  if (
    fullText.includes("carcass weighed") ||
    fullText.includes("weighed & branded") ||
    fullText.includes("carcass weighing") ||
    category === "weighing"
  ) {
    if (isAdmin) return `/admin/slaughter/records${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/carcass-weighing${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/permits?tab=pending${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 8: Meat Permit issuance / payment received / dispatch
  if (
    fullText.includes("meat permit") ||
    fullText.includes("permit issued") ||
    fullText.includes("payment received") ||
    fullText.includes("ready for dispatch") ||
    fullText.includes("dispatched") ||
    category === "permit" ||
    category === "payment" ||
    category === "dispatch"
  ) {
    if (isAdmin) return `/admin/permits${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/approval${tag ? `&search=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/permits?tab=issued${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 9: Slaughter schedule or slaughter processing completed
  if (
    category === "schedule" ||
    fullText.includes("slaughter group completed") ||
    fullText.includes("slaughter processing") ||
    fullText.includes("slaughter records")
  ) {
    if (isAdmin) return `/admin/slaughter/records${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isVet) return `/vet/livestock/history${tag ? `&search=${encodeURIComponent(tag)}` : ""}`;
    if (isOwner) return `/owner/animals${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
    return `/staff/slaughter-processing?tab=completed${tag ? `&search=${encodeURIComponent(tag)}&tag=${encodeURIComponent(tag)}` : ""}`;
  }

  // Scenario 10: Owner registration or Account approval / rejection
  if (
    type === "account_approval" ||
    fullText.includes("account approved") ||
    fullText.includes("account rejected") ||
    fullText.includes("owner registered") ||
    fullText.includes("new livestock registered") ||
    fullText.includes("user management")
  ) {
    if (isAdmin) return `/admin/owners${searchTarget ? `?search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isStaff) return `/staff/owners?tab=owners${searchTarget ? `&search=${encodeURIComponent(searchTarget)}` : ""}`;
    if (isOwner) return `/owner/animals`;
    return `/vet/dashboard`;
  }

  // Scenario 11: System announcements or Security warning
  if (
    category === "system" ||
    type === "danger" ||
    type === "security" ||
    fullText.includes("security") ||
    fullText.includes("system") ||
    fullText.includes("announcement")
  ) {
    if (isAdmin) return `/admin/settings`;
    if (isVet) return `/vet/settings`;
    if (isStaff) return `/staff/settings`;
    return `/owner/profile`;
  }

  // Fallback safe routes per role:
  if (isAdmin) return `/admin/dashboard`;
  if (isVet) return `/vet/ante-mortem`;
  if (isStaff) return `/staff/slaughter-processing`;
  if (isOwner) return `/owner/animals`;
  return `/`;
}

/**
 * Determine category key for meta lookups
 */
function resolveCategory(n) {
  if (!n) return "system";
  const title = String(n.title || "").toLowerCase();
  const message = String(n.message || "").toLowerCase();
  const type = String(n.type || "").toLowerCase();
  const text = `${title} ${message} ${type}`;

  if (text.includes("marking") || text.includes("timeout")) return "marking";
  if (text.includes("vet approved") || text.includes("ante-mortem batch") || text.includes("post-mortem batch")) return "vetapproval";
  if (text.includes("condemned") || text.includes("inspection")) return "inspection";
  if (text.includes("weighed") || text.includes("weighing") || text.includes("branding")) return "weighing";
  if (text.includes("slaughter") || text.includes("operator")) return "slaughter";
  if (text.includes("permit") || text.includes("dispatch")) return "permit";
  if (text.includes("payment")) return "payment";
  if (text.includes("account") || text.includes("registered")) return "account";
  if (type === "warning" || type === "danger" || text.includes("⚠️")) return "warning";
  return n.category || "system";
}

/**
 * Build combined list of bell items from live data and stored Supabase notifications
 * STRICTLY scoped to the authenticated user's role.
 */
function buildBellItems(ante, post, schedules, storedNotifs, livestock, role, ownerId) {
  const items = [];
  const cleanRole = String(role || "").toLowerCase().trim();
  const isAdmin = cleanRole === "admin" || cleanRole === "administrator";
  const isVet = cleanRole === "vet" || cleanRole === "veterinarian";
  const isStaff = cleanRole === "staff" || cleanRole === "operator";
  const isOwner = cleanRole === "owner";

  // 1. Process Supabase stored notifications first (Strictly role-scoped)
  (storedNotifs || []).forEach((n) => {
    const notifRole = String(n.role || "").toLowerCase().trim();

    if (isOwner) {
      if (!n.owner_id || String(n.owner_id).trim() !== String(ownerId || "").trim()) {
        return;
      }
    } else if (isAdmin) {
      if (notifRole && notifRole !== "admin" && notifRole !== "administrator") return;
      if (!notifRole && n.owner_id) return;
    } else if (isVet) {
      if (notifRole !== "vet" && notifRole !== "veterinarian") return;
    } else if (isStaff) {
      if (notifRole !== "staff" && notifRole !== "operator") return;
    }

    const cat = resolveCategory(n);
    const tagMatch = (n.title + " " + n.message).match(/\bTAG-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/i);

    items.push({
      id: `stored-${n.id}`,
      dbId: n.id,
      isStored: true,
      category: cat,
      title: n.title || "Notification",
      message: n.message || "",
      date: n.date || n.created_at || new Date().toISOString(),
      read: Boolean(n.read),
      urgent: Boolean(n.urgent) || String(n.type).toLowerCase() === "warning" || (n.title || "").includes("⚠️"),
      tag_number: tagMatch ? tagMatch[0].toUpperCase() : undefined,
      owner_id: n.owner_id,
      role: notifRole,
      type: n.type,
      raw: n,
    });
  });

  // 2. Role-specific live operational activities:
  if (isStaff) {
    // STAFF ONLY:
    // a) Livestock received awaiting animal marking
    (livestock || [])
      .filter((l) => {
        const s = String(l.status || "").toLowerCase();
        return !l.marked && (s === "pending" || s === "received" || s === "pending marking");
      })
      .slice(0, 3)
      .forEach((l) => {
        items.push({
          id: `staff-marking-pending-${l.id || l.tag_number}`,
          tag_number: l.tag_number,
          category: "marking",
          title: `🏷️ Intake Awaiting Marking: ${l.tag_number}`,
          message: `${l.tag_number} (${l.species}) received from ${l.owner_name || "Owner"} — ready for animal marking`,
          urgent: false,
          date: l.received_date || l.registered_at || l.created_at || new Date().toISOString(),
          read: false,
        });
      });

    // b) 24h Marking Fallback Timeouts
    (livestock || [])
      .filter((l) => {
        const s = String(l.status || "").toLowerCase();
        return s === "returned to animal marking" || s === "returned to marking" || Boolean(l.fallback_at);
      })
      .slice(0, 3)
      .forEach((l) => {
        const id = `marking-timeout-${l.id || l.tag_number}`;
        const alreadyInList = items.some(
          (it) => it.tag_number && l.tag_number && it.tag_number.toUpperCase() === l.tag_number.toUpperCase() && it.category === "marking"
        );
        if (!alreadyInList) {
          items.push({
            id,
            tag_number: l.tag_number,
            category: "marking",
            title: `⚠️ 24h Timeout: ${l.tag_number || "Animal"}`,
            message: `${l.tag_number} returned to Animal Marking (slaughter limit expired)`,
            urgent: true,
            date: l.fallback_at || l.updated_at || l.created_at || new Date().toISOString(),
            read: false,
          });
        }
      });

    // c) Live slaughter schedules for today / upcoming
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in3 = new Date(today); in3.setDate(today.getDate() + 3);
    (schedules || [])
      .filter((s) => {
        const schedRaw = s.slaughter_date || s.scheduled_date || s.date;
        if (!schedRaw) return false;
        const d = new Date(schedRaw);
        if (isNaN(d.getTime())) return false;
        const schedMidnight = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        schedMidnight.setHours(0, 0, 0, 0);
        return schedMidnight >= today && schedMidnight <= in3;
      })
      .slice(0, 3)
      .forEach((s) => {
        const schedDate = s.slaughter_date || s.scheduled_date || s.date;
        const d = new Date(schedDate);
        const schedMidnight = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        schedMidnight.setHours(0, 0, 0, 0);
        const diff = Math.round((schedMidnight - today) / 86400000);
        const urgency = diff === 0 ? "TODAY" : diff === 1 ? "Tomorrow" : `In ${diff} days`;
        items.push({
          id: `sched-${s.id}`,
          category: "schedule",
          title: `📅 Slaughter Schedule — ${urgency}`,
          message: `${s.tag_number || "Batch"} (${s.species || "Livestock"}) on ${formatDate(schedDate)}`,
          date: schedDate,
          tag_number: s.tag_number,
          urgent: diff === 0,
          read: false,
        });
      });
  }

  if (isVet) {
    // VETERINARIAN ONLY:
    // a) Marked animals awaiting ante-mortem inspection
    (livestock || [])
      .filter((l) => {
        const s = String(l.status || "").toLowerCase();
        const isMarked = l.marked === true || s === "marked" || Boolean(l.mark_type);
        const isPendingInspection = s === "marked" || s === "awaiting inspection" || s === "for inspection";
        return isMarked && isPendingInspection;
      })
      .slice(0, 3)
      .forEach((l) => {
        items.push({
          id: `vet-ante-queue-${l.id || l.tag_number}`,
          category: "inspection",
          title: "🩺 Pending Ante-Mortem Inspection",
          message: `${l.tag_number} (${l.species}) marked and awaiting ante-mortem clearance`,
          tag_number: l.tag_number,
          date: l.mark_date || l.updated_at || l.created_at || new Date().toISOString(),
          read: false,
        });
      });

    // b) Ante-mortem approvals
    (ante || [])
      .filter((a) => a.decision === "Approved" || a.result === "Passed" || a.status === "Approved")
      .slice(0, 3)
      .forEach((a) => {
        const id = `vetante-${a.id}`;
        if (!items.some((it) => it.id === id)) {
          items.push({
            id,
            category: "vetapproval",
            title: "✅ Ante-Mortem Approved",
            message: `${a.tag_number || "Livestock"} passed ante-mortem inspection`,
            tag_number: a.tag_number,
            date: a.date || a.created_at || new Date().toISOString(),
            read: false,
          });
        }
      });

    // c) Post-mortem approvals & condemnations
    (post || [])
      .filter((p) => p.decision === "Approved")
      .slice(0, 3)
      .forEach((p) => {
        const id = `vetpost-${p.id}`;
        if (!items.some((it) => it.id === id)) {
          items.push({
            id,
            category: "vetapproval",
            title: "✅ Post-Mortem Approved",
            message: `${p.tag_number || "Carcass"} approved for release`,
            tag_number: p.tag_number,
            date: p.date || p.created_at || new Date().toISOString(),
            read: false,
          });
        }
      });

    (post || [])
      .filter((p) => p.decision && p.decision !== "Approved")
      .slice(0, 2)
      .forEach((p) => {
        const id = `post-condemn-${p.id}`;
        if (!items.some((it) => it.id === id)) {
          items.push({
            id,
            category: "inspection",
            title: "⚠️ Meat Condemned",
            message: `${p.tag_number || "Carcass"} — condemnation recorded`,
            tag_number: p.tag_number,
            urgent: true,
            date: p.date || p.created_at || new Date().toISOString(),
            read: false,
          });
        }
      });
  }

  // Deduplicate items by ID
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    if (!seen.has(it.id)) {
      seen.add(it.id);
      deduped.push(it);
    }
  }

  // Sort: newest first
  return deduped.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
}

export const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all"); // "all" | "unread"
  const ref = useRef(null);
  const navigate = useNavigate();
  const { role, ownerId } = useAuth();

  const { data: storedNotifs, refresh: refreshStored } = useSupabase(TABLES.NOTIFICATIONS);
  const { data: ante } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post } = useSupabase(TABLES.POST_MORTEM);
  const { data: schedules } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: livestock } = useSupabase(TABLES.LIVESTOCK);

  const cleanRole = useMemo(() => String(role || "").toLowerCase().trim(), [role]);
  const storageKey = useMemo(() => `lmis_read_notifs_${cleanRole || "guest"}`, [cleanRole]);

  // Read state stored locally per role
  const [readIds, setReadIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`lmis_read_notifs_${cleanRole || "guest"}`) || localStorage.getItem("lmis_read_notifs");
      return new Set(saved ? JSON.parse(saved) : []);
    } catch {
      return new Set();
    }
  });

  // Re-read when role changes or window event fires
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setReadIds(new Set(saved ? JSON.parse(saved) : []));
    } catch {}
  }, [storageKey]);

  // Sync with window events
  useEffect(() => {
    const handleUpdate = () => {
      try {
        const saved = localStorage.getItem(storageKey);
        setReadIds(new Set(saved ? JSON.parse(saved) : []));
      } catch {}
    };
    window.addEventListener("lmis-notif-read", handleUpdate);
    return () => window.removeEventListener("lmis-notif-read", handleUpdate);
  }, [storageKey]);

  // Close dropdown on outside click
  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Build bell items list
  const bellItems = useMemo(
    () => buildBellItems(ante, post, schedules, storedNotifs, livestock, role, ownerId),
    [ante, post, schedules, storedNotifs, livestock, role, ownerId]
  );

  // Check if an item is read
  const isItemRead = useCallback(
    (item) => {
      if (item.read) return true;
      if (readIds.has(item.id)) return true;
      if (item.dbId && readIds.has(`stored-${item.dbId}`)) return true;
      return false;
    },
    [readIds]
  );

  // Filtered lists
  const unreadCount = useMemo(() => {
    return bellItems.filter((it) => !isItemRead(it)).length;
  }, [bellItems, isItemRead]);

  const displayedItems = useMemo(() => {
    if (filter === "unread") {
      return bellItems.filter((it) => !isItemRead(it));
    }
    return bellItems;
  }, [bellItems, filter, isItemRead]);

  // Click Handler: Mark clicked notification as read and navigate directly to its specific record
  const handleItemClick = async (item) => {
    // 1. Mark as read immediately in local state
    const next = new Set([...readIds, item.id]);
    if (item.dbId) next.add(`stored-${item.dbId}`);
    setReadIds(next);

    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      window.dispatchEvent(new Event("lmis-notif-read"));
    } catch (_) {}

    // 2. Persist read status in Supabase if stored notification
    if (item.dbId) {
      try {
        await supabase.from(TABLES.NOTIFICATIONS).update({ read: true }).eq("id", item.dbId);
        refreshStored?.();
      } catch (err) {
        console.warn("Could not mark notification read in Supabase:", err);
      }
    }

    // 3. Close dropdown
    setOpen(false);

    // 4. Resolve exact module and record destination
    const destination = resolveNotificationDestination(item, role);
    if (destination) {
      navigate(destination);
    }
  };

  // Mark all notifications as read
  const markAllAsReadDropdown = async (e) => {
    e.stopPropagation();
    const allIds = bellItems.map((it) => it.id);
    bellItems.forEach((it) => {
      if (it.dbId) allIds.push(`stored-${it.dbId}`);
    });
    const next = new Set([...readIds, ...allIds]);
    setReadIds(next);

    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      window.dispatchEvent(new Event("lmis-notif-read"));
    } catch (_) {}

    // Persist to Supabase
    const unreadDbIds = bellItems.filter((it) => it.dbId && !it.read).map((it) => it.dbId);
    if (unreadDbIds.length > 0) {
      try {
        await supabase.from(TABLES.NOTIFICATIONS).update({ read: true }).in("id", unreadDbIds);
        refreshStored?.();
      } catch (err) {
        console.warn("Could not mark all notifications read in Supabase:", err);
      }
    }
  };

  // Resolve settings path based on role
  const settingsPath = useMemo(() => {
    const r = String(role || "").toLowerCase();
    if (r === "admin") return "/admin/settings";
    if (r === "vet" || r === "veterinarian") return "/vet/settings";
    if (r === "staff") return "/staff/settings";
    if (r === "owner") return "/owner/profile";
    return "/settings";
  }, [role]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Bell Button */}
      <button
        type="button"
        className="icon-btn-header"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: 9,
          border: "none",
          background: open ? "var(--color-bg, #f1f5f9)" : "transparent",
          color: "var(--color-text, #0f172a)",
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        <Icon.Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#ef4444",
              boxShadow: "0 0 0 2px var(--color-surface, #ffffff)",
            }}
          />
        )}
      </button>

      {/* Notifications Dropdown Panel */}
      {open && (
        <div
          className="dropdown notification-dropdown-menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            zIndex: 1000,
            width: 390,
            maxWidth: "calc(100vw - 24px)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0,0,0,0.06)",
            animation: "fadeIn 140ms ease-out",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 18px",
              background: "var(--color-surface, #ffffff)",
              borderBottom: "1px solid var(--color-border, #e2e8f0)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h4 style={{ fontSize: 14.5, fontWeight: 800, margin: 0, color: "var(--color-text, #0f172a)", letterSpacing: "-0.01em" }}>
                  Notifications
                </h4>
                {unreadCount > 0 ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      background: "#ef4444",
                      color: "#ffffff",
                      padding: "2px 7px",
                      borderRadius: 999,
                      lineHeight: 1.2,
                    }}
                  >
                    {unreadCount} new
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text-muted, #64748b)",
                      background: "var(--color-bg, #f1f5f9)",
                      padding: "2px 7px",
                      borderRadius: 999,
                    }}
                  >
                    All caught up
                  </span>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsReadDropdown}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: "var(--color-primary, #0284c7)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 6px",
                    borderRadius: 6,
                    transition: "opacity 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                  <Icon.Check size={13} /> Mark all read
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setFilter("all")}
                style={{
                  padding: "4px 10px",
                  fontSize: 11.5,
                  fontWeight: filter === "all" ? 700 : 600,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: filter === "all" ? "var(--color-primary, #0284c7)" : "var(--color-bg, #f1f5f9)",
                  color: filter === "all" ? "#ffffff" : "var(--color-text-muted, #64748b)",
                  transition: "all 0.15s ease",
                }}
              >
                All ({bellItems.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                style={{
                  padding: "4px 10px",
                  fontSize: 11.5,
                  fontWeight: filter === "unread" ? 700 : 600,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: filter === "unread" ? "var(--color-primary, #0284c7)" : "var(--color-bg, #f1f5f9)",
                  color: filter === "unread" ? "#ffffff" : "var(--color-text-muted, #64748b)",
                  transition: "all 0.15s ease",
                }}
              >
                Unread ({unreadCount})
              </button>
            </div>
          </div>

          {/* Scrollable Notification List */}
          <div style={{ maxHeight: 380, overflowY: "auto", background: "var(--color-surface, #ffffff)" }}>
            {displayedItems.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted, #64748b)" }}>
                <div
                  style={{
                    display: "inline-flex",
                    padding: 12,
                    borderRadius: "50%",
                    background: "var(--color-bg, #f1f5f9)",
                    marginBottom: 10,
                    color: "var(--color-text-muted, #94a3b8)",
                  }}
                >
                  <Icon.Bell size={24} />
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                  {filter === "unread" ? "No unread alerts" : "No notifications"}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-muted, #64748b)" }}>
                  {filter === "unread" ? "You have read all recent alerts." : "Activity and process updates will appear here."}
                </p>
              </div>
            ) : (
              displayedItems.map((n) => {
                const read = isItemRead(n);
                const meta = BELL_TYPE_META[n.category] || BELL_TYPE_META.system;
                const timeString = timeAgo(n.date);

                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleItemClick(n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleItemClick(n);
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "12px 18px",
                      borderBottom: "1px solid var(--color-border, #f1f5f9)",
                      borderLeft: !read ? `3px solid ${meta.color}` : "3px solid transparent",
                      background: !read ? `${meta.color}08` : "transparent",
                      cursor: "pointer",
                      transition: "background 140ms ease",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--color-bg, #f8fafc)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = !read ? `${meta.color}08` : "transparent";
                    }}
                  >
                    {/* Icon Pill */}
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        flexShrink: 0,
                        background: `${meta.color}18`,
                        color: meta.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      {meta.icon}
                    </div>

                    {/* Notification Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: !read ? 800 : 600,
                            color: !read ? "var(--color-text, #0f172a)" : "var(--color-text-muted, #475569)",
                            lineHeight: 1.3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {n.title}
                        </span>

                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: `${meta.color}18`,
                            color: meta.color,
                            flexShrink: 0,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>

                      {/* Message preview (2-line clamp) */}
                      <p
                        style={{
                          fontSize: 12,
                          color: !read ? "var(--color-text, #334155)" : "var(--color-text-muted, #64748b)",
                          lineHeight: 1.4,
                          margin: "2px 0 4px",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {n.message}
                      </p>

                      {/* Footer Row: Tag Badge + Timestamp */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                        {n.tag_number && (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 10.5,
                              fontWeight: 700,
                              background: "var(--color-bg, #f1f5f9)",
                              border: "1px solid var(--color-border, #e2e8f0)",
                              color: "var(--color-text, #0f172a)",
                              padding: "1px 5px",
                              borderRadius: 4,
                            }}
                          >
                            {n.tag_number}
                          </span>
                        )}

                        {timeString && (
                          <span style={{ fontSize: 11, color: "var(--color-text-muted, #94a3b8)" }}>
                            {timeString}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Unread Indicator Dot */}
                    {!read && (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: meta.color,
                          flexShrink: 0,
                          marginTop: 6,
                          boxShadow: `0 0 0 2px ${meta.color}25`,
                        }}
                        title="Unread"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--color-border, #e2e8f0)",
              textAlign: "center",
              background: "var(--color-bg, #f8fafc)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(settingsPath);
              }}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-primary, #0284c7)",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon.Settings size={13} /> Notification Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
