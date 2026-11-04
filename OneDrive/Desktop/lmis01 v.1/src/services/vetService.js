import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES } from "../utils/constants";
import { uuid, today } from "../utils/helpers";
import { authService } from "./authService";
import { logActivity } from "./activityService";
import { getCurrentActor, appendProcessEvent, parseHistory } from "../utils/processHistory";
import { staffService } from "./staffService";
import { adminService } from "./adminService";

// Fire database change notification to update all mounted hooks locally, cross-tab, and cross-browser.
const notifyChange = (table = TABLES.ANTE_MORTEM, action = "update", record = null) => {
  notifyDbChange(table, action, record);
};

// A single stalled network call must never leave a Delete button spinning forever.
// Every awaited Supabase/storage call in the delete paths is wrapped in this.
const DEFAULT_TIMEOUT_MS = 15000;
const withTimeout = (promise, ms = DEFAULT_TIMEOUT_MS, label = "request") =>
  Promise.race([
    Promise.resolve(promise).then((v) => ({ timedOut: false, value: v })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true, error: new Error(`${label} timed out after ${ms}ms`) }), ms)
    ),
  ]);

// condemnation_records has no stage column, so the stage is derived from `part` exactly
// like the UI does: "Live Animal" is an Ante-Mortem rejection/rejection-of-intake,
// every other part is a Post-Mortem condemnation.
const condemnationStageOf = (row) => {
  if (!row) return null;
  const explicit = `${row.inspection_type || ""} ${row.stage || ""} ${row.type || ""}`.toLowerCase();
  if (explicit.includes("ante")) return "Ante-Mortem";
  if (explicit.includes("post")) return "Post-Mortem";
  const part = String(row.part || "").trim().toLowerCase();
  if (part === "live animal") return "Ante-Mortem";
  if (part.includes("whole carcass") || part.includes("entire carcass")) return "Post-Mortem";
  return "Post-Mortem";
};

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

const getDbRows = async (table) => {
  try {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      console.warn(`Supabase ${table} select error:`, error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`Supabase ${table} fetch error:`, err);
    return [];
  }
};

const LIVESTOCK_WRITABLE_COLUMNS = [
  "status", "owner_name", "marked", "mark_type", "mark_date",
  "ante_inspected_by", "ante_inspected_by_user_id", "ante_inspected_at",
  "post_inspected_by", "post_inspected_by_user_id", "post_inspected_at",
  "process_history"
];

const CORE_LIVESTOCK_COLUMNS = ["status", "owner_name", "marked", "mark_type", "mark_date"];

const isMissingColumnError = (error) =>
  /PGRST204|42703|column|schema cache/i.test(`${error?.code || ""} ${error?.message || ""}`);

/**
 * Writes a livestock patch to Supabase, retrying with only the core columns that
 * always exist if the full patch is rejected for missing attribution columns.
 */
