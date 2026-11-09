import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES } from "../utils/constants";
import { uuid, today } from "../utils/helpers";
import { logActivity, notifyOwner } from "./activityService";
import { getNextReceiptNumber } from "./feeService";
import { mutateTableCache } from "../hooks/useSupabase";
import { adminService } from "./adminService";

import { getCurrentActor, appendProcessEvent, parseHistory } from "../utils/processHistory";

// Ensure Supabase Auth session is active before sensitive data operations
const ensureAuthSession = async () => {
  // If session has been terminated or replaced due to concurrent login, DO NOT auto sign-in!
  if (
    typeof sessionStorage !== "undefined" &&
    (sessionStorage.getItem("lsmis_concurrent_logout_notice") ||
     sessionStorage.getItem("lsmis_termination_notice"))
  ) {
    throw new Error("Your session has ended because your account was signed in elsewhere.");
  }

  // Validate active session with database
  await adminService.assertActiveSession();

  try {
    const { data: s } = await supabase.auth.getSession();
    if (s?.session) return s.session;
    return null;
  } catch (err) {
    console.warn("Session check notice:", err);
    throw err;
  }
};

// Fire database change notification to update all mounted hooks locally, cross-tab, and cross-browser.
const notifyChange = (table = TABLES.LIVESTOCK, action = "update", record = null) => {
  notifyDbChange(table, action, record);
};

const getBaseTag = (tag) => {
  if (!tag) return "";
  const clean = String(tag).trim();
  const splitMatch = clean.match(/^((?:TAG-)?[0-9a-zA-Z]+-[A-Za-z]+)-(?:\d+|[a-zA-Z])$/i);
  if (splitMatch) return splitMatch[1];
  const numSplitMatch = clean.match(/^((?:TAG-)?[0-9a-zA-Z]+-\d+)-(?:\d+|[a-zA-Z])$/i);
  if (numSplitMatch) return numSplitMatch[1];
  return clean;
};

