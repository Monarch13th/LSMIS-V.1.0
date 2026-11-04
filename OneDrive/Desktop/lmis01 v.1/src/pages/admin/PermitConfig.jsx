/**
 * PermitConfig.jsx
 * Meat Permit Configuration — Admin can view, edit, and save default parameters
 * used on the Meat Inspection Certificate and Gate Pass slips.
 * Values are stored in Supabase (permit_config table, row id='default')
 * with localStorage as an offline fallback.
 * Updates apply strictly to newly issued permits; previously issued records retain their snapshot.
 */

import { useState, useEffect } from "react";
import { useToast } from "../../components/notifications/Toast";
import { supabase } from "../../services/supabaseClient";
import { notifyDbChange } from "../../services/realtimeSync";
import { TABLES } from "../../utils/constants";
import { Card, Button } from "../../components/ui";
import { Icon } from "../../components/icons";
import { ConfirmAdminPasswordModal } from "../../components/admin/ConfirmAdminPasswordModal";
import { useAdminConfirmPassword } from "../../hooks/useAdminConfirmPassword";

const STORAGE_KEY = "permitConfig";
const ROW_ID = "default";

export const DEFAULT_PERMIT_CONFIG = {
  permitPrefix: "permit-",
  origin:       "TAPON TINAAN",
  destination:  "NEW PEOPLES MARKET",
  address:      "EAST POBLACION",
  timeIssued:   "",
  conveyance:   "MEAT VAN",
  plateNo:      "",
  inspector:    "NERISSA U. VELOSO",
  cityVet:      "DR. RAYMUNDO VALENTINE P. PAMIREZ",
};

/** Map JS camelCase keys -> DB snake_case columns */
export const toDbRow = (cfg) => ({
  id:            ROW_ID,
  permit_prefix: cfg.permitPrefix,
  origin:        cfg.origin,
  destination:   cfg.destination,
  address:       cfg.address,
  time_issued:   cfg.timeIssued,
  conveyance:    cfg.conveyance,
  plate_no:      cfg.plateNo,
  inspector:     cfg.inspector,
  city_vet:      cfg.cityVet,
  updated_at:    new Date().toISOString(),
});

/** Map DB row -> JS object */
export const fromDbRow = (row) => ({
  permitPrefix: row.permit_prefix ?? DEFAULT_PERMIT_CONFIG.permitPrefix,
  origin:       row.origin       ?? DEFAULT_PERMIT_CONFIG.origin,
  destination:  row.destination  ?? DEFAULT_PERMIT_CONFIG.destination,
  address:      row.address      ?? DEFAULT_PERMIT_CONFIG.address,
  timeIssued:   row.time_issued  ?? DEFAULT_PERMIT_CONFIG.timeIssued,
  conveyance:   row.conveyance   ?? DEFAULT_PERMIT_CONFIG.conveyance,
  plateNo:      row.plate_no     ?? DEFAULT_PERMIT_CONFIG.plateNo,
  inspector:    row.inspector    ?? DEFAULT_PERMIT_CONFIG.inspector,
  cityVet:      row.city_vet     ?? DEFAULT_PERMIT_CONFIG.cityVet,
});

/** Read config: Supabase first, localStorage fallback */
export const getPermitConfig = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_PERMIT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_PERMIT_CONFIG };
  } catch {
    return { ...DEFAULT_PERMIT_CONFIG };
  }
};

