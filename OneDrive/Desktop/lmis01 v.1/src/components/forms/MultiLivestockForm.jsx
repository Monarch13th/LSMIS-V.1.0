import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../icons";
import { useToast } from "../notifications/Toast";
import { ConfirmDialog } from "../ui/Modal";
import { listSpecies, DEFAULT_SPECIES } from "../../services/speciesService";
import { TABLES } from "../../utils/constants";
import { supabase } from "../../services/supabaseClient";
import { formatOwnerId } from "../../utils/formatters";
import { initials } from "../../utils/helpers";

export const SPECIES_CONFIG = [
  { id: "Hog", label: "Hog", color: "#a855f7", dbId: "spec-hog" },
  { id: "Cattle", label: "Cattle", color: "#0284c7", dbId: "spec-cattle" },
  { id: "Carabao", label: "Carabao", color: "#10b981", dbId: "spec-carabao" },
  { id: "Goat", label: "Goat", color: "#f59e0b", dbId: "spec-goat" },
];

export const AGE_PRESETS = [
  "6 months",
  "1 year",
  "1.5 years",
  "2 years",
  "3 years",
  "4+ years",
  "Market Age",
  "Suckling",
  "Weanling",
  "Yearling",
  "Adult / Mature",
  "Old / Cull",
];

const createEmptyLine = (suggestedSex = "Male") => ({
  id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
  sex: suggestedSex,
  age_months: "",
  quantity: 1,
  breed: "",
  remarks: "",
  mark_type: "Ear Tag",
});

