import { supabase } from "../services/supabaseClient";

/**
 * Builds an owner scope filter containing ownerId, animal tags, and record IDs.
 */
export const buildOwnerScope = (ownerId, animals = []) => {
  const tags = new Set();
  const ids = new Set();

  if (Array.isArray(animals)) {
    animals.forEach((a) => {
      if (a?.tag_number) {
        tags.add(String(a.tag_number).trim());
        tags.add(String(a.tag_number).trim().toUpperCase());
      }
      if (a?.id) {
        ids.add(String(a.id));
      }
    });
  }

  return {
    ownerId: ownerId || null,
    tags,
    ids,
  };
};

/**
 * Subscribes to Supabase realtime events across multiple tables with debouncing,
 * scoped to changes relevant to the owner.
 */
export const subscribeOwnerLiveRefresh = ({
  channelName = "owner-live-refresh",
  tables = [],
  getScope,
  getRefresh,
  debounceMs = 300,
}) => {
  if (!supabase || typeof supabase.channel !== "function") {
    return () => {};
  }

  let debounceTimer = null;
  const triggerRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const refreshFn = typeof getRefresh === "function" ? getRefresh() : null;
        if (typeof refreshFn === "function") {
          refreshFn();
        }
      } catch (err) {
        console.warn("ownerLiveRefresh callback error:", err);
      }
    }, debounceMs);
  };

  const channel = supabase.channel(channelName);

  (tables || []).forEach((table) => {
    if (!table) return;
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        // If a scope checker is provided, optionally filter events
        if (typeof getScope === "function") {
          const scope = getScope();
          if (scope) {
            const newRecord = payload?.new || {};
            const oldRecord = payload?.old || {};
            const recOwnerId = newRecord.owner_id || oldRecord.owner_id;
            const recTag = (newRecord.tag_number || oldRecord.tag_number || "").toString().trim().toUpperCase();
            const recLivestockId = newRecord.livestock_id || oldRecord.livestock_id || newRecord.id || oldRecord.id;

            // If scope has ownerId and matches, or tag matches, or id matches:
            if (
              (scope.ownerId && recOwnerId && String(recOwnerId) === String(scope.ownerId)) ||
              (recTag && scope.tags && (scope.tags.has(recTag) || scope.tags.has(newRecord.tag_number))) ||
              (recLivestockId && scope.ids && scope.ids.has(String(recLivestockId))) ||
              (!recOwnerId && !recTag && !recLivestockId) // fallback for broad events
            ) {
              triggerRefresh();
              return;
            }
            return;
          }
        }
        triggerRefresh();
      }
    );
  });

  channel.subscribe();

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    try {
      supabase.removeChannel(channel);
    } catch (_) {}
  };
};

