// Flexible fee & payment service.
// Admin defines fee rules; Staff payment auto-loads & calculates totals.
import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES } from "../utils/constants";
import { uuid, today } from "../utils/helpers";
import { logActivity } from "./activityService";
import { authService } from "./authService";

export const getNextReceiptNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `RCP-${year}-`;
  let payments = [];

  try {
    const { data } = await supabase
      .from(TABLES.PAYMENTS)
      .select("receipt_no")
      .like("receipt_no", `${prefix}%`)
      .order("receipt_no", { ascending: false })
      .limit(50);
    payments = data || [];
  } catch (err) {
    console.warn("Could not load existing receipts from Supabase:", err);
  }

  const highestNumber = payments.reduce((highest, payment) => {
    const match = String(payment.receipt_no || "").match(new RegExp(`^RCP-${year}-(\\d+)$`, "i"));
    return match ? Math.max(highest, parseInt(match[1], 10)) : highest;
  }, 0);

  return `${prefix}${String(highestNumber + 1).padStart(3, "0")}`;
};

export const normalizeAnimalType = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "Others";

  const normalized = raw.toLowerCase();
  if (["hog", "pig", "piglet", "swine"].includes(normalized)) return "Hog";
  if (["cattle", "cow", "bull", "steer", "bovine"].includes(normalized)) return "Cattle";
  if (["carabao", "buffalo", "water buffalo"].includes(normalized)) return "Carabao";
  if (["goat", "chevon", "kid"].includes(normalized)) return "Goat";

  return raw;
};

