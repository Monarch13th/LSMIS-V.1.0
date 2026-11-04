// React hook wrapping the Supabase client with in-memory deduplication and caching.
// `data` is always an array (starts as []) and `loading` is always a boolean.
// Auto-refreshes whenever ANY role writes to this table or related tables (shared data flow).
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../services/supabaseClient";
import { shouldTableReload, initRealtimeSync } from "../services/realtimeSync";

// ---------------------------------------------------------------------------
// Global In-Memory Cache, Subscriber Registry & In-Flight Promise Registry
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15000; // 15s freshness window unless invalidated by a DB mutation
const tableDataCache = new Map(); // table -> { data: Array, timestamp: number, stale: boolean }
const inFlightPromises = new Map(); // table -> Promise<Array>
const tableSubscribers = new Map(); // table -> Set<Function>

// Mark cached tables stale immediately when any local/cross-tab/realtime mutation fires
if (typeof window !== "undefined") {
  window.addEventListener("lmis-db-change", (event) => {
    const changedTable = event?.detail?.table;
    for (const [cachedTable, entry] of tableDataCache.entries()) {
      if (!changedTable || shouldTableReload(cachedTable, changedTable)) {
        entry.stale = true;
      }
    }
  });
}

function areRowsEqual(oldRows, newRows) {
  if (!oldRows || !newRows) return false;
  if (oldRows === newRows) return true;
  if (oldRows.length !== newRows.length) return false;
  for (let i = 0; i < oldRows.length; i++) {
    const a = oldRows[i];
    const b = newRows[i];
    if (a === b) continue;
    if (a.id !== b.id) return false;
    if (a.status !== b.status) return false;
    if (a.updated_at !== b.updated_at) return false;
    if (a.completed_at !== b.completed_at) return false;
    if (a.marked !== b.marked) return false;
    if (a.mark_type !== b.mark_type) return false;
    if (a.operator !== b.operator) return false;
    if (a.weight !== b.weight) return false;
    if (a.total_weight !== b.total_weight) return false;
    if (a.cold_weight !== b.cold_weight) return false;
    if (a.decision !== b.decision) return false;
    if (a.permit_issued_at !== b.permit_issued_at) return false;
    if (a.read !== b.read) return false;
    if (a.rate !== b.rate) return false;
    if (a.amount !== b.amount) return false;
    if (a.tag_number !== b.tag_number) return false;
    if (a.species !== b.species) return false;
    if (a.owner_name !== b.owner_name) return false;
    if (a.owner_id !== b.owner_id) return false;
    if (a.findings !== b.findings) return false;
    if (a.remarks !== b.remarks) return false;
    if (a.reason !== b.reason) return false;
    if (a.date !== b.date) return false;
    if (a.full_name !== b.full_name) return false;
    if (a.name !== b.name) return false;
    if (a.avatar_url !== b.avatar_url) return false;
    if (a.contact !== b.contact) return false;
    if (a.address !== b.address) return false;
    if (a.email !== b.email) return false;
  }
  return true;
}

/**
 * Optimistically mutate cached rows for a table across all active hooks and tabs.
 * Allows immediate UI feedback without waiting for round-trip network re-fetch.
 */
export function mutateTableCache(table, updater) {
  if (!table || typeof updater !== "function") return;
  const currentCache = tableDataCache.get(table);
  const currentRows = currentCache?.data || [];
  const updatedRows = updater(currentRows);
  if (Array.isArray(updatedRows)) {
    tableDataCache.set(table, { data: updatedRows, timestamp: Date.now(), stale: false });
    const subs = tableSubscribers.get(table);
    if (subs) {
      subs.forEach((notifySub) => notifySub(updatedRows, false));
    }
  }
}

