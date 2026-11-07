import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { ConfirmDialog } from "../ui/Modal";
import { listSpecies } from "../../services/speciesService";
import { TABLES } from "../../utils/constants";
import { supabase } from "../../services/supabaseClient";

export const SPECIES_CONFIG = [
  { id: "Hog", label: "Hog", color: "#a855f7", dbId: "spec-hog" },
  { id: "Cattle", label: "Cattle", color: "#0284c7", dbId: "spec-cattle" },
  { id: "Carabao", label: "Carabao", color: "#10b981", dbId: "spec-carabao" },
  { id: "Goat", label: "Goat", color: "#f59e0b", dbId: "spec-goat" },
];

export const AGE_PRESETS = [
  { label: "6 mos", value: "6", unit: "Months" },
  { label: "8 mos", value: "8", unit: "Months" },
  { label: "1 yr", value: "1", unit: "Years" },
  { label: "1.5 yrs", value: "1.5", unit: "Years" },
  { label: "2 yrs", value: "2", unit: "Years" },
  { label: "3 yrs", value: "3", unit: "Years" },
];

export const formatAgeString = (value, unit) => {
  if (!value || isNaN(Number(value))) return "";
  const num = parseFloat(value);
  const cleanUnit = (unit || "Months").trim().toLowerCase();
  if (cleanUnit.startsWith("year")) {
    return num === 1 ? "1 Year" : `${num} Years`;
  }
  return num === 1 ? "1 Month" : `${num} Months`;
};

