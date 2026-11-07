import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { ConfirmDialog } from "../ui/Modal";
import { listSpecies } from "../../services/speciesService";
import { TABLES } from "../../utils/constants";
import { supabase } from "../../services/supabaseClient";
import { scrollToFirstError } from "../../utils/formValidation";
import { SearchableAgeInput, validateAgeInput, extractAgeComponents } from "../common/SearchableAgeInput";

export const SPECIES_CONFIG = [
  { id: "Hog", label: "Hog", color: "#a855f7", dbId: "spec-hog", image_url: null },
  { id: "Cattle", label: "Cattle", color: "#0284c7", dbId: "spec-cattle", image_url: null },
  { id: "Carabao", label: "Carabao", color: "#10b981", dbId: "spec-carabao", image_url: null },
  { id: "Goat", label: "Goat", color: "#f59e0b", dbId: "spec-goat", image_url: null },
];

export const formatAgeString = (value, unit) => {
  if (!value || isNaN(Number(value))) return "";
  const num = parseInt(value, 10);
  const cleanUnit = (unit || "Months").trim().toLowerCase();
  if (cleanUnit.startsWith("year")) {
    return num === 1 ? "1 Year" : `${num} Years`;
  }
  return num === 1 ? "1 Month" : `${num} Months`;
};

// Initial entry starts with no selected sex ("")
const createInitialEntry = (defaultSpecies = "Hog", defaultSex = "") => ({
  id: "entry_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
  species: defaultSpecies,
  species_id: null,
  sex: defaultSex,
  age: "",
  age_value: "",
  age_unit: "Months",
  quantity: 1,
});