// ---------------------------------------------------------------------------
// Simple debounce: collapses rapid bursts of events into a single call.
// ---------------------------------------------------------------------------
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export const useSupabase = (table, deps = [], options = {}) => {
  const cached = table ? tableDataCache.get(table) : null;
  const initialData = cached?.data || [];
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(initialData.length === 0);
  const [error, setError] = useState(null);

  const inFlightRef = useRef(false);
  const needsReloadRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (!table) return () => { isMountedRef.current = false; };

    if (!tableSubscribers.has(table)) {
      tableSubscribers.set(table, new Set());
    }
    const subSet = tableSubscribers.get(table);
    const onSharedUpdate = (newRows, isForcedUpdate) => {
      if (!isMountedRef.current) return;
      setData((prev) => {
        if (areRowsEqual(prev, newRows)) return prev;
        return newRows;
      });
      setLoading(false);
      setError(null);
    };
    subSet.add(onSharedUpdate);

    return () => {
      isMountedRef.current = false;
      subSet.delete(onSharedUpdate);
    };
  }, [table]);

  // Ensure global realtime engine is running
  useEffect(() => {
    initRealtimeSync();
  }, []);

  const executeFetch = async (isForced = false) => {
    if (!table) return [];
    // If a request for this table is already in-flight across any hook, share the same Promise
    if (inFlightPromises.has(table)) {
      return inFlightPromises.get(table);
    }
    const fetchPromise = (async () => {
      try {
        const { data: rows, error: dbErr } = await supabase.from(table).select("*");
        if (dbErr) throw dbErr;
        const validRows = Array.isArray(rows) ? rows : [];
        tableDataCache.set(table, { data: validRows, timestamp: Date.now(), stale: false });
        const subs = tableSubscribers.get(table);
        if (subs) {
          subs.forEach((notifySub) => notifySub(validRows, isForced));
        }
        return validRows;
      } finally {
        inFlightPromises.delete(table);
      }
    })();
    inFlightPromises.set(table, fetchPromise);
    return fetchPromise;
  };

  const load = useCallback(async (isForced = false) => {
    if (!table) return;

    // Serve from fresh cache on unforced mount/navigation to prevent redundant full-table fetches
    if (!isForced) {
      const currentCache = tableDataCache.get(table);
      if (
        currentCache &&
        !currentCache.stale &&
        Array.isArray(currentCache.data) &&
        Date.now() - currentCache.timestamp < CACHE_TTL_MS
      ) {
        if (isMountedRef.current) {
          setData((prev) => (areRowsEqual(prev, currentCache.data) ? prev : currentCache.data));
          setLoading(false);
        }
        return;
      }
    }

    if (inFlightRef.current) {
      // Mark that a reload request arrived during an active query
      needsReloadRef.current = true;
      return;
    }
    inFlightRef.current = true;
    needsReloadRef.current = false;

    try {
      const dbRows = await executeFetch(isForced);
      if (!isMountedRef.current) return;

      setData((prev) => {
        if (areRowsEqual(prev, dbRows)) {
          return prev; // Maintain reference identity, prevent unneeded rerenders
        }
        return dbRows;
      });
      setError(null);
    } catch (err) {
      if (isMountedRef.current) {
        console.warn(`Supabase fetch failed for table '${table}':`, err);
        setError(err);
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
      // If a new mutation occurred while the previous query was running, reload immediately
      if (needsReloadRef.current && isMountedRef.current) {
        needsReloadRef.current = false;
        load(true);
      }
    }
  }, [table]);

  // Initial load + reload when deps change
  useEffect(() => {
    load();
  }, [load, ...deps]);

  // Debounced reload for broadcast events — collapses rapid event bursts into one fetch
  const debouncedLoad = useRef(debounce(() => load(true), 250));
  useEffect(() => {
    debouncedLoad.current = debounce(() => load(true), 250);
  }, [load]);

  // Listen for lmis-db-change events (fired locally, cross-tab, or from Supabase Realtime)
  useEffect(() => {
    if (!table) return;
    const handler = (event) => {
      const changedTable = event?.detail?.table;
      if (!changedTable || shouldTableReload(table, changedTable)) {
        debouncedLoad.current();
      }
    };
    window.addEventListener("lmis-db-change", handler);
    return () => window.removeEventListener("lmis-db-change", handler);
  }, [table]);

  return { data, loading, error, refresh: () => load(true), setData };
};