const getDbRows = async (table) => {
  try {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      console.warn(`Supabase select error for table ${table}:`, error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error(`Supabase query exception for table ${table}:`, err);
    return [];
  }
};

/**
 * Safely updates a livestock row with attribution fields and appends an immutable
 * event to process_history. If columns don't exist yet, gracefully falls back without failing.
 */
export const safeUpdateLivestockWithHistory = async (id, tag, patch, processEvent = null, existingAnimal = null) => {
  await adminService.assertActiveSession();
  try {
    let animal = existingAnimal || null;
    const cleanTag = tag ? String(tag).trim() : null;
    if (!animal && cleanTag) {
      const { data } = await supabase.from(TABLES.LIVESTOCK).select("id, process_history, marking_history").ilike("tag_number", cleanTag).maybeSingle();
      animal = data;
    }
    if (!animal && id) {
      const { data } = await supabase.from(TABLES.LIVESTOCK).select("id, process_history, marking_history").eq("id", id).maybeSingle();
      animal = data;
    }

    const currentHistory = parseHistory(animal?.process_history || animal?.marking_history);
    const updatedHistory = processEvent ? appendProcessEvent(currentHistory, processEvent) : currentHistory;

    const fullPatch = {
      ...patch,
      process_history: updatedHistory,
    };

    const targetQuery = animal?.id
      ? supabase.from(TABLES.LIVESTOCK).update(fullPatch).eq("id", animal.id)
      : (cleanTag
        ? supabase.from(TABLES.LIVESTOCK).update(fullPatch).ilike("tag_number", cleanTag)
        : supabase.from(TABLES.LIVESTOCK).update(fullPatch).eq("id", id));

    let { error } = await targetQuery;

    // Gracefully handle column non-existence if database migration has not been applied yet
    if (error && /column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.process_history;
      delete fallbackPatch.workflow_status;
      const fbQuery = animal?.id
        ? supabase.from(TABLES.LIVESTOCK).update(fallbackPatch).eq("id", animal.id)
        : (cleanTag
          ? supabase.from(TABLES.LIVESTOCK).update(fallbackPatch).ilike("tag_number", cleanTag)
          : supabase.from(TABLES.LIVESTOCK).update(fallbackPatch).eq("id", id));
      const res = await fbQuery;
      if (res.error) {
        // Safe minimum patch with only known core columns
        const safeMin = {};
        if (patch.status) safeMin.status = patch.status;
        if (patch.marked !== undefined) safeMin.marked = patch.marked;
        if (patch.mark_type) safeMin.mark_type = patch.mark_type;
        if (patch.mark_date) safeMin.mark_date = patch.mark_date;
        if (patch.permit_issued_at) safeMin.permit_issued_at = patch.permit_issued_at;
        if (patch.permit_issued_by) safeMin.permit_issued_by = patch.permit_issued_by;
        if (patch.permit_no) safeMin.permit_no = patch.permit_no;
        if (patch.weighed_at) safeMin.weighed_at = patch.weighed_at;
        if (patch.weighed_by) safeMin.weighed_by = patch.weighed_by;
        if (patch.weight !== undefined) safeMin.weight = patch.weight;
        let minRes;
        if (animal?.id) minRes = await supabase.from(TABLES.LIVESTOCK).update(safeMin).eq("id", animal.id);
        else if (cleanTag) minRes = await supabase.from(TABLES.LIVESTOCK).update(safeMin).ilike("tag_number", cleanTag);
        else if (id) minRes = await supabase.from(TABLES.LIVESTOCK).update(safeMin).eq("id", id);
        if (minRes?.error) throw minRes.error;
      }
    } else if (error) {
      throw error;
    }
  } catch (err) {
    console.warn("safeUpdateLivestockWithHistory error:", err);
    throw err;
  }
};

export const staffService = {
  // Owners
  listOwners: () => getDbRows(TABLES.OWNERS),
  createOwner: async (p) => {
    await adminService.assertActiveSession();
    let nextId = p.id;
    if (!nextId) {
      try {
        const { data: owners } = await supabase.from(TABLES.OWNERS).select("id").order("id", { ascending: false }).limit(30);
        const nums = (owners || [])
          .map((o) => {
            const m = String(o.id || "").match(/OWNER-(\d+)/) ||
                      String(o.id || "").match(/OWN-(\d+)-(\d{4})/i) ||
                      String(o.id || "").match(/REG-(\d+)-(\d{4})/i);
            if (m) {
              const numPart = m[1].length === 4 ? m[2] : m[1];
              return parseInt(numPart, 10);
            }
            return 0;
          })
          .filter((n) => !isNaN(n));
        const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
        const currentYear = new Date().getFullYear();
        nextId = `OWN-${String(nextNum).padStart(3, "0")}-${currentYear}`;
      } catch (err) {
        console.warn("Could not determine next owner ID from Supabase:", err);
        nextId = `OWN-001-${new Date().getFullYear()}`;
      }
    }

    const actor = getCurrentActor();
    const row = {
      id: nextId,
      registered_date: today(),
      total_animals: 0,
      status: p.status || "Approved",
      created_by: actor.name,
      created_by_user_id: actor.id,
      ...p,
    };
    let { data, error } = await supabase.from(TABLES.OWNERS).insert(row).select().maybeSingle();
    if (error && /column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const { created_by, created_by_user_id, ...fallbackRow } = row;
      const res = await supabase.from(TABLES.OWNERS).insert(fallbackRow).select().maybeSingle();
      data = res.data;
      error = res.error;
    }
    if (error) {
      console.error("Supabase owner insert error:", error);
      throw error;
    }
    await logActivity({ action: `Registered owner ${p.name}`, module: "Owners", notify: { title: "New Owner Registered", message: `${p.name} was registered as a livestock owner`, type: "info" } });
    notifyChange(TABLES.OWNERS, "insert", data || row);
    return { data: data || row };
  },
  updateOwner: async (id, p) => {
    const patch = { ...p };
    // Prevent overwriting the original creator
    delete patch.created_by;
    delete patch.created_by_user_id;
    const { data, error } = await supabase.from(TABLES.OWNERS).update(patch).eq("id", id).select().maybeSingle();
    if (error) {
      console.error("Supabase owner update error:", error);
      throw error;
    }
    await logActivity({
      action: `Updated owner record ${data?.name || p?.name || id}`,
      module: "Owners",
    });
    notifyChange(TABLES.OWNERS, "update", data || p);
    return { data: data || p };
  },
  deleteOwner: async (id) => {
    const { data: existing } = await supabase.from(TABLES.OWNERS).select("name").eq("id", id).maybeSingle();
    const { error } = await supabase.from(TABLES.OWNERS).delete().eq("id", id);
    if (error) {
      console.error("Supabase owner delete error:", error);
      throw error;
    }
    await logActivity({
      action: `Deleted owner record ${existing?.name || id}`,
      module: "Owners",
    });
    notifyChange(TABLES.OWNERS, "delete", { id });
  },

  // Livestock
  listLivestock: () => getDbRows(TABLES.LIVESTOCK),
  createLivestock: async (p) => {
    await ensureAuthSession();
    const targetOwnerId = p.owner_id ? String(p.owner_id).trim() : null;
    const targetOwnerName = p.owner_name ? String(p.owner_name).trim() : null;
    const rawQty = parseInt(p.quantity, 10) || 1;
    const nowIso = new Date().toISOString();
    const actor = getCurrentActor();

    const initialHistory = appendProcessEvent([], {
      stage: "Registration",
      action: "Livestock Registered",
      details: { tag_number: p.tag_number, species: p.species, breed: p.breed || "", remarks: p.remarks || "" },
      actor,
    });

    const ageVal = p.age_value !== undefined && p.age_value !== null && !isNaN(p.age_value)
      ? Number(p.age_value)
      : (p.age_months ? parseInt(p.age_months, 10) || null : null);
    const isYear = String(p.age_unit || p.age_months || "").toLowerCase().includes("year");
    const ageUnit = p.age_unit
      ? String(p.age_unit).trim()
      : (p.age_months ? (isYear ? (ageVal === 1 ? "Year" : "Years") : (ageVal === 1 ? "Month" : "Months")) : null);

    const row = {
      id: p.id || uuid(),
      tag_number: p.tag_number,
      species: p.species,
      sex: p.sex || null,
      age_months: p.age_months || null,
      age_value: ageVal,
      age_unit: ageUnit,
      quantity: rawQty,
      owner_id: targetOwnerId,
      owner_name: targetOwnerName,
      received_date: p.received_date || today(),
      registered_at: p.registered_at || p.created_at || nowIso,
      created_by: actor.name,
      created_by_user_id: actor.id,
      registered_by: actor.name,
      registered_by_user_id: actor.id,
      process_history: initialHistory,
      status: p.status || "Pending Marking",
      marked: false,
      mark_type: null,
      mark_date: null,
      marked_at: null,
    };

    let insertedData = null;
    let { data: insData, error: insertErr } = await supabase.from(TABLES.LIVESTOCK).insert(row).select();
    if (!insertErr && insData) {
      insertedData = insData;
    }

    if (insertErr && /registered_at|created_by|registered_by|process_history|age_value|age_unit|schema cache|column/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
      const fallbackRow = { ...row };
      delete fallbackRow.created_by;
      delete fallbackRow.created_by_user_id;
      delete fallbackRow.registered_by;
      delete fallbackRow.registered_by_user_id;
      delete fallbackRow.process_history;
      if (/age_value|age_unit/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
        delete fallbackRow.age_value;
        delete fallbackRow.age_unit;
      }
      if (/registered_at/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
        delete fallbackRow.registered_at;
      }
      const res = await supabase.from(TABLES.LIVESTOCK).insert(fallbackRow).select();
      insertErr = res.error;
      if (!insertErr && res.data) {
        insertedData = res.data;
      }
    }
    if (insertErr) {
      console.error("Supabase livestock insert error:", insertErr);
      throw new Error(insertErr.message || "Failed to register livestock in Supabase");
    }

    const finalRow = (insertedData && insertedData[0]) || row;
    mutateTableCache(TABLES.LIVESTOCK, (prev) => [finalRow, ...(prev || []).filter((x) => x.id !== finalRow.id)]);

    // Execute secondary operations (Owner sync, Owner notification, Activity log) concurrently
    const backgroundTasks = [];

    if (targetOwnerId || targetOwnerName) {
      backgroundTasks.push(
        (async () => {
          try {
            let currentTotal = 0;
            const { data: dbAnimals } = await supabase
              .from(TABLES.LIVESTOCK)
              .select("quantity")
              .eq("owner_id", targetOwnerId);
            if (dbAnimals && dbAnimals.length > 0) {
              currentTotal = dbAnimals.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
            }

            if (targetOwnerId) {
              await supabase
                .from(TABLES.OWNERS)
                .update({ total_animals: currentTotal, status: "Approved" })
                .eq("id", targetOwnerId);
            } else if (targetOwnerName) {
              await supabase
                .from(TABLES.OWNERS)
                .update({ total_animals: currentTotal, status: "Approved" })
                .ilike("name", targetOwnerName);
            }
          } catch (ownerErr) {
            console.warn("Owner sync error upon registration:", ownerErr);
          }
        })()
      );

      backgroundTasks.push(
        notifyOwner({
          owner_id: targetOwnerId,
          title: "New Livestock Registered",
          message: `${p.tag_number || "Livestock"} (${p.species || "Animal"}) has been officially registered and received by abattoir personnel under your account.`,
          type: "info",
        }).catch((err) => console.warn("Owner notification error:", err))
      );
    }

    backgroundTasks.push(
      logActivity({
        action: `Registered livestock ${p.tag_number}`,
        module: "Livestock",
        notify: {
          title: "New Animal Received",
          message: `${p.tag_number} (${p.species}) received from ${p.owner_name || "Owner"} — ready for marking`,
          type: "info",
          owner_id: targetOwnerId || null,
        },
      }).catch((err) => console.warn("Log activity error:", err))
    );

    await Promise.allSettled(backgroundTasks);

    notifyChange(TABLES.LIVESTOCK, "insert", row);
    return { data: row };
  },
  createLivestockBatch: async (items) => {
    if (!Array.isArray(items) || items.length === 0) return { data: [] };
    await ensureAuthSession();
    const nowIso = new Date().toISOString();
    const actor = getCurrentActor();
    const todayDate = today();

    // Fetch latest owner names from owners table to guarantee consistent profile synchronization
    const distinctOwnerIds = Array.from(new Set(items.map((p) => p.owner_id).filter(Boolean)));
    const ownerNameMap = new Map();
    if (distinctOwnerIds.length > 0) {
      try {
        const { data: ownersData } = await supabase
          .from(TABLES.OWNERS)
          .select("id, name, temp_reg_id, auth_user_id")
          .or(distinctOwnerIds.map((id) => `id.eq.${id},temp_reg_id.eq.${id}`).join(","));
        (ownersData || []).forEach((o) => {
          if (o.id && o.name) ownerNameMap.set(String(o.id).trim().toLowerCase(), o.name);
          if (o.temp_reg_id && o.name) ownerNameMap.set(String(o.temp_reg_id).trim().toLowerCase(), o.name);
          if (o.auth_user_id && o.name) ownerNameMap.set(String(o.auth_user_id).trim().toLowerCase(), o.name);
        });
      } catch (_) {}
    }

    const rows = items.map((p) => {
      const targetOwnerId = p.owner_id ? String(p.owner_id).trim() : null;
      const targetOwnerName =
        (targetOwnerId && ownerNameMap.get(targetOwnerId.toLowerCase())) ||
        (p.owner_name ? String(p.owner_name).trim() : null);
      const rawQty = parseInt(p.quantity, 10) || 1;

      const initialHistory = appendProcessEvent([], {
        stage: "Registration",
        action: "Livestock Registered",
        details: { tag_number: p.tag_number, species: p.species, breed: p.breed || "", remarks: p.remarks || "" },
        actor,
      });

      const ageVal = p.age_value !== undefined && p.age_value !== null && !isNaN(p.age_value)
        ? Number(p.age_value)
        : (p.age_months ? parseInt(p.age_months, 10) || null : null);
      const isYear = String(p.age_unit || p.age_months || "").toLowerCase().includes("year");
      const ageUnit = p.age_unit
        ? String(p.age_unit).trim()
        : (p.age_months ? (isYear ? (ageVal === 1 ? "Year" : "Years") : (ageVal === 1 ? "Month" : "Months")) : null);

      return {
        id: p.id || uuid(),
        tag_number: p.tag_number,
        species: p.species,
        species_id: p.species_id || null,
        sex: p.sex || null,
        age_months: p.age_months || null,
        age_value: ageVal,
        age_unit: ageUnit,
        quantity: rawQty,
        owner_id: targetOwnerId,
        owner_name: targetOwnerName,
        received_date: p.received_date || todayDate,
        registered_at: p.registered_at || p.created_at || nowIso,
        created_by: actor.name,
        created_by_user_id: actor.id,
        registered_by: actor.name,
        registered_by_user_id: actor.id,
        process_history: initialHistory,
        status: p.status || "Pending Marking",
        marked: false,
        mark_type: null,
        mark_date: null,
        marked_at: null,
      };
    });

    let insertedRows = null;
    let { data: insData, error: insertErr } = await supabase.from(TABLES.LIVESTOCK).insert(rows).select();
    if (!insertErr && insData) {
      insertedRows = insData;
    }

    if (insertErr && /registered_at|created_by|registered_by|process_history|age_value|age_unit|schema cache|column/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
      const fallbackRows = rows.map((r) => {
        const fb = { ...r };
        delete fb.created_by;
        delete fb.created_by_user_id;
        delete fb.registered_by;
        delete fb.registered_by_user_id;
        delete fb.process_history;
        if (/age_value|age_unit/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
          delete fb.age_value;
          delete fb.age_unit;
        }
        if (/registered_at/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
          delete fb.registered_at;
        }
        return fb;
      });
      const res = await supabase.from(TABLES.LIVESTOCK).insert(fallbackRows).select();
      insertErr = res.error;
      if (!insertErr && res.data) {
        insertedRows = res.data;
      }
    }
    if (insertErr) {
      console.error("Supabase batch livestock insert error:", insertErr);
      throw new Error(insertErr.message || "Failed to register livestock batch in Supabase");
    }

    const finalRows = insertedRows && insertedRows.length > 0 ? insertedRows : rows;

    // Instantly update client cache across all mounted components
    mutateTableCache(TABLES.LIVESTOCK, (prev) => {
      const existingIds = new Set((prev || []).map((x) => x.id));
      const fresh = finalRows.filter((r) => !existingIds.has(r.id));
      return [...fresh, ...(prev || [])];
    });

    const backgroundTasks = [];
    const firstItem = items[0] || {};
    const targetOwnerId = firstItem.owner_id ? String(firstItem.owner_id).trim() : null;
    const targetOwnerName = firstItem.owner_name ? String(firstItem.owner_name).trim() : null;

    if (targetOwnerId || targetOwnerName) {
      backgroundTasks.push(
        (async () => {
          try {
            let currentTotal = 0;
            const { data: dbAnimals } = await supabase
              .from(TABLES.LIVESTOCK)
              .select("quantity")
              .eq("owner_id", targetOwnerId);
            if (dbAnimals && dbAnimals.length > 0) {
              currentTotal = dbAnimals.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
            }
            if (targetOwnerId) {
              await supabase
                .from(TABLES.OWNERS)
                .update({ total_animals: currentTotal, status: "Approved" })
                .eq("id", targetOwnerId);
            } else if (targetOwnerName) {
              await supabase
                .from(TABLES.OWNERS)
                .update({ total_animals: currentTotal, status: "Approved" })
                .ilike("name", targetOwnerName);
            }
          } catch (ownerErr) {
            console.warn("Owner sync error upon batch registration:", ownerErr);
          }
        })()
      );

      backgroundTasks.push(
        notifyOwner({
          owner_id: targetOwnerId,
          title: "New Livestock Registered",
          message: `${items.length} animal${items.length > 1 ? "s" : ""} officially registered and received under your account.`,
          type: "info",
        }).catch((err) => console.warn("Owner notification error:", err))
      );
    }

    backgroundTasks.push(
      logActivity({
        action: `Batch registered ${items.length} livestock entries`,
        module: "Livestock",
        notify: {
          title: "New Animals Received",
          message: `${items.length} animals received from ${firstItem.owner_name || "Owner"} — ready for marking`,
          type: "info",
          owner_id: targetOwnerId || null,
        },
      }).catch((err) => console.warn("Log activity error:", err))
    );

    await Promise.allSettled(backgroundTasks);

    if (rows.length > 0) {
      notifyChange(TABLES.LIVESTOCK, "insert", rows[0]);
    }
    return { data: rows };
  },
  markAnimal: async (id, tag, markType = "Ear Tag", preloadedAnimal = null, options = {}) => {
    let animal = preloadedAnimal || null;
    const selectCols = "id, tag_number, species, owner_name, owner_id, status, marked, mark_type, mark_date, marked_at, fallback_at, fallback_reason, marking_history, process_history";
    if (!animal) {
      try {
        if (id) {
          const { data } = await supabase.from(TABLES.LIVESTOCK).select(selectCols).eq("id", id).maybeSingle();
          animal = data;
        }
        if (!animal && tag) {
          const { data } = await supabase.from(TABLES.LIVESTOCK).select(selectCols).eq("tag_number", tag).maybeSingle();
          animal = data;
        }
      } catch (_) {}
    }

    if (animal && (animal.status === "Condemned" || animal.status === "Rejected")) {
      throw new Error(`Animal ${tag || id} is officially CONDEMNED. File is finalized. Marking not permitted.`);
    }

    const nowObj = new Date();
    const markDate = nowObj.toISOString().split("T")[0];
    const markTime = nowObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const markedAtIso = nowObj.toISOString();

    // Preserve previous marking history for audit purposes
    let markingHistory = [];
    if (Array.isArray(animal?.marking_history)) {
      markingHistory = [...animal.marking_history];
    } else if (typeof animal?.marking_history === "string") {
      try {
        markingHistory = JSON.parse(animal.marking_history) || [];
      } catch (_) {}
    }

    if (animal?.marked_at || animal?.mark_date || animal?.fallback_at) {
      markingHistory.push({
        event: animal.fallback_at ? "re_marked_after_24h_fallback" : "re_marked",
        previous_mark_type: animal.mark_type || null,
        previous_mark_date: animal.mark_date || null,
        previous_marked_at: animal.marked_at || null,
        fallback_at: animal.fallback_at || null,
        fallback_reason: animal.fallback_reason || null,
        re_marked_at: markedAtIso,
      });
    }

    const actor = getCurrentActor();
    const updatedHistory = appendProcessEvent(animal?.process_history || [], {
      stage: "Marking",
      action: `Animal Marked (${markType}) — Ready for Ante-Mortem Inspection`,
      details: { mark_type: markType },
      actor,
    });

    const dbPatch = {
      marked: true,
      mark_type: markType,
      mark_date: markDate,
      marked_at: markedAtIso,
      marked_by: actor.name,
      marked_by_user_id: actor.id,
      process_history: updatedHistory,
      status: "Marked",
      fallback_at: null,
      fallback_reason: null,
      marking_history: markingHistory,
    };

    let updateErr = null;
    if (id) {
      const res = await supabase.from(TABLES.LIVESTOCK).update(dbPatch).eq("id", id);
      updateErr = res.error;
    }
    if ((updateErr || !id) && tag) {
      const res = await supabase.from(TABLES.LIVESTOCK).update(dbPatch).eq("tag_number", tag);
      updateErr = res.error;
    }

    // Gracefully handle column non-existence if database migration has not been run yet
    if (updateErr && /column|schema cache/i.test(`${updateErr.message || ""} ${updateErr.details || ""}`)) {
      const fallbackPatch = {
        marked: true,
        mark_type: markType,
        mark_date: markDate,
        marked_at: markedAtIso,
        status: "Marked",
      };
      if (id) {
        const res = await supabase.from(TABLES.LIVESTOCK).update(fallbackPatch).eq("id", id);
        updateErr = res.error;
      }
      if ((updateErr || !id) && tag) {
        const res = await supabase.from(TABLES.LIVESTOCK).update(fallbackPatch).eq("tag_number", tag);
        updateErr = res.error;
      }
    }
    if (updateErr) {
      throw updateErr;
    }

    const isReMark = Boolean(animal?.fallback_at || (animal?.status === "Returned to Animal Marking"));

    await logActivity({
      action: isReMark
        ? `Re-marked fallback animal ${tag || id} (${markType}) — Ready for Ante-Mortem`
        : `Marked animal ${tag || id} (${markType}) — Ready for Ante-Mortem`,
      module: "Marking",
      user: actor.name,
      role: actor.role,
      user_id: actor.id,
      notify: {
        title: isReMark ? "Animal Re-Marked & Ready" : "Animal Marked & Ready",
        message: `${tag || id} marked with ${markType} and transferred to Ante-Mortem inspection (${markDate} ${markTime})`,
        type: "success",
        owner_id: animal?.owner_id || null,
      },
    }).catch((err) => console.warn("Log activity error in markAnimal:", err));

    mutateTableCache(TABLES.LIVESTOCK, (prev) =>
      (prev || []).map((x) => {
        if ((id && x.id === id) || (tag && x.tag_number === tag)) {
          return { ...x, ...dbPatch };
        }
        return x;
      })
    );

    if (!options.skipNotify) {
      notifyChange(TABLES.LIVESTOCK, "update", { id: animal?.id || id, ...dbPatch });
    }
    return { data: dbPatch };
  },

  notifyTableChange: (table = TABLES.LIVESTOCK, action = "update", record = null) => {
    notifyChange(table, action, record);
  },

  // Evaluate and apply automatic 24-hour fallback for livestock awaiting slaughter line intake (throttled)
  processMarking24hFallback: async () => {
    if (typeof document !== "undefined" && document.hidden) {
      return { processed: 0 };
    }
    // Prevent overlapping or rapid consecutive executions (minimum 45s cooldown)
    const nowTs = Date.now();
    if (staffService._lastFallbackRun && nowTs - staffService._lastFallbackRun < 45000) {
      return { processed: 0 };
    }
    staffService._lastFallbackRun = nowTs;

    // 1. First attempt to call the PostgreSQL server-side RPC function
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("process_marking_24h_fallback");
      if (!rpcErr && rpcRes && rpcRes.success && rpcRes.processed_count > 0) {
        notifyChange();
        return rpcRes;
      }
    } catch (_) {}

    // 2. Client-coordinated evaluation fallback against live database records
    try {
      const now = new Date();
      const cutoffTime = now.getTime() - (24 * 60 * 60 * 1000); // 24 hours ago
      const nowIso = now.toISOString();
      const phTimeStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) + " " +
        now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit" });

      // Fetch livestock that are currently marked, awaiting slaughter, or stalled in queue
      const { data: animals, error: fetchErr } = await supabase
        .from(TABLES.LIVESTOCK)
        .select("*")
        .or("status.eq.Ready for Slaughter,status.eq.Pending Slaughter,status.eq.Pending Operator Reassignment,status.eq.In Progress,marked.eq.true");

      if (fetchErr || !animals || animals.length === 0) return { processed: 0 };

      // Fetch processing records to check if slaughter has already started or completed
      const { data: processingList } = await supabase
        .from(TABLES.SLAUGHTER_PROCESSING)
        .select("tag_number, status, operator, steps, reassigned_at, started_at, created_at, fallback_at");

      // Fetch slaughter records to cross-reference operator assignments & timestamps
      const { data: slaughterList } = await supabase
        .from(TABLES.SLAUGHTER_RECORDS)
        .select("id, tag_number, livestock_id, status, operator, previous_operator, reassigned_at, created_at, fallback_at");

      // Identify animals with genuine active floor progress (at least 1 step completed) or completed slaughter
      const inProcTags = new Set(
        (processingList || [])
          .filter((p) => {
            const st = String(p.status || "").toLowerCase();
            if (st === "completed" || st === "slaughtered" || st === "done") return true;
            if (st === "in progress") {
              const stepsObj = typeof p.steps === "string" ? (() => { try { return JSON.parse(p.steps); } catch (_) { return {}; } })() : (p.steps || {});
              const hasCompletedStep = Object.entries(stepsObj).some(([k, v]) => {
                if (k === "started_at" || k === "completed_at") return false;
                if (typeof v === "boolean") return v;
                if (v && typeof v === "object") return Boolean(v.done);
                return Boolean(v);
              });
              return hasCompletedStep;
            }
            return false;
          })
          .map((p) => String(p.tag_number || "").trim().toUpperCase())
      );

      // Fetch permit tags to strictly prevent reverting permitted livestock
      const { data: activePermits } = await supabase
        .from(TABLES.PERMITS)
        .select("tag_number, status");
      const permittedTagSet = new Set(
        (activePermits || [])
          .filter((p) => String(p.status || "").toLowerCase() !== "revoked")
          .map((p) => String(p.tag_number || "").trim().toUpperCase())
      );

      // Fetch existing timeout notifications to prevent duplicate alerts
      const { data: existingNotifs } = await supabase
        .from(TABLES.NOTIFICATIONS)
        .select("title, message, date")
        .or("title.ilike.%24h Timeout%,title.ilike.%Operator Reassignment Required%");

      let processedCount = 0;

      for (const animal of animals) {
        const cleanTag = String(animal.tag_number || "").trim().toUpperCase();
        if (!cleanTag) continue;

        // Skip animals with issued permits or in permit records
        if (permittedTagSet.has(cleanTag)) continue;

        // Skip animals already with genuine slaughter progress or completed slaughter
        if (inProcTags.has(cleanTag)) continue;

        // Skip downstream, post-mortem, carcass weighing, permit, dispatch, condemned, or finalized animals
        const st = String(animal.status || "").toLowerCase();
        if (
          st === "slaughtering" || st === "completed" ||
          st === "weighed" || st === "paid" || st === "released" || st === "dispatched" ||
          st === "permit issued" || st === "ready for dispatch" ||
          st.includes("permit") || st.includes("dispatch") || st.includes("post-mortem") || st.includes("post mortem") ||
          st.includes("condemn") || st.includes("reject") ||
          Boolean(animal.permit_issued_at) || Boolean(animal.weighed_at)
        ) {
          continue;
        }

        // Prevent duplicate fallback processing for the same cycle
        const isAlreadyPendingFallback = Boolean(
          animal.fallback_at &&
          (!animal.reassigned_at || new Date(animal.fallback_at) > new Date(animal.reassigned_at))
        );
        if (isAlreadyPendingFallback) continue;

        // Locate matching processing and slaughter record entries
        const matchingProc = (processingList || []).find(
          (p) => String(p.tag_number || "").trim().toUpperCase() === cleanTag
        );
        const matchingSr = (slaughterList || []).find(
          (s) => String(s.tag_number || "").trim().toUpperCase() === cleanTag || (s.livestock_id && s.livestock_id === animal.id)
        );

        // Check if animal has an assigned operator (entered Ready for Slaughter)
        const assignedOp = matchingProc?.operator && matchingProc.operator !== "Unassigned"
          ? matchingProc.operator
          : (matchingSr?.operator && matchingSr.operator !== "Unassigned"
            ? matchingSr.operator
            : (animal.operator && animal.operator !== "Unassigned"
              ? animal.operator
              : (animal.previous_operator && animal.previous_operator !== "Unassigned" ? animal.previous_operator : null)));

        // If the animal is not yet assigned an operator (waiting in Assign Team Operator),
        // it has not entered Ready for Slaughter and cannot fall back.
        if (!assignedOp && st !== "in progress") continue;

        // Determine exact timestamp when livestock entered Ready for Slaughter
        const readyForSlaughterTimestamp =
          animal.ready_for_slaughter_at ||
          animal.reassigned_at ||
          matchingProc?.reassigned_at ||
          matchingProc?.started_at ||
          matchingProc?.created_at ||
          matchingSr?.reassigned_at ||
          matchingSr?.created_at;

        if (!readyForSlaughterTimestamp) continue;
        const entryTime = new Date(readyForSlaughterTimestamp).getTime();
        if (isNaN(entryTime)) continue;

        // If livestock entered Ready for Slaughter less than 24 hours ago, remain in Ready for Slaughter
        if (entryTime > cutoffTime) continue;

        const prevOperator = assignedOp || matchingProc?.operator || matchingSr?.operator || animal.previous_operator || "Unassigned";

        // Prepare updated marking history
        let markingHistory = [];
        if (Array.isArray(animal.marking_history)) {
          markingHistory = [...animal.marking_history];
        } else if (typeof animal.marking_history === "string") {
          try { markingHistory = JSON.parse(animal.marking_history) || []; } catch (_) {}
        }

        markingHistory.push({
          event: "fallback_24h_timeout",
          action: "Returned to Assign Team Operator for reassignment",
          previous_operator: prevOperator,
          previous_mark_type: animal.mark_type || null,
          previous_mark_date: animal.mark_date || null,
          previous_marked_at: animal.marked_at || null,
          fallback_at: nowIso,
          fallback_reason: "Exceeded 24-hour limit in Ready for Slaughter without slaughter processing. Operator reassignment required.",
        });

        const patch = {
          status: "Ready for Slaughter",
          marked: true,
          fallback_at: nowIso,
          fallback_reason: "Exceeded 24-hour limit in Ready for Slaughter without slaughter processing. Operator reassignment required.",
          previous_operator: prevOperator,
          marking_history: markingHistory,
        };

        let updateError = null;
        const res = await supabase.from(TABLES.LIVESTOCK).update(patch).eq("id", animal.id);
        updateError = res.error;

        // If columns don't exist yet, update basic status
        if (updateError && /column.*does not exist/i.test(`${updateError.message || ""} ${updateError.details || ""}`)) {
          await supabase.from(TABLES.LIVESTOCK).update({
            status: "Ready for Slaughter",
            marked: true,
            fallback_at: nowIso,
            fallback_reason: "Exceeded 24-hour limit in Ready for Slaughter without slaughter processing. Operator reassignment required.",
          }).eq("id", animal.id);
        }

        // Update pending slaughter record - reset operator to Unassigned so it returns to Assign Team Operator
        try {
          await supabase
            .from(TABLES.SLAUGHTER_RECORDS)
            .update({
              status: "Ready for Slaughter",
              operator: "Unassigned",
              previous_operator: prevOperator,
              fallback_at: nowIso,
              fallback_reason: "Exceeded 24-hour limit in Ready for Slaughter without slaughter processing. Operator reassignment required.",
            })
            .eq("tag_number", animal.tag_number)
            .neq("status", "Completed");
        } catch (_) {}

        try {
          // If processing record exists without completed steps, reset to Pending Reassignment & Unassigned
          await supabase
            .from(TABLES.SLAUGHTER_PROCESSING)
            .update({
              status: "Pending Reassignment",
              operator: "Unassigned",
              previous_operator: prevOperator,
              fallback_at: nowIso,
              fallback_reason: "Exceeded 24-hour limit in Ready for Slaughter without slaughter processing. Operator reassignment required.",
            })
            .eq("tag_number", animal.tag_number)
            .neq("status", "Completed");
        } catch (_) {}

        // Prevent duplicate notifications for this specific fallback event cycle
        const hasNotif = (existingNotifs || []).some(
          (n) => n.message && n.message.includes(animal.tag_number) && new Date(n.date).getTime() >= entryTime
        );

        if (!hasNotif) {
          const notifMsg = `Livestock ${animal.tag_number} (${animal.species || "Livestock"}, Owner: ${animal.owner_name || "Unknown Owner"}) exceeded the 24-hour limit in Ready for Slaughter without slaughter floor intake on ${phTimeStr}. Previous operator: ${prevOperator}. The livestock has been returned to Assign Team Operator for a new team operator assignment.`;
          try {
            await supabase.from(TABLES.NOTIFICATIONS).insert({
              id: uuid(),
              title: "⚠️ 24h Timeout: Operator Reassignment Required",
              message: notifMsg,
              date: nowIso,
              read: false,
              type: "warning",
              owner_id: null,
              role: "staff",
            });
          } catch (ne) {
            console.warn("Notice inserting fallback notification:", ne);
          }
        }

          // Record audit log
          try {
            await logActivity({
              action: `Automatic 24h Fallback: Returned ${animal.tag_number} to Assign Team Operator (exceeded 24h limit, reassign operator)`,
              module: "Slaughter",
              severity: "warning",
              tag_number: animal.tag_number,
              old_value: prevOperator,
              new_value: "Reassignment Required",
            });
          } catch (_) {}

          processedCount++;
        }

        if (processedCount > 0) {
        notifyChange();
      }

      return { processed: processedCount };
    } catch (err) {
      console.warn("Exception during processMarking24hFallback:", err);
      return { error: err.message };
    }
  },
  updateLivestock: async (id, p) => {
    const { data: existing } = await supabase.from(TABLES.LIVESTOCK).select().eq("id", id).maybeSingle();
    if (existing && (existing.status === "Condemned" || existing.status === "Rejected") && p.status && p.status !== "Condemned") {
      throw new Error(`Animal ${id} is officially CONDEMNED. File is finalized.`);
    }
    const patch = { ...p };
    delete patch.created_at;
    delete patch.registered_at;
    delete patch.created_by;
    delete patch.created_by_user_id;
    delete patch.registered_by;
    delete patch.registered_by_user_id;
    const { data, error } = await supabase.from(TABLES.LIVESTOCK).update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    await logActivity({
      action: `Updated livestock record ${data?.tag_number || existing?.tag_number || p?.tag_number || id}`,
      module: "Livestock",
      tag_number: data?.tag_number || existing?.tag_number || p?.tag_number || null,
    });
    notifyChange();
    return { data: data || p };
  },
  deleteLivestock: async (id, force = false) => {
    let animal = null;
    const { data } = await supabase.from(TABLES.LIVESTOCK).select("*").eq("id", id).maybeSingle();
    animal = data;

    if (animal && !force) {
      const status = String(animal.status || "").toLowerCase();
      if (
        status === "in progress" ||
        status === "completed" ||
        status === "released" ||
        status === "slaughtered" ||
        status === "scheduled" ||
        status === "ready for slaughter" ||
        status === "condemned" ||
        status === "rejected"
      ) {
        throw new Error(`Animal ${animal.tag_number || id} is already in slaughter process or finalized and cannot be deleted.`);
      }
    }

    const { error } = await supabase.from(TABLES.LIVESTOCK).delete().eq("id", id);
    if (error) throw error;

    if (animal?.tag_number) {
      await supabase.from(TABLES.LIVESTOCK).delete().eq("tag_number", animal.tag_number);
    }

    await logActivity({
      action: `Deleted livestock record ${animal?.tag_number || id}`,
      module: "Livestock",
      tag_number: animal?.tag_number || null,
    });

    if (animal?.owner_id) {
      try {
        let remainingCount = 0;
        const { data: dbRemaining } = await supabase
          .from(TABLES.LIVESTOCK)
          .select("quantity")
          .eq("owner_id", animal.owner_id);
        if (dbRemaining) {
          remainingCount = dbRemaining.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
        }
        await supabase
          .from(TABLES.OWNERS)
          .update({ total_animals: remainingCount })
          .eq("id", animal.owner_id);
      } catch (delErr) {
        console.warn("Error updating owner count after animal deletion:", delErr);
      }
    }

    notifyChange();
  },

  // Slaughter
  listSlaughter: () => getDbRows(TABLES.SLAUGHTER_RECORDS),
  createSlaughter: async (p) => {
    if (p.tag_number) {
      const { data: animals } = await supabase.from(TABLES.LIVESTOCK).select().eq("tag_number", p.tag_number);
      const animal = animals?.[0];
      if (animal && (animal.status === "Condemned" || animal.status === "Rejected")) {
        throw new Error(`Livestock ${p.tag_number} is officially CONDEMNED. File is final. No slaughter permitted.`);
      }
    }

    const nowObj = new Date();
    const markDate = p.mark_date || nowObj.toISOString().split("T")[0];

    const row = {
      id: uuid(),
      status: "Ready for Slaughter",
      slaughter_date: null,
      date: markDate,
      ...p,
    };
    const { error } = await supabase.from(TABLES.SLAUGHTER_RECORDS).insert(row);
    if (error) throw error;
    await logActivity({ action: `Advanced ${p.tag_number} to Ready for Slaughter`, module: "Slaughter", notify: { title: "Ready for Slaughter", message: `${p.tag_number} ready for slaughter line`, type: "info" } });
    notifyChange();
    return { data: row };
  },
  updateSlaughter: async (id, patch) => {
    const { error } = await supabase.from(TABLES.SLAUGHTER_RECORDS).update(patch).eq("id", id);
    if (error) throw error;
    await logActivity({ action: `Updated slaughter record`, module: "Slaughter" });
    notifyChange();
    return { data: patch };
  },
  completeSlaughter: async (id, tag) => {
    const nowObj = new Date();
    const endDate = nowObj.toISOString().split("T")[0];
    const patch = {
      status: "Completed",
      slaughter_date: endDate,
    };
    const { error } = await supabase.from(TABLES.SLAUGHTER_RECORDS).update(patch).eq("id", id);
    if (error) throw error;
    await logActivity({ action: `Completed slaughter ${tag || ""}`.trim(), module: "Slaughter", notify: { title: "Slaughter Completed", message: `Slaughter operation completed${tag ? ` for ${tag}` : ""} — ready for post-mortem inspection`, type: "success" } });
    notifyChange();
    return { data: patch };
  },

  // Slaughter Processing
  listProcessing: () => getDbRows(TABLES.SLAUGHTER_PROCESSING),
  assignSlaughterOperator: async ({ tag_number, operator }, options = {}) => {
    if (!tag_number) throw new Error("Tag number is required");
    const actor = getCurrentActor();
    const nowIso = new Date().toISOString();

    const { data: animals } = await supabase.from(TABLES.LIVESTOCK).select().eq("tag_number", tag_number);
    const animal = animals?.[0];
    if (animal && (animal.status === "Condemned" || animal.status === "Rejected")) {
      throw new Error(`Livestock ${tag_number} is officially CONDEMNED. File is final. No slaughter permitted.`);
    }

    const prevOperator = animal?.previous_operator || null;
    const isReassignment = Boolean(
      animal?.fallback_at ||
      (prevOperator && prevOperator !== "Unassigned" && prevOperator !== operator)
    );

    const livestockPatch = {
      status: "In Progress",
      reassigned_at: nowIso,
      fallback_at: null,
      fallback_reason: null,
      previous_operator: operator,
    };

    const slaughterPatch = {
      operator,
      status: "In Progress",
      fallback_at: null,
      fallback_reason: null,
      reassigned_at: nowIso,
      previous_operator: prevOperator || operator,
    };

    // Check if slaughter_records entry exists, if not create one
    const { data: existingSr } = await supabase
      .from(TABLES.SLAUGHTER_RECORDS)
      .select("id")
      .eq("tag_number", tag_number)
      .maybeSingle();

    if (existingSr?.id) {
      await supabase.from(TABLES.SLAUGHTER_RECORDS).update(slaughterPatch).eq("id", existingSr.id);
    } else {
      await supabase.from(TABLES.SLAUGHTER_RECORDS).insert({
        id: uuid(),
        tag_number,
        species: animal?.species || "Livestock",
        owner_name: animal?.owner_name || "Unknown Owner",
        scheduled_date: animal?.mark_date || nowIso.split("T")[0],
        slaughter_date: animal?.mark_date || nowIso.split("T")[0],
        status: "In Progress",
        operator,
        livestock_id: animal?.id || null,
        reassigned_at: nowIso,
      });
    }

    // Ensure entry in slaughter_processing so it immediately becomes an Active Floor Operation
    try {
      const { data: existingProc } = await supabase
        .from(TABLES.SLAUGHTER_PROCESSING)
        .select("id")
        .eq("tag_number", tag_number)
        .maybeSingle();

      const procDate = animal?.mark_date || nowIso.split("T")[0];
      const initialSteps = {
        bathing: false,
        stunning: false,
        bleeding: false,
        scalding: false,
        dehairing: false,
        washing: false,
        started_at: nowIso,
      };

      if (existingProc?.id) {
        await supabase
          .from(TABLES.SLAUGHTER_PROCESSING)
          .update({
            status: "In Progress",
            operator,
            previous_operator: prevOperator || operator,
            reassigned_at: nowIso,
            fallback_at: null,
            fallback_reason: null,
            date: procDate,
          })
          .eq("id", existingProc.id);
      } else {
        const procRow = {
          id: uuid(),
          tag_number,
          species: animal?.species || "Livestock",
          owner_name: animal?.owner_name || "Unknown Owner",
          operator,
          previous_operator: prevOperator || null,
          reassigned_at: nowIso,
          status: "In Progress",
          date: procDate,
          steps: initialSteps,
          notes: "",
          operator_id: actor.id,
          processed_by: actor.name,
          processed_by_user_id: actor.id,
          processed_at: nowIso,
        };
        let { error: procInsErr } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).insert(procRow);
        if (procInsErr && /column|schema cache/i.test(`${procInsErr.message || ""} ${procInsErr.details || ""}`)) {
          const { operator_id, processed_by, processed_by_user_id, processed_at, previous_operator, reassigned_at, ...fbRow } = procRow;
          await supabase.from(TABLES.SLAUGHTER_PROCESSING).insert(fbRow);
        }
      }
    } catch (procErr) {
      console.warn("Slaughter processing sync notice in assignSlaughterOperator:", procErr);
    }

    await safeUpdateLivestockWithHistory(
      animal?.id || null,
      tag_number,
      livestockPatch,
      {
        stage: "Slaughter",
        action: isReassignment ? "Operator Reassigned" : "Operator Assigned",
        details: {
          operator,
          tag_number,
          previous_operator: prevOperator,
          is_reassignment: isReassignment
        },
        actor,
      }
    );

    await logActivity({
      action: `Assigned operator ${operator} to ${tag_number}`,
      module: "Slaughter",
      notify: {
        title: "Operator Assigned",
        message: `${operator} assigned to ${tag_number} (${animal?.species || "Livestock"})`,
        type: "info",
      }
    });

    if (!options.skipNotify) {
      notifyChange(TABLES.SLAUGHTER_PROCESSING);
      notifyChange(TABLES.SLAUGHTER_RECORDS);
      notifyChange(TABLES.LIVESTOCK);
    }
    return { success: true, operator };
  },
  assignSlaughterOperatorBatch: async ({ tag_numbers = [], operator }) => {
    if (!Array.isArray(tag_numbers) || tag_numbers.length === 0) {
      throw new Error("At least one livestock record must be selected");
    }
    if (!operator) {
      throw new Error("Please select a slaughter team operator");
    }

    const cleanTags = tag_numbers.map((t) => String(t || "").trim()).filter(Boolean);
    if (cleanTags.length === 0) {
      throw new Error("At least one valid livestock tag must be selected");
    }

    // 1. Batch fetch all candidate animals at once to prevent sequential DB round-trips
    const { data: animals, error: lError } = await supabase
      .from(TABLES.LIVESTOCK)
      .select("id, tag_number, species, sex, quantity, owner_name, owner_id, status, fallback_at, reassigned_at, marked, previous_operator")
      .in("tag_number", cleanTags);

    if (lError) throw lError;
    const animalMap = new Map((animals || []).map((a) => [String(a.tag_number || "").toUpperCase(), a]));

    // 2. Batch fetch existing slaughter_processing rows
    const { data: existingProcRows } = await supabase
      .from(TABLES.SLAUGHTER_PROCESSING)
      .select("id, tag_number, status, operator, steps")
      .in("tag_number", cleanTags);
    const procMap = new Map((existingProcRows || []).map((p) => [String(p.tag_number || "").toUpperCase(), p]));

    const successes = [];
    const failures = [];
    const validAnimalsToProcess = [];

    for (const tag of cleanTags) {
      const animal = animalMap.get(tag.toUpperCase());
      if (!animal) {
        failures.push({ tag_number: tag, reason: `Livestock record ${tag} not found` });
        continue;
      }

      const lowerSt = String(animal.status || "").toLowerCase();
      if (lowerSt.includes("condemn") || lowerSt.includes("reject")) {
        failures.push({ tag_number: tag, reason: `Livestock ${tag} is condemned or rejected` });
        continue;
      }
      if (
        lowerSt === "completed" ||
        lowerSt === "slaughtered" ||
        lowerSt === "weighed" ||
        lowerSt === "paid" ||
        lowerSt === "released" ||
        lowerSt === "dispatched"
      ) {
        failures.push({ tag_number: tag, reason: `Livestock ${tag} has already completed slaughter or downstream stages` });
        continue;
      }

      const existingProc = procMap.get(tag.toUpperCase());
      const procSteps = existingProc?.steps || {};
      const isActivelyProcessing = Object.values(procSteps).some((v) => v === true || v?.done === true);
      if (isActivelyProcessing && existingProc?.status === "In Progress") {
        failures.push({ tag_number: tag, reason: `Livestock ${tag} is already being actively slaughtered on the floor` });
        continue;
      }

      validAnimalsToProcess.push(animal);
    }

    // 3. Process assignments concurrently in parallel with skipNotify: true
    if (validAnimalsToProcess.length > 0) {
      await Promise.all(
        validAnimalsToProcess.map(async (animal) => {
          try {
            await staffService.assignSlaughterOperator(
              {
                tag_number: animal.tag_number,
                operator,
              },
              { skipNotify: true }
            );

            successes.push({
              tag_number: animal.tag_number,
              owner_name: animal.owner_name || "Unknown Owner",
              species: animal.species || "Livestock",
              sex: animal.sex,
              head_count: Number(animal.quantity) || 1,
            });
          } catch (err) {
            failures.push({
              tag_number: animal.tag_number,
              reason: err.message || "Failed to assign operator",
            });
          }
        })
      );
    }

    // 4. Fire single consolidated notification after all records finish
    notifyChange(TABLES.SLAUGHTER_PROCESSING);
    notifyChange(TABLES.SLAUGHTER_RECORDS);
    notifyChange(TABLES.LIVESTOCK);

    return {
      success: failures.length === 0,
      total: tag_numbers.length,
      successes,
      failures,
      operator,
    };
  },
  completeSlaughterSingle: async ({ livestock_id = null, tag_number, operator = null, owner_name = null }) => {
    if (!tag_number && !livestock_id) {
      throw new Error("No livestock identifier provided");
    }
    const actor = getCurrentActor();
    const nowIso = new Date().toISOString();
    const completionDate = nowIso.split("T")[0];
    const cleanTag = tag_number ? String(tag_number).trim() : null;

    // 1. Locate and verify the livestock record from Supabase
    let animal = null;
    if (livestock_id) {
      const { data, error } = await supabase
        .from(TABLES.LIVESTOCK)
        .select("id, tag_number, status, species, sex, owner_name, previous_operator, created_at, process_history")
        .eq("id", livestock_id)
        .maybeSingle();
      if (!error && data) animal = data;
    }
    if (!animal && cleanTag) {
      const { data, error } = await supabase
        .from(TABLES.LIVESTOCK)
        .select("id, tag_number, status, species, sex, owner_name, previous_operator, created_at, process_history")
        .ilike("tag_number", cleanTag)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to query livestock record: ${error.message}`);
      }
      animal = data;
    }

    if (!animal) {
      throw new Error(`Livestock record ${cleanTag || livestock_id} not found in database`);
    }

    const st = String(animal.status || "").trim().toLowerCase();
    if (st === "condemned" || st === "rejected") {
      throw new Error(`Livestock ${animal.tag_number} is condemned/rejected and cannot be marked as slaughtered.`);
    }

    const effectiveId = animal.id;
    const effectiveTag = animal.tag_number || cleanTag;
    const effectiveOperator = operator || actor.name || "Team A";
    const effectiveOwner = animal.owner_name || owner_name || "Unknown Owner";

    // 2. Update LIVESTOCK table directly with history and verify database confirmation
    const currentHistory = parseHistory(animal.process_history);
    const updatedHistory = appendProcessEvent(currentHistory, {
      stage: "Slaughter",
      action: "Slaughter Processing Completed",
      details: {
        operator: effectiveOperator,
        owner_name: effectiveOwner,
        tag_number: effectiveTag,
        completed_individually: true,
      },
      actor,
    });

    const livestockPatch = {
      status: "Completed",
      slaughtered_by: actor.name,
      slaughtered_by_user_id: actor.id,
      slaughtered_at: nowIso,
      process_history: updatedHistory,
    };

    let { data: updatedLive, error: liveErr } = await supabase
      .from(TABLES.LIVESTOCK)
      .update(livestockPatch)
      .eq("id", effectiveId)
      .select("id, tag_number, status");

    if (liveErr) {
      if (/column|schema cache/i.test(`${liveErr.message || ""} ${liveErr.details || ""}`)) {
        const fbPatch = {
          status: "Completed",
          slaughtered_by: actor.name,
          slaughtered_at: nowIso,
        };
        const fbRes = await supabase.from(TABLES.LIVESTOCK).update(fbPatch).eq("id", effectiveId).select("id, tag_number, status");
        if (fbRes.error) throw new Error(`Database error updating livestock: ${fbRes.error.message}`);
        updatedLive = fbRes.data;
      } else {
        throw new Error(`Database error updating livestock: ${liveErr.message}`);
      }
    }

    if (!updatedLive || updatedLive.length === 0) {
      // Fallback check by tag_number if ID update didn't match a row
      const tagFallbackRes = await supabase
        .from(TABLES.LIVESTOCK)
        .update(livestockPatch)
        .ilike("tag_number", effectiveTag)
        .select("id, tag_number, status");
      if (tagFallbackRes.error) throw new Error(`Database error updating livestock: ${tagFallbackRes.error.message}`);
      if (!tagFallbackRes.data || tagFallbackRes.data.length === 0) {
        throw new Error(`Could not find livestock row in database to update for ${effectiveTag}`);
      }
    }

    // 3. Update SLAUGHTER_PROCESSING table
    const allStepsCompleted = {
      bathing: { done: true, completed_at: nowIso, completed_by: actor.name },
      stunning: { done: true, completed_at: nowIso, completed_by: actor.name },
      bleeding: { done: true, completed_at: nowIso, completed_by: actor.name },
      scalding: { done: true, completed_at: nowIso, completed_by: actor.name },
      dehairing: { done: true, completed_at: nowIso, completed_by: actor.name },
      washing: { done: true, completed_at: nowIso, completed_by: actor.name },
      completed_at: nowIso,
    };

    try {
      const { data: existingProc } = await supabase
        .from(TABLES.SLAUGHTER_PROCESSING)
        .select("id, steps")
        .ilike("tag_number", effectiveTag)
        .maybeSingle();

      if (existingProc?.id) {
        await supabase
          .from(TABLES.SLAUGHTER_PROCESSING)
          .update({
            status: "Completed",
            steps: allStepsCompleted,
            date: completionDate,
            processed_by: actor.name,
            processed_by_user_id: actor.id,
            processed_at: nowIso,
            operator: effectiveOperator,
          })
          .eq("id", existingProc.id);
      } else {
        await supabase
          .from(TABLES.SLAUGHTER_PROCESSING)
          .insert({
            id: uuid(),
            tag_number: effectiveTag,
            species: animal.species || "Livestock",
            owner_name: effectiveOwner,
            operator: effectiveOperator,
            status: "Completed",
            date: completionDate,
            steps: allStepsCompleted,
            processed_by: actor.name,
            processed_by_user_id: actor.id,
            processed_at: nowIso,
          });
      }
    } catch (procErr) {
      console.warn("Slaughter processing sync notice:", procErr);
    }

    // 4. Update SLAUGHTER_RECORDS table
    try {
      await supabase
        .from(TABLES.SLAUGHTER_RECORDS)
        .update({
          status: "Completed",
          slaughter_date: completionDate,
          operator: effectiveOperator,
        })
        .ilike("tag_number", effectiveTag);
    } catch (srErr) {
      console.warn("Slaughter records update notice:", srErr);
    }

    // 5. Activity log
    try {
      await logActivity({
        action: `Marked livestock ${effectiveTag} as done (Slaughtered)`,
        module: "Slaughter",
        notify: {
          title: "Slaughter Completed",
          message: `${effectiveTag} marked as done — ready for post-mortem inspection`,
          type: "success",
        },
      });
    } catch (_) {}

    // 6. Broadcast real-time notifications
    notifyChange(TABLES.LIVESTOCK, "update", { id: effectiveId, tag: effectiveTag, status: "Completed" });
    notifyChange(TABLES.SLAUGHTER_PROCESSING, "update", { tag: effectiveTag, status: "Completed" });
    notifyChange(TABLES.SLAUGHTER_RECORDS, "update", { tag: effectiveTag, status: "Completed" });
    notifyChange(TABLES.POST_MORTEM, "update", { tag: effectiveTag, status: "Completed" });

    return {
      success: true,
      id: effectiveId,
      tag_number: effectiveTag,
      status: "Completed",
    };
  },
  completeSlaughterGroup: async ({ owner_name, group_key, items = [], tag_numbers = [], operator = null }) => {
    // Determine target list from provided items or tag_numbers
    let targets = [];
    if (Array.isArray(items) && items.length > 0) {
      targets = items.map((i) => ({
        id: i.livestock_id || i.id || null,
        livestock_id: i.livestock_id || i.id || null,
        tag_number: i.tag_number ? String(i.tag_number).trim() : null,
        operator: i.operator || operator,
        owner_name: i.owner_name || owner_name,
      })).filter((i) => i.tag_number || i.id);
    } else if (Array.isArray(tag_numbers) && tag_numbers.length > 0) {
      targets = tag_numbers.map((t) => ({
        tag_number: String(t || "").trim(),
        operator,
        owner_name,
      })).filter((i) => i.tag_number);
    }

    if (targets.length === 0) {
      throw new Error("No livestock records provided for batch completion");
    }

    const successes = [];
    const failures = [];

    // Process every animal using the validated completeSlaughterSingle transition logic
    for (const target of targets) {
      try {
        const res = await staffService.completeSlaughterSingle({
          livestock_id: target.livestock_id || target.id,
          tag_number: target.tag_number,
          operator: target.operator,
          owner_name: target.owner_name,
        });

        if (res?.success) {
          successes.push({
            id: res.id,
            tag_number: res.tag_number || target.tag_number,
          });
        } else {
          failures.push({
            tag: target.tag_number || target.id,
            reason: "Database did not confirm row update",
          });
        }
      } catch (err) {
        console.error(`Batch slaughter failure for ${target.tag_number || target.id}:`, err);
        failures.push({
          tag: target.tag_number || target.id,
          reason: err.message || "Database update failed",
        });
      }
    }

    if (successes.length === 0 && failures.length > 0) {
      throw new Error(`Failed to mark records as done: ${failures.map((f) => `${f.tag} (${f.reason})`).join("; ")}`);
    }

    // Consolidated audit log for the batch action
    if (successes.length > 0) {
      try {
        await logActivity({
          action: `Completed slaughter for ${owner_name || "Owner"} (${successes.length} heads)`,
          module: "Slaughter",
          notify: {
            title: "Slaughter Group Completed",
            message: `${successes.length} livestock for ${owner_name || "Owner"} marked as done — ready for post-mortem inspection`,
            type: "success",
          },
        });
      } catch (_) {}
    }

    return {
      success: failures.length === 0,
      total_requested: targets.length,
      completed_count: successes.length,
      successes,
      failures,
    };
  },
  createProcessing: async (p) => {
    let animal = null;
    if (p.tag_number) {
      const { data: animals } = await supabase.from(TABLES.LIVESTOCK).select().eq("tag_number", p.tag_number);
      animal = animals?.[0];
      if (animal && (animal.status === "Condemned" || animal.status === "Rejected")) {
        throw new Error(`Livestock ${p.tag_number} is officially CONDEMNED. File is final. No slaughter processing permitted.`);
      }
    }

    const nowObj = new Date();
    const startDate = nowObj.toISOString().split("T")[0];
    const startedAt = p.started_at || p.slaughter_started_at || p.steps?.started_at || nowObj.toISOString();

    const isReassignment = Boolean(
      animal?.fallback_at &&
      (!animal?.reassigned_at || new Date(animal.fallback_at) > new Date(animal.reassigned_at))
    );

    const stepsPayload = {
      ...(p.steps || {}),
      started_at: p.steps?.started_at || startedAt,
    };

    const actor = getCurrentActor();
    const operatorName = p.operator || actor.name || "Assigned Operator";
    const dbRow = {
      id: p.id || uuid(),
      tag_number: p.tag_number,
      species: p.species || "Livestock",
      owner_name: p.owner_name || "Unknown Owner",
      operator: operatorName,
      previous_operator: isReassignment ? (animal?.previous_operator || animal?.operator || null) : null,
      reassigned_at: isReassignment ? startedAt : null,
      operator_id: actor.id,
      processed_by: actor.name,
      processed_by_user_id: actor.id,
      processed_at: startedAt,
      status: "In Progress",
      date: p.date || startDate,
      steps: stepsPayload,
      notes: p.notes || "",
    };
    
    let { error: insErr } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).insert(dbRow);
    if (insErr && /column|schema cache/i.test(`${insErr.message || ""} ${insErr.details || ""}`)) {
      const { operator_id, processed_by, processed_by_user_id, processed_at, previous_operator, reassigned_at, ...fbRow } = dbRow;
      const res = await supabase.from(TABLES.SLAUGHTER_PROCESSING).insert(fbRow);
      insErr = res.error;
    }
    if (insErr) throw insErr;

    const livestockPatch = { status: "In Progress" };
    if (isReassignment) {
      livestockPatch.reassigned_at = startedAt;
      if (animal?.previous_operator || animal?.operator) {
        livestockPatch.previous_operator = animal?.previous_operator || animal?.operator;
      }
    }

    const slaughterPatch = {
      status: "In Progress",
      operator: operatorName,
      slaughter_date: startDate,
    };
    if (isReassignment) {
      slaughterPatch.reassigned_at = startedAt;
    }

    await Promise.allSettled([
      supabase.from(TABLES.SLAUGHTER_RECORDS).update(slaughterPatch).ilike("tag_number", p.tag_number),
      safeUpdateLivestockWithHistory(
        null,
        p.tag_number,
        livestockPatch,
        {
          stage: "Slaughter",
          action: isReassignment ? "Operator Reassigned After Fallback" : "Slaughter Processing Started",
          details: {
            operator: operatorName,
            tag_number: p.tag_number,
            previous_operator: animal?.previous_operator || animal?.operator || null,
            is_reassignment: isReassignment
          },
          actor,
        }
      ),
      logActivity({
        action: isReassignment
          ? `Reassigned operator to ${operatorName} for fallback livestock ${p.tag_number} and started processing`
          : `Started slaughter processing for ${p.tag_number}`,
        module: "Slaughter",
        notify: {
          title: isReassignment ? "Operator Reassigned" : "Slaughter Started",
          message: isReassignment
            ? `New operator ${operatorName} assigned for ${p.tag_number} (${p.species})`
            : `Processing started for ${p.tag_number} (${p.species})`,
          type: "info",
        },
      }).catch((err) => console.warn("Log activity error in createProcessing:", err)),
    ]);

    notifyChange(TABLES.SLAUGHTER_PROCESSING, "insert", dbRow);
    return { data: { ...dbRow, started_at: startedAt, slaughter_started_at: startedAt } };
  },

  updateProcessing: async (id, patch, tag, currentUser = null) => {
    const effectiveTag = tag || (typeof id === "string" && id.startsWith("TAG-") ? id : null);
    const actor = getCurrentActor();

    const dbPatch = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.operator !== undefined) dbPatch.operator = patch.operator;
    if (patch.date !== undefined) dbPatch.date = patch.date;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    if (patch.operator) {
      dbPatch.processed_by = actor.name;
      dbPatch.processed_by_user_id = actor.id;
    }

    if (patch.steps !== undefined) {
      let existingStartedAt = patch.steps?.started_at || patch.started_at || patch.slaughter_started_at;
      let existingCompletedAt = patch.steps?.completed_at || patch.completed_at || patch.slaughter_completed_at;

      try {
        let existingSteps = null;
        if (id) {
          const { data: existing } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).select("steps").eq("id", id).maybeSingle();
          existingSteps = existing?.steps;
        }
        if (!existingSteps && effectiveTag) {
          const { data: existing } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).select("steps").ilike("tag_number", effectiveTag).maybeSingle();
          existingSteps = existing?.steps;
        }

        if (existingSteps) {
          const parsedExisting = typeof existingSteps === "string" ? JSON.parse(existingSteps) : existingSteps;
          if (!existingStartedAt && parsedExisting?.started_at) {
            existingStartedAt = parsedExisting.started_at;
          }
          if (!existingCompletedAt && parsedExisting?.completed_at) {
            existingCompletedAt = parsedExisting.completed_at;
          }
        }
      } catch (_) {}

      dbPatch.steps = {
        ...patch.steps,
        ...(existingStartedAt ? { started_at: existingStartedAt } : {}),
        ...(existingCompletedAt ? { completed_at: existingCompletedAt } : {}),
      };
    }

    let updated = false;
    let lastError = null;
    if (id) {
      let { data, error } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).update(dbPatch).eq("id", id).select();
      if (error && /column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
        const { processed_by, processed_by_user_id, ...fbPatch } = dbPatch;
        const res = await supabase.from(TABLES.SLAUGHTER_PROCESSING).update(fbPatch).eq("id", id).select();
        data = res.data;
        error = res.error;
      }
      if (error) lastError = error;
      if (!error && Array.isArray(data) && data.length > 0) updated = true;
    }
    if (!updated && effectiveTag) {
      let { data, error } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).update(dbPatch).ilike("tag_number", effectiveTag).select();
      if (error && /column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
        const { processed_by, processed_by_user_id, ...fbPatch } = dbPatch;
        const res = await supabase.from(TABLES.SLAUGHTER_PROCESSING).update(fbPatch).ilike("tag_number", effectiveTag).select();
        data = res.data;
        error = res.error;
      }
      if (error) lastError = error;
      if (!error && Array.isArray(data) && data.length > 0) updated = true;
    }

    if (!updated && effectiveTag) {
      try {
        const { data: liveData } = await supabase.from(TABLES.LIVESTOCK).select("*").ilike("tag_number", effectiveTag).maybeSingle();
        const nowObj = new Date();
        const startDate = nowObj.toISOString().split("T")[0];
        const initialStartedAt = patch.started_at || patch.slaughter_started_at || dbPatch.steps?.started_at || nowObj.toISOString();
        const newRow = {
          id: uuid(),
          tag_number: effectiveTag,
          species: liveData?.species || "Livestock",
          owner_name: liveData?.owner_name || "Unknown Owner",
          operator: patch.operator || liveData?.operator || actor.name || "Team A",
          status: patch.status || "In Progress",
          date: patch.date || startDate,
          steps: {
            ...(dbPatch.steps || patch.steps || {}),
            started_at: initialStartedAt,
          },
          notes: patch.notes || "",
        };
        const { error: insErr } = await supabase.from(TABLES.SLAUGHTER_PROCESSING).insert(newRow);
        if (!insErr) {
          updated = true;
        } else {
          lastError = insErr;
          console.warn("Slaughter processing insert notice:", insErr.message || insErr);
        }
      } catch (err) {
        lastError = err;
        console.warn("Slaughter processing insert fallback error:", err);
      }
    }

    // Always sync in-progress steps to livestock process history so steps persist reliably
    if (effectiveTag && patch.steps) {
      try {
        await safeUpdateLivestockWithHistory(
          id,
          effectiveTag,
          {},
          {
            stage: "Slaughter",
            action: patch.status === "Completed" ? "Slaughter Processing Completed" : "Slaughter Steps Updated",
            details: {
              steps: patch.steps,
              operator: patch.operator || actor.name,
              tag_number: effectiveTag,
              status: patch.status || "In Progress",
            },
            actor,
          }
        );
      } catch (syncErr) {
        console.warn("Notice: could not sync slaughter steps to livestock history:", syncErr);
      }
    }

    if (patch.status === "Completed") {
      const nowIso = new Date().toISOString();
      const endDate = nowIso.split("T")[0];
      const completionTasks = [];

      if (effectiveTag) {
        completionTasks.push((async () => {
          try {
            await supabase.from(TABLES.SLAUGHTER_RECORDS).update({
              status: "Completed",
              slaughter_date: endDate,
            }).ilike("tag_number", effectiveTag.trim());
          } catch (err) {
            console.warn("Slaughter records complete error:", err);
          }
        })());

        completionTasks.push(
          safeUpdateLivestockWithHistory(
            id,
            effectiveTag,
            {
              status: "Completed",
              slaughtered_by: actor.name,
              slaughtered_by_user_id: actor.id,
              slaughtered_at: nowIso,
            },
            {
              stage: "Slaughter",
              action: "Slaughter Processing Completed",
              details: { operator: patch.operator || actor.name, tag_number: effectiveTag },
              actor,
            }
          )
        );
      } else if (id) {
        completionTasks.push(
          safeUpdateLivestockWithHistory(
            id,
            null,
            {
              status: "Completed",
              slaughtered_by: actor.name,
              slaughtered_by_user_id: actor.id,
              slaughtered_at: nowIso,
            },
            {
              stage: "Slaughter",
              action: "Slaughter Processing Completed",
              details: { operator: patch.operator || actor.name },
              actor,
            }
          )
        );
      }

      completionTasks.push((async () => {
        try {
          await logActivity({
            action: `Completed slaughter processing for ${effectiveTag || id}`,
            module: "Slaughter",
            notify: {
              title: "Slaughter Completed",
              message: `${effectiveTag || id} processing complete — ready for post-mortem inspection`,
              type: "success",
            },
          });
        } catch (err) {
          console.warn("Log activity error in updateProcessing:", err);
        }
      })());

      await Promise.allSettled(completionTasks);
      notifyChange(TABLES.LIVESTOCK, "update", { id, tag: effectiveTag, status: "Completed" });
      notifyChange(TABLES.SLAUGHTER_RECORDS, "update", { tag: effectiveTag, status: "Completed" });
      notifyChange(TABLES.POST_MORTEM, "update", { tag: effectiveTag, status: "Completed" });
    } else if (!updated && lastError && !/row-level security/i.test(lastError.message || "")) {
      // If in progress and failed for a non-RLS fatal reason, report error
      throw lastError;
    }

    notifyChange(TABLES.SLAUGHTER_PROCESSING, "update", { id, tag: effectiveTag, ...dbPatch });
    return { data: patch };
  },

  // Carcass
  listCarcass: () => getDbRows(TABLES.CARCASS),
  listCarcassBranding: () => getDbRows(TABLES.CARCASS_BRANDING),
  createCarcass: async (p) => {
    const isUuid = (val) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    const rowId = isUuid(p.id) ? p.id : uuid();
    const nowIso = p.weighed_at || p.created_at || new Date().toISOString();
    const actor = getCurrentActor();
    const row = { ...p, id: rowId, date: p.date || today(), weighed_at: nowIso, created_at: nowIso };
    
    const brandCodeVal = (() => {
      const c = String(row.brand_code || "").trim();
      if (c && c.startsWith("CAR-2026-") && c.length >= 10) return c;
      const numPart = String(c || row.tag_number || "").replace(/\D/g, "").padStart(3, "0");
      return numPart ? `CAR-2026-${numPart}` : `CAR-2026-001`;
    })();

    const dbPayload = {
      id: row.id,
      tag_number: String(row.tag_number || "").trim(),
      slaughter_id: row.slaughter_id || "SL000",
      quantity: parseInt(row.quantity, 10) || 1,
      total_weight: parseFloat(row.total_weight) || parseFloat(row.cold_weight) || 0,
      hot_weight: parseFloat(row.hot_weight ?? row.total_weight ?? row.cold_weight) || 0,
      cold_weight: parseFloat(row.cold_weight ?? row.total_weight) || 0,
      organ_weight: parseFloat(row.organ_weight || 0) || 0,
      grade: row.grade || "A",
      brand_code: brandCodeVal,
      branding_status: row.branding_status || "Branded",
      brand_method: row.brand_method || "Official Meat Inspection Stamp (Food-Grade Ink)",
      operator: row.operator || actor.name || "Dr. Dave",
      weighed_by: actor.name || "Dr. Dave",
      weighed_by_user_id: actor.id || null,
      date: row.date || today(),
      weighed_at: nowIso,
      created_at: nowIso,
    };

    // 1. Try atomic RPC first (SECURITY DEFINER transaction)
    let usedRpc = false;
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("record_carcass_weighing", {
        p_tag_number: dbPayload.tag_number,
        p_total_weight: dbPayload.total_weight,
        p_hot_weight: dbPayload.hot_weight,
        p_cold_weight: dbPayload.cold_weight,
        p_grade: dbPayload.grade,
        p_brand_code: dbPayload.brand_code,
        p_branding_status: dbPayload.branding_status,
        p_brand_method: dbPayload.brand_method,
        p_slaughter_id: dbPayload.slaughter_id,
        p_operator: dbPayload.operator,
        p_weighed_by: dbPayload.weighed_by,
        p_weighed_by_user_id: dbPayload.weighed_by_user_id,
        p_weighed_at: dbPayload.weighed_at,
        p_livestock_id: p.livestock_id || null,
        p_notes: p.notes || `Official Meat Inspection Stamp recorded during Carcass Weighing via ${dbPayload.brand_method}`,
      });

      if (!rpcErr && rpcData?.success) {
        usedRpc = true;
      } else if (rpcErr) {
        if (rpcErr.message && /already weighed/i.test(rpcErr.message)) {
          throw new Error(`Carcass for ${dbPayload.tag_number} is already weighed`);
        }
        if (rpcErr.code !== "PGRST202") {
          console.warn("RPC record_carcass_weighing warning, falling back to direct operations:", rpcErr);
        }
      }
    } catch (rpcEx) {
      if (/already weighed/i.test(rpcEx?.message || "")) throw rpcEx;
      console.warn("RPC attempt threw:", rpcEx);
    }

    // 2. Fallback to direct table operations if RPC not yet installed
    if (!usedRpc) {
      const { data: existingCarcass, error: existingErr } = await supabase
        .from(TABLES.CARCASS)
        .select("id")
        .eq("tag_number", dbPayload.tag_number)
        .limit(1);
      if (existingErr) throw existingErr;
      if (Array.isArray(existingCarcass) && existingCarcass.length > 0) {
        throw new Error(`Carcass for ${dbPayload.tag_number} is already weighed`);
      }

      let { error } = await supabase.from(TABLES.CARCASS).insert(dbPayload);
      if (error && /brand_code|branding_status|brand_method|weighed_by|weighed_at|created_at|column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
        const { brand_code, branding_status, brand_method, ...fallbackPayload1 } = dbPayload;
        ({ error } = await supabase.from(TABLES.CARCASS).insert(fallbackPayload1));
        if (error && /weighed_by|weighed_at|created_at|column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
          const { weighed_by, weighed_by_user_id, weighed_at, created_at, ...basePayload } = fallbackPayload1;
          ({ error } = await supabase.from(TABLES.CARCASS).insert(basePayload));
        }
      }
      if (error) {
        console.error("Supabase carcass insert error:", error);
        if (error.code === "42501") {
          throw new Error(
            `Database Permission Error (RLS 42501): The 'vet' role is blocked from inserting into 'carcass_records'. Please execute 'fix_carcass_weighing_and_branding.sql' in the Supabase SQL Editor to grant veterinary write access.`
          );
        }
        throw error;
      }

      // Check if branding record already exists to prevent duplicate key constraint violations
      try {
        const { data: existingBrand } = await supabase
          .from(TABLES.CARCASS_BRANDING)
          .select("id")
          .eq("carcass_id", row.id)
          .eq("branding_type", p.branding_type || "INSPECTED_AND_PASSED")
          .maybeSingle();

        if (!existingBrand) {
          const { error: bErr } = await supabase.from(TABLES.CARCASS_BRANDING).insert({
            carcass_id: row.id,
            livestock_id: p.livestock_id || null,
            tag_number: String(row.tag_number || "").trim(),
            branding_code: dbPayload.brand_code && dbPayload.brand_code.trim() !== "" ? dbPayload.brand_code : undefined,
            branding_type: p.branding_type || "INSPECTED_AND_PASSED",
            branding_status: "BRANDED",
            branded_at: nowIso,
            branded_by: actor.id || null,
            notes: p.notes || `Official Meat Inspection Stamp recorded during Carcass Weighing via ${dbPayload.brand_method || "Official Stamp"}`,
          });
          if (bErr) console.warn("Carcass branding insert error:", bErr);
        }
      } catch (bCatch) {
        console.warn("Branding insert check exception:", bCatch);
      }

      await Promise.allSettled([
        supabase.from(TABLES.SLAUGHTER_RECORDS).update({ status: "Completed", slaughter_date: today() }).eq("tag_number", p.tag_number),
        supabase.from(TABLES.SLAUGHTER_PROCESSING).update({ status: "Completed" }).eq("tag_number", p.tag_number),
      ]);
    }

    const timeFormatted = new Date(nowIso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    await Promise.allSettled([
      safeUpdateLivestockWithHistory(
        null,
        p.tag_number,
        {
          weight: dbPayload.cold_weight || dbPayload.total_weight,
          status: "Weighed",
          workflow_status: "WEIGHED",
          weighed_by: actor.name,
          weighed_by_user_id: actor.id,
          weighed_at: nowIso,
        },
        {
          stage: "Carcass Weighing & Branding",
          action: `Carcass Weighed (${dbPayload.cold_weight}kg, Grade ${dbPayload.grade}) & Branded (${dbPayload.brand_code})`,
          details: {
            weight: dbPayload.cold_weight,
            hot_weight: dbPayload.hot_weight,
            grade: dbPayload.grade,
            brand_code: dbPayload.brand_code,
            branding_status: dbPayload.branding_status,
            brand_method: dbPayload.brand_method,
          },
          actor: { ...actor, role: actor.role || "vet" },
        }
      ),
      logActivity({
        action: `Recorded carcass weight and branding for ${p.tag_number} (${dbPayload.cold_weight}kg, Brand: ${dbPayload.brand_code}) at ${timeFormatted}`,
        module: "Weighing",
        notify: {
          title: "Carcass Weighed & Branded",
          message: `${p.tag_number} weighed: ${p.cold_weight || p.total_weight}kg (Grade ${p.grade}, Brand: ${dbPayload.brand_code}) by ${actor.name} at ${timeFormatted}`,
          type: "info",
          owner_id: p.owner_id || null,
        },
      }).catch((err) => console.warn("Log activity error in createCarcass:", err)),
    ]);

    notifyChange(TABLES.CARCASS, "insert", row);
    return row;
  },

  updateCarcass: async (id, patch) => {
    const actor = getCurrentActor();
    const nowIso = new Date().toISOString();
    const dbPatch = { ...patch };
    delete dbPatch.weightVal;
    delete dbPatch.owner_contact;
    delete dbPatch.owner_address;
    delete dbPatch.inspectionDecision;
    delete dbPatch.postMortemRecord;
    delete dbPatch.postMortemDate;
    delete dbPatch.isPartialCondemned;

    let { error } = await supabase.from(TABLES.CARCASS).update(dbPatch).eq("id", id);
    if (error && /brand_code|branding_status|brand_method|column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const { brand_code, branding_status, brand_method, ...basePatch } = dbPatch;
      ({ error } = await supabase.from(TABLES.CARCASS).update(basePatch).eq("id", id));
    }
    if (error) {
      console.error("Supabase carcass update error:", error);
      throw error;
    }

    if (patch.tag_number && (patch.total_weight || patch.cold_weight)) {
      const wVal = parseFloat(patch.total_weight || patch.cold_weight);
      await Promise.allSettled([
        safeUpdateLivestockWithHistory(
          null,
          patch.tag_number,
          {
            weight: wVal,
            weighed_by: actor.name,
            weighed_by_user_id: actor.id,
            weighed_at: nowIso,
          },
          {
            stage: "Carcass Weighing & Branding",
            action: `Carcass Weight & Branding Corrected (${wVal}kg, Grade ${patch.grade || "A"})`,
            details: {
              weight: wVal,
              brand_code: patch.brand_code,
              branding_status: patch.branding_status,
              grade: patch.grade,
            },
            actor: { ...actor, role: actor.role || "vet" },
          }
        ),
        logActivity({
          action: `Corrected carcass weighing details for ${patch.tag_number} (${wVal}kg) by ${actor.name}`,
          module: "Weighing",
          notify: {
            title: "Carcass Weighing Corrected",
            message: `${patch.tag_number} weight corrected: ${wVal}kg by ${actor.name}`,
            type: "info",
          },
        }),
      ]);
    }

    notifyChange(TABLES.CARCASS, "update", { id, ...dbPatch });
    return { data: { id, ...dbPatch } };
  },

  // Payments
  listPayments: () => getDbRows(TABLES.PAYMENTS),
  createPayment: async (p) => {
    const actor = getCurrentActor();
    const receipt = await getNextReceiptNumber();
    const nowIso = new Date().toISOString();
    const row = {
      id: uuid(),
      date: today(),
      status: "Paid",
      receipt_no: receipt,
      paid_at: nowIso,
      created_at: nowIso,
      staff_name: actor.name,
      staff_id: actor.id,
      processed_by_user_id: actor.id,
      ...p,
    };
    let { error } = await supabase.from(TABLES.PAYMENTS).insert(row);
    if (error && /column|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) {
      const { staff_id, processed_by_user_id, ...fbRow } = row;
      const res = await supabase.from(TABLES.PAYMENTS).insert(fbRow);
      error = res.error;
    }
    if (error) {
      console.error("Supabase payment insert error:", error);
      throw error;
    }

    const paymentTasks = [];
    if (p.tag_number) {
      paymentTasks.push(
        safeUpdateLivestockWithHistory(
          null,
          p.tag_number,
          {
            status: "Paid",
            paid_by_staff: actor.name,
            paid_by_user_id: actor.id,
            paid_at: nowIso,
          },
          {
            stage: "Payments",
            action: `Slaughter Fee Payment Recorded (Receipt ${receipt} - ₱${Number(p.amount || 0).toLocaleString()})`,
            details: { receipt_no: receipt, amount: p.amount, method: p.method },
            actor,
          }
        )
      );
    }

    paymentTasks.push(
      logActivity({
        action: `Recorded payment ${receipt} for ${p.tag_number || p.animal_type || "Livestock"}`,
        module: "Payments",
        tag_number: p.tag_number || null,
        notify: {
          title: "Payment Received",
          message: `Payment of ₱${Number(p.amount).toLocaleString()} recorded for ${p.tag_number || p.owner_name}`,
          type: "success",
          owner_id: p.owner_id || null,
        },
      }).catch((err) => console.warn("Log activity error in createPayment:", err))
    );

    await Promise.allSettled(paymentTasks);

    notifyChange(TABLES.PAYMENTS, "insert", row);
    return { data: row };
  },

  // Notifications
  listNotifications: () => getDbRows(TABLES.NOTIFICATIONS),
};