export const MultiLivestockForm = ({
  owner,
  allKnownRows = [],
  onSubmit,
  onCancel,
}) => {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [currentOwner, setCurrentOwner] = useState(owner || null);

  // Synchronize owner profile if needed
  useEffect(() => {
    let isMounted = true;
    const fetchLatestOwner = async () => {
      const targetId = owner?.id || owner?.owner_id || owner?.temp_reg_id;
      if (!targetId) {
        if (isMounted) setCurrentOwner(owner || null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from(TABLES.OWNERS)
          .select("*")
          .or(`id.eq.${targetId},temp_reg_id.eq.${targetId}`)
          .maybeSingle();
        if (isMounted && data && !error) {
          setCurrentOwner(data);
        } else if (isMounted) {
          setCurrentOwner(owner || null);
        }
      } catch (_) {
        if (isMounted) setCurrentOwner(owner || null);
      }
    };
    fetchLatestOwner();
    return () => {
      isMounted = false;
    };
  }, [owner?.id, owner?.owner_id, owner?.temp_reg_id]);

  const activeOwner = currentOwner || owner;
  const ownerName =
    activeOwner?.name ||
    activeOwner?.full_name ||
    activeOwner?.owner_name ||
    (activeOwner?.first_name ? `${activeOwner.first_name} ${activeOwner.last_name || ""}`.trim() : "") ||
    "Owner";

  // Dynamic active species list from database
  const [speciesList, setSpeciesList] = useState(SPECIES_CONFIG);

  const loadSpecies = useCallback(async () => {
    try {
      const data = await listSpecies({ activeOnly: true });
      if (Array.isArray(data) && data.length > 0) {
        setSpeciesList(
          data.map((s) => ({
            id: s.name,
            label: s.name,
            color: s.color || "#059669",
            dbId: s.id,
            code: s.code || s.name.substring(0, 3).toUpperCase(),
            image_url: s.image_url || null,
          }))
        );
      }
    } catch (err) {
      console.warn("Failed to load active species:", err);
    }
  }, []);

  useEffect(() => {
    loadSpecies();

    const handleSpeciesChange = (e) => {
      const changedTable = e?.detail?.table || e?.table;
      if (changedTable === TABLES.SPECIES || changedTable === "species" || !changedTable) {
        loadSpecies();
      }
    };

    window.addEventListener("lmis-db-change", handleSpeciesChange);

    const channel = supabase
      ?.channel("staff-species-sync-livestock-form")
      ?.on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLES.SPECIES || "species" },
        () => {
          loadSpecies();
        }
      )
      ?.subscribe();

    return () => {
      window.removeEventListener("lmis-db-change", handleSpeciesChange);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [loadSpecies]);

  // Dynamic livestock entries state - initial entry starts with no selected sex
  const [entries, setEntries] = useState([
    createInitialEntry(speciesList?.[0]?.id || "Hog", ""),
  ]);

  // Reset form when owner changes
  useEffect(() => {
    const defaultSpec = speciesList?.[0]?.id || "Hog";
    setEntries([createInitialEntry(defaultSpec, "")]);
    setErrors({});
    setShowConfirm(false);
    setSubmitting(false);
  }, [owner?.id, owner?.owner_id]);

  // Total head count across all entries
  const totalHeadCount = useMemo(() => {
    return entries.reduce((sum, item) => {
      const rawQty = String(item.quantity || "").trim();
      if (rawQty.includes(".") || !/^\d+$/.test(rawQty)) return sum;
      const qty = parseInt(rawQty, 10);
      return sum + (isNaN(qty) || qty < 1 ? 0 : qty);
    }, 0);
  }, [entries]);

  // Escape key handling for confirmation modal
  useEffect(() => {
    if (!showConfirm) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !submitting) {
        setShowConfirm(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showConfirm, submitting]);

  // Add another livestock entry - starts with NO selected sex ("")
  const handleAddLivestockEntry = () => {
    const lastEntry = entries[entries.length - 1];
    const nextSpecies = lastEntry?.species || speciesList?.[0]?.id || "Hog";

    // Strictly start with no selected sex (""), independent of previous entries
    const newEntry = createInitialEntry(nextSpecies, "");
    const matched = speciesList.find((s) => s.id === nextSpecies || s.label === nextSpecies);
    if (matched) newEntry.species_id = matched.dbId;

    setEntries((prev) => [...prev, newEntry]);
  };

  // Check if entry has entered data
  const hasEnteredData = (entry) => {
    return Boolean(
      (entry.sex && entry.sex.trim()) ||
      (entry.age && String(entry.age).trim()) ||
      (entry.age_value && String(entry.age_value).trim()) ||
      (entry.quantity && parseInt(entry.quantity, 10) > 1)
    );
  };

  // Request removing a livestock entry
  const handleRequestRemoveEntry = (entry) => {
    if (entries.length <= 1) {
      showToast("A registration transaction must have at least one livestock entry.", "warning");
      return;
    }
    if (hasEnteredData(entry)) {
      setEntryToDelete(entry);
    } else {
      executeRemoveEntry(entry.id);
    }
  };

  const executeRemoveEntry = (entryId) => {
    setEntries((prev) => prev.filter((item) => item.id !== entryId));
    setEntryToDelete(null);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`species_${entryId}`];
      delete next[`sex_${entryId}`];
      delete next[`age_${entryId}`];
      delete next[`quantity_${entryId}`];
      return next;
    });
  };

  // Update specific field on an entry without affecting any other entry
  const handleUpdateEntry = (entryId, field, value) => {
    let currentEntry = null;

    setEntries((prev) =>
      prev.map((item) => {
        if (item.id !== entryId) return item;
        const updated = { ...item, [field]: value };
        if (field === "species") {
          const matched = speciesList.find((s) => s.id === value || s.label === value);
          updated.species_id = matched?.dbId || null;
        }
        currentEntry = updated;
        return updated;
      })
    );

    const target = currentEntry || entries.find((item) => item.id === entryId) || {};
    const effectiveAgeUnit = field === "age_unit" ? value : target.age_unit;
    const effectiveAgeValue = field === "age_value" ? value : target.age_value;

    setErrors((prev) => {
      const next = { ...prev };
      if (field === "species" && value) delete next[`species_${entryId}`];
      if (field === "sex" && value) delete next[`sex_${entryId}`];

      // Instant validation for age while typing or selecting
      if (field === "age" || field === "age_value") {
        const strVal = String(value || "").trim();
        if (!strVal) {
          delete next[`age_${entryId}`];
        } else {
          const err = validateAgeInput(strVal);
          if (err) {
            next[`age_${entryId}`] = err;
          } else {
            delete next[`age_${entryId}`];
          }
        }
      }

      // Instant integer validation for quantity while typing
      if (field === "quantity") {
        const strVal = String(value || "").trim();
        if (strVal.includes(".") || (strVal && !/^\d+$/.test(strVal))) {
          next[`quantity_${entryId}`] = "Quantity must be a positive whole number (no decimals allowed).";
        } else if (strVal && parseInt(strVal, 10) < 1) {
          next[`quantity_${entryId}`] = "Quantity must be at least 1.";
        } else if (strVal && parseInt(strVal, 10) >= 1) {
          delete next[`quantity_${entryId}`];
        }
      }

      return next;
    });
  };

  // Validate all entries before opening confirmation dialog
  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};

    if (entries.length === 0) {
      showToast("Please add at least one livestock entry.", "error");
      return;
    }

    entries.forEach((item, idx) => {
      const num = idx + 1;
      if (!item.species) {
        newErrors[`species_${item.id}`] = `Entry #${num}: Please select animal species.`;
      }
      if (!item.sex) {
        newErrors[`sex_${item.id}`] = `Entry #${num}: Please select animal sex (Male or Female).`;
      }

      const ageStr = String(item.age || item.age_value || "").trim();
      if (!ageStr) {
        newErrors[`age_${item.id}`] = `Entry #${num}: Please enter animal age.`;
      } else {
        const ageErr = validateAgeInput(ageStr);
        if (ageErr) {
          newErrors[`age_${item.id}`] = `Entry #${num}: ${ageErr}`;
        }
      }

      const qtyStr = String(item.quantity || "").trim();
      if (!qtyStr) {
        newErrors[`quantity_${item.id}`] = `Entry #${num}: Please enter quantity.`;
      } else if (qtyStr.includes(".") || !/^\d+$/.test(qtyStr)) {
        newErrors[`quantity_${item.id}`] = `Entry #${num}: Quantity must be a positive whole number (no decimals allowed).`;
      } else {
        const qty = parseInt(qtyStr, 10);
        if (isNaN(qty) || qty < 1) {
          newErrors[`quantity_${item.id}`] = `Entry #${num}: Quantity must be at least 1.`;
        }
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast("Please complete all required fields with whole numbers before submitting.", "error");

      // Automatically navigate and scroll to the first invalid field in form order
      let firstErrorId = null;
      for (const item of entries) {
        if (newErrors[`species_${item.id}`]) {
          firstErrorId = `species_${item.id}`;
          break;
        }
        if (newErrors[`sex_${item.id}`]) {
          firstErrorId = `sex_${item.id}`;
          break;
        }
        if (newErrors[`age_${item.id}`]) {
          firstErrorId = `age_${item.id}`;
          break;
        }
        if (newErrors[`quantity_${item.id}`]) {
          firstErrorId = `quantity_${item.id}`;
          break;
        }
      }

      if (firstErrorId) {
        scrollToFirstError(firstErrorId, { offset: 90 });
      }
      return;
    }

    setErrors({});
    setShowConfirm(true);
  };

  // Confirm and deliver formatted records to parent handler
  const handleConfirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const formattedEntries = entries.map((item) => {
        const matchedSpecies = (speciesList || []).find(
          (s) => s.id === item.species || s.label === item.species
        );
        const ageStr = String(item.age || item.age_value || "").trim();
        const { age_months, age_value, age_unit } = extractAgeComponents(ageStr);

        return {
          species: item.species,
          species_id: item.species_id || matchedSpecies?.dbId || null,
          sex: item.sex,
          age: age_months,
          age_months: age_months,
          age_value: age_value,
          age_unit: age_unit,
          quantity: parseInt(item.quantity, 10) || 1,
        };
      });

      await onSubmit({
        owner: activeOwner,
        entries: formattedEntries,
      });

      setShowConfirm(false);
      setEntries([createInitialEntry(speciesList?.[0]?.id || "Hog", "")]);
      setErrors({});
    } catch (err) {
      console.error("MultiLivestockForm submission error:", err);
      const errMsg = err?.message || err?.details || "Failed to register livestock batch";
      showToast(errMsg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
      }}
    >
      <style>{`
        .livestock-entry-row {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .entry-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
          gap: 8px;
        }
        .entry-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        @media (max-width: 640px) {
          .entry-form-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }
        }
        .age-input-group {
          display: grid;
          grid-template-columns: 1fr 110px;
          gap: 8px;
        }
        .sex-toggle-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .sex-toggle-btn {
          height: 44px;
          border-radius: 8px;
          border: 1.5px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 13px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sex-toggle-btn:hover {
          background: var(--color-surface);
          border-color: #94a3b8;
        }
        .sex-toggle-btn.active-male {
          background: rgba(2, 132, 199, 0.12);
          border-color: #0284c7;
          color: #0284c7;
          box-shadow: 0 0 0 1px #0284c7;
        }
        .sex-toggle-btn.active-female {
          background: rgba(236, 72, 153, 0.12);
          border-color: #ec4899;
          color: #db2777;
          box-shadow: 0 0 0 1px #ec4899;
        }
        .species-thumb-box {
          width: 52px;
          height: 44px;
          min-width: 52px;
          border-radius: 8px;
          border: 1.5px solid var(--color-border);
          background: var(--color-bg);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .species-thumb-box:hover {
          border-color: #94a3b8;
        }
      `}</style>

      {/* SCROLLABLE ENTRIES BODY CONTAINER (MATCHING ANTE-MORTEM INSPECTION FORM) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingRight: 6,
          scrollbarWidth: "thin",
        }}
      >
        {entries.map((entry, index) => {
          const speciesObj =
            speciesList.find((s) => s.id === entry.species || s.label === entry.species) ||
            speciesList[0] ||
            { label: entry.species, color: "#10b981", image_url: null };

          return (
            <div
              key={entry.id}
              className="livestock-entry-row"
              style={{
                borderTop: index > 0 ? "1px solid var(--color-border)" : "none",
                paddingTop: index > 0 ? 14 : 0,
              }}
            >
              {/* Card Header: Clean Entry Number + Remove Button (No Outer Border) */}
              <div className="entry-header">
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "var(--color-text)",
                  }}
                >
                  Livestock Entry #{index + 1}
                </span>

                {/* Remove Entry Button */}
                {entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRequestRemoveEntry(entry)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    title={`Remove Entry #${index + 1}`}
                  >
                    <Icon.Trash size={13} />
                    <span>Remove Entry</span>
                  </button>
                )}
              </div>

              {/* Form Grid: 4 Core Fields */}
              <div className="entry-form-grid">
                {/* Field 1: Species Selection with Live Image Display */}
                <div>
                  <label
                    htmlFor={`species-${entry.id}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      display: "block",
                      marginBottom: 5,
                    }}
                  >
                    Species <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {/* Live Species Image Preview */}
                    <div className="species-thumb-box" title={entry.species}>
                      {speciesObj?.image_url ? (
                        <img
                          key={speciesObj.image_url}
                          src={speciesObj.image_url}
                          alt={entry.species}
                          referrerPolicy="no-referrer"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const ph = e.currentTarget.nextElementSibling;
                            if (ph) ph.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        style={{
                          display: speciesObj?.image_url ? "none" : "flex",
                          flexDirection: "column",
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

                    {/* Species Dropdown */}
                    <select
                      id={`species_${entry.id}`}
                      className="form-control"
                      value={entry.species}
                      onChange={(e) => handleUpdateEntry(entry.id, "species", e.target.value)}
                      style={{
                        height: 44,
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        background: "var(--color-bg)",
                        color: "var(--color-text)",
                        borderColor: errors[`species_${entry.id}`] ? "#ef4444" : "var(--color-border)",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {speciesList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} ({s.code || s.id.substring(0, 3).toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>
                  {errors[`species_${entry.id}`] && (
                    <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon.AlertTriangle size={12} />
                      <span>{errors[`species_${entry.id}`]}</span>
                    </div>
                  )}
                </div>

                {/* Field 2: Sex Selection with Independent State */}
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      display: "block",
                      marginBottom: 5,
                    }}
                  >
                    Sex <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <div id={`sex_${entry.id}`} className="sex-toggle-group">
                    <button
                      type="button"
                      className={`sex-toggle-btn ${entry.sex === "Male" ? "active-male" : ""}`}
                      onClick={() => handleUpdateEntry(entry.id, "sex", "Male")}
                      style={{
                        borderColor: errors[`sex_${entry.id}`] && !entry.sex ? "#ef4444" : undefined,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>♂</span>
                      <span>Male</span>
                    </button>
                    <button
                      type="button"
                      className={`sex-toggle-btn ${entry.sex === "Female" ? "active-female" : ""}`}
                      onClick={() => handleUpdateEntry(entry.id, "sex", "Female")}
                      style={{
                        borderColor: errors[`sex_${entry.id}`] && !entry.sex ? "#ef4444" : undefined,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>♀</span>
                      <span>Female</span>
                    </button>
                  </div>
                  {errors[`sex_${entry.id}`] && (
                    <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon.AlertTriangle size={12} />
                      <span>{errors[`sex_${entry.id}`]}</span>
                    </div>
                  )}
                </div>

                {/* Field 3: Age (Searchable Dropdown with Manual Text Input) */}
                <div>
                  <label
                    htmlFor={`age_${entry.id}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      display: "block",
                      marginBottom: 5,
                    }}
                  >
                    Age <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <SearchableAgeInput
                    id={`age_${entry.id}`}
                    value={entry.age || ""}
                    onChange={(val) => {
                      handleUpdateEntry(entry.id, "age", val);
                    }}
                    error={errors[`age_${entry.id}`]}
                    placeholder="e.g. 6 months, 1 year, 1 year and 6 months"
                  />

                  {errors[`age_${entry.id}`] && (
                    <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon.AlertTriangle size={12} />
                      <span>{errors[`age_${entry.id}`]}</span>
                    </div>
                  )}
                </div>

                {/* Field 4: Quantity */}
                <div>
                  <label
                    htmlFor={`quantity_${entry.id}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      display: "block",
                      marginBottom: 5,
                    }}
                  >
                    Quantity (Heads) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    id={`quantity_${entry.id}`}
                    type="number"
                    step="1"
                    min="1"
                    inputMode="numeric"
                    placeholder="e.g. 1"
                    className="form-control"
                    value={entry.quantity}
                    onKeyDown={(e) => {
                      // Disallow decimal point, comma, signs, and exponent notation
                      if (e.key === "." || e.key === "," || e.key === "-" || e.key === "+" || e.key === "e" || e.key === "E") {
                        e.preventDefault();
                      }
                    }}
                    onChange={(e) => handleUpdateEntry(entry.id, "quantity", e.target.value)}
                    style={{
                      height: 44,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      borderColor: errors[`quantity_${entry.id}`] ? "#ef4444" : "var(--color-border)",
                    }}
                  />
                  {errors[`quantity_${entry.id}`] && (
                    <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon.AlertTriangle size={12} />
                      <span>{errors[`quantity_${entry.id}`]}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* DYNAMIC "+ ADD ANOTHER LIVESTOCK ENTRY" BUTTON */}
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <button
            type="button"
            onClick={handleAddLivestockEntry}
            style={{
              width: "100%",
              padding: "11px 16px",
              borderRadius: 8,
              border: "1.5px dashed #10b981",
              background: "rgba(16, 185, 129, 0.05)",
              color: "#059669",
              fontSize: 13,
              fontWeight: 750,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.15s ease",
              boxSizing: "border-box",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.12)";
              e.currentTarget.style.borderColor = "#059669";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(16, 185, 129, 0.05)";
              e.currentTarget.style.borderColor = "#10b981";
            }}
          >
            <Icon.Plus size={15} />
            <span>Add Another Livestock Entry</span>
          </button>
        </div>
      </div>

      {/* FIXED PINNED ACTIONS FOOTER (MATCHING ANTE-MORTEM INSPECTION MODAL FOOTER) */}
      <div
        style={{
          marginTop: "auto",
          marginLeft: "-20px",
          marginRight: "-20px",
          marginBottom: 0,
          padding: "12px 20px",
          background: "var(--color-surface, #ffffff)",
          borderTop: "1px solid var(--color-border, #e2e8f0)",
          boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.04)",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
            style={{ height: 36, padding: "0 16px", fontSize: 13, borderRadius: 8 }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || totalHeadCount === 0}
            style={{
              height: 36,
              padding: "0 22px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 8,
              background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
              color: "#ffffff",
              boxShadow: "0 2px 6px rgba(16, 185, 129, 0.28)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? (
              <>
                <Icon.RefreshCw size={14} className="animate-spin" />
                <span>Registering...</span>
              </>
            ) : (
              <>
                <Icon.CheckCircle size={14} />
                <span>Register</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog on Submit with itemized breakdown matching reference design */}
      {showConfirm && (
        <div
          className="modal-backdrop confirm-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              setShowConfirm(false);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-livestock-reg-title"
        >
          <div
            style={{
              width: "100%",
              maxWidth: 490,
              background: "var(--color-surface, #ffffff)",
              borderRadius: 14,
              border: "1px solid var(--color-border, #e2e8f0)",
              boxShadow: "0 20px 45px -10px rgba(0, 0, 0, 0.35)",
              padding: "20px 22px 20px 22px",
              boxSizing: "border-box",
              animation: "modalFadeIn 0.18s ease-out",
            }}
          >
            {/* Header: Left checkmark badge + title, Right close button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: "#dcfce7",
                    color: "#16a34a",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Check size={17} strokeWidth={2.6} />
                </div>
                <h3
                  id="confirm-livestock-reg-title"
                  style={{
                    margin: 0,
                    fontSize: 16.5,
                    fontWeight: 700,
                    color: "var(--color-text, #0f172a)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Confirm Livestock Registration
                </h3>
              </div>

              <button
                type="button"
                onClick={() => !submitting && setShowConfirm(false)}
                disabled={submitting}
                aria-label="Close dialog"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--color-text-muted, #64748b)",
                  cursor: submitting ? "not-allowed" : "pointer",
                  padding: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                }}
              >
                <Icon.X size={18} />
              </button>
            </div>

            {/* Prompt sentence */}
            <p
              style={{
                margin: "14px 0 14px 0",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "var(--color-text-secondary, #334155)",
                textAlign: "left",
              }}
            >
              Are you sure you want to register incoming livestock for{" "}
              <strong style={{ color: "var(--color-text, #0f172a)" }}>{ownerName}</strong>?
            </p>

            {/* Scrollable details table container */}
            <div
              style={{
                border: "1px solid var(--color-border, #e2e8f0)",
                borderRadius: 9,
                overflow: "hidden",
                background: "var(--color-bg, #ffffff)",
              }}
            >
              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  scrollbarWidth: "thin",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                    textAlign: "left",
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "var(--color-surface-subtle, #f8fafc)",
                      zIndex: 3,
                    }}
                  >
                    <tr style={{ borderBottom: "1px solid var(--color-border, #e2e8f0)" }}>
                      <th
                        style={{
                          padding: "9px 12px",
                          fontWeight: 700,
                          color: "var(--color-text-secondary, #475569)",
                          fontSize: 12,
                        }}
                      >
                        Species
                      </th>
                      <th
                        style={{
                          padding: "9px 12px",
                          fontWeight: 700,
                          color: "var(--color-text-secondary, #475569)",
                          fontSize: 12,
                        }}
                      >
                        Sex
                      </th>
                      <th
                        style={{
                          padding: "9px 12px",
                          fontWeight: 700,
                          color: "var(--color-text-secondary, #475569)",
                          fontSize: 12,
                        }}
                      >
                        Age
                      </th>
                      <th
                        style={{
                          padding: "9px 12px",
                          fontWeight: 700,
                          color: "var(--color-text-secondary, #475569)",
                          fontSize: 12,
                          textAlign: "right",
                        }}
                      >
                        Quantity
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item, i) => (
                      <tr
                        key={item.id || i}
                        style={{
                          borderBottom:
                            i < entries.length - 1
                              ? "1px solid var(--color-border, #f1f5f9)"
                              : "none",
                          background:
                            i % 2 === 0
                              ? "transparent"
                              : "var(--color-surface-subtle, #fafafa)",
                        }}
                      >
                        <td
                          style={{
                            padding: "9px 12px",
                            fontWeight: 600,
                            color: "var(--color-text, #0f172a)",
                          }}
                        >
                          {item.species}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            color: "var(--color-text-secondary, #334155)",
                          }}
                        >
                          {item.sex || "Unspecified"}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            color: "var(--color-text-secondary, #334155)",
                          }}
                        >
                          {item.age || (item.age_value ? formatAgeString(item.age_value, item.age_unit) : "—")}
                        </td>
                        <td
                          style={{
                            padding: "9px 12px",
                            fontWeight: 600,
                            color: "var(--color-text, #0f172a)",
                            textAlign: "right",
                          }}
                        >
                          {item.quantity} {parseInt(item.quantity, 10) === 1 ? "head" : "heads"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total Banner at the bottom of the table */}
              <div
                style={{
                  background: "#dcfce7",
                  borderTop: "1px solid #bbf7d0",
                  padding: "10px 14px",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 13.5,
                  color: "#065f46",
                }}
              >
                Total Livestock: {totalHeadCount} {totalHeadCount === 1 ? "head" : "heads"}
              </div>
            </div>

            {/* Footer Buttons: Cancel on left, Confirm Registration on right */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
                style={{
                  flex: 1,
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1.5px solid var(--color-border, #cbd5e1)",
                  background: "var(--color-bg, #ffffff)",
                  color: "var(--color-text, #334155)",
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: submitting ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={submitting}
                style={{
                  flex: 1,
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#065f46",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: submitting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  boxShadow: "0 2px 6px rgba(6, 95, 70, 0.25)",
                  transition: "all 0.15s ease",
                }}
              >
                {submitting ? (
                  <>
                    <Icon.RefreshCw size={14} className="animate-spin" />
                    <span>Registering...</span>
                  </>
                ) : (
                  "Confirm Registration"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog on Removing Entry with data */}
      <ConfirmDialog
        open={Boolean(entryToDelete)}
        title="Remove Livestock Entry?"
        message={`Entry contains entered livestock details. Are you sure you want to remove it?`}
        confirmText="Yes, Remove"
        confirmVariant="danger"
        onConfirm={() => {
          if (entryToDelete) executeRemoveEntry(entryToDelete.id);
        }}
        onCancel={() => setEntryToDelete(null)}
      />
    </form>
  );
};
