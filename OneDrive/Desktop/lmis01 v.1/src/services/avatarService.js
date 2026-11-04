import { supabase } from "./supabaseClient";

/**
 * Uploads an avatar image to Supabase Storage ('avatars' bucket)
 * and returns the public CDN URL.
 * Throws a descriptive error if storage upload fails so errors are not silently ignored.
 */
export const uploadAvatarFile = async (file, userIdOrEmail) => {
  if (!file) throw new Error("No file provided for upload");

  // Basic validation: max 5MB, must be image
  if (!file.type.startsWith("image/")) {
    throw new Error("File must be an image (PNG, JPG, JPEG, WEBP)");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image size exceeds 5MB limit");
  }

  const cleanIdentifier = String(userIdOrEmail || "user")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase();
  const fileExt = file.name.split(".").pop() || "png";
  const filePath = `${cleanIdentifier}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    console.error("Supabase storage upload error:", uploadError);
    throw new Error("Supabase Storage error: " + (uploadError.message || "Failed to upload avatar image to storage."));
  }

  const { data: urlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  if (!urlData?.publicUrl) {
    throw new Error("Failed to retrieve public CDN URL for the uploaded photo.");
  }

  return urlData.publicUrl;
};