const createInitialEntry = (defaultSpecies = "Hog", defaultSex = "Male") => ({
  id: "entry_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
  species: defaultSpecies,
  species_id: null,
  sex: defaultSex,
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

  // Dynamic livestock entries state
  const [entries, setEntries] = useState([
    createInitialEntry(speciesList?.[0]?.id || "Hog", "Male"),
  ]);

  // Reset form when owner changes
  useEffect(() => {
    const defaultSpec = speciesList?.[0]?.id || "Hog";
    setEntries([createInitialEntry(defaultSpec, "Male")]);
    setErrors({});
    setShowConfirm(false);
    setSubmitting(false);
  }, [owner?.id, owner?.owner_id]);

  // Total head count across all entries
  const totalHeadCount = useMemo(() => {
    return entries.reduce((sum, item) => {
      const qty = parseInt(item.quantity, 10);
      return sum + (isNaN(qty) || qty < 1 ? 1 : qty);
    }, 0);
  }, [entries]);

  // Add another livestock entry
  const handleAddLivestockEntry = () => {
    const lastEntry = entries[entries.length - 1];
    const nextSpecies = lastEntry?.species || speciesList?.[0]?.id || "Hog";
    const nextSex = lastEntry?.sex === "Male" ? "Female" : "Male";

    const newEntry = createInitialEntry(nextSpecies, nextSex);
    const matched = speciesList.find((s) => s.id === nextSpecies);
    if (matched) newEntry.species_id = matched.dbId;

    setEntries((prev) => [...prev, newEntry]);
  };

  // Check if entry has entered data
  const hasEnteredData = (entry) => {
    return Boolean(
      (entry.age_value && entry.age_value.trim()) ||
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

  // Update specific field on an entry
  const handleUpdateEntry = (entryId, field, value) => {
    setEntries((prev) =>
      prev.map((item) => {
        if (item.id !== entryId) return item;
        const updated = { ...item, [field]: value };
        if (field === "species") {
          const matched = speciesList.find((s) => s.id === value);
          updated.species_id = matched?.dbId || null;
        }
        return updated;
      })
    );

    setErrors((prev) => {
      const next = { ...prev };
      if (field === "species" && value) delete next[`species_${entryId}`];
      if (field === "sex" && value) delete next[`sex_${entryId}`];
      if (field === "age_value" && value && parseFloat(value) > 0) delete next[`age_${entryId}`];
      if (field === "quantity" && parseInt(value, 10) >= 1) delete next[`quantity_${entryId}`];
      return next;
    });
  };

  // Quick preset age setter
  const handleApplyAgePreset = (entryId, preset) => {
    setEntries((prev) =>
      prev.map((item) => {
        if (item.id !== entryId) return item;
        return {
          ...item,
          age_value: preset.value,
          age_unit: preset.unit,
        };
      })
    );
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`age_${entryId}`];
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
        newErrors[`sex_${item.id}`] = `Entry #${num}: Please select animal sex.`;
      }

      const ageValStr = String(item.age_value || "").trim();
      const ageNum = parseFloat(ageValStr);
      if (!ageValStr || isNaN(ageNum) || ageNum <= 0) {
        newErrors[`age_${item.id}`] = `Entry #${num}: Please enter a valid age greater than 0.`;
      } else if (item.age_unit === "Months" && ageNum > 240) {
        newErrors[`age_${item.id}`] = `Entry #${num}: Age in months cannot exceed 240 (20 years).`;
      } else if (item.age_unit === "Years" && ageNum > 30) {
        newErrors[`age_${item.id}`] = `Entry #${num}: Age in years cannot exceed 30.`;
      }

      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty < 1) {
        newErrors[`quantity_${item.id}`] = `Entry #${num}: Quantity must be at least 1.`;
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast("Please correct the highlighted livestock fields before submitting.", "error");
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
        const formattedAge = formatAgeString(item.age_value, item.age_unit);

        return {
          species: item.species,
          species_id: item.species_id || matchedSpecies?.dbId || null,
          sex: item.sex,
          age_months: formattedAge,
          age_value: item.age_value,
          age_unit: item.age_unit,
          quantity: parseInt(item.quantity, 10) || 1,
        };
      });

      await onSubmit({
        owner: activeOwner,
        entries: formattedEntries,
      });

      setShowConfirm(false);
      setEntries([createInitialEntry(speciesList?.[0]?.id || "Hog")]);
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
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .livestock-entry-card {
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          gap: 14px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .livestock-entry-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.05);
        }
        [data-theme="dark"] .livestock-entry-card {
          background: #1e293b;
          border-color: #334155;
        }
        [data-theme="dark"] .livestock-entry-card:hover {
          border-color: #475569;
        }
        .entry-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 10px;
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
          height: 38px;
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
        }
        .sex-toggle-btn.active-female {
          background: rgba(236, 72, 153, 0.12);
          border-color: #ec4899;
          color: #db2777;
        }
        .age-preset-chip {
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text-muted);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .age-preset-chip:hover {
          background: var(--color-surface);
          color: var(--color-primary, #10b981);
          border-color: var(--color-primary, #10b981);
        }
      `}</style>

      {/* SECTION TITLE */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
        <h4
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon.Cow size={16} style={{ color: "#10b981" }} />
          <span>Livestock Details</span>
        </h4>
      </div>

      {/* DYNAMIC LIVESTOCK ENTRIES LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {entries.map((entry, index) => (
          <div key={entry.id} className="livestock-entry-card">
            {/* Card Header: Entry Number + Remove Button */}
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

            {/* Card Form Grid: 4 Core Fields */}
            <div className="entry-form-grid">
              {/* Field 1: Species Selection */}
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
                <select
                  id={`species-${entry.id}`}
                  className="form-control"
                  value={entry.species}
                  onChange={(e) => handleUpdateEntry(entry.id, "species", e.target.value)}
                  style={{
                    height: 38,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    borderColor: errors[`species_${entry.id}`] ? "#ef4444" : "var(--color-border)",
                  }}
                >
                  {speciesList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.code || s.id.substring(0, 3).toUpperCase()})
                    </option>
                  ))}
                </select>
                {errors[`species_${entry.id}`] && (
                  <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon.AlertTriangle size={12} />
                    <span>{errors[`species_${entry.id}`]}</span>
                  </div>
                )}
              </div>

              {/* Field 2: Sex Selection */}
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
                <div className="sex-toggle-group">
                  <button
                    type="button"
                    className={`sex-toggle-btn ${entry.sex === "Male" ? "active-male" : ""}`}
                    onClick={() => handleUpdateEntry(entry.id, "sex", "Male")}
                  >
                    <span style={{ fontSize: 14 }}>♂</span>
                    <span>Male</span>
                  </button>
                  <button
                    type="button"
                    className={`sex-toggle-btn ${entry.sex === "Female" ? "active-female" : ""}`}
                    onClick={() => handleUpdateEntry(entry.id, "sex", "Female")}
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

              {/* Field 3: Age & Unit */}
              <div>
                <label
                  htmlFor={`age-value-${entry.id}`}
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
                <div className="age-input-group">
                  <input
                    id={`age-value-${entry.id}`}
                    type="number"
                    step="any"
                    min="0.1"
                    placeholder="e.g. 6"
                    className="form-control"
                    value={entry.age_value}
                    onChange={(e) => handleUpdateEntry(entry.id, "age_value", e.target.value)}
                    style={{
                      height: 38,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      borderColor: errors[`age_${entry.id}`] ? "#ef4444" : "var(--color-border)",
                    }}
                  />
                  <select
                    className="form-control"
                    value={entry.age_unit}
                    onChange={(e) => handleUpdateEntry(entry.id, "age_unit", e.target.value)}
                    style={{
                      height: 38,
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 700,
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                    }}
                  >
                    <option value="Months">Months</option>
                    <option value="Years">Years</option>
                  </select>
                </div>

                {/* Preset quick-picks */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontWeight: 600 }}>Quick pick:</span>
                  {AGE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="age-preset-chip"
                      onClick={() => handleApplyAgePreset(entry.id, p)}
                      title={`Set age to ${p.value} ${p.unit}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

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
                  htmlFor={`quantity-${entry.id}`}
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
                  id={`quantity-${entry.id}`}
                  type="number"
                  min="1"
                  className="form-control"
                  value={entry.quantity}
                  onChange={(e) => handleUpdateEntry(entry.id, "quantity", e.target.value)}
                  style={{
                    height: 38,
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
        ))}
      </div>

      {/* DYNAMIC "+ ADD LIVESTOCK" BUTTON */}
      <div>
        <button
          type="button"
          onClick={handleAddLivestockEntry}
          style={{
            width: "100%",
            padding: "12px 18px",
            borderRadius: 10,
            border: "2px dashed #10b981",
            background: "rgba(16, 185, 129, 0.05)",
            color: "#059669",
            fontSize: 13.5,
            fontWeight: 800,
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
          <Icon.Plus size={16} />
          <span>+ Add Another Livestock Entry</span>
        </button>
      </div>

      {/* ACTIONS FOOTER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          paddingTop: 16,
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
          Total to register: <strong style={{ color: "#059669" }}>{totalHeadCount} {totalHeadCount === 1 ? "head" : "heads"}</strong> across <strong>{entries.length}</strong> {entries.length === 1 ? "entry" : "entries"}.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || totalHeadCount === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 20px",
              fontSize: 13.5,
              fontWeight: 700,
              borderRadius: 9,
              background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
              color: "#ffffff",
              boxShadow: "0 2px 6px rgba(16, 185, 129, 0.28)",
            }}
          >
            {submitting ? (
              <>
                <Icon.RefreshCw size={15} className="animate-spin" />
                <span>Registering...</span>
              </>
            ) : (
              <>
                <Icon.CheckCircle size={15} />
                <span>Register</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog on Submit with itemized breakdown */}
      <ConfirmDialog
        open={showConfirm}
        title="Confirm Livestock Registration"
        message={
          <div>
            <p style={{ margin: "0 0 10px 0" }}>
              Are you sure you want to register <strong>{totalHeadCount} {totalHeadCount === 1 ? "head" : "heads"}</strong> of incoming livestock for <strong>{ownerName}</strong>?
            </p>
            <div
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "8px 12px",
                maxHeight: 180,
                overflowY: "auto",
                fontSize: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                textAlign: "left",
              }}
            >
              {entries.map((item, i) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>
                    <strong>#{i + 1}</strong>: {item.species} ({item.sex}) · {formatAgeString(item.age_value, item.age_unit)}
                  </span>
                  <span style={{ fontWeight: 700, color: "#059669" }}>
                    {item.quantity} {parseInt(item.quantity, 10) === 1 ? "head" : "heads"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        }
        confirmText="Yes, Register Livestock"
        confirmVariant="success"
        loading={submitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />

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
