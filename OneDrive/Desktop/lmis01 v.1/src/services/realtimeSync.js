import { supabase } from "./supabaseClient.js";
import { TABLES } from "../utils/constants.js";

export const TABLE_RELATIONS = {
  [TABLES.LIVESTOCK]: [
    TABLES.LIVESTOCK,
    TABLES.ANTE_MORTEM,
    TABLES.SLAUGHTER_PROCESSING,
    TABLES.PERMITS,
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
    TABLES.PERMITS,
  ],
  [TABLES.PERMITS]: [
    TABLES.PERMITS,
    TABLES.LIVESTOCK,
  ],
  [TABLES.PERMIT_CONFIG]: [
    TABLES.PERMIT_CONFIG,
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

export function shouldTableReload(currentTable, changedTable) {
  if (!currentTable) return false;
  if (!changedTable || changedTable === "*") return true;
  if (currentTable === changedTable) return true;

  const related = TABLE_RELATIONS[changedTable];
  if (Array.isArray(related) && related.includes(currentTable)) return true;

  return false;
}

let _initialized = false;
let _localBroadcastChannel = null;
let _realtimeChannel = null;
const _recentLocalMutations = new Map();

export function initRealtimeSync() {
  if (_initialized || typeof window === "undefined") return;
  if (!supabase || typeof supabase.channel !== "function") return;
  _initialized = true;

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

  try {
    _realtimeChannel = supabase.channel("lmis_realtime_sync", {
      config: { broadcast: { self: false } },
    });

    _realtimeChannel.on("broadcast", { event: "db_change" }, ({ payload }) => {
      if (payload) {
        notifyDbChange(payload.table, payload.action, payload.record, {
          isFromSupabaseBroadcast: true,
          isFromBroadcastChannel: true,
        });
      }
    });

    _realtimeChannel.on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
      if (payload && payload.table) {
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
      }
    });
  } catch (e) {
    console.warn("Supabase Realtime channel setup warning:", e);
  }

  window.addEventListener("lmis-db-change", (event) => {
    if (!event.detail) {
      scheduleOutboundBroadcast("*", { table: "*", action: "update", timestamp: Date.now() });
    }
  });
}

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

export function notifyDbChange(table = "*", action = "update", record = null, options = {}) {
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

  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("lmis-db-change", { detail: payload }));
    }
  } catch (err) {
    console.warn("Local DOM dispatch failed:", err);
  }

  if (!options.isFromBroadcastChannel && !options.isFromSupabaseBroadcast) {
    scheduleOutboundBroadcast(table, payload);
  }
}

if (typeof window !== "undefined") {
  queueMicrotask(() => {
    try {
      initRealtimeSync();
    } catch (_) {}
  });
}
