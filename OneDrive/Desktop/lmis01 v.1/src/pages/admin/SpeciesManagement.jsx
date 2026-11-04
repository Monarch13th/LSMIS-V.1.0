import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Modal,
  ConfirmDialog,
  AlertDialog,
  EmptyState,
} from "../../components/ui";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate } from "../../utils/formatters";
import {
  listSpecies,
  createSpecies,
  updateSpecies,
  toggleSpeciesStatus,
  deleteSpecies,
  getSpeciesLivestockCounts,
  checkSpeciesNameExists,
  uploadSpeciesImage,
  deleteSpeciesImage,
} from "../../services/speciesService";

export const SpeciesManagement = () => {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [speciesList, setSpeciesList] = useState([]);
  const [livestockCounts, setLivestockCounts] = useState({});
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Modals & States
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [viewingSpecies, setViewingSpecies] = useState(null);
  const [editingSpecies, setEditingSpecies] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Image Upload State
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Form Fields (Clean & Simplified)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    status: "Active",
    image_url: null,
    image_path: null,
  });

  // Action Dialogs
  const [confirmStatusToggle, setConfirmStatusToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [alertDialog, setAlertDialog] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info",
  });

  // Load Data
  const loadData = useCallback(async () => {
    try {
      const [speciesData, countsData] = await Promise.all([
        listSpecies({ activeOnly: false }),
        getSpeciesLivestockCounts(),
      ]);
      setSpeciesList(speciesData || []);
      setLivestockCounts(countsData || {});
    } catch (err) {
      console.error("Failed to load species data:", err);
      showToast("Failed to load species data from database", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();

    const handleSync = (e) => {
      const changedTable = e?.detail?.table || e?.table;
      if (
        !changedTable ||
        changedTable === TABLES.SPECIES ||
        changedTable === "species" ||
        changedTable === TABLES.LIVESTOCK
      ) {
        loadData();
      }
    };

    window.addEventListener("lmis-db-change", handleSync);
    window.addEventListener("storage", handleSync);

    const channel = supabase
      ?.channel("admin-species-management-realtime")
      ?.on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLES.SPECIES || "species" },
        () => {
          loadData();
        }
      )
      ?.subscribe();

    return () => {
      window.removeEventListener("lmis-db-change", handleSync);
      window.removeEventListener("storage", handleSync);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [loadData]);

  // Statistics
  const totalCount = speciesList.length;
  const activeCount = speciesList.filter((s) => s.status === "Active").length;
  const inactiveCount = totalCount - activeCount;

  // Filtered List
  const filteredList = useMemo(() => {
    return speciesList.filter((s) => {
      if (filterStatus !== "all" && s.status !== filterStatus) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = (s.name || "").toLowerCase().includes(q);
        const matchesCode = (s.code || "").toLowerCase().includes(q);
        const matchesDesc = (s.description || "").toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesDesc) return false;
      }
      return true;
    });
  }, [speciesList, filterStatus, search]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setEditingSpecies(null);
    setImageFile(null);
    setImagePreview("");
    setFormData({
      name: "",
      description: "",
      status: "Active",
      image_url: null,
      image_path: null,
    });
    setFormErrors({});
    setFormModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (spec) => {
    setEditingSpecies(spec);
    setImageFile(null);
    setImagePreview(spec.image_url || "");
    setFormData({
      name: spec.name || "",
      description: spec.description || "",
      status: spec.status || "Active",
      image_url: spec.image_url || null,
      image_path: spec.image_path || null,
    });
    setFormErrors({});
    setFormModalOpen(true);
  };

  // Handle File Selection with Type & Size Validation
  const processImageFile = (file) => {
    if (!file) return;

    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase()) && !file.type.startsWith("image/")) {
      showToast("Invalid format. Please upload a JPG, JPEG, PNG, or WEBP image.", "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("File is too large. Image size must be 5MB or less.", "error");
      return;
    }

    setImageFile(file);
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);

    if (formErrors.image) {
      setFormErrors((prev) => ({ ...prev, image: null }));
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Save Species (Add or Update)
  const handleSave = async (e) => {
    e?.preventDefault();
    const errors = {};

    const cleanName = formData.name.trim();
    if (!cleanName) {
      errors.name = "Species Name is required.";
    }

    // Animal Picture is strictly required
    const hasImage = Boolean(imageFile || formData.image_url);
    if (!hasImage) {
      errors.image = "Animal Picture is required. Please upload an image.";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    // Check duplicate name
    try {
      const isDuplicate = await checkSpeciesNameExists(
        cleanName,
        editingSpecies ? editingSpecies.id : null
      );
      if (isDuplicate) {
        setFormErrors({
          name: `A species named "${cleanName}" already exists. Species names must be unique.`,
        });
        return;
      }
    } catch (chkErr) {
      console.warn("Could not check duplicate name:", chkErr);
    }

    setSubmitting(true);
    setFormErrors({});

    let newUploadedImagePath = null;
    let finalImageUrl = formData.image_url;
    let finalImagePath = formData.image_path;

    try {
      // 1. Upload new image to Supabase Storage if selected
      if (imageFile) {
        const uploadRes = await uploadSpeciesImage(
          imageFile,
          cleanName.substring(0, 3).toUpperCase() || "spec"
        );
        finalImageUrl = uploadRes.imageUrl;
        finalImagePath = uploadRes.imagePath;
        newUploadedImagePath = uploadRes.imagePath;
      }

      // 2. Prepare payload
      const payload = {
        name: cleanName,
        code: cleanName.substring(0, 3).toUpperCase(),
        description: formData.description.trim(),
        status: formData.status,
        image_url: finalImageUrl,
        image_path: finalImagePath,
      };

      if (editingSpecies) {
        await updateSpecies(editingSpecies.id, payload);

        // 3. Remove old image from Storage ONLY after database update succeeds
        if (
          imageFile &&
          editingSpecies.image_path &&
          editingSpecies.image_path !== finalImagePath
        ) {
          try {
            await deleteSpeciesImage(editingSpecies.image_path);
          } catch (delStorageErr) {
            console.warn("Could not delete old species image:", delStorageErr);
          }
        }

        setAlertDialog({
          open: true,
          title: "Species Updated",
          message: `Livestock species "${cleanName}" has been successfully updated.`,
          variant: "success",
        });
        showToast(`Species "${cleanName}" updated successfully`, "success");
      } else {
        await createSpecies(payload);

        setAlertDialog({
          open: true,
          title: "Species Saved",
          message: `New species "${cleanName}" has been added and is now available for Staff livestock registration.`,
          variant: "success",
        });
        showToast(`Species "${cleanName}" added successfully`, "success");
      }

      setFormModalOpen(false);
      await loadData();
    } catch (err) {
      console.error("Save species error:", err);

      // Clean up newly uploaded image if database save failed to avoid orphaned files
      if (newUploadedImagePath) {
        try {
          await deleteSpeciesImage(newUploadedImagePath);
        } catch (cleanupErr) {
          console.warn("Failed to cleanup newly uploaded image after error:", cleanupErr);
        }
      }

      const msg = err.message || "Failed to save species record";
      setFormErrors({ general: msg });
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Confirm Status Toggle (Activate / Deactivate)
  const handleConfirmToggleStatus = async () => {
    if (!confirmStatusToggle) return;
    const spec = confirmStatusToggle;
    const nextStatus = spec.status === "Active" ? "Inactive" : "Active";

    try {
      await toggleSpeciesStatus(spec.id, spec.status);
      showToast(`Species "${spec.name}" is now ${nextStatus}`, "success");
      setConfirmStatusToggle(null);
      await loadData();
    } catch (err) {
      console.error("Toggle species status error:", err);
      showToast(err.message || "Failed to update species status", "error");
      setConfirmStatusToggle(null);
    }
  };

  // Delete Species
  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);

    try {
      await deleteSpecies(confirmDelete.id);
      showToast(`Species "${confirmDelete.name}" deleted successfully`, "success");
      setConfirmDelete(null);
      await loadData();
    } catch (err) {
      console.error("Delete species error:", err);
      setConfirmDelete(null);

      if (err.code === "SPECIES_IN_USE" || err.message?.includes("associated")) {
        setAlertDialog({
          open: true,
          title: "Cannot Delete Species In Use",
          message: err.message,
          variant: "warning",
        });
      } else {
        showToast(err.message || "Failed to delete species", "error");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="species-management-page records-page-container" style={{ width: "100%", padding: 0 }}>
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 12,
          overflow: "hidden",
          border: "none",
          boxShadow: "none",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Header Toolbar */}
        <div
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "nowrap",
            overflowX: "auto",
            scrollbarWidth: "none",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            minHeight: 54,
          }}
        >
          {/* Status Filter Pills */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {[
              { id: "all", label: "All Species", count: totalCount, icon: <Icon.Cow size={14} /> },
              { id: "Active", label: "Active", count: activeCount, icon: <Icon.CheckCircle size={14} /> },
              { id: "Inactive", label: "Inactive", count: inactiveCount, icon: <Icon.XCircle size={14} /> },
            ].map((tab) => {
              const active = filterStatus === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterStatus(tab.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: active ? 700 : 600,
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    background: active ? "var(--color-primary)" : "var(--color-surface-hover, rgba(0,0,0,0.04))",
                    color: active ? "#fff" : "var(--color-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 10,
                      background: active ? "rgba(255,255,255,0.25)" : "var(--color-bg)",
                      color: active ? "#fff" : "var(--color-text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Toolbar Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* Search Input */}
            <div style={{ position: "relative", width: 220 }}>
              <Icon.Search
                size={13}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                placeholder="Search species..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  paddingLeft: 30,
                  paddingRight: search ? 24 : 10,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontSize: 12,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: 2,
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Add Species Button */}
            <button
              type="button"
              onClick={handleOpenAddModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                borderRadius: 6,
                background: "var(--color-primary)",
                color: "#fff",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <Icon.Plus size={14} />
              <span>Add Species</span>
            </button>
          </div>
        </div>

        {/* Scrollable Records Table */}
        <div
          className="records-scrollable-content table-wrap"
          style={{
            overflowX: "auto",
            overflowY: "auto",
            scrollbarWidth: "thin",
            flex: 1,
            minHeight: 0,
          }}
        >
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  background: "var(--color-bg)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
                  Species
                </th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
                  Description
                </th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--color-text-muted)", width: "110px" }}>
                  Status
                </th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--color-text-muted)", width: "130px" }}>
                  Date Added
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--color-text-muted)", width: "230px" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((spec) => {
                const isActive = spec.status === "Active";
                const dateDisplay = formatDate(spec.created_at) || "—";

                return (
                  <tr
                    key={spec.id}
                    onClick={() => setViewingSpecies(spec)}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid var(--color-border)",
                      transition: "background-color 0.15s ease",
                    }}
                    className="personnel-table-row"
                    title="Click to view species details"
                  >
                    {/* Species: Picture & Name */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div
                          style={{
                            width: 50,
                            height: 50,
                            borderRadius: 8,
                            overflow: "hidden",
                            background: "#ffffff",
                            border: "1px solid var(--color-border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 2,
                            flexShrink: 0,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                          }}
                        >
                          {spec.image_url ? (
                            <img
                              src={spec.image_url}
                              alt={spec.name}
                              referrerPolicy="no-referrer"
                              style={{
                                maxWidth: "100%",
                                maxHeight: "100%",
                                width: "auto",
                                height: "auto",
                                objectFit: "contain",
                                display: "block",
                              }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                if (e.currentTarget.nextSibling) {
                                  e.currentTarget.nextSibling.style.display = "flex";
                                }
                              }}
                            />
                          ) : null}
                          <div
                            style={{
                              display: spec.image_url ? "none" : "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "100%",
                              height: "100%",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            <Icon.Cow size={22} />
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ fontWeight: 650, fontSize: "0.92rem", color: "var(--color-text)" }}>
                            {spec.name}
                          </div>
                          {spec.code && (
                            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              Tag Code: <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--color-text)" }}>{spec.code}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Description */}
                    <td style={{ padding: "12px 16px", color: "var(--color-text-muted)", fontSize: "0.85rem", maxWidth: 320 }}>
                      {spec.description ? (
                        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {spec.description}
                        </span>
                      ) : (
                        <span style={{ opacity: 0.5, fontStyle: "italic" }}>No description</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: isActive ? "#166534" : "#dc2626",
                          background: isActive ? "#f0fdf4" : "#fef2f2",
                          border: `1px solid ${isActive ? "#bbf7d0" : "#fecaca"}`,
                          padding: "3px 8px",
                          borderRadius: "6px",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: isActive ? "#16a34a" : "#dc2626",
                          }}
                        />
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </td>

                    {/* Date Added */}
                    <td style={{ padding: "12px 16px", color: "var(--color-text)", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                      {dateDisplay}
                    </td>

                    {/* Actions: View, Edit, Activate/Deactivate */}
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 6 }}
                      >
                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(spec)}
                          style={{
                            padding: "5px 9px",
                            borderRadius: "6px",
                            border: "1px solid var(--color-border)",
                            background: "transparent",
                            color: "var(--color-text)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            transition: "all 0.15s ease",
                          }}
                          title="Edit species"
                        >
                          <Icon.Edit size={13} />
                          <span>Edit</span>
                        </button>

                        {/* Activate / Deactivate Toggle Button */}
                        {isActive ? (
                          <button
                            type="button"
                            onClick={() => setConfirmStatusToggle(spec)}
                            style={{
                              padding: "5px 9px",
                              borderRadius: "6px",
                              border: "1px solid #fecaca",
                              background: "#fef2f2",
                              color: "#991b1b",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: 600,
                              transition: "all 0.15s ease",
                            }}
                            title="Deactivate species (hide from new intake)"
                          >
                            <Icon.XCircle size={13} style={{ color: "#dc2626" }} />
                            <span>Deactivate</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmStatusToggle(spec)}
                            style={{
                              padding: "5px 9px",
                              borderRadius: "6px",
                              border: "1px solid #bbf7d0",
                              background: "#f0fdf4",
                              color: "#166534",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: 600,
                              transition: "all 0.15s ease",
                            }}
                            title="Activate species"
                          >
                            <Icon.CheckCircle size={13} style={{ color: "#16a34a" }} />
                            <span>Activate</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredList.length === 0 && !loading && (
          <EmptyState
            title="No species found"
            message={
              search || filterStatus !== "all"
                ? "No species records match your current search or status filter criteria."
                : "No livestock species configured in the system."
            }
            icon={<Icon.Cow size={36} />}
          />
        )}
      </div>

      {/* ============================================================ */}
      {/* ADD / EDIT SPECIES MODAL (CLEAN & REDESIGNED)                */}
      {/* ============================================================ */}
      <Modal
        open={formModalOpen}
        onClose={() => !submitting && setFormModalOpen(false)}
        title={editingSpecies ? "Edit Livestock Species" : "Add New Livestock Species"}
        size="md"
        dialogStyle={{ maxWidth: "520px" }}
        bodyStyle={{ padding: "18px 22px" }}
      >
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {formErrors.general && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
                fontSize: 12.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon.AlertTriangle size={16} />
              <span>{formErrors.general}</span>
            </div>
          )}

          {/* 1. Species Name (Required) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: "0.8rem", marginBottom: "5px", fontWeight: 700 }}>
              Species Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. Hog, Cattle, Carabao, Goat, Sheep"
              value={formData.name}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, name: e.target.value }));
                if (formErrors.name) setFormErrors((prev) => ({ ...prev, name: null }));
              }}
              style={{
                height: "38px",
                fontSize: "0.85rem",
                border: formErrors.name ? "1.5px solid #ef4444" : undefined,
              }}
              required
            />
            {formErrors.name && (
              <span style={{ fontSize: "0.75rem", color: "#ef4444", marginTop: 4, display: "block", fontWeight: 600 }}>
                {formErrors.name}
              </span>
            )}
          </div>

          {/* 2. Animal Picture Upload Area (Required, Clean & Visual) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
              <label className="form-label" style={{ fontSize: "0.8rem", marginBottom: 0, fontWeight: 700 }}>
                Animal Picture <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                JPG, JPEG, PNG, WEBP (Max 5MB)
              </span>
            </div>

            {/* Hidden native input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/jpg"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            {!imagePreview ? (
              /* Empty Upload Dropzone */
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                style={{
                  border: formErrors.image
                    ? "2px dashed #ef4444"
                    : isDragging
                    ? "2px dashed var(--color-primary)"
                    : "1.5px dashed var(--color-border)",
                  borderRadius: 10,
                  padding: "24px 16px",
                  background: isDragging
                    ? "rgba(16, 185, 129, 0.05)"
                    : "var(--color-bg)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "var(--color-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon.Upload size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 650, color: "var(--color-text)" }}>
                    Click to upload animal picture
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: 2 }}>
                    or drag and drop file here
                  </div>
                </div>
              </div>
            ) : (
              /* Selected Image Preview with Change Picture action */
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  padding: "10px 14px",
                  background: "var(--color-bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "#ffffff",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 2,
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={imagePreview}
                      alt="Preview"
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        width: "auto",
                        height: "auto",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "var(--color-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={imageFile ? imageFile.name : `${formData.name || "Species"} Picture`}
                    >
                      {imageFile ? imageFile.name : `${formData.name || "Species"} Picture`}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
                      ✓ Picture ready
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                  title="Upload a different picture"
                >
                  <Icon.Upload size={13} />
                  <span>Change Picture</span>
                </button>
              </div>
            )}

            {formErrors.image && (
              <span style={{ fontSize: "0.75rem", color: "#ef4444", marginTop: 4, display: "block", fontWeight: 600 }}>
                {formErrors.image}
              </span>
            )}
          </div>

          {/* 3. Description (Optional) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: "0.8rem", marginBottom: "5px", fontWeight: 700 }}>
              Description <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>(Optional)</span>
            </label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="e.g. Swine livestock or domestic pig classification notes"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              style={{ fontSize: "0.85rem", resize: "vertical" }}
            />
          </div>

          {/* 4. Status (Active / Inactive) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: "0.8rem", marginBottom: "6px", fontWeight: 700 }}>
              Status
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label
                onClick={() => setFormData((prev) => ({ ...prev, status: "Active" }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: formData.status === "Active" ? "1.5px solid #16a34a" : "1px solid var(--color-border)",
                  background: formData.status === "Active" ? "#f0fdf4" : "var(--color-bg)",
                  color: formData.status === "Active" ? "#166534" : "var(--color-text)",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: formData.status === "Active" ? 700 : 500,
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  name="species_status"
                  value="Active"
                  checked={formData.status === "Active"}
                  onChange={() => {}}
                  style={{ accentColor: "#16a34a" }}
                />
                <span>Active</span>
              </label>

              <label
                onClick={() => setFormData((prev) => ({ ...prev, status: "Inactive" }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: formData.status === "Inactive" ? "1.5px solid #dc2626" : "1px solid var(--color-border)",
                  background: formData.status === "Inactive" ? "#fef2f2" : "var(--color-bg)",
                  color: formData.status === "Inactive" ? "#991b1b" : "var(--color-text)",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: formData.status === "Inactive" ? 700 : 500,
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  name="species_status"
                  value="Inactive"
                  checked={formData.status === "Inactive"}
                  onChange={() => {}}
                  style={{ accentColor: "#dc2626" }}
                />
                <span>Inactive</span>
              </label>
            </div>
            <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: 4, display: "block" }}>
              Active species appear automatically in Staff Personnel's Register Livestock options.
            </span>
          </div>

          {/* Form Action Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 10,
              paddingTop: 12,
              borderTop: "1px solid var(--color-border)",
              marginTop: 4,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => setFormModalOpen(false)}
              style={{ height: "36px", padding: "0 16px", fontSize: "0.82rem" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ height: "36px", padding: "0 18px", fontSize: "0.82rem", minWidth: 110 }}
            >
              {submitting ? "Saving..." : editingSpecies ? "Save Changes" : "Save Species"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ============================================================ */}
      {/* VIEW SPECIES DETAILS MODAL                                   */}
      {/* ============================================================ */}
      <Modal
        open={Boolean(viewingSpecies)}
        onClose={() => setViewingSpecies(null)}
        title="Species Details"
        size="md"
        dialogStyle={{ maxWidth: "480px" }}
        bodyStyle={{ padding: "18px 22px" }}
      >
        {viewingSpecies && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* High-res Image Preview */}
            <div
              style={{
                width: "100%",
                height: 180,
                borderRadius: 10,
                overflow: "hidden",
                background: "#ffffff",
                border: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                padding: 10,
              }}
            >
              {viewingSpecies.image_url ? (
                <img
                  src={viewingSpecies.image_url}
                  alt={viewingSpecies.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--color-text-muted)" }}>
                  <Icon.Cow size={44} />
                  <span style={{ fontSize: "0.78rem" }}>No image uploaded</span>
                </div>
              )}
            </div>

            {/* Info Grid */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 750, color: "var(--color-text)", margin: 0 }}>
                    {viewingSpecies.name}
                  </h3>
                  {viewingSpecies.code && (
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Tag Code: <strong style={{ color: "var(--color-text)" }}>{viewingSpecies.code}</strong>
                    </span>
                  )}
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: viewingSpecies.status === "Active" ? "#166534" : "#dc2626",
                    background: viewingSpecies.status === "Active" ? "#f0fdf4" : "#fef2f2",
                    border: `1px solid ${viewingSpecies.status === "Active" ? "#bbf7d0" : "#fecaca"}`,
                    padding: "3px 8px",
                    borderRadius: "6px",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: viewingSpecies.status === "Active" ? "#16a34a" : "#dc2626",
                    }}
                  />
                  {viewingSpecies.status || "Active"}
                </span>
              </div>

              {/* Description */}
              <div style={{ background: "var(--color-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: 4 }}>
                  Description
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--color-text)" }}>
                  {viewingSpecies.description || <span style={{ opacity: 0.5, fontStyle: "italic" }}>No description provided.</span>}
                </div>
              </div>

              {/* Metadata details */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: "var(--color-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: 2 }}>
                    Date Added
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 650, color: "var(--color-text)" }}>
                    {formatDate(viewingSpecies.created_at) || "—"}
                  </div>
                </div>

                <div style={{ background: "var(--color-bg)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: 2 }}>
                    Linked Livestock
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 650, color: "var(--color-text)" }}>
                    {livestockCounts[viewingSpecies.id] || livestockCounts[viewingSpecies.name] || 0} heads
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                paddingTop: 12,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setViewingSpecies(null)}
                style={{ height: "36px", padding: "0 14px", fontSize: "0.82rem" }}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const s = viewingSpecies;
                  setViewingSpecies(null);
                  handleOpenEditModal(s);
                }}
                style={{ height: "36px", padding: "0 14px", fontSize: "0.82rem", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon.Edit size={13} />
                <span>Edit Species</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* CONFIRM STATUS TOGGLE DIALOG                                 */}
      {/* ============================================================ */}
      <ConfirmDialog
        open={Boolean(confirmStatusToggle)}
        onCancel={() => setConfirmStatusToggle(null)}
        onConfirm={handleConfirmToggleStatus}
        title={
          confirmStatusToggle?.status === "Active"
            ? `Deactivate ${confirmStatusToggle?.name}?`
            : `Activate ${confirmStatusToggle?.name}?`
        }
        message={
          confirmStatusToggle?.status === "Active"
            ? `Deactivating "${confirmStatusToggle?.name}" will hide it from Staff's Register Livestock options. Existing livestock records will not be affected.`
            : `Activating "${confirmStatusToggle?.name}" will make it immediately available in Staff's Register Livestock options.`
        }
        confirmText={confirmStatusToggle?.status === "Active" ? "Deactivate" : "Activate"}
        confirmVariant={confirmStatusToggle?.status === "Active" ? "danger" : "primary"}
      />

      {/* ============================================================ */}
      {/* CONFIRM DELETE DIALOG                                        */}
      {/* ============================================================ */}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Livestock Species?"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? If there are any livestock records linked to this species, deletion will be blocked to maintain data integrity.`}
        confirmText="Delete Species"
        confirmVariant="danger"
        loading={deleting}
      />

      {/* ============================================================ */}
      {/* ALERT / NOTIFICATION DIALOG                                  */}
      {/* ============================================================ */}
      <AlertDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog((prev) => ({ ...prev, open: false }))}
        title={alertDialog.title}
        message={alertDialog.message}
        variant={alertDialog.variant}
        buttonText="OK"
      />
    </div>
  );
};

export default SpeciesManagement;