export const feeService = {
  /* ===== Fee rules (Admin) ===== */
  normalizeAnimalType,
  resolveFeeRule: (animalType, fees = []) => {
    const target = normalizeAnimalType(animalType);
    const list = Array.isArray(fees) ? fees : [];

    return list.find((f) => normalizeAnimalType(f.animal_type) === target && f.status === "Active")
      || list.find((f) => normalizeAnimalType(f.animal_type) === "Others" && f.status === "Active")
      || list.find((f) => f.status === "Active")
      || null;
  },
  listFees: () => supabase.from(TABLES.FEES).select().then((r) => r.data),

  createFee: async (p) => {
    const id = `FEE-${String(Math.floor(Math.random() * 900) + 100)}`;
    const { data, error } = await supabase.from(TABLES.FEES).insert({ id, effective_date: p.effective_date || today(), status: "Active", ...p });
    if (error) {
      console.error("Error creating fee:", error);
      throw error;
    }
    await logActivity({ action: `Added fee rule ${p.fee_name}`, module: "Settings", notify: { title: "New Fee Rule", message: `${p.fee_name} added for ${p.animal_type} (${p.method} @ ₱${p.rate})`, type: "info" } });
    notifyDbChange(TABLES.FEES, "insert", p);
    return { data };
  },

  updateFee: async (id, patch) => {
    const { id: _id, ...cleanPatch } = patch || {};
    const now = new Date();
    const phDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
    const updateData = {
      ...cleanPatch,
      effective_date: cleanPatch.effective_date || phDate,
    };

    let data = null;
    let error = null;

    try {
      const res = await supabase
        .from(TABLES.FEES)
        .update({ ...updateData, updated_at: now.toISOString() })
        .eq("id", id)
        .select();
      data = res.data;
      error = res.error;

      if (error && (error.code === "42703" || (error.message && error.message.includes("updated_at")))) {
        const fallbackRes = await supabase
          .from(TABLES.FEES)
          .update(updateData)
          .eq("id", id)
          .select();
        data = fallbackRes.data;
        error = fallbackRes.error;
      }
    } catch (e) {
      error = e;
    }

    if (error) {
      console.error("Error updating fee:", error);
      throw error;
    }
    if (!data || data.length === 0) {
      throw new Error(`Failed to update fee rate: Record "${id}" was not updated. Please check admin permissions.`);
    }

    try {
      await logActivity({ action: `Updated fee rule ${id}`, module: "Settings" });
    } catch (logErr) {
      console.warn("Activity logging failed during fee update:", logErr);
    }

    notifyDbChange(TABLES.FEES, "update", { id, ...updateData });
    return { data: data[0] };
  },

  deleteFee: async (id) => {
    const { data, error } = await supabase.from(TABLES.FEES).delete().eq("id", id);
    if (error) {
      console.error("Error deleting fee:", error);
      throw error;
    }
    await logActivity({ action: `Deleted fee rule ${id}`, module: "Settings" });
    notifyDbChange(TABLES.FEES, "delete", { id });
    return { data };
  },

  toggleFee: async (id, status) => {
    const { data, error } = await supabase.from(TABLES.FEES).update({ status }).eq("id", id);
    if (error) {
      console.error("Error toggling fee status:", error);
      throw error;
    }
    notifyDbChange(TABLES.FEES, "update", { id, status });
    return { data };
  },

  /** Find the active fee rule for an animal type */
  findFeeForAnimal: async (animalType) => {
    const fees = await supabase.from(TABLES.FEES).select().then((r) => r.data);
    return feeService.resolveFeeRule(animalType, fees);
  },

  /** Calculate total based on method */
  calculate: ({ method, rate, quantity = 1, weight = 0 }) => {
    const r = parseFloat(rate) || 0;
    if (method === "Per Kilo") return Math.round(r * (parseFloat(weight) || 0));
    return Math.round(r * (parseInt(quantity) || 1)); // Per Head
  },

  /* ===== Payments (Staff) ===== */
  listPayments: () => supabase.from(TABLES.PAYMENTS).select().then((r) => r.data),

  createPayment: async (p) => {
    if (p.tag_number) {
      try {
        const { data: existing } = await supabase
          .from(TABLES.PAYMENTS)
          .select("*")
          .eq("tag_number", p.tag_number)
          .eq("status", "Paid")
          .maybeSingle();
        if (existing) {
          return existing;
        }
      } catch (_) {}
    }

    const receipt = await getNextReceiptNumber();
    const staff = authService.getSession()?.name || "Staff";
    const nowIso = p.paid_at || p.created_at || new Date().toISOString();
    const { fee_name, ...dbPayload } = p;
    const baseRecord = {
      id: uuid(),
      date: p.date || today(),
      status: "Paid",
      receipt_no: receipt,
      staff_name: staff,
      created_at: nowIso,
      paid_at: nowIso,
      ...dbPayload,
    };

    const insertPayload = {
      ...baseRecord,
      ...(p.species ? { species: p.species } : {}),
      ...(p.fee_name ? { fee_name: p.fee_name } : {}),
    };

    let result = await supabase.from(TABLES.PAYMENTS).insert(insertPayload).select();
    if (result.error) {
      const errorText = String(result.error.message || "");
      const missingColumn = /column .*fee_name|fee_name.*does not exist|unknown column.*fee_name|column .*species|species.*does not exist|unknown column.*species|created_at|paid_at/i.test(errorText);
      if (missingColumn) {
        const fallbackRecord = { ...baseRecord };
        delete fallbackRecord.species;
        delete fallbackRecord.fee_name;
        delete fallbackRecord.created_at;
        delete fallbackRecord.paid_at;
        result = await supabase.from(TABLES.PAYMENTS).insert(fallbackRecord).select();
      }
      if (result.error) {
        console.error("Error creating payment:", result.error);
        throw result.error;
      }
    }

    const savedRow = result.data?.[0] || insertPayload;
    const timeFormatted = new Date(nowIso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    await logActivity({
      action: `Recorded payment ${receipt}${p.tag_number ? ` for ${p.tag_number}` : ""} (${p.animal_type || p.species}) at ${timeFormatted}`,
      module: "Payments",
      tag_number: p.tag_number || null,
      notify: {
        title: "Payment Received",
        message: `₱${Number(p.amount).toLocaleString()} collected from ${p.owner_name} for ${p.tag_number} at ${timeFormatted}`,
        type: "success"
      },
    });
    notifyDbChange(TABLES.PAYMENTS, "insert", savedRow);
    if (p.tag_number) {
      notifyDbChange(TABLES.LIVESTOCK, "update", { tag_number: p.tag_number });
    }
    return savedRow;
  },

  updatePayment: async (id, patch) => {
    const res = await supabase.from(TABLES.PAYMENTS).update(patch).eq("id", id);
    await logActivity({ action: `Updated payment ${id}`, module: "Payments" });
    notifyDbChange(TABLES.PAYMENTS, "update", { id, ...patch });
    return res;
  },
};
