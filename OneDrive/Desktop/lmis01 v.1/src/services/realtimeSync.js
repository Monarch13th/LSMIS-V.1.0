import { supabase } from "./supabaseClient.js";
import { TABLES } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Table Relationship & Query Invalidation Mapping
// When a table changes, all related tables that depend on it are invalidated.
// ---------------------------------------------------------------------------
export const TABLE_RELATIONS = {
  [TABLES.LIVESTOCK]: [
    TABLES.LIVESTOCK,
    TABLES.ANTE_MORTEM,
    TABLES.SLAUGHTER_PROCESSING,
  ],
  [TABLES.ANTE_MORTEM]: [
    TABLES.ANTE_MORTEM,
    TABLES.LIVESTOCK,
    TABLES.CONDEMNATION_RECORDS,
  ],
  [TABLES.SLAUGHTER_PROCESSING]: [
    TABLES.SLAUGHTER_PROCESSING,
    TABLES.SLAUGHTER_RECORDS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.SLAUGHTER_RECORDS]: [
    TABLES.SLAUGHTER_RECORDS,
    TABLES.SLAUGHTER_PROCESSING,
    TABLES.LIVESTOCK,
  ],
  [TABLES.POST_MORTEM]: [
    TABLES.POST_MORTEM,
    TABLES.LIVESTOCK,
    TABLES.CONDEMNATION_RECORDS,
  ],
  [TABLES.CARCASS]: [
    TABLES.CARCASS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.PAYMENTS]: [
    TABLES.PAYMENTS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.FEES]: [
    TABLES.FEES,
  ],
  [TABLES.PERMITS]: [
    TABLES.PERMITS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.PERMIT_CONFIG]: [
    TABLES.PERMIT_CONFIG,
    TABLES.PERMITS,
  ],
  [TABLES.DISPATCH]: [
    TABLES.DISPATCH,
    TABLES.LIVESTOCK,
    TABLES.PERMITS,
  ],
  [TABLES.OWNERS]: [
    TABLES.OWNERS,
    TABLES.USERS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.CONDEMNATION_RECORDS]: [
    TABLES.CONDEMNATION_RECORDS,
    TABLES.EVIDENCE_RECORDS,
  ],
  [TABLES.EVIDENCE_RECORDS]: [
    TABLES.EVIDENCE_RECORDS,
    TABLES.CONDEMNATION_RECORDS,
  ],
  [TABLES.POST_MORTEM_CONDEMNED_CUTS]: [
    TABLES.POST_MORTEM_CONDEMNED_CUTS,
    TABLES.CONDEMNATION_RECORDS,
  ],
  [TABLES.ORGAN_INSPECTIONS]: [
    TABLES.ORGAN_INSPECTIONS,
  ],
  [TABLES.DISEASES]: [
    TABLES.DISEASES,
  ],
  [TABLES.DISPOSAL_RECORDS]: [
    TABLES.DISPOSAL_RECORDS,
    TABLES.CONDEMNATION_RECORDS,
  ],
  [TABLES.NOTIFICATIONS]: [
    TABLES.NOTIFICATIONS,
  ],
  [TABLES.USERS]: [
    TABLES.USERS,
    TABLES.OWNERS,
  ],
  [TABLES.SPECIES]: [
    TABLES.SPECIES,
    TABLES.LIVESTOCK,
  ],
  [TABLES.SETTINGS]: [
    TABLES.SETTINGS,
  ],
  [TABLES.BACKUPS]: [
    TABLES.BACKUPS,
  ],
  [TABLES.AUDIT_LOGS]: [
    TABLES.AUDIT_LOGS,
  ],
};

/**
 * Checks whether a hook watching `currentTable` should reload when `changedTable` is modified.
 */
