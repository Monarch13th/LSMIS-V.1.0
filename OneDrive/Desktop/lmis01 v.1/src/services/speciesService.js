import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { logActivity } from "./activityService";
import { TABLES } from "../utils/constants";

// Default fallback species in case database is temporarily unreachable
export const DEFAULT_SPECIES = [
  {
    id: "spec-hog",
    name: "Hog",
    code: "HOG",
    description: "Swine / Porcine livestock",
    color: "#a855f7",
    icon: "Pig",
    status: "Active",
    sort_order: 1,
  },
  {
    id: "spec-cattle",
    name: "Cattle",
    code: "CAT",
    description: "Bovine livestock / Large cattle",
    color: "#0284c7",
    icon: "Cow",
    status: "Active",
    sort_order: 2,
  },
  {
    id: "spec-carabao",
    name: "Carabao",
    code: "CAR",
    description: "Water buffalo (Bubalus bubalis)",
    color: "#10b981",
    icon: "Cow",
    status: "Active",
    sort_order: 3,
  },
  {
    id: "spec-goat",
    name: "Goat",
    code: "GOA",
    description: "Caprine / Small ruminant livestock",
    color: "#f59e0b",
    icon: "Cow",
    status: "Active",
    sort_order: 4,
  },
];

/**
 * Fetch all species ordered by sort_order
 * @param {Object} options
 * @param {boolean} options.activeOnly
 */
export async function listSpecies({ activeOnly = false } = {}) {
  try {
    let query = supabase
      .from(TABLES.SPECIES)
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (activeOnly) {
      query = query.eq("status", "Active");
    }

    const { data, error } = await query;
    if (error) {
      console.warn("Failed to fetch species from Supabase, falling back to defaults:", error.message);
      return activeOnly
        ? DEFAULT_SPECIES.filter((s) => s.status === "Active")
        : DEFAULT_SPECIES;
    }

    if (!data || data.length === 0) {
      return activeOnly
        ? DEFAULT_SPECIES.filter((s) => s.status === "Active")
        : DEFAULT_SPECIES;
    }

    return data;
  } catch (err) {
    console.error("Error in listSpecies:", err);
    return activeOnly
      ? DEFAULT_SPECIES.filter((s) => s.status === "Active")
      : DEFAULT_SPECIES;
  }
}

/**
 * Fetch head count of livestock per species
 * Returns a map of { [speciesName]: count, [speciesId]: count }
 */
export async function getSpeciesLivestockCounts() {
  try {
    const { data, error } = await supabase
      .from(TABLES.LIVESTOCK)
      .select("species, species_id");

    if (error) {
      console.warn("Could not query livestock counts:", error.message);
      return {};
    }

    const counts = {};
    (data || []).forEach((row) => {
      if (row.species) {
        const nameKey = String(row.species).trim();
        counts[nameKey] = (counts[nameKey] || 0) + 1;
        counts[nameKey.toLowerCase()] = (counts[nameKey.toLowerCase()] || 0) + 1;
      }
      if (row.species_id) {
        counts[row.species_id] = (counts[row.species_id] || 0) + 1;
      }
    });

    return counts;
  } catch (err) {
    console.error("Error in getSpeciesLivestockCounts:", err);
    return {};
  }
}

/**
 * Check if a species name already exists (case-insensitive)
 * @param {string} name
 * @param {string} excludeId
 */
export async function checkSpeciesNameExists(name, excludeId = null) {
  const cleanName = (name || "").trim().toLowerCase();
  if (!cleanName) return false;

  const { data, error } = await supabase
    .from(TABLES.SPECIES)
    .select("id, name");

  if (error || !data) return false;

  return data.some(
    (s) =>
      (!excludeId || s.id !== excludeId) &&
      s.name.trim().toLowerCase() === cleanName
  );
}

/**
 * Add a new livestock species
 */