const createInitialBlock = (speciesId = "Hog") => ({
  id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
  species: speciesId,
  lines: [createEmptyLine("Male")],
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
  const [blockToDelete, setBlockToDelete] = useState(null);
  const [currentOwner, setCurrentOwner] = useState(owner || null);

  // Synchronize and retrieve the owner's latest saved profile from Supabase
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
    "";
  const ownerContact = activeOwner?.contact || activeOwner?.phone || activeOwner?.mobile || "";
  const ownerEmail = activeOwner?.email || "";
  const ownerAddress = activeOwner?.address || "";
  const ownerIdFormatted = formatOwnerId(activeOwner);
  const ownerStatus = activeOwner?.status || "Approved";

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

    // Supabase realtime channel for live species sync
    const channel = supabase
      ?.channel("staff-species-sync")
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

  // Form holds one or more species blocks, each containing one or more lines
  const initialSpecies = speciesList?.[0]?.id || "Hog";
  const [blocks, setBlocks] = useState([createInitialBlock(initialSpecies)]);

  // Reset form whenever owner changes so stale data from previous owner never carries over
  useEffect(() => {
    const defaultSpec = speciesList?.[0]?.id || "Hog";
    setBlocks([createInitialBlock(defaultSpec)]);
    setErrors({});
    setShowConfirm(false);
    setSubmitting(false);
  }, [owner?.id, owner?.owner_id, speciesList]);

  // Set of species currently selected across blocks
  const usedSpeciesSet = useMemo(() => {
    return new Set(blocks.map((b) => b.species).filter(Boolean));
  }, [blocks]);

  // Whether all available species are currently in use
  const allSpeciesUsed = blocks.length >= speciesList.length;

  // Total head count across all blocks and lines
  const totalHeadCount = useMemo(() => {
    return blocks.reduce((sum, b) => {
      const bSum = b.lines.reduce((lSum, l) => lSum + (parseInt(l.quantity, 10) || 0), 0);
      return sum + bSum;
    }, 0);
  }, [blocks]);

  // Add another species block
  const handleAddSpeciesBlock = () => {
    if (allSpeciesUsed) return;
    const available = speciesList.find((s) => !usedSpeciesSet.has(s.id));
    if (!available) return;

    setBlocks((prev) => [...prev, createInitialBlock(available.id)]);
  };

  // Switch species for a block
  const handleUpdateBlockSpecies = (blockId, newSpecies) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, species: newSpecies } : b))
    );
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`species_${blockId}`];
      return next;
    });
  };

  // Detect whether a block has user-entered data
  const hasEnteredData = (block) => {
    if (block.lines.length > 1) return true;
    const line = block.lines[0];
    if (!line) return false;
    const hasAge = Boolean(line.age_months && line.age_months.trim());
    const hasQty = parseInt(line.quantity, 10) > 1;
    const hasBreed = Boolean(line.breed && line.breed.trim());
    const hasRemarks = Boolean(line.remarks && line.remarks.trim());
    return hasAge || hasQty || hasBreed || hasRemarks;
  };

  // Request removing a species block (checks for entered data)
  const handleRequestRemoveBlock = (block) => {
    if (blocks.length <= 1) {
      showToast("A receiving transaction must have at least one livestock entry.", "warning");
      return;
    }
    if (hasEnteredData(block)) {
      setBlockToDelete(block);
    } else {
      executeRemoveBlock(block.id);
    }
  };

  const executeRemoveBlock = (blockId) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setBlockToDelete(null);
  };

  // Add a line under a species block (pre-selects unused sex if available)
  const handleAddLine = (blockId) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b;
        const hasMale = b.lines.some((l) => l.sex === "Male");
        const hasFemale = b.lines.some((l) => l.sex === "Female");
        if (hasMale && hasFemale) return b;
        if (b.lines.length >= 2) return b;

        let suggestedSex = "Male";
        if (hasMale && !hasFemale) suggestedSex = "Female";
        else if (hasFemale && !hasMale) suggestedSex = "Male";

        return {
          ...b,
          lines: [...b.lines, createEmptyLine(suggestedSex)],
        };
      })
    );
  };

  // Remove a line from a species block
  const handleRemoveLine = (blockId, lineId) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b;
        if (b.lines.length <= 1) {
          showToast("Each species block must have at least one line.", "warning");
          return b;
        }
        return {
          ...b,
          lines: b.lines.filter((l) => l.id !== lineId),
        };
      })
    );
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`sex_${lineId}`];
      delete next[`age_${lineId}`];
      delete next[`quantity_${lineId}`];
      delete next[`dup_${lineId}`];
      return next;
    });
  };

  // Update a line's field
  const handleUpdateLine = (blockId, lineId, field, value) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b;
        return {
          ...b,
          lines: b.lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)),
        };
      })
    );

    setErrors((prev) => {
      const next = { ...prev };
      if (field === "age_months" && value && value.trim()) {
        delete next[`age_${lineId}`];
      }
      if (field === "quantity" && parseInt(value, 10) >= 1) {
        delete next[`quantity_${lineId}`];
      }
      delete next[`dup_${lineId}`];
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    let hasDuplicate = false;

    if (blocks.length === 0) {
      showToast("Please add at least one livestock entry.", "error");
      return;
    }

    blocks.forEach((block, bIdx) => {
      const blockNum = bIdx + 1;
      if (!block.species) {
        newErrors[`species_${block.id}`] = `Entry #${blockNum}: Select animal species.`;
      }

      // Track duplicate sex + age combos within this species block
      const seenCombos = new Map();

      block.lines.forEach((line, lIdx) => {
        const lineNum = lIdx + 1;
        if (!line.sex) {
          newErrors[`sex_${line.id}`] = `Entry #${blockNum}, Line ${lineNum}: Select sex.`;
        }
        const ageClean = (line.age_months || "").trim();
        if (!ageClean) {
          newErrors[`age_${line.id}`] = `Entry #${blockNum}, Line ${lineNum}: Age is required.`;
        }
        const q = parseInt(line.quantity, 10);
        if (isNaN(q) || q < 1) {
          newErrors[`quantity_${line.id}`] = `Entry #${blockNum}, Line ${lineNum}: Quantity must be at least 1.`;
        }

        // Duplicate combo check
        if (line.sex && ageClean) {
          const comboKey = `${line.sex.toLowerCase()}__${ageClean.toLowerCase()}`;
          if (seenCombos.has(comboKey)) {
            newErrors[`dup_${line.id}`] = `Duplicate line: ${line.sex} with age "${ageClean}" is already entered for ${block.species}.`;
            const firstId = seenCombos.get(comboKey);
            newErrors[`dup_${firstId}`] = `Duplicate line: ${line.sex} with age "${ageClean}" is repeated.`;
            hasDuplicate = true;
          } else {
            seenCombos.set(comboKey, line.id);
          }
        }
      });
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      if (hasDuplicate) {
        showToast("Duplicate lines found within the same species. Please adjust sex or age.", "error");
      } else {
        showToast("Please fill in all required livestock details before submitting.", "error");
      }
      return;
    }

    setErrors({});
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const flattenedEntries = [];
      blocks.forEach((block) => {
        const matchedSpecies = (speciesList || []).find(
          (s) => s.id === block.species || s.label === block.species
        );
        block.lines.forEach((line) => {
          flattenedEntries.push({
            species: block.species,
            species_id: matchedSpecies?.dbId || null,
            sex: line.sex,
            age_months: (line.age_months || "").trim(),
            quantity: parseInt(line.quantity, 10) || 1,
            breed: line.breed || "",
            remarks: line.remarks || "",
            mark_type: line.mark_type || "Ear Tag",
          });
        });
      });

      await onSubmit({ owner: activeOwner, blocks, entries: flattenedEntries });
      setShowConfirm(false);
      setBlocks([createInitialBlock(speciesList?.[0]?.id || "Hog")]);
      setErrors({});
    } catch (err) {
      console.error("MultiLivestockForm intake submission error:", err);
      const errMsg = err?.message || err?.details || "Failed to register livestock intake batch";
      showToast(errMsg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .species-lines-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .species-lines-grid.multi-lines {
          grid-template-columns: 1fr 1fr;
        }
        @media (max-width: 768px) {
          .species-lines-grid.multi-lines {
            grid-template-columns: 1fr;
          }
        }
        .lmis-inputs-grid {
          display: grid;
          grid-template-columns: 0.9fr 1.1fr 1.4fr;
          gap: 10px;
        }
        @media (max-width: 540px) {
          .lmis-inputs-grid {
            grid-template-columns: 1fr;
            gap: 8px;
          }
        }
      `}</style>

      {/* DYNAMIC SPECIES CARDS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {blocks.map((block, blockIndex) => {
          const speciesObj =
            speciesList.find((s) => s.id === block.species) || speciesList[0] || { label: block.species, color: "#059669" };
          const blockTotal = block.lines.reduce(
            (acc, l) => acc + (parseInt(l.quantity, 10) || 0),
            0
          );

          const firstLineSex = block.lines?.[0]?.sex
            ? String(block.lines[0].sex).trim().toLowerCase()
            : "";
          const speciesLabel = speciesObj?.label || block.species || "";
          const addLineLabel =
            firstLineSex === "male"
              ? (speciesLabel ? `Add Female (${speciesLabel})` : "Add Female")
              : firstLineSex === "female"
              ? (speciesLabel ? `Add Male (${speciesLabel})` : "Add Male")
              : (speciesLabel ? `Add Line (${speciesLabel})` : "Add Line");

          return (
            <div
              key={block.id}
              style={{
                border: "none",
                borderRadius: 0,
                padding: blockIndex > 0 ? "16px 0 0 0" : "0",
                borderTop: blockIndex > 0 ? "1px solid var(--color-border)" : "none",
                background: "transparent",
                boxShadow: "none",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                position: "relative",
              }}
            >
              {/* Species Selection Pills */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--color-text)",
                      margin: 0,
                    }}
                  >
                    Animal Species <span style={{ color: "#ef4444" }}>*</span>
                  </label>

                  {blocks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRequestRemoveBlock(block)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        color: "#dc2626",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "4px 9px",
                        borderRadius: 6,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Remove this livestock species block"
                    >
                      <Icon.Trash size={12} />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  {speciesList.map((s) => {
                    const active = block.species === s.id;
                    const isUsedElsewhere = blocks.some(
                      (b) => b.id !== block.id && b.species === s.id
                    );
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isUsedElsewhere}
                        onClick={() => handleUpdateBlockSpecies(block.id, s.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 7,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: active ? "1.5px solid #059669" : "1.5px solid var(--color-border)",
                          background: active
                            ? "rgba(16, 185, 129, 0.12)"
                            : isUsedElsewhere
                            ? "var(--color-bg)"
                            : "var(--color-surface)",
                          color: active
                            ? "var(--color-primary-dark, #059669)"
                            : isUsedElsewhere
                            ? "var(--color-text-muted)"
                            : "var(--color-text)",
                          fontWeight: active ? 750 : 600,
                          fontSize: 13,
                          cursor: isUsedElsewhere ? "not-allowed" : "pointer",
                          opacity: isUsedElsewhere ? 0.45 : 1,
                          transition: "all 120ms ease",
                        }}
                        title={
                          isUsedElsewhere
                            ? `${s.label} is already selected in another entry`
                            : `Select ${s.label}`
                        }
                      >
                        {s.image_url ? (
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 4,
                              background: "#ffffff",
                              border: active ? "1px solid #059669" : "1px solid var(--color-border)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 1,
                              flexShrink: 0,
                            }}
                          >
                            <img
                              src={s.image_url}
                              alt={s.label}
                              style={{
                                maxWidth: "100%",
                                maxHeight: "100%",
                                width: "auto",
                                height: "auto",
                                objectFit: "contain",
                                display: "block",
                              }}
                              onError={(e) => {
                                e.currentTarget.parentElement.style.display = "none";
                              }}
                            />
                          </div>
                        ) : (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: s.color || "#059669",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span>{s.label}</span>
                        {isUsedElsewhere && (
                          <span style={{ fontSize: 10, opacity: 0.7 }}>(Used)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {errors[`species_${block.id}`] && (
                  <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon.AlertTriangle size={12} />
                    <span>{errors[`species_${block.id}`]}</span>
                  </div>
                )}
              </div>

              {/* LINES LIST UNDER THIS SPECIES */}
              <div className={`species-lines-grid ${block.lines.length > 1 ? "multi-lines" : ""}`}>
                {block.lines.map((line, lineIndex) => (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: block.lines.length > 1 ? "10px 12px" : "0",
                      background:
                        block.lines.length > 1 ? "var(--color-bg)" : "transparent",
                      border:
                        block.lines.length > 1 ? "1px solid var(--color-border)" : "none",
                      borderRadius: 8,
                    }}
                  >
                    {/* Header for line when multiple lines exist */}
                    {block.lines.length > 1 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--color-text-muted)",
                          }}
                        >
                          {line.sex ? (line.sex.charAt(0).toUpperCase() + line.sex.slice(1).toLowerCase()) : `Line #${lineIndex + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(block.id, line.id)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: "2px 6px",
                          }}
                          title="Remove this line"
                        >
                          <Icon.Trash size={12} />
                          <span>Remove Line</span>
                        </button>
                      </div>
                    )}

                    {/* Quantity, Sex, Age Row (The classic 3-column input layout) */}
                    <div className="lmis-inputs-grid">
                      {/* Quantity */}
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
                          Quantity <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <input
                          type="number"
                          min="1"
                          className="form-control"
                          value={line.quantity}
                          onChange={(e) =>
                            handleUpdateLine(block.id, line.id, "quantity", e.target.value)
                          }
                          style={{
                            height: 38,
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 700,
                            background: "var(--color-bg)",
                            color: "var(--color-text)",
                            borderColor: errors[`quantity_${line.id}`]
                              ? "#ef4444"
                              : "var(--color-border)",
                          }}
                        />
                      </div>

                      {/* Sex */}
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
                        <select
                          className="form-control"
                          value={line.sex}
                          onChange={(e) =>
                            handleUpdateLine(block.id, line.id, "sex", e.target.value)
                          }
                          style={{
                            height: 38,
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            background: "var(--color-bg)",
                            color: "var(--color-text)",
                            borderColor: errors[`sex_${line.id}`]
                              ? "#ef4444"
                              : "var(--color-border)",
                          }}
                        >
                          <option
                            value="Male"
                            disabled={block.lines.some((l) => l.id !== line.id && l.sex === "Male")}
                          >
                            Male ♂ {block.lines.some((l) => l.id !== line.id && l.sex === "Male") ? "(Already selected)" : ""}
                          </option>
                          <option
                            value="Female"
                            disabled={block.lines.some((l) => l.id !== line.id && l.sex === "Female")}
                          >
                            Female ♀ {block.lines.some((l) => l.id !== line.id && l.sex === "Female") ? "(Already selected)" : ""}
                          </option>
                        </select>
                      </div>

                      {/* Age / Maturity */}
                      <div>
                        <label
                          htmlFor={`age-months-${line.id}`}
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

                        <input
                          id={`age-months-${line.id}`}
                          name="age_months"
                          type="text"
                          list={`age-presets-${line.id}`}
                          className="form-control"
                          placeholder="e.g. 1 year and 9 months"
                          value={line.age_months || ""}
                          onChange={(e) =>
                            handleUpdateLine(block.id, line.id, "age_months", e.target.value)
                          }
                          style={{
                            width: "100%",
                            height: 38,
                            borderRadius: 8,
                            border: `1.5px solid ${
                              errors[`age_${line.id}`] || errors[`dup_${line.id}`]
                                ? "#ef4444"
                                : "var(--color-border)"
                            }`,
                            background: "var(--color-bg)",
                            color: "var(--color-text)",
                            fontFamily: "inherit",
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "0 10px",
                            outline: "none",
                          }}
                        />
                        <datalist id={`age-presets-${line.id}`}>
                          {AGE_PRESETS.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                      </div>
                    </div>

                    {/* Inline errors for line */}
                    {(errors[`age_${line.id}`] ||
                      errors[`quantity_${line.id}`] ||
                      errors[`sex_${line.id}`] ||
                      errors[`dup_${line.id}`]) && (
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "#ef4444",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Icon.AlertTriangle size={12} />
                        <span>
                          {errors[`dup_${line.id}`] ||
                            errors[`age_${line.id}`] ||
                            errors[`quantity_${line.id}`] ||
                            errors[`sex_${line.id}`]}
                        </span>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Line button under this species */}
                {(!block.lines.some((l) => l.sex === "Male") ||
                  !block.lines.some((l) => l.sex === "Female")) &&
                  block.lines.length < 2 && (
                    <button
                      type="button"
                      onClick={() => handleAddLine(block.id)}
                      style={{
                        width: "100%",
                        height: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1.5px dashed var(--color-border)",
                        background: "var(--color-bg)",
                        color: "var(--color-primary-dark, #059669)",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        boxSizing: "border-box",
                        transition: "all 120ms ease",
                      }}
                    >
                      <Icon.Plus size={14} />
                      <span>{addLineLabel}</span>
                    </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. ADD ANOTHER SPECIES BUTTON */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Button
          type="button"
          variant="outline"
          onClick={handleAddSpeciesBlock}
          disabled={allSpeciesUsed}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "11px",
            borderRadius: 9,
            border: "1.5px dashed var(--color-border)",
            background: "var(--color-bg)",
            fontSize: 13,
            fontWeight: 700,
            color: allSpeciesUsed ? "var(--color-text-muted)" : "var(--color-primary, #10b981)",
            cursor: allSpeciesUsed ? "not-allowed" : "pointer",
            opacity: allSpeciesUsed ? 0.6 : 1,
          }}
        >
          <Icon.Plus size={15} />
          <span>Add Another Livestock Species Line</span>
        </Button>
        {allSpeciesUsed && (
          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginTop: 2,
            }}
          >
            All available species ({speciesList.length}) have been added to this registration.
          </div>
        )}
      </div>

      {/* 5. ACTIONS FOOTER */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 12,
          paddingTop: 14,
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting}
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
              <span>Registering Livestock...</span>
            </>
          ) : (
            <>
              <Icon.CheckCircle size={15} />
              <span>Register Livestock</span>
            </>
          )}
        </Button>
      </div>

      {/* Confirmation Dialog on Submit */}
      <ConfirmDialog
        open={showConfirm}
        title="Confirm Livestock Registration"
        message={`Are you sure you want to register ${totalHeadCount} ${
          totalHeadCount === 1 ? "head" : "heads"
        } of livestock${ownerName ? ` for ${ownerName}` : ""}?`}
        confirmText="Yes, Register Livestock"
        confirmVariant="success"
        loading={submitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />

      {/* Confirmation Dialog on Removing Species Block if it has data */}
      <ConfirmDialog
        open={Boolean(blockToDelete)}
        title="Remove Livestock Entry?"
        message={`This entry contains entered livestock details. Are you sure you want to remove it?`}
        confirmText="Yes, Remove"
        confirmVariant="danger"
        onConfirm={() => {
          if (blockToDelete) executeRemoveBlock(blockToDelete.id);
        }}
        onCancel={() => setBlockToDelete(null)}
      />
    </form>
  );
};