export const PermitConfig = () => {
  const { showToast } = useToast();
  const { confirmModalProps, confirmAdminAction } = useAdminConfirmPassword();
  const [form, setForm]       = useState({ ...DEFAULT_PERMIT_CONFIG });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  /* Load from Supabase on mount */
  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("permit_config")
          .select("*")
          .eq("id", ROW_ID)
          .single();

        if (!error && data) {
          const cfg = fromDbRow(data);
          setForm(cfg);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        } else {
          setForm(getPermitConfig());
        }
      } catch {
        setForm(getPermitConfig());
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (key, value) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const executeSavePermitConfig = async () => {
    setSaving(true);
    try {
      const row = toDbRow(form);
      const { error } = await supabase
        .from("permit_config")
        .upsert(row, { onConflict: "id" });

      if (error) throw error;

      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      setSaved(true);
      showToast("Permit configuration saved successfully! Newly issued permits will use these parameters.", "success");
      notifyDbChange(TABLES.PERMIT_CONFIG, "upsert", row);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("permit_config_updated"));
      }
    } catch (err) {
      console.error("Failed to save permit config:", err);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      setSaved(true);
      showToast("Saved locally (database unavailable)", "warning");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    confirmAdminAction({
      title: "Update Permit Configuration",
      actionDescription: "Saving Meat Inspection Certificate and Gate Pass configuration defaults. Newly issued permits will adopt these parameters without modifying historical permit records.",
      confirmButtonText: "Confirm & Save Configuration",
      danger: false,
      actionContext: {
        action: "Updated Permit & Gate Pass Configuration Defaults",
        module: "Permit Configuration",
      },
      onConfirm: async () => {
        await executeSavePermitConfig();
      },
    });
  };

  const handleReset = async () => {
    setForm({ ...DEFAULT_PERMIT_CONFIG });
    try {
      const row = toDbRow(DEFAULT_PERMIT_CONFIG);
      await supabase
        .from("permit_config")
        .upsert(row, { onConflict: "id" });
    } catch { /* ignore */ }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PERMIT_CONFIG));
    setSaved(false);
    showToast("Reset to default configuration values", "info");
    notifyDbChange(TABLES.PERMIT_CONFIG, "upsert", DEFAULT_PERMIT_CONFIG);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("permit_config_updated"));
    }
  };

  if (loading) {
    return (
      <Card style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 14 }}>
        Loading permit configuration…
      </Card>
    );
  }

  return (
    <div className="permit-config-page" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card style={{ padding: 0, borderRadius: 16, overflow: "hidden" }}>
        <form onSubmit={handleSave}>
          {/* Header */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--color-text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon.FileText size={20} style={{ color: "var(--color-primary)" }} />
                  <span>Meat Permit Configuration</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Configure official defaults for Meat Inspection Certificates and Gate Passes. Changes apply only to newly issued permits.
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: "24px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 20,
              }}
            >
              {/* Point of Origin */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  Point of Origin <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.origin}
                  onChange={(e) => handleChange("origin", e.target.value.toUpperCase())}
                  placeholder="e.g. TAPON TINAAN"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Facility origin location shown on the Meat Inspection Certificate
                </div>
              </div>

              {/* Destination */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  Destination <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.destination}
                  onChange={(e) => handleChange("destination", e.target.value.toUpperCase())}
                  placeholder="e.g. NEW PEOPLES MARKET"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Default market or receiving center destination
                </div>
              </div>

              {/* Physical Facility Address */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  Physical Facility Address <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.address}
                  onChange={(e) => handleChange("address", e.target.value.toUpperCase())}
                  placeholder="e.g. EAST POBLACION"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Physical address printed on official certificates and slips
                </div>
              </div>

              {/* Conveyance Used */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  Conveyance Used <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.conveyance}
                  onChange={(e) => handleChange("conveyance", e.target.value.toUpperCase())}
                  placeholder="e.g. MEAT VAN"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Vehicle transport classification (e.g. MEAT VAN, REFRIGERATED TRUCK)
                </div>
              </div>

              {/* Meat Inspector Name */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  Meat Inspector Name <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.inspector}
                  onChange={(e) => handleChange("inspector", e.target.value.toUpperCase())}
                  placeholder="e.g. NERISSA U. VELOSO"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 700 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Official signatory as Meat Inspector III
                </div>
              </div>

              {/* City Veterinarian Name */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "block" }}>
                  City Veterinarian Name <span className="req">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={form.cityVet}
                  onChange={(e) => handleChange("cityVet", e.target.value.toUpperCase())}
                  placeholder="e.g. DR. RAYMUNDO VALENTINE P. PAMIREZ"
                  style={{ height: 44, borderRadius: 8, fontSize: 13, textTransform: "uppercase", fontWeight: 700 }}
                />
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Official authorizing officer as City Veterinarian
                </div>
              </div>
            </div>
          </div>

          {/* Footer Controls */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 24px",
              background: "var(--color-bg)",
              borderTop: "1px solid var(--color-border)",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              {saved ? (
                <span style={{ color: "var(--color-success)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon.Check size={14} /> Active parameters saved. Newly issued permits will adopt these details.
                </span>
              ) : (
                <span>Unsaved changes will not take effect until confirmed.</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <Button type="button" variant="outline" onClick={handleReset}>
                Reset Defaults
              </Button>
              <Button type="submit" disabled={saving} className="btn-primary" style={{ padding: "9px 24px" }}>
                {saving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <ConfirmAdminPasswordModal {...confirmModalProps} />
    </div>
  );
};

export default PermitConfig;