export function shouldTableReload(currentTable, changedTable) {
  if (!currentTable) return false;
  if (!changedTable || changedTable === "*") return true;
  if (currentTable === changedTable) return true;

  const related = TABLE_RELATIONS[changedTable];
  if (Array.isArray(related) && related.includes(currentTable)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Synchronization Engine State
// ---------------------------------------------------------------------------
let _initialized = false;
let _localBroadcastChannel = null;
let _realtimeChannel = null;
const _recentLocalMutations = new Map();

/**
 * Initializes cross-tab and cross-device realtime synchronization.
 * Idempotent: safe to call multiple times.
 */
export function initRealtimeSync() {
  if (_initialized || typeof window === "undefined") return;
  if (!supabase || typeof supabase.channel !== "function") return;
  _initialized = true;

  // 1. Same-Browser Cross-Tab synchronization using Web BroadcastChannel API
  try {
    if (typeof BroadcastChannel !== "undefined") {
      _localBroadcastChannel = new BroadcastChannel("lmis_cross_tab_sync");
      _localBroadcastChannel.onmessage = (event) => {
        if (event && event.data) {
          const { table, action, record } = event.data;
          notifyDbChange(table, action, record, {
            isFromBroadcastChannel: true,
            isFromSupabaseBroadcast: true,
          });
        }
      };
    }
  } catch (e) {
    console.warn("BroadcastChannel initialization warning:", e);
  }

  // 2. Cross-Device / Cross-Browser Supabase Realtime synchronization
  try {
    _realtimeChannel = supabase.channel("lmis_realtime_sync", {
      config: { broadcast: { self: false } },
    });

    // Realtime Broadcast from peer browsers
    _realtimeChannel.on("broadcast", { event: "db_change" }, ({ payload }) => {
      if (payload) {
        notifyDbChange(payload.table, payload.action, payload.record, {
          isFromSupabaseBroadcast: true,
          isFromBroadcastChannel: true,
        });
      }
    });

    // Postgres changes on public schema (fallback for direct SQL or external writes)
    _realtimeChannel.on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
      if (payload && payload.table) {
        // If this event was triggered by our own recent mutation, skip to prevent double-reload
        const lastLocal = _recentLocalMutations.get(payload.table) || 0;
        if (Date.now() - lastLocal < 2500) {
          return;
        }
        notifyDbChange(payload.table, payload.eventType, payload.new || payload.old, {
          isFromPostgresChanges: true,
          isFromBroadcastChannel: true,
          isFromSupabaseBroadcast: true,
        });
      }
    });

    _realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: TABLES.OWNERS }, (payload) => {
      const lastLocal = _recentLocalMutations.get(TABLES.OWNERS) || 0;
      if (Date.now() - lastLocal < 1000) return;
      notifyDbChange(TABLES.OWNERS, payload.eventType, payload.new || payload.old, {
        isFromPostgresChanges: true,
        isFromBroadcastChannel: true,
        isFromSupabaseBroadcast: true,
      });
    });

    _realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: TABLES.USERS }, (payload) => {
      const lastLocal = _recentLocalMutations.get(TABLES.USERS) || 0;
      if (Date.now() - lastLocal < 1000) return;
      notifyDbChange(TABLES.USERS, payload.eventType, payload.new || payload.old, {
        isFromPostgresChanges: true,
        isFromBroadcastChannel: true,
        isFromSupabaseBroadcast: true,
      });
    });

    _realtimeChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Successfully subscribed to Supabase Realtime
      }
    });
  } catch (e) {
    console.warn("Supabase Realtime channel setup warning:", e);
  }

  // 3. Fallback listener for legacy raw window.dispatchEvent(new Event("lmis-db-change"))
  window.addEventListener("lmis-db-change", (event) => {
    // If the event was fired without detail, coalesce and propagate to other tabs
    if (!event.detail) {
      scheduleOutboundBroadcast("*", { table: "*", action: "update", timestamp: Date.now() });
    }
  });
}

// ---------------------------------------------------------------------------
// Coalesced Outbound Broadcast Queue (prevents event storms on batch operations)
// ---------------------------------------------------------------------------
let _outboundBroadcastTimer = null;
const _outboundPendingTables = new Set();

function scheduleOutboundBroadcast(table, payload) {
  _outboundPendingTables.add(table);
  if (_outboundBroadcastTimer) return;
  _outboundBroadcastTimer = setTimeout(() => {
    _outboundBroadcastTimer = null;
    const tables = Array.from(_outboundPendingTables);
    _outboundPendingTables.clear();

    for (const t of tables) {
      const consolidatedPayload = {
        ...payload,
        table: t,
        timestamp: Date.now(),
      };

      if (_localBroadcastChannel) {
        try {
          _localBroadcastChannel.postMessage(consolidatedPayload);
        } catch (_) {}
      }

      if (_realtimeChannel) {
        try {
          _realtimeChannel.send({
            type: "broadcast",
            event: "db_change",
            payload: consolidatedPayload,
          });
        } catch (_) {}
      }
    }
  }, 100);
}

/**
 * Central database change notification dispatcher.
 * Triggers:
 *  1. Local DOM CustomEvent for immediate (0ms) current-window reload
 *  2. Web BroadcastChannel for immediate (~1ms) same-browser cross-tab reload
 *  3. Supabase Realtime Broadcast for fast (~50-200ms) cross-device / multi-browser reload
 *
 * @param {string} table - Table name from TABLES constants or "*" for all
 * @param {string} action - 'insert' | 'update' | 'delete'
 * @param {object|null} record - The affected record or summary object
 * @param {object} options - Internal routing flags to prevent echo loops
 */
export function notifyDbChange(table = "*", action = "update", record = null, options = {}) {
  // Ensure sync engine is booted
  if (!_initialized && typeof window !== "undefined") {
    initRealtimeSync();
  }

  const isLocalOrigin = !options.isFromPostgresChanges && !options.isFromBroadcastChannel && !options.isFromSupabaseBroadcast;
  if (isLocalOrigin && table) {
    _recentLocalMutations.set(table, Date.now());
  }

  const payload = {
    table,
    action,
    record: record && typeof record === "object" ? { id: record.id, tag_number: record.tag_number } : null,
    timestamp: Date.now(),
  };

  // 1. Local DOM event for current window (always runs immediately at 0ms)
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("lmis-db-change", { detail: payload }));
    }
  } catch (err) {
    console.warn("Local DOM dispatch failed:", err);
  }

  // 2 & 3. Coalesced cross-tab and cross-device broadcast (debounced by 100ms)
  if (!options.isFromBroadcastChannel && !options.isFromSupabaseBroadcast) {
    scheduleOutboundBroadcast(table, payload);
  }
}

// Auto-boot on client side safely deferred
if (typeof window !== "undefined") {
  queueMicrotask(() => {
    try {
      initRealtimeSync();
    } catch (_) {}
  });
}