const persistLivestockPatch = async (patch, apply) => {
  const safe = Object.fromEntries(
    Object.entries(patch || {}).filter(([k]) => LIVESTOCK_WRITABLE_COLUMNS.includes(k))
  );

  if (Object.keys(safe).length === 0) return true;

  try {
    const res = await apply(safe);
    if (res?.error && isMissingColumnError(res.error)) {
      const coreSafe = Object.fromEntries(
        Object.entries(patch || {}).filter(([k]) => CORE_LIVESTOCK_COLUMNS.includes(k))
      );
      if (Object.keys(coreSafe).length > 0) {
        const coreRes = await apply(coreSafe);
        return !coreRes?.error;
      }
      return false;
    }
    if (res?.error) {
      console.warn("vetService: livestock status write to Supabase failed:", res.error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("vetService: livestock status write to Supabase threw:", e);
    return false;
  }
};

export const vetService = {
  listLivestock: async () => {
    return await getDbRows(TABLES.LIVESTOCK);
  },
  listAnteMortem: async () => {
    return await getDbRows(TABLES.ANTE_MORTEM);
  },
  listPostMortem: async () => {
    return await getDbRows(TABLES.POST_MORTEM);
  },
  listInspections: async () => {
    const [a, p] = await Promise.all([
      getDbRows(TABLES.ANTE_MORTEM),
      getDbRows(TABLES.POST_MORTEM),
    ]);
    return [
      ...a.map((item) => ({ ...item, type: "Ante-Mortem" })),
      ...p.map((item) => ({ ...item, type: "Post-Mortem" })),
    ];
  },

  createInspection: async (type, payload) => {
    await adminService.assertActiveSession();
    const table = type === "Ante-Mortem" ? TABLES.ANTE_MORTEM : TABLES.POST_MORTEM;
    
    // Ensure the inspector is a Veterinarian (never staff), falling back to Vet name 'Dr. Dave'
    const session = authService.getSession();
    const actor = getCurrentActor();
    const inspector = (session && session.role === "vet") ? session.name : (actor.role === "vet" ? actor.name : (payload.inspector_name || "Dr. Dave"));
    const inspectorId = actor.id || session?.id || session?.user_id || null;
    
    // Generate sequential unique ID padded to 5 digits (e.g. 00001)
    let formattedId = payload.id;
    if (!formattedId) {
      let nextNum = 1;
      try {
        const { data: existing } = await supabase
          .from(table)
          .select("id")
          .order("id", { ascending: false })
          .limit(30);
        const existingNums = (existing || []).map((e) => parseInt(e.id, 10)).filter((n) => !isNaN(n));
        nextNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
        const existingIds = new Set((existing || []).map((e) => String(e.id)));
        while (existingIds.has(String(nextNum).padStart(5, "0"))) {
          nextNum++;
        }
      } catch (_) {}
      formattedId = String(nextNum).padStart(5, "0");
    }

    // Build findings text if parts are specified
    let effectiveFindings = payload.findings || "None";
    if (payload.condemned_parts && payload.condemned_parts.length > 0) {
      const partsSummary = payload.condemned_parts.map((p) => `${p.part} (${p.weight || p.weight_kg} kg)`).join(", ");
      if (!effectiveFindings.includes(partsSummary)) {
        effectiveFindings = `${effectiveFindings} · Condemned cuts: ${partsSummary}`;
      }
    }

    const nowObj = new Date();
    const nowIso = nowObj.toISOString();
    const nowTime = nowObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const isApproval = payload.decision === "Approved" || payload.decision === "Passed";
    const isRejection = payload.decision === "Rejected" || payload.decision === "Condemned" || payload.decision === "Whole Carcass Condemned";

    // Clean payload matching exact database columns
    const dbPayload = {
      id: formattedId,
      date: payload.date || today(),
      inspected_at: payload.inspected_at || nowIso,
      inspector_name: inspector,
      inspector_id: inspectorId,
      created_by_user_id: inspectorId,
      tag_number: payload.tag_number || null,
      species: payload.species || null,
      livestock_id: payload.livestock_id || null,
      findings: effectiveFindings,
      decision: payload.decision || "Approved",
      remarks: payload.remarks || "",
      // Post-Mortem inspections persist their raw decision + condemned parts
      ...(type === "Post-Mortem"
        ? {
            raw_decision: payload.raw_decision || payload.decision || null,
            condemned_parts: (Array.isArray(payload.condemned_parts) ? payload.condemned_parts : []).map(
              (p) => ({ ...p, photo: undefined, photos: undefined, dataUrl: undefined, data_url: undefined })
            ),
          }
        : {}),
    };

    let dbRes = null;
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      dbPayload.id = formattedId;
      dbRes = await supabase.from(table).insert(dbPayload).select();

      if (dbRes.error && /inspector_id|created_by_user_id|column|schema cache/i.test(`${dbRes.error.message || ""} ${dbRes.error.details || ""}`)) {
        const { inspector_id, created_by_user_id, ...pWithoutAttribution } = dbPayload;
        dbRes = await supabase.from(table).insert(pWithoutAttribution).select();
      }

      if (dbRes.error && /duplicate key|unique constraint|pkey/i.test(`${dbRes.error.message || ""} ${dbRes.error.details || ""}`)) {
        try {
          const { data: latest } = await supabase.from(table).select("id").order("id", { ascending: false }).limit(30);
          const lNums = (latest || []).map((e) => parseInt(e.id, 10)).filter((n) => !isNaN(n));
          const retryNum = (lNums.length ? Math.max(...lNums) : parseInt(formattedId, 10) || 1) + 1 + attempt;
          formattedId = String(retryNum).padStart(5, "0");
          continue;
        } catch (_) {}
      }

      if (!dbRes.error) {
        break;
      }
    }

    if (dbRes?.error) {
      console.warn(`Supabase ${type} inspection insert with full payload failed, retrying with core payload:`, dbRes.error);
      const corePayload = {
        id: formattedId,
        date: payload.date || today(),
        inspected_at: payload.inspected_at || nowIso,
        inspector_name: inspector,
        tag_number: payload.tag_number || null,
        species: payload.species || null,
        livestock_id: payload.livestock_id || null,
        findings: effectiveFindings,
        decision: payload.decision || "Approved",
        remarks: payload.remarks || "",
        ...(type === "Post-Mortem" ? { raw_decision: payload.raw_decision || payload.decision || null } : {}),
      };
      dbRes = await supabase.from(table).insert(corePayload).select();
    }

    if (dbRes?.error) {
      console.error(`Supabase ${type} inspection insert failed:`, dbRes.error);
      throw new Error(`Failed to record ${type} inspection: ${dbRes.error.message || "Database insert failed"}`);
    }

    const res = {
      data: {
        ...(dbRes.data?.[0] || dbPayload),
        owner_name: payload.owner_name || "",
        type,
        condemned_parts: payload.condemned_parts || []
      },
      error: null
    };

    // Sync livestock status so Admin & Staff see it immediately
    let speciesName = payload.species || "Unknown";
    const isPartial =
      payload.decision === "Partial" ||
      payload.decision === "Passed with Partial Condemnation" ||
      payload.raw_decision === "Partial";
    const isWholeCarcassCondemned =
      !isPartial &&
      (payload.decision === "Rejected" ||
       payload.decision === "Condemned" ||
       payload.decision === "Whole Carcass Condemned");
    const isApprovedOrPartial =
      payload.decision === "Approved" ||
      payload.decision === "Passed" ||
      isPartial;
    
    let animal = payload.animal || null;
    const cleanTag = String(payload.tag_number || "").trim();
    const cleanLivestockId = String(payload.livestock_id || "").trim();
    const livestockCols = "id, tag_number, species, owner_name, owner_id, status, process_history";

    if (!animal && (cleanLivestockId || cleanTag)) {
      if (cleanLivestockId) {
        try {
          const { data } = await supabase.from(TABLES.LIVESTOCK).select(livestockCols).eq("id", cleanLivestockId).maybeSingle();
          animal = data;
        } catch (_) {}
      }
      if (!animal && cleanTag) {
        try {
          const { data } = await supabase.from(TABLES.LIVESTOCK).select(livestockCols).ilike("tag_number", cleanTag).maybeSingle();
          animal = data;
        } catch (_) {}
      }
    }

    if (animal) {
      speciesName = animal.species || speciesName;
      const ownerPatch = (payload.owner_name && (!animal.owner_name || animal.owner_name === "Unknown" || animal.owner_name === "—"))
        ? { owner_name: payload.owner_name }
          : {};
        let newStatus = animal.status;

        if (type === "Ante-Mortem") {
          newStatus = isWholeCarcassCondemned
            ? "Ante-Mortem Whole Carcass Condemned"
            : isApprovedOrPartial
            ? "Approved"
            : animal.status;
        } else {
          // Post-Mortem
          newStatus = isWholeCarcassCondemned
            ? "Post-Mortem Whole Carcass Condemned"
            : isPartial
            ? "Partially Condemned"
            : isApprovedOrPartial
            ? "Approved"
            : animal.status;
        }

        const existingHistory = parseHistory(animal.process_history);
        const stageName = type === "Ante-Mortem" ? "Ante-Mortem Inspection" : "Post-Mortem Inspection";
        const updatedHistory = appendProcessEvent(existingHistory, {
          stage: stageName,
          action: `${type}: ${payload.decision || "Inspected"}`,
          details: {
            decision: payload.decision,
            findings: effectiveFindings,
            remarks: payload.remarks || "",
            tag_number: payload.tag_number || animal.tag_number,
          },
          actor: { ...actor, name: inspector, id: inspectorId, role: "vet" },
        });

        const statusPatch = {
          ...ownerPatch,
          status: newStatus,
          process_history: updatedHistory,
          ...(type === "Ante-Mortem"
            ? {
                ante_inspected_by: inspector,
                ante_inspected_by_user_id: inspectorId,
                ante_inspected_at: nowIso,
              }
            : {
                post_inspected_by: inspector,
                post_inspected_by_user_id: inspectorId,
                post_inspected_at: nowIso,
              }),
        };

        if (animal.id) {
          await persistLivestockPatch(statusPatch, (p) =>
            supabase.from(TABLES.LIVESTOCK).update(p).eq("id", animal.id).select("id")
          );
        } else if (cleanTag) {
          await persistLivestockPatch(statusPatch, (p) =>
            supabase.from(TABLES.LIVESTOCK).update(p).ilike("tag_number", cleanTag).select("id")
          );
        }
      } else if (payload.tag_number) {
        const cleanTag = String(payload.tag_number || "").trim().toLowerCase();
        let newStatus = "Pending";

        if (type === "Ante-Mortem") {
          newStatus = isWholeCarcassCondemned ? "Ante-Mortem Whole Carcass Condemned" : "Approved";
        } else {
          newStatus = isWholeCarcassCondemned
            ? "Post-Mortem Whole Carcass Condemned"
            : isPartial
            ? "Partially Condemned"
            : "Approved";
        }

        const statusPatch = { status: newStatus };
        if (payload.owner_name) statusPatch.owner_name = payload.owner_name;

        await persistLivestockPatch(statusPatch, (p) =>
          supabase
            .from(TABLES.LIVESTOCK)
            .update(p)
            .ilike("tag_number", cleanTag)
            .select("id")
        );
      }

      if (isWholeCarcassCondemned && payload.tag_number) {
        // Ensure slaughter processing and records mark the carcass as Condemned so it does not proceed downstream
        const condStatus = type === "Ante-Mortem" ? "Ante-Mortem Condemned" : "Post-Mortem Condemned";
        const cleanTag = String(payload.tag_number).trim();
        await Promise.allSettled([
          supabase.from(TABLES.SLAUGHTER_PROCESSING).update({ status: condStatus }).ilike("tag_number", cleanTag),
          supabase.from(TABLES.SLAUGHTER_RECORDS).update({ status: condStatus }).ilike("tag_number", cleanTag),
        ]);
      }

    // Create itemized condemnation records if specific condemned parts were logged on a Partial decision
    if (isPartial && payload.condemned_parts && payload.condemned_parts.length > 0) {
      for (const item of payload.condemned_parts) {
        try {
          const wKg = parseFloat(item.weight || item.weight_kg) || 0;
          const itemPhotos =
            Array.isArray(item.photos) && item.photos.length > 0
              ? item.photos
              : item.photo || item.photo_url || item.image_url || item.file_url || item.file_preview
              ? [{ preview: item.photo || item.photo_url || item.image_url || item.file_url || item.file_preview, dataUrl: item.dataUrl || item.preview, name: item.photoName || `${item.part}_evidence.png` }]
              : [];
          const firstPhotoUrl =
            item.photo ||
            item.photo_url ||
            item.image_url ||
            item.file_url ||
            item.file_preview ||
            (itemPhotos.length > 0
              ? typeof itemPhotos[0] === "string"
                ? itemPhotos[0]
                : itemPhotos[0]?.dataUrl || itemPhotos[0]?.preview || itemPhotos[0]?.url
              : null);

          const condRes = await vetService.createCondemnationRecord({
            tag_number: payload.tag_number,
            species: speciesName,
            reason: item.reason || payload.findings || `Post-Mortem Meat Condemnation`,
            part: item.part || "Condemned Cut",
            weight_kg: wKg,
            quantity: wKg > 0 ? `${wKg} kg` : (item.quantity || "1 Cut"),
            inspector: inspector,
            livestock_id: payload.livestock_id || "",
            location: item.location || "",
            disposition: item.disposition || "Condemned / Rendered",
            findings: item.findings || "",
            photos: itemPhotos,
            photo_url: firstPhotoUrl,
            file_url: firstPhotoUrl,
            inspection_type: "Post-Mortem",
            stage: "Post-Mortem",
            notes: item.notes || payload.remarks || `Post-Mortem condemned part (${item.part}) inspection record.`
          });

          // (createCondemnationRecord automatically creates the linked evidence records and uploads photos)

          // Also insert into dedicated post_mortem_condemned_cuts table if available.
          // `firstPhotoUrl` above is a browser value (base64 data URL), and
          // createCondemnationRecord has by now uploaded the file to Storage and
          // returned the real URL. Use that returned URL so photo_url holds a
          // Supabase Storage reference instead of a duplicate in-row image.
          const storedPhotoUrl = condRes?.data?.photo_url || null;
          const { error: cutInsertError } = await supabase.from("post_mortem_condemned_cuts").insert({
            inspection_id: formattedId,
            livestock_id: payload.livestock_id || null,
            tag_number: payload.tag_number,
            species: speciesName,
            part: item.part || "Condemned Cut",
            location: item.location || null,
            weight_kg: wKg,
            reason: item.reason || "Partial Condemnation",
            findings: item.findings || null,
            disposition: item.disposition || "Condemned / Rendered",
            photo_url: storedPhotoUrl,
            photo_name: item.photo_name || item.photoName || null,
            inspector: inspector,
            notes: item.notes || null,
          });
          if (cutInsertError) {
            console.error(`post_mortem_condemned_cuts insert failed for ${payload.tag_number} / ${item.part}:`, cutInsertError.message);
          }
        } catch (err) {
          console.error("Condemned part creation failed:", err);
        }
      }
    } else if (isWholeCarcassCondemned) {
      // Whole Carcass Condemnation (Post-Mortem) or Ante-Mortem Rejection / Condemnation
      const stageName = type === "Ante-Mortem" ? "Ante-Mortem" : "Post-Mortem";
      const partName = type === "Ante-Mortem" ? "Live Animal" : "Whole Carcass";
      const defaultQty = type === "Ante-Mortem" ? "1 Head" : "Whole Carcass";
      const defaultReason = payload.reason || payload.findings || (type === "Ante-Mortem" ? "Ante-Mortem Whole Carcass Condemnation" : "Post-Mortem Whole Carcass Condemnation");
      try {
        const mainPhotos = payload.photos || (payload.photo ? [{ preview: payload.photo, name: payload.photoName }] : []);
        await vetService.createCondemnationRecord({
          tag_number: payload.tag_number,
          species: speciesName,
          reason: defaultReason,
          part: partName,
          weight_kg: 0,
          quantity: defaultQty,
          inspector: inspector,
          livestock_id: payload.livestock_id || "",
          inspection_type: stageName,
          stage: stageName,
          photos: mainPhotos,
          notes: payload.remarks || payload.findings || (type === "Ante-Mortem" ? "Live animal classified as unfit for slaughter during Ante-Mortem inspection." : "Entire carcass classified as condemned during Post-Mortem veterinary inspection.")
        });
      } catch (err) {
        console.error(`${stageName} condemnation record creation failed:`, err);
      }
    }

    logActivity({
      action: `${type} inspection — ${payload.decision} for ${payload.tag_number}`,
      module: "Inspection",
      notify: {
        title: isWholeCarcassCondemned ? `${type} Condemned (Finalized)` : `${type} ${payload.decision}`,
        message: `${payload.tag_number} officially ${payload.decision.toLowerCase()} in ${type.toLowerCase()} inspection${isWholeCarcassCondemned ? " — whole carcass condemned" : ""}`,
        type: isWholeCarcassCondemned ? "error" : "success",
        owner_id: animal?.owner_id || null,
      },
    }).catch((err) => console.warn("Log activity error in createInspection:", err));

    notifyChange(table, "insert", dbPayload);
    return res;
  },

  createInspectionsBatch: async (type, records) => {
    await adminService.assertActiveSession();
    if (!Array.isArray(records) || records.length === 0) {
      return { succeededTags: [], failedTags: [], results: [] };
    }
    if (records.length === 1) {
      const single = records[0];
      try {
        const res = await vetService.createInspection(type, single);
        return {
          succeededTags: [single.tag_number].filter(Boolean),
          failedTags: [],
          results: [res],
          approvedCount: single.decision === "Approved" ? 1 : 0,
          condemnedCount: single.decision === "Condemned" ? 1 : 0,
          partialCount: (single.decision === "Partial" || single.raw_decision === "Partial") ? 1 : 0,
        };
      } catch (err) {
        return {
          succeededTags: [],
          failedTags: [single.tag_number].filter(Boolean),
          results: [],
          error: err,
        };
      }
    }

    const table = type === "Ante-Mortem" ? TABLES.ANTE_MORTEM : TABLES.POST_MORTEM;
    const session = authService.getSession();
    const actor = getCurrentActor();
    const inspector = (session && session.role === "vet") ? session.name : (actor.role === "vet" ? actor.name : (records[0]?.inspector_name || "Dr. Dave"));
    const inspectorId = actor.id || session?.id || session?.user_id || null;

    // 1. Fetch next sequential base ID ONCE
    let baseNum = 1;
    try {
      const { data: existing } = await supabase
        .from(table)
        .select("id")
        .order("id", { ascending: false })
        .limit(30);
      const existingNums = (existing || []).map((e) => parseInt(e.id, 10)).filter((n) => !isNaN(n));
      baseNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
      const existingIds = new Set((existing || []).map((e) => String(e.id)));
      while (existingIds.has(String(baseNum).padStart(5, "0"))) {
        baseNum++;
      }
    } catch (_) {}

    const nowObj = new Date();
    const nowIso = nowObj.toISOString();

    // 2. Prepare database payloads with pre-allocated continuous sequential IDs
    const preparedItems = records.map((item, idx) => {
      const formattedId = item.id || String(baseNum + idx).padStart(5, "0");

      let effectiveFindings = item.findings || "None";
      if (item.condemned_parts && item.condemned_parts.length > 0) {
        const partsSummary = item.condemned_parts.map((p) => `${p.part} (${p.weight || p.weight_kg} kg)`).join(", ");
        if (!effectiveFindings.includes(partsSummary)) {
          effectiveFindings = `${effectiveFindings} · Condemned cuts: ${partsSummary}`;
        }
      }

      const isPartial = item.decision === "Partial" || item.decision === "Passed with Partial Condemnation" || item.raw_decision === "Partial";
      const isWholeCarcassCondemned = !isPartial && (item.decision === "Rejected" || item.decision === "Condemned" || item.decision === "Whole Carcass Condemned");
      const isApprovedOrPartial = item.decision === "Approved" || item.decision === "Passed" || isPartial;

      const dbPayload = {
        id: formattedId,
        date: item.date || today(),
        inspected_at: item.inspected_at || nowIso,
        inspector_name: inspector,
        inspector_id: inspectorId,
        created_by_user_id: inspectorId,
        tag_number: item.tag_number || null,
        species: item.species || null,
        livestock_id: item.livestock_id || null,
        findings: effectiveFindings,
        decision: item.decision || "Approved",
        remarks: item.remarks || "",
        ...(type === "Post-Mortem"
          ? {
              raw_decision: item.raw_decision || item.decision || null,
              condemned_parts: (Array.isArray(item.condemned_parts) ? item.condemned_parts : []).map(
                (p) => ({ ...p, photo: undefined, photos: undefined, dataUrl: undefined, data_url: undefined })
              ),
            }
          : {}),
      };

      return {
        item,
        dbPayload,
        formattedId,
        isPartial,
        isWholeCarcassCondemned,
        isApprovedOrPartial,
        effectiveFindings,
      };
    });

    const dbPayloads = preparedItems.map((p) => p.dbPayload);
    let dbRes = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      dbRes = await supabase.from(table).insert(dbPayloads).select();

      if (dbRes.error && /inspector_id|created_by_user_id|column|schema cache/i.test(`${dbRes.error.message || ""} ${dbRes.error.details || ""}`)) {
        const withoutAttribution = dbPayloads.map(({ inspector_id, created_by_user_id, ...rest }) => rest);
        dbRes = await supabase.from(table).insert(withoutAttribution).select();
      }

      if (dbRes.error && /duplicate key|unique constraint|pkey/i.test(`${dbRes.error.message || ""} ${dbRes.error.details || ""}`)) {
        try {
          const { data: latest } = await supabase.from(table).select("id").order("id", { ascending: false }).limit(30);
          const lNums = (latest || []).map((e) => parseInt(e.id, 10)).filter((n) => !isNaN(n));
          const retryBase = (lNums.length ? Math.max(...lNums) : baseNum) + 1 + attempt;
          preparedItems.forEach((p, idx) => {
            p.formattedId = String(retryBase + idx).padStart(5, "0");
            p.dbPayload.id = p.formattedId;
          });
          continue;
        } catch (_) {}
      }

      if (!dbRes.error) break;
    }

    if (dbRes?.error) {
      console.error(`Supabase ${type} batch insert failed:`, dbRes.error);
      throw new Error(`Failed to record ${type} inspections: ${dbRes.error.message || "Database insert failed"}`);
    }

    const succeededTags = [];
    const failedTags = [];
    let approvedCount = 0;
    let condemnedCount = 0;
    let partialCount = 0;

    // 3. Update livestock statuses and process histories in parallel
    await Promise.allSettled(
      preparedItems.map(async (entry) => {
        const { item, isPartial, isWholeCarcassCondemned, isApprovedOrPartial, effectiveFindings } = entry;
        const tag = item.tag_number;
        try {
          let animal = item.animal || null;
          const cleanTag = String(tag || "").trim();
          const cleanLivestockId = String(item.livestock_id || "").trim();

          if (!animal && (cleanLivestockId || cleanTag)) {
            if (cleanLivestockId) {
              const { data } = await supabase.from(TABLES.LIVESTOCK).select("id, tag_number, species, owner_name, owner_id, status, process_history").eq("id", cleanLivestockId).maybeSingle();
              animal = data;
            }
            if (!animal && cleanTag) {
              const { data } = await supabase.from(TABLES.LIVESTOCK).select("id, tag_number, species, owner_name, owner_id, status, process_history").ilike("tag_number", cleanTag).maybeSingle();
              animal = data;
            }
          }

          let newStatus = animal?.status || "Pending";
          if (type === "Ante-Mortem") {
            newStatus = isWholeCarcassCondemned ? "Ante-Mortem Whole Carcass Condemned" : isApprovedOrPartial ? "Approved" : newStatus;
          } else {
            newStatus = isWholeCarcassCondemned
              ? "Post-Mortem Whole Carcass Condemned"
              : isPartial
              ? "Partially Condemned"
              : isApprovedOrPartial
              ? "Approved"
              : newStatus;
          }

          const existingHistory = parseHistory(animal?.process_history);
          const stageName = type === "Ante-Mortem" ? "Ante-Mortem Inspection" : "Post-Mortem Inspection";
          const updatedHistory = appendProcessEvent(existingHistory, {
            stage: stageName,
            action: `${type}: ${item.decision || "Inspected"}`,
            details: {
              decision: item.decision,
              findings: effectiveFindings,
              remarks: item.remarks || "",
              tag_number: tag || animal?.tag_number,
            },
            actor: { ...actor, name: inspector, id: inspectorId, role: "vet" },
          });

          const statusPatch = {
            status: newStatus,
            process_history: updatedHistory,
            ...(type === "Ante-Mortem"
              ? { ante_inspected_by: inspector, ante_inspected_by_user_id: inspectorId, ante_inspected_at: nowIso }
              : { post_inspected_by: inspector, post_inspected_by_user_id: inspectorId, post_inspected_at: nowIso }),
          };

          if (item.owner_name && (!animal?.owner_name || animal.owner_name === "Unknown" || animal.owner_name === "—")) {
            statusPatch.owner_name = item.owner_name;
          }

          if (animal?.id) {
            await persistLivestockPatch(statusPatch, (p) => supabase.from(TABLES.LIVESTOCK).update(p).eq("id", animal.id));
          } else if (cleanTag) {
            await persistLivestockPatch(statusPatch, (p) => supabase.from(TABLES.LIVESTOCK).update(p).ilike("tag_number", cleanTag));
          }

          // Whole carcass downstream status sync if condemned
          if (isWholeCarcassCondemned && tag) {
            const condStatus = type === "Ante-Mortem" ? "Ante-Mortem Condemned" : "Post-Mortem Condemned";
            await Promise.allSettled([
              supabase.from(TABLES.SLAUGHTER_PROCESSING).update({ status: condStatus }).ilike("tag_number", cleanTag),
              supabase.from(TABLES.SLAUGHTER_RECORDS).update({ status: condStatus }).ilike("tag_number", cleanTag),
            ]);
          }

          // Condemned parts handling if partial condemnation
          if (isPartial && item.condemned_parts && item.condemned_parts.length > 0) {
            for (const cut of item.condemned_parts) {
              try {
                const wKg = parseFloat(cut.weight || cut.weight_kg) || 0;
                await vetService.createCondemnationRecord({
                  tag_number: tag,
                  species: item.species || animal?.species || "Livestock",
                  reason: cut.reason || item.findings || `Post-Mortem Meat Condemnation`,
                  part: cut.part || "Condemned Cut",
                  weight_kg: wKg,
                  quantity: wKg > 0 ? `${wKg} kg` : (cut.quantity || "1 Cut"),
                  inspector: inspector,
                  livestock_id: item.livestock_id || animal?.id || "",
                  location: cut.location || "",
                  disposition: cut.disposition || "Condemned / Rendered",
                  findings: cut.findings || "",
                  photos: cut.photos || (cut.photo ? [{ preview: cut.photo, name: cut.photoName }] : []),
                  inspection_type: "Post-Mortem",
                  stage: "Post-Mortem",
                  notes: cut.notes || item.remarks || `Post-Mortem condemned cut (${cut.part}).`,
                });
              } catch (cutErr) {
                console.error("Batch condemned cut creation error:", cutErr);
              }
            }
          } else if (isWholeCarcassCondemned) {
            const stageName = type === "Ante-Mortem" ? "Ante-Mortem" : "Post-Mortem";
            const partName = type === "Ante-Mortem" ? "Live Animal" : "Whole Carcass";
            const defaultQty = type === "Ante-Mortem" ? "1 Head" : "Whole Carcass";
            try {
              await vetService.createCondemnationRecord({
                tag_number: tag,
                species: item.species || animal?.species || "Livestock",
                reason: item.reason || item.findings || `${stageName} Condemnation`,
                part: partName,
                weight_kg: 0,
                quantity: defaultQty,
                inspector: inspector,
                livestock_id: item.livestock_id || animal?.id || "",
                inspection_type: stageName,
                stage: stageName,
                photos: item.photos || (item.photo ? [{ preview: item.photo, name: item.photoName }] : []),
                notes: item.remarks || item.findings || `${stageName} whole carcass condemned.`,
              });
            } catch (wholeErr) {
              console.error("Batch whole condemnation record creation error:", wholeErr);
            }
          }

          succeededTags.push(tag);
          if (isWholeCarcassCondemned) condemnedCount++;
          else if (isPartial) partialCount++;
          else approvedCount++;
        } catch (itemErr) {
          console.error(`Batch processing failed for ${tag}:`, itemErr);
          failedTags.push(tag);
        }
      })
    );

    // 4. Log single batch activity and fire notifyChange ONCE
    logActivity({
      action: `${type} inspection batch (${succeededTags.length} records) certified`,
      module: "Inspection",
      notify: {
        title: `${type} Batch Certified`,
        message: `${succeededTags.length} record(s) processed in ${type.toLowerCase()} inspection.`,
        type: condemnedCount > 0 ? "warning" : "success",
      },
    }).catch(() => {});

    notifyChange(table, "insert", { count: succeededTags.length });

    return {
      succeededTags,
      failedTags,
      approvedCount,
      condemnedCount,
      partialCount,
      results: dbRes.data || [],
    };
  },

  deleteInspection: async (type, id, optionalTag, optionalLivestockId) => {
    // 1. Authorization check
    const session = authService.getSession();
    const isAuthorized = session && (session.role === "vet" || session.role === "admin" || session.role === "inspector" || session.role === "staff");
    if (!isAuthorized) {
      throw new Error("Unauthorized: Only authorized veterinarians or inspectors may delete inspection records.");
    }

    const table = type === "Ante-Mortem" ? TABLES.ANTE_MORTEM : TABLES.POST_MORTEM;

    // 2. Retrieve target inspection record details before deletion
    let targetRecord = null;
    if (id) {
      try {
        const { data } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
        targetRecord = data;
      } catch (_) {}
    }

    const cleanTag = String(optionalTag || targetRecord?.tag_number || "").trim();
    const tagNumber = cleanTag || null;
    let livestockId = String(optionalLivestockId || targetRecord?.livestock_id || "").trim() || null;
    const previousDecision = targetRecord?.decision || targetRecord?.status || "Saved Inspection";

    // Fallback: resolve livestock ID by tag if missing
    if (!livestockId && cleanTag) {
      try {
        const { data: liveData } = await supabase.from(TABLES.LIVESTOCK).select("id").ilike("tag_number", cleanTag).maybeSingle();
        if (liveData?.id) livestockId = String(liveData.id);
      } catch (_) {}
    }

    // 3. Delete inspection record from Supabase
    try {
      if (id) {
        await supabase.from(table).delete().eq("id", id);
      }
      if (cleanTag) {
        await supabase.from(table).delete().ilike("tag_number", cleanTag);
      }
    } catch (err) {
      console.warn(`Supabase ${table} delete error:`, err);
    }

    if (cleanTag) {
      // 4. Delete associated condemnation records for this tag & inspection stage.
      try {
        const { data: condRows } = await supabase
          .from(TABLES.CONDEMNATION_RECORDS || "condemnation_records")
          .select("id,part")
          .ilike("tag_number", cleanTag);
        const stageIds = (condRows || [])
          .filter((r) => condemnationStageOf(r) === type)
          .map((r) => r.id)
          .filter(Boolean);
        if (stageIds.length) {
          await supabase
            .from(TABLES.CONDEMNATION_RECORDS || "condemnation_records")
            .delete()
            .in("id", stageIds);
        }
      } catch (err) {
        console.warn("Error clearing condemnation records on delete:", err);
      }

      // 5. Delete associated evidence records for this tag & inspection stage
      try {
        const { data: evRows } = await supabase
          .from(TABLES.EVIDENCE_RECORDS || "evidence_records")
          .select("id,inspection_type")
          .ilike("tag_number", cleanTag);
        const needle = String(type).split("-")[0].toLowerCase();
        const evIds = (evRows || [])
          .filter((r) => String(r.inspection_type || "").toLowerCase().includes(needle))
          .map((r) => r.id)
          .filter(Boolean);
        if (evIds.length) {
          await supabase.from(TABLES.EVIDENCE_RECORDS || "evidence_records").delete().in("id", evIds);
        }
      } catch (err) {
        console.warn("Error clearing evidence records on delete:", err);
      }

      // 6. Delete itemized cut records if Post-Mortem
      if (type === "Post-Mortem") {
        try {
          await supabase.from("post_mortem_condemned_cuts").delete().ilike("tag_number", cleanTag);
        } catch (_) {}
      }

      // 7. Reset affected livestock status to "Pending"
      try {
        await supabase.from(TABLES.LIVESTOCK).update({ status: "Pending" }).ilike("tag_number", cleanTag);
      } catch (err) {
        console.warn("Error resetting livestock status on delete:", err);
      }

      // 8. For Post-Mortem, if slaughter records had status set to Condemned, restore to Completed
      if (type === "Post-Mortem") {
        try {
          await supabase.from(TABLES.SLAUGHTER_PROCESSING).update({ status: "Completed" }).ilike("tag_number", cleanTag);
          await supabase.from(TABLES.SLAUGHTER_RECORDS).update({ status: "Completed" }).ilike("tag_number", cleanTag);
        } catch (_) {}
      }
    }

    // 9. Record Audit Log
    const userName = session ? (session.name || session.username || "Veterinarian") : "Veterinarian";
    const userRole = session ? session.role : "vet";
    const actionName = type === "Ante-Mortem" ? "Deleted Ante-Mortem Inspection" : "Deleted Post-Mortem Inspection";

    await logActivity({
      action: `${actionName}${cleanTag ? ` for Tag ${cleanTag}` : ""}`,
      module: "Inspection",
      tag_number: cleanTag || null,
      user: userName,
      role: userRole,
      old_value: previousDecision,
      new_value: "Pending",
      field_changed: "status",
      severity: "warning",
      result: "Inspection reset to Pending",
      notify: {
        title: `${type} Inspection Deleted`,
        message: `Inspection record for ${cleanTag || "livestock"} was deleted. Status reset to Pending.`,
        type: "warning",
      },
    });

    // 10. Notify all mounted hooks once after all local state changes are done
    notifyChange(table, "delete", { id, tag: cleanTag });

    return { ok: true, tag_number: cleanTag };
  },

  deleteInspectionByTag: async (type, tag) => {
    const table = type === "Ante-Mortem" ? TABLES.ANTE_MORTEM : TABLES.POST_MORTEM;
    const cleanTag = (tag || "").trim();

    try {
      const existing = await getDbRows(table);
      const match = (existing || []).find((r) => String(r.tag_number || "").trim().toLowerCase() === cleanTag.toLowerCase());
      if (match?.id) {
        return await vetService.deleteInspection(type, match.id, cleanTag, match.livestock_id);
      }
    } catch (_) {}

    return await vetService.deleteInspection(type, null, cleanTag, null);
  },

  updateLivestockStatus: async (livestockId, status, tag) => {
    const isCondemned = status === "Rejected" || status === "Condemned";
    const newStatus = isCondemned ? "Condemned" : status;
    const cleanTag = tag ? String(tag).trim() : null;
    let res = { ok: true, status: newStatus };

    if (livestockId) {
      try {
        const { data, error } = await supabase
          .from(TABLES.LIVESTOCK)
          .update({ status: newStatus })
          .eq("id", livestockId)
          .select();
        if (!error && data) res.data = data;
      } catch (err) {
        console.warn("updateLivestockStatus update by id error:", err);
      }
    }
    if (cleanTag) {
      try {
        await supabase
          .from(TABLES.LIVESTOCK)
          .update({ status: newStatus })
          .ilike("tag_number", cleanTag);
      } catch (err) {
        console.warn("updateLivestockStatus update by tag error:", err);
      }
    }

    // Auto-create Ante-Mortem inspection record if approved
    if (status === "Approved" || status === "Passed") {
      try {
        let animal = null;
        if (livestockId) {
          const { data: livestock } = await supabase.from(TABLES.LIVESTOCK).select().eq("id", livestockId);
          animal = livestock?.[0];
        }
        if (!animal && cleanTag) {
          const { data: livestock } = await supabase.from(TABLES.LIVESTOCK).select().ilike("tag_number", cleanTag);
          animal = livestock?.[0];
        }
        const session = authService.getSession();
        const inspector = (session && session.role === "vet") ? session.name : "Dr. Dave";

        const resolvedTag = tag || animal?.tag_number;
        if (resolvedTag) {
          const { data: existing } = await supabase
            .from(TABLES.ANTE_MORTEM)
            .select("id")
            .ilike("tag_number", String(resolvedTag).trim());
          if (!existing || existing.length === 0) {
            await vetService.createInspection("Ante-Mortem", {
              tag_number: resolvedTag,
              livestock_id: livestockId || animal?.id || "",
              species: animal?.species || "Unknown",
              owner_name: animal?.owner_name || "",
              decision: "Approved",
              findings: "Normal vital signs, active and normal behavior, fit for slaughter",
              inspector_name: inspector,
            });
          }
        }
      } catch (err) {
        console.warn("Auto-inspection record creation in updateLivestockStatus:", err);
      }
    }

    // Auto-create condemnation record if rejected
    if (status === "Rejected") {
      try {
        let animal = null;
        if (livestockId) {
          const { data: livestock } = await supabase.from(TABLES.LIVESTOCK).select().eq("id", livestockId);
          animal = livestock?.[0];
        }
        if (!animal && cleanTag) {
          const { data: livestock } = await supabase.from(TABLES.LIVESTOCK).select().ilike("tag_number", cleanTag);
          animal = livestock?.[0];
        }
        const session = authService.getSession();
        const inspector = (session && session.role === "vet") ? session.name : "Dr. Dave";

        await vetService.createCondemnationRecord({
          tag_number: tag || animal?.tag_number,
          species: animal?.species || "Unknown",
          reason: "Rejected during livestock approval review",
          part: "Live Animal",
          quantity: "1 Head",
          inspector: inspector,
          notes: ""
        });
      } catch (err) {
        console.error("Auto-condemnation in updateLivestockStatus failed:", err);
      }
    }

    await logActivity({
      action: `Animal ${newStatus.toLowerCase()} ${tag || ""}`.trim(),
      module: "Inspection",
      notify: {
        title: `Animal ${newStatus}`,
        message: `${tag || "An animal"} was ${newStatus.toLowerCase()} during inspection`,
        type: newStatus === "Condemned" ? "error" : "success",
      },
    });

    notifyChange(TABLES.LIVESTOCK, "update", { id, tag, status: newStatus });
    return res;
  },

  listOrganInspections: async () => {
    const { data, error } = await supabase.from("organ_inspections").select();
    if (error) throw error;
    return data;
  },
  createOrganInspection: async (payload) => {
    const res = await supabase.from("organ_inspections").insert({ id: uuid(), date: today(), ...payload });
    if (res.error) throw res.error;
    await logActivity({
      action: `Organ inspection recorded for ${payload.tag_number}`,
      module: "Inspection",
      notify: {
        title: "Organ Inspected",
        message: `${payload.organ} of ${payload.tag_number} was inspected`,
        type: payload.decision === "Rejected" ? "warning" : "success",
      },
    });
    notifyChange(TABLES.ORGAN_INSPECTIONS, "insert", payload);
    return res;
  },

  listDiseases: async () => {
    const { data, error } = await supabase.from("diseases").select();
    if (error) throw error;
    return data || [];
  },
  createDisease: async (payload) => {
    const res = await supabase.from("diseases").insert({ id: uuid(), date: today(), ...payload });
    if (res.error) throw res.error;
    await logActivity({
      action: `Disease logged: ${payload.disease} for ${payload.tag_number}`,
      module: "Disease Monitoring",
      notify: {
        title: "Disease Logged",
        message: `${payload.disease} was reported for ${payload.tag_number}`,
        type: payload.severity === "High" ? "error" : "warning",
      },
    });
    notifyChange(TABLES.DISEASES, "insert", payload);
    return res;
  },

  listCondemnationRecords: async () => {
    const { data, error } = await supabase.from(TABLES.CONDEMNATION_RECORDS).select();
    if (error) throw error;
    return data || [];
  },
  createCondemnationRecord: async (payload) => {
    await adminService.assertActiveSession();
    const recordId = payload.id || uuid();
    let attachedPhotos = payload.photos || [];
    if (attachedPhotos.length === 0 && (payload.photo || payload.photo_url || payload.file_url)) {
      attachedPhotos = [{ preview: payload.photo || payload.photo_url || payload.file_url, name: payload.photoName || `${payload.part || "condemned"}_evidence.png` }];
    }

    // Upload files if needed
    if (attachedPhotos.length > 0) {
      // Every photo must reach Supabase Storage before any row is written. This
      // used to warn and continue, so a failed upload left the raw File/preview
      // in place and `photo_url` below could receive a browser data URL.
      const uploaded = await vetService.uploadMultipleEvidenceFiles(attachedPhotos, payload.tag_number);
      attachedPhotos = uploaded.map((u, i) => ({
        id: u.file_path || u.file_url || `photo-${i + 1}`,
        url: u.file_url,
        preview: u.file_url,
        name: u.file_name || `Photo ${i + 1}`,
        size: u.file_size || 0,
        file_path: u.file_path || null,
      }));
    }

    const firstPhotoUrl = attachedPhotos[0]?.url || attachedPhotos[0]?.preview || payload.photo_url || payload.file_url || null;

    const actor = getCurrentActor();
    const inspectorName = payload.inspector || actor.name || "Dr. Dave";
    const inspectorId = actor.id || null;

    const record = {
      id: recordId,
      date: payload.date || today(),
      tag_number: payload.tag_number,
      species: payload.species || "Livestock",
      reason: payload.reason || "",
      part: payload.part || "Condemned Cut",
      quantity: payload.quantity || (payload.weight_kg ? `${payload.weight_kg} kg` : "1 Cut"),
      weight_kg: payload.weight_kg ? Number(payload.weight_kg) : 0,
      inspector: inspectorName,
      inspector_id: inspectorId,
      created_by_user_id: inspectorId,
      notes: payload.notes || "",
      livestock_id: payload.livestock_id || null,
      location: payload.location || "",
      disposition: payload.disposition || "Condemned / Rendered",
      findings: payload.findings || "",
      photo_url: firstPhotoUrl,
      photos: attachedPhotos,
      // Stage is derived from the payload so Ante-Mortem and Post-Mortem never mix
      inspection_type: payload.inspection_type || (payload.part === "Live Animal" ? "Ante-Mortem" : "Post-Mortem"),
    };

    const dbPayload = {
      id: recordId,
      date: record.date,
      tag_number: record.tag_number,
      species: record.species,
      reason: record.reason,
      part: record.part,
      quantity: record.quantity,
      weight_kg: record.weight_kg,
      inspector: record.inspector,
      inspector_id: inspectorId,
      created_by_user_id: inspectorId,
      notes: record.notes,
      livestock_id: record.livestock_id,
      location: record.location,
      disposition: record.disposition,
      findings: record.findings,
      photo_url: firstPhotoUrl,
    };
    let dbRes = await supabase.from(TABLES.CONDEMNATION_RECORDS).insert(dbPayload).select();
    if (dbRes.error && /inspector_id|created_by_user_id|column|schema cache/i.test(`${dbRes.error.message || ""} ${dbRes.error.details || ""}`)) {
      const { inspector_id, created_by_user_id, ...fbDbPayload } = dbPayload;
      dbRes = await supabase.from(TABLES.CONDEMNATION_RECORDS).insert(fbDbPayload).select();
    }
    if (dbRes.error) {
      console.error("Supabase condemnation insert error:", dbRes.error);
      throw new Error(`Failed to save condemnation record: ${dbRes.error.message}`);
    }
    const res = { data: { ...record, ...dbRes.data[0] }, error: null };

    // Append condemnation event to livestock process history if tag is present
    if (payload.tag_number) {
      try {
        const { data: dbAnimal } = await supabase
          .from(TABLES.LIVESTOCK)
          .select("*")
          .ilike("tag_number", payload.tag_number)
          .maybeSingle();
        if (dbAnimal) {
          const hist = parseHistory(dbAnimal.process_history);
          const updatedHist = appendProcessEvent(hist, {
            stage: "Condemnation",
            action: `Condemned Part: ${record.part} (${record.reason || "Unfit"})`,
            details: {
              part: record.part,
              weight_kg: record.weight_kg,
              reason: record.reason,
              disposition: record.disposition,
            },
            actor: { ...actor, name: inspectorName, id: inspectorId, role: "vet" },
          });
          await persistLivestockPatch({ process_history: updatedHist }, (p) =>
            supabase.from(TABLES.LIVESTOCK).update(p).eq("id", dbAnimal.id)
          );
        }
      } catch (err) {
        console.warn("Livestock process history update notice on condemnation:", err);
      }
    }

    // Link attached evidence photos to evidence_records
    if (attachedPhotos.length > 0) {
      // The photos are in Storage by now, but the evidence row may still fail.
      // Swallowing that left the condemnation pointing at a photo with no
      // evidence record and still reported success, so this must propagate.
      await vetService.createMultipleEvidenceRecords(
        {
          tag_number: payload.tag_number,
          type: "Photo",
          notes: `Condemnation (${record.part}): ${record.reason}${record.findings ? ` · ${record.findings}` : ""}`,
          inspection_type: payload.inspection_type || ((payload.part || "Condemned Cut") === "Live Animal" ? "Ante-Mortem" : "Post-Mortem"),
          condemnation_record_id: recordId,
        },
        attachedPhotos
      );
    }

    await logActivity({
      action: `Condemned meat recorded for ${payload.tag_number}`,
      module: "Condemnation",
      notify: {
        title: "Meat Condemned",
        message: `${payload.quantity || `${payload.weight_kg || 0} kg`} of ${payload.tag_number} condemned. Reason: ${payload.reason}`,
        type: "error",
      },
    });
    notifyChange(TABLES.CONDEMNATION_RECORDS, "insert", payload);
    return res;
  },

  updateCondemnationRecord: async (id, patch, tagNumber) => {
    let attachedPhotos = patch.photos;
    const effectiveTag = tagNumber || patch.tag_number;

    if (Array.isArray(attachedPhotos) && attachedPhotos.length > 0) {
      const hasUnuploadedFiles = attachedPhotos.some((p) => p.file || (p instanceof File));
      if (hasUnuploadedFiles) {
        // Abort on failure: continuing would leave the un-uploaded File in place
        // and `firstPhotoUrl` would pick up its browser preview.
        const uploaded = await vetService.uploadMultipleEvidenceFiles(attachedPhotos, effectiveTag);
        if (uploaded.length > 0) {
          attachedPhotos = uploaded.map((u, i) => ({
            id: u.file_path || u.file_url || `photo-${i + 1}`,
            url: u.file_url,
            preview: u.file_url,
            name: u.file_name || `Photo ${i + 1}`,
            size: u.file_size || 0,
            file_path: u.file_path || null,
          }));
        }
      }
    }

    const firstPhotoUrl = Array.isArray(attachedPhotos) && attachedPhotos.length > 0
      ? (attachedPhotos[0]?.url || attachedPhotos[0]?.preview || null)
      : (patch.photo_url || patch.file_url || undefined);

    const updatedPatch = {
      ...patch,
      ...(attachedPhotos !== undefined ? { photos: attachedPhotos } : {}),
      ...(firstPhotoUrl !== undefined ? { photo_url: firstPhotoUrl, file_url: firstPhotoUrl } : {}),
    };

    const dbPatch = {};
    if (updatedPatch.part !== undefined) dbPatch.part = updatedPatch.part;
    if (updatedPatch.reason !== undefined) dbPatch.reason = updatedPatch.reason;
    if (updatedPatch.weight_kg !== undefined) {
      dbPatch.weight_kg = Number(updatedPatch.weight_kg) || 0;
      dbPatch.quantity = `${dbPatch.weight_kg} kg`;
    }
    if (updatedPatch.location !== undefined) dbPatch.location = updatedPatch.location;
    if (updatedPatch.disposition !== undefined) dbPatch.disposition = updatedPatch.disposition;
    if (updatedPatch.findings !== undefined) dbPatch.findings = updatedPatch.findings;
    if (updatedPatch.inspector !== undefined) dbPatch.inspector = updatedPatch.inspector;
    if (updatedPatch.notes !== undefined) dbPatch.notes = updatedPatch.notes;
    if (firstPhotoUrl !== undefined) {
      dbPatch.photo_url = firstPhotoUrl;
    }

    let res = { data: updatedPatch, error: null };
    if (id) {
      const dbRes = await supabase.from(TABLES.CONDEMNATION_RECORDS).update(dbPatch).eq("id", id).select();
      if (dbRes.error) {
        console.error("Supabase condemnation update error:", dbRes.error);
        throw new Error(`Failed to update condemnation record: ${dbRes.error.message}`);
      }
      if (dbRes.data?.[0]) {
        res = { data: { ...updatedPatch, ...dbRes.data[0] }, error: null };
      }
    }

    // Also update/sync linked evidence records
    if (Array.isArray(attachedPhotos) && attachedPhotos.length > 0 && effectiveTag) {
      // Same rule as create: a failed evidence insert must not be reported as a
      // successful update.
      await vetService.createMultipleEvidenceRecords(
        {
          tag_number: effectiveTag,
          type: "Photo",
          notes: `Condemnation (${updatedPatch.part || "Condemned"}): ${updatedPatch.reason || ""}${updatedPatch.findings ? ` · ${updatedPatch.findings}` : ""}`,
          inspection_type: updatedPatch.part === "Live Animal" ? "Ante-Mortem" : "Post-Mortem",
          condemnation_record_id: id || null,
        },
        attachedPhotos
      );
    }

    await logActivity({
      action: `Condemnation record updated for ${effectiveTag || id}`,
      module: "Condemnation",
    });

    notifyChange(TABLES.CONDEMNATION_RECORDS, "update", updatedPatch);
    return res;
  },

  listDisposalRecords: async () => {
    const { data, error } = await supabase.from(TABLES.DISPOSAL_RECORDS).select();
    if (error) throw error;
    return data || [];
  },
  createDisposalRecord: async (payload) => {
    const res = await supabase.from(TABLES.DISPOSAL_RECORDS).insert({ id: uuid(), date: today(), ...payload });
    if (res.error) throw res.error;
    await logActivity({
      action: `Disposal recorded: ${payload.method} for ${payload.tag_number}`,
      module: "Condemnation",
      notify: {
        title: "Disposal Processed",
        message: `${payload.quantity} was disposed using ${payload.method} for ${payload.tag_number}`,
        type: "success",
      },
    });
    notifyChange(TABLES.DISPOSAL_RECORDS, "insert", payload);
    return res;
  },

  listEvidenceRecords: async () => {
    const { data, error } = await supabase.from(TABLES.EVIDENCE_RECORDS).select();
    if (error) throw error;
    return data || [];
  },
  uploadEvidenceFile: async (file, tagNumber) => {
    const cleanTag = String(tagNumber || "TAG").trim().replace(/^#/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileExt = file.name ? file.name.split(".").pop() : "png";
    const filePath = `evidence/${cleanTag}/${uuid()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("evidence")
      .upload(filePath, file, { contentType: file.type || "image/png", upsert: false });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from("evidence").getPublicUrl(filePath);
    return { file_path: filePath, file_url: urlData?.publicUrl || null };
  },
  uploadMultipleEvidenceFiles: async (files = [], tagNumber) => {
    const cleanTag = String(tagNumber || "TAG").trim().replace(/^#/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const uploaded = [];
    const MAX_PHOTOS = 3;
    const cappedFiles = (files || []).slice(0, MAX_PHOTOS);
    for (const item of cappedFiles) {
      if (!item) continue;
      const fileObj = item.file || (item instanceof File ? item : null);
      const fileName = item?.name || item?.fileName || item?.file_name || (fileObj ? fileObj.name : null) || "evidence.png";
      const remoteUrl = (typeof item.url === "string" && item.url.startsWith("http"))
        ? item.url
        : (typeof item.file_url === "string" && item.file_url.startsWith("http"))
        ? item.file_url
        : (typeof item.preview === "string" && item.preview.startsWith("http"))
        ? item.preview
        : null;
      // A Storage path is the only proof the object was really written to the
      // bucket. A bare http URL can be a stale, deleted or data-URI-derived link,
      // which is how whole-carcass rows ended up pointing at nothing. Only the
      // combination of a path AND a URL is reused as-is; everything else is
      // uploaded now.
      const existingRemotePath = nonEmpty(item.file_path) ? String(item.file_path).trim() : null;
      const alreadyUploaded = !!(existingRemotePath && remoteUrl);

      if (alreadyUploaded) {
        uploaded.push({
          file_path: existingRemotePath,
          file_url: remoteUrl,
          file_name: fileName,
          file_size: item.size || fileObj?.size || 0,
          mime_type: item.type || fileObj?.type || "image/png",
        });
        continue;
      }

      if (!fileObj) {
        throw new Error(
          `Evidence "${fileName}" for ${cleanTag} has no uploaded file. A real File is required so the ` +
            `image can be stored in Supabase Storage.`
        );
      }

      const { file_path, file_url } = await vetService.uploadEvidenceFile(fileObj, cleanTag);
      if (!file_path || !file_url) {
        throw new Error(`Evidence "${fileName}" for ${cleanTag} was not confirmed in Supabase Storage.`);
      }
      uploaded.push({
        file_path,
        file_url,
        file_name: fileName,
        file_size: fileObj.size || 0,
        mime_type: fileObj.type || "image/png",
      });
    }
    return uploaded;
  },
  createMultipleEvidenceRecords: async (payload, files = []) => {
    const MAX_PHOTOS = 3;
    const cappedFiles = (files || []).slice(0, MAX_PHOTOS);
    const uploadedFiles = await vetService.uploadMultipleEvidenceFiles(cappedFiles, payload.tag_number);
    // Returning an empty list here was indistinguishable from success at the call
    // site, so a condemnation could report "saved" with no evidence row at all.
    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw new Error(`No evidence photo could be stored for ${payload.tag_number}.`);
    }

    const allUrls = uploadedFiles.map((f) => f.file_url).filter(Boolean).slice(0, MAX_PHOTOS);
    const allPhotos = uploadedFiles.slice(0, MAX_PHOTOS).map((f, i) => ({
      id: f.file_path || f.file_url || `photo-${i + 1}`,
      url: f.file_url,
      preview: f.file_url,
      name: f.file_name || `Photo ${i + 1}`,
      size: f.file_size || 0,
      file_path: f.file_path || null,
    }));

    const primaryFile = uploadedFiles[0];
    // The Storage key must reach the row for every stage. It used to be written
    // only for Ante-Mortem and left `undefined` otherwise, so Post-Mortem
    // whole-carcass evidence had `file_path = ''` and the object could not be
    // re-verified later. Without the key a deleted photo is indistinguishable
    // from a good one.
    const rec = await vetService.createEvidenceRecord(
      {
        tag_number: payload.tag_number,
        type: payload.type || "Photo",
        notes: payload.notes || "",
        inspection_type: payload.inspection_type || "Post-Mortem",
        condemnation_record_id: payload.condemnation_record_id || null,
        file_preview: primaryFile.file_url,
        file_url: primaryFile.file_url,
        file_path: primaryFile.file_path || null,
        file_name: primaryFile.file_name || "Evidence Photo",
        file_size: primaryFile.file_size || 0,
        mime_type: primaryFile.mime_type || "image/png",
        photos: allPhotos,
        file_urls: allUrls,
      },
      null
    );
    return [rec];
  },
  createEvidenceRecord: async (payload, file) => {
    let fileMetadata = {};
    if (file) {
      // A Storage failure must abort the whole record. This used to warn and
      // continue, which stored a browser preview in `file_url` with an empty
      // `file_path` - a temporary frontend URL presented as a saved photo.
      const { file_path, file_url } = await vetService.uploadEvidenceFile(file, payload.tag_number);
      if (!file_path || !file_url) {
        throw new Error(`Evidence upload for ${payload.tag_number} returned no Storage path.`);
      }
      fileMetadata = {
        file_path,
        file_url,
        file_size: file.size,
        mime_type: file.type,
      };
    }
    const session = authService.getSession();
    const userId = session?.id || null;
    const record = {
      id: uuid(),
      date: today(),
      ...payload,
      ...fileMetadata,
      uploaded_by: userId,
    };
    const dbRecord = {
      id: record.id,
      date: record.date || today(),
      tag_number: record.tag_number,
      type: record.type || "Photo",
      file_name: record.file_name || null,
      file_path: record.file_path || null,
      file_url: record.file_url || null,
      file_preview: record.file_preview || record.file_url || null,
      file_size: record.file_size || null,
      mime_type: record.mime_type || null,
      uploaded_by: record.uploaded_by || null,
      inspection_type: record.inspection_type || "Post-Mortem",
      notes: record.notes || "",
      status: record.status || "Active",
    };
    // `photos` and `file_urls` are real columns but were written only for
    // Ante-Mortem, so every extra photo of a Post-Mortem condemnation was
    // dropped on insert and survived only in the browser cache.
    if (Array.isArray(record.photos)) dbRecord.photos = record.photos;
    if (Array.isArray(record.file_urls)) dbRecord.file_urls = record.file_urls;

    const dbRes = await supabase.from(TABLES.EVIDENCE_RECORDS).insert(dbRecord);
    // supabase-js resolves with { error } instead of throwing, so the insert has
    // to be inspected explicitly. Reporting success here is what let evidence
    // look saved while the row was never written.
    if (dbRes && dbRes.error) {
      throw new Error(`Evidence record was not saved to Supabase: ${dbRes.error.message}`);
    }
    const res = { data: record, error: null };
    await logActivity({
      action: `Evidence uploaded: ${payload.type} for ${payload.tag_number}`,
      module: "Condemnation",
      notify: {
        title: "Evidence Uploaded",
        message: `${payload.type} evidence uploaded for ${payload.tag_number}`,
        type: "success",
      },
    });
    notifyChange(TABLES.EVIDENCE_RECORDS, "insert", record);
    return res;
  },
  /**
   * Deletes one Condemnation Evidence record end to end.
   *
   * opts.stage          "Ante-Mortem" | "Post-Mortem" - scopes every lookup so a Post
   *                     condemnation is never touched by an Ante delete (and vice versa).
   * opts.condemnationId real condemnation_records.id. Synthetic ids are ignored.
   * opts.photoUrls      every photo URL the details modal was showing, so the matching
   *                     storage objects can be removed.
   *
   * The condemnation_records row itself is deleted. Previously it was only updated
   * (photo_url -> null), so the record survived and reappeared in the list.
   */
  deleteEvidenceRecord: async (id, filePath, tagNumber, photoUrl, opts = {}) => {
    const stage = opts.stage === "Post-Mortem" ? "Post-Mortem" : "Ante-Mortem";
    const cleanTag = tagNumber ? String(tagNumber).trim().toUpperCase() : null;
    const rawId = id ? String(id).trim() : null;
    // Synthetic ids are generated by the UI and match no database row.
    const isSyntheticId = !rawId || /^synthetic[_-]/i.test(rawId) || /^synth/i.test(rawId);
    const cleanId = isSyntheticId ? null : rawId;
    const photoUrls = [].concat(opts.photoUrls || [], nonEmpty(photoUrl) ? photoUrl : []);

    const errors = [];
    const fail = (msg, detail) => errors.push(detail ? `${msg}: ${detail}` : msg);

    const run = async (label, factory) => {
      try {
        const r = await withTimeout(factory(), DEFAULT_TIMEOUT_MS, label);
        if (r.timedOut) { fail(label, r.error.message); return null; }
        if (r.value && r.value.error) {
          // supabase-js resolves with { error } instead of throwing, so every call
          // must be inspected explicitly or failures vanish silently.
          fail(label, `${r.value.error.message}${r.value.error.code ? ` (${r.value.error.code})` : ""}`);
          return null;
        }
        return r.value;
      } catch (e) {
        fail(label, e.message || String(e));
        return null;
      }
    };

    // ---------------------------------------------------------------- storage keys
    // Only keys that genuinely belong to this animal. Never guess a folder from a tag
    // that could match another record.
    const storageKeys = new Set();
    if (nonEmpty(filePath)) storageKeys.add(filePath.trim());
    photoUrls.forEach((u) => {
      if (!nonEmpty(u)) return;
      const m = u.trim().match(/storage\/v1\/object\/public\/[^/]+\/(.+)$/i);
      if (m) storageKeys.add(m[1]);
    });
    if (cleanTag) {
      // Folder is per-tag, so this can only touch this animal's evidence files.
      const { data: files } = (await run("storage list", () =>
        supabase.storage.from("evidence").list(`evidence/${cleanTag}`)
      )) || {};
      (files || []).forEach((f) => f && f.name && storageKeys.add(`evidence/${cleanTag}/${f.name}`));
    }

    // ---------------------------------------------------------------- record ids
    const evIds = [];
    const condIds = [];
    const cutIds = [];

    if (cleanTag) {
      const evRows = (await run("select evidence_records", () =>
        supabase.from(TABLES.EVIDENCE_RECORDS || "evidence_records").select("id,inspection_type,status").ilike("tag_number", cleanTag)
      ))?.data || [];
      evRows.forEach((r) => {
        const t = String(r.inspection_type || "").toLowerCase();
        // Rows with no stage are kept only when the tag is condemned in this stage.
        if (!t ? stage === "Ante-Mortem" : t.includes(stage.split("-")[0].toLowerCase())) evIds.push(r.id);
      });

      const condRows = (await run("select condemnation_records", () =>
        supabase.from(TABLES.CONDEMNATION_RECORDS || "condemnation_records").select("id,part").ilike("tag_number", cleanTag)
      ))?.data || [];
      condRows.forEach((r) => {
        if (condemnationStageOf(r) === stage) condIds.push(r.id);
      });

      if (stage === "Post-Mortem") {
        // Scoped by tag_number, never by id: post_mortem_condemned_cuts.id is a uuid and
        // filtering it with a synthetic id fails with 22P02.
        const cutRows = (await run("select post_mortem_condemned_cuts", () =>
          supabase.from("post_mortem_condemned_cuts").select("id").ilike("tag_number", cleanTag)
        ))?.data || [];
        cutRows.forEach((r) => r.id && cutIds.push(r.id));
      }
    }

    // A real id always wins, so a targeted delete is exact.
    if (cleanId) {
      if (!evIds.includes(cleanId)) evIds.push(cleanId);
      if (!condIds.includes(cleanId)) condIds.push(cleanId);
    }
    if (Array.isArray(opts.condemnationId)) {
      opts.condemnationId.filter(Boolean).forEach((cid) => {
        if (!condIds.includes(cid)) condIds.push(cid);
      });
    }

    // ---------------------------------------------------------------- DB deletion
    // Photos/files first: if these fail the condemnation row is still deleted below, so a
    // storage problem can never block or revert the record deletion.
    if (storageKeys.size) {
      await run("storage remove", () =>
        supabase.storage.from("evidence").remove(Array.from(storageKeys))
      );
    }

    if (evIds.length) {
      await run("delete evidence_records", () =>
        supabase.from(TABLES.EVIDENCE_RECORDS || "evidence_records").delete().in("id", evIds)
      );
    }
    if (cutIds.length) {
      await run("delete post_mortem_condemned_cuts", () =>
        supabase.from("post_mortem_condemned_cuts").delete().in("id", cutIds)
      );
    }
    if (condIds.length) {
      // run() already recorded any { error } into errors.
      await run("delete condemnation_records", () =>
        supabase.from(TABLES.CONDEMNATION_RECORDS || "condemnation_records").delete().in("id", condIds)
      );
    }

    const deletedCondemnation = condIds.length > 0 && errors.length === 0;
    if (condIds.length && !deletedCondemnation && errors.length) {
      // The condemnation row is what the user asked to remove - surface the real reason.
      throw new Error(`Could not delete the condemnation record. ${errors.join(" | ")}`);
    }

    // ---------------------------------------------------------------- workflow state
    // Return the animal to the correct list. This must run after the rows are gone,
    // because it only resets the workflow when no condemnation/evidence rows remain.
    if (cleanTag) {
      try {
        await withTimeout(
          vetService.syncLivestockStatusAfterCondemnationDelete(cleanTag, stage),
          DEFAULT_TIMEOUT_MS,
          "livestock status reset"
        );
      } catch (e) {
        fail("livestock status reset", e.message || String(e));
      }
    }

    notifyChange(TABLES.CONDEMNATION_RECORDS, "delete", { id, tag: cleanTag });
    if (errors.length) {
      throw new Error(`Deleted the condemnation record, but some cleanup failed. ${errors.join(" | ")}`);
    }
    return { ok: true };
  },

  deleteCondemnationRecord: async (id, tagNumber) => {
    const cleanTag = tagNumber ? String(tagNumber).trim().toUpperCase() : null;
    const cleanId = id ? String(id).trim() : null;

    // Delete from Supabase tables by specific ID first
    try {
      if (cleanId && !cleanId.startsWith("cond-") && !cleanId.startsWith("mock-")) {
        await supabase.from(TABLES.CONDEMNATION_RECORDS || "condemnation_records").delete().eq("id", cleanId);
        await supabase.from("post_mortem_condemned_cuts").delete().eq("id", cleanId);
        await supabase.from(TABLES.EVIDENCE_RECORDS || "evidence_records").delete().eq("id", cleanId);
      } else if (cleanTag) {
        await supabase
          .from(TABLES.CONDEMNATION_RECORDS || "condemnation_records")
          .delete()
          .ilike("tag_number", cleanTag);
        await supabase
          .from("post_mortem_condemned_cuts")
          .delete()
          .ilike("tag_number", cleanTag);
      }
    } catch (e) {}

    if (cleanTag) {
      await vetService.syncLivestockStatusAfterCondemnationDelete(cleanTag);
    } else {
      notifyChange(TABLES.CONDEMNATION_RECORDS, "delete", { id: cleanId });
    }
    return { ok: true };
  },

  syncLivestockStatusAfterCondemnationDelete: async (tagNumber) => {
    if (!tagNumber) return;
    const cleanTag = String(tagNumber).trim().toUpperCase();

    try {
      // 1. Check if an Ante-Mortem inspection exists for this tag
      let anteRecord = null;
      try {
        const { data: aData } = await supabase
          .from(TABLES.ANTE_MORTEM)
          .select("*")
          .ilike("tag_number", cleanTag)
          .maybeSingle();
        anteRecord = aData;
      } catch (_) {}

      // 2. Check if a Post-Mortem inspection exists for this tag
      let postRecord = null;
      try {
        const { data: pData } = await supabase
          .from(TABLES.POST_MORTEM)
          .select("*")
          .ilike("tag_number", cleanTag)
          .maybeSingle();
        postRecord = pData;
      } catch (_) {}

      // If Ante-Mortem inspection was completed, preserve the inspection and do NOT return to Awaiting / Pending
      if (anteRecord) {
        const dec = String(anteRecord.decision || "").toLowerCase();
        const isAntePassed = dec.includes("pass") || dec.includes("fit") || dec.includes("approv");
        if (isAntePassed) {
          const { data: liveDb } = await supabase
            .from(TABLES.LIVESTOCK)
            .select("status, marked")
            .ilike("tag_number", cleanTag)
            .maybeSingle();

          const curSt = String(liveDb?.status || "").toLowerCase();
          if (curSt.includes("condemn") || curSt.includes("reject")) {
            const isMarked = Boolean(liveDb?.marked);
            const targetStatus = isMarked ? "Ready for Slaughter" : "Received";
            await supabase.from(TABLES.LIVESTOCK).update({ status: targetStatus }).ilike("tag_number", cleanTag);
          }
          notifyChange(TABLES.LIVESTOCK, "update", { tag: cleanTag });
          return;
        }
      }

      // If Post-Mortem inspection was completed, preserve inspection result and do NOT reset to Awaiting
      if (postRecord) {
        const pDec = String(postRecord.decision || "").toLowerCase();
        if (pDec.includes("pass") || pDec.includes("approv") || pDec.includes("partial")) {
          let isWeighed = false;
          try {
            const { data: dbCarcass } = await supabase
              .from(TABLES.CARCASS)
              .select("id")
              .ilike("tag_number", cleanTag)
              .maybeSingle();
            isWeighed = Boolean(dbCarcass);
          } catch (_) {}

          const targetStatus = isWeighed ? "Weighed" : "Approved";
          const { data: liveDb } = await supabase
            .from(TABLES.LIVESTOCK)
            .select("status")
            .ilike("tag_number", cleanTag)
            .maybeSingle();

          const curSt = String(liveDb?.status || "").toLowerCase();
          if (curSt.includes("condemn") || curSt.includes("reject") || curSt.includes("partial")) {
            await supabase.from(TABLES.LIVESTOCK).update({ status: targetStatus }).ilike("tag_number", cleanTag);
          }
          notifyChange(TABLES.LIVESTOCK, "update", { tag: cleanTag });
          return;
        }
      }

      notifyChange(TABLES.CONDEMNATION_RECORDS, "update", { tag: cleanTag });
    } catch (e) {
      console.error("Error in syncLivestockStatusAfterCondemnationDelete:", e);
      notifyChange(TABLES.CONDEMNATION_RECORDS, "update", { tag: cleanTag });
    }
  },

  getEvidenceFileUrl: (filePath) => {
    if (!filePath) return null;
    const { data } = supabase.storage.from("evidence").getPublicUrl(filePath);
    return data?.publicUrl || null;
  },

  listNotifications: () => supabase.from(TABLES.NOTIFICATIONS).select().then((r) => r.data),

  // Carcass Weighing & Branding
  listCarcass: () => staffService.listCarcass(),
  createCarcass: (p) => staffService.createCarcass(p),
  updateCarcass: (id, patch) => staffService.updateCarcass(id, patch),
};