export async function createSpecies(payload) {
  const trimmedName = (payload.name || "").trim();
  if (!trimmedName) {
    throw new Error("Species name is required.");
  }

  // Check duplicate
  const exists = await checkSpeciesNameExists(trimmedName);
  if (exists) {
    throw new Error(`Species with name "${trimmedName}" already exists.`);
  }

  // Determine code
  let code = (payload.code || "").trim().toUpperCase();
  if (!code) {
    code = trimmedName.substring(0, 3).toUpperCase();
  }

  // Generate ID
  const id = `spec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // Determine next sort_order
  let nextSort = 1;
  const { data: existing } = await supabase
    .from(TABLES.SPECIES)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0 && existing[0].sort_order != null) {
    nextSort = existing[0].sort_order + 1;
  }

  const record = {
    id,
    name: trimmedName,
    code,
    description: (payload.description || "").trim(),
    color: payload.color || "#059669",
    icon: payload.icon || "Cow",
    image_url: payload.image_url || null,
    image_path: payload.image_path || null,
    status: payload.status || "Active",
    sort_order: payload.sort_order != null ? Number(payload.sort_order) : nextSort,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLES.SPECIES)
    .insert([record])
    .select()
    .single();

  if (error) {
    throw new Error(error.message || "Failed to create species.");
  }

  // Notify real-time listeners across tabs/devices
  notifyDbChange(TABLES.SPECIES, "insert", data);

  // Log activity
  try {
    await logActivity({
      action: "Created",
      module: "Species Management",
      details: `Created new livestock species "${trimmedName}" (${code})`,
      new_value: data,
    });
  } catch (logErr) {
    console.warn("Activity log failed:", logErr);
  }

  return data;
}

/**
 * Update an existing species
 */
export async function updateSpecies(id, patch) {
  if (!id) throw new Error("Species ID is required.");

  const updates = { ...patch, updated_at: new Date().toISOString() };

  // If renaming, check for uniqueness and propagate to livestock records
  let oldSpeciesRecord = null;
  if (patch.name) {
    const trimmedName = patch.name.trim();
    if (!trimmedName) throw new Error("Species name cannot be empty.");

    const exists = await checkSpeciesNameExists(trimmedName, id);
    if (exists) {
      throw new Error(`Species with name "${trimmedName}" already exists.`);
    }

    updates.name = trimmedName;

    // Fetch current record to see if name changed
    const { data: current } = await supabase
      .from(TABLES.SPECIES)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    oldSpeciesRecord = current;
  }

  if (patch.code) {
    updates.code = patch.code.trim().toUpperCase();
  }

  const { data, error } = await supabase
    .from(TABLES.SPECIES)
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || "Failed to update species.");
  }

  // If name changed, synchronize existing livestock records
  if (oldSpeciesRecord && oldSpeciesRecord.name !== updates.name) {
    try {
      await supabase
        .from(TABLES.LIVESTOCK)
        .update({ species: updates.name })
        .eq("species_id", id);

      notifyDbChange(TABLES.LIVESTOCK, "update", { species: updates.name, species_id: id });
    } catch (syncErr) {
      console.warn("Failed to synchronize species name in livestock:", syncErr);
    }
  }

  notifyDbChange(TABLES.SPECIES, "update", data);

  try {
    await logActivity({
      action: "Updated",
      module: "Species Management",
      details: `Updated species "${data.name}"`,
      old_value: oldSpeciesRecord,
      new_value: data,
    });
  } catch (logErr) {
    console.warn("Activity log failed:", logErr);
  }

  return data;
}

/**
 * Toggle active/inactive status
 */
export async function toggleSpeciesStatus(id, currentStatus) {
  const nextStatus = currentStatus === "Active" ? "Inactive" : "Active";
  return updateSpecies(id, { status: nextStatus });
}

/**
 * Upload an animal picture to Supabase Storage ('species' bucket)
 * Returns { imageUrl, imagePath }
 */
export async function uploadSpeciesImage(file, identifier = "species") {
  if (!file) throw new Error("No image file provided.");

  // Validate mime type
  const validMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!validMimes.includes(file.type.toLowerCase()) && !file.type.startsWith("image/")) {
    throw new Error("Invalid image format. Allowed formats: JPG, JPEG, PNG, WEBP.");
  }

  // Validate size (5MB limit)
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image size exceeds the 5MB limit.");
  }

  const cleanId = String(identifier || "species")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase();
  const fileExt = file.name ? file.name.split(".").pop().toLowerCase() : "png";
  const imagePath = `${cleanId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("species")
    .upload(imagePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    console.error("Species image upload error:", uploadError);
    throw new Error(`Failed to upload animal picture: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage
    .from("species")
    .getPublicUrl(imagePath);

  if (!urlData?.publicUrl) {
    throw new Error("Failed to generate public URL for uploaded animal picture.");
  }

  return {
    imageUrl: urlData.publicUrl,
    imagePath,
  };
}

/**
 * Delete an animal picture from Supabase Storage ('species' bucket)
 */
export async function deleteSpeciesImage(imagePath) {
  if (!imagePath) return;
  try {
    const { error } = await supabase.storage
      .from("species")
      .remove([imagePath]);
    if (error) {
      console.warn("Could not delete old species image from storage:", error.message);
    }
  } catch (err) {
    console.warn("deleteSpeciesImage error:", err);
  }
}

/**
 * Delete a species. Prevents deletion if any livestock are using it.
 */
export async function deleteSpecies(id) {
  if (!id) throw new Error("Species ID is required.");

  // 1. Fetch current species
  const { data: speciesRecord, error: fetchErr } = await supabase
    .from(TABLES.SPECIES)
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !speciesRecord) {
    throw new Error("Species record not found.");
  }

  // 2. Check if any livestock are linked
  const { data: linkedLivestock, error: countErr } = await supabase
    .from(TABLES.LIVESTOCK)
    .select("id")
    .or(`species_id.eq.${id},species.ilike.${speciesRecord.name}`)
    .limit(10);

  if (countErr) {
    console.warn("Error checking linked livestock:", countErr);
  }

  if (linkedLivestock && linkedLivestock.length > 0) {
    const count = linkedLivestock.length;
    const countText = count >= 10 ? "10+ livestock records" : `${count} livestock record(s)`;
    const error = new Error(
      `Cannot delete "${speciesRecord.name}" because ${countText} are currently associated with it. Please mark this species as "Inactive" instead to prevent future registrations.`
    );
    error.code = "SPECIES_IN_USE";
    error.count = count;
    throw error;
  }

  // 3. Delete from Supabase
  const { error: delErr } = await supabase
    .from(TABLES.SPECIES)
    .delete()
    .eq("id", id);

  if (delErr) {
    throw new Error(delErr.message || "Failed to delete species.");
  }

  // Clean up image from storage if present
  if (speciesRecord.image_path) {
    deleteSpeciesImage(speciesRecord.image_path);
  }

  notifyDbChange(TABLES.SPECIES, "delete", { id, name: speciesRecord.name });

  try {
    await logActivity({
      action: "Deleted",
      module: "Species Management",
      details: `Deleted livestock species "${speciesRecord.name}"`,
      old_value: speciesRecord,
    });
  } catch (logErr) {
    console.warn("Activity log failed:", logErr);
  }

  return true;
}
