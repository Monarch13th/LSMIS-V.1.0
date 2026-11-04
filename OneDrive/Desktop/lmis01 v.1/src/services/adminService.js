import { supabase } from "./supabaseClient";
import { notifyDbChange } from "./realtimeSync";
import { TABLES, STORAGE_KEYS } from "../utils/constants";
import { uuid, now } from "../utils/helpers";
import { createClient } from "@supabase/supabase-js";
import { authStore } from "../store/authStore";
import { activityService } from "./activityService";
import { authSecurityService } from "./authSecurityService";

// Helper for live Supabase data
const fetchTable = async (table) => {
  let dbData = [];
  try {
    const res = await supabase.from(table).select("*");
    if (!res.error && res.data) {
      dbData = res.data;
    }
  } catch (e) {
    console.warn(`AdminService Supabase ${table} fetch error:`, e);
  }

  return dbData;
};

// Fire database change notification to update all mounted hooks locally, cross-tab, and cross-browser.
const notifyChange = (table = TABLES.USERS, action = "update", record = null) => {
  notifyDbChange(table, action, record);
};

// Check if an email is already registered across ANY account type (Staff, Vet, Admin, Owner)
export const isEmailTakenAcrossSystem = async (email, excludeUserId = null) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return false;

  // 1. Check Supabase USERS table
  try {
    let q = supabase.from(TABLES.USERS).select("id, email").ilike("email", cleanEmail);
    if (excludeUserId) q = q.neq("id", excludeUserId);
    const { data } = await q.limit(1).maybeSingle();
    if (data?.email) return true;
  } catch (e) {}

  // 2. Check Supabase OWNERS table
  try {
    let q = supabase.from(TABLES.OWNERS).select("id, email").ilike("email", cleanEmail);
    if (excludeUserId) q = q.neq("id", excludeUserId);
    const { data } = await q.limit(1).maybeSingle();
    if (data?.email) return true;
  } catch (e) {}

  return false;
};

const isUuid = (val) =>
  typeof val === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

const sanitizeUserDbPayload = (raw = {}) => {
  const allowed = [
    "id", "created_at", "full_name", "email", "username", "role", "owner_id", "status", "last_login",
    "avatar_url", "phone", "contact", "address", "license", "specialization",
    "terminated_at", "terminated_until", "termination_reason", "active_session_id", "active_session_updated_at"
  ];
  const out = {};
  for (const k of allowed) {
    if (raw[k] !== undefined && raw[k] !== null) {
      out[k] = typeof raw[k] === "string" ? raw[k].trim() : raw[k];
    }
  }
  if (out.email) out.email = out.email.toLowerCase();
  if (out.role) out.role = out.role.toLowerCase();
  return out;
};

const inFlightOperations = new Set();

export const adminService = {
  // Classification: Personnel Management is strictly for operational Personnel (Veterinarian & Staff) — never Admins or Owners!
  listUsers: async () => {
    const allUsers = await fetchTable(TABLES.USERS);
    return (allUsers || []).filter((u) => {
      if (!u) return false;
      const r = (u.role || "").toLowerCase().trim();
      if (r === "owner" || u.owner_id || r === "admin" || r.includes("admin")) return false;
      return (
        r === "vet" ||
        r === "staff" ||
        r === "veterinarian" ||
        r === "meat_inspector" ||
        (r.includes("vet") && !r.includes("admin")) ||
        (r.includes("staff") && !r.includes("admin"))
      );
    });
  },

  createUser: async (payload) => {
    const cleanEmail = (payload.email || "").trim().toLowerCase();
    if (await isEmailTakenAcrossSystem(cleanEmail)) {
      throw new Error("This email address is already in use by another account. Please use another email.");
    }
    const assignedRole = (payload.role || "staff").toLowerCase();
    if (assignedRole === "owner") {
      throw new Error("Livestock Owners must be managed through Owner Management.");
    }

    let authData = null;
    try {
      // Use a secondary client so we don't log out the admin when creating a new user
      const secondarySupabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      
      // Create the user in Supabase Auth
      const { data, error: authError } = await secondarySupabase.auth.signUp({
        email: cleanEmail,
        password: payload.password || "password123",
        options: {
          data: {
            full_name: payload.full_name,
            role: assignedRole
          }
        }
      });
      if (!authError) authData = data;
    } catch (e) {
      console.warn("Auth signup failed (offline/no connection):", e);
    }

    const userId = authData?.user?.id || uuid();
    const dbPayload = sanitizeUserDbPayload({ 
      id: userId,
      created_at: new Date().toISOString(), 
      last_login: "Never", 
      status: "Active",
      ...payload,
      email: cleanEmail,
      role: assignedRole
    });

    try {
      const { error: dbError } = await supabase.from(TABLES.USERS).insert(dbPayload);
      if (dbError) {
        console.warn("Supabase DB users insert note:", dbError);
      }
    } catch (err) {
      console.warn("Supabase DB users insert exception:", err);
    }

    try {
      const roleLabel = assignedRole === "admin" ? "Administrator" : assignedRole === "vet" ? "Veterinary Personnel" : "Staff Personnel";
      await activityService.logActivity({
        action: `Created ${roleLabel} account for ${payload.full_name || cleanEmail}`,
        module: "Personnel Management",
        severity: "info",
        role: "admin",
        new_value: `${cleanEmail} (${assignedRole})`,
        field_changed: "account_creation",
      });
    } catch (_) {}
    
    notifyChange();
    return dbPayload;
  },

  updateUser: async (id, patch) => {
    if (patch.email) {
      const cleanEmail = patch.email.trim().toLowerCase();
      if (await isEmailTakenAcrossSystem(cleanEmail, id)) {
        throw new Error("This email address is already in use by another account. Please use another email.");
      }
    }
    const cleanPatch = { ...patch };
    delete cleanPatch.password;
    if (!cleanPatch.id) cleanPatch.id = id;

    const isIdUuid = isUuid(id);
    const targetEmail = cleanPatch.email ? cleanPatch.email.trim().toLowerCase() : null;

    // Build sanitized database payload
    const dbUpdate = sanitizeUserDbPayload(cleanPatch);
    if (!isIdUuid) delete dbUpdate.id; // Don't send non-UUID string as Postgres UUID

    // 1. Sync changes to Supabase Auth (auth.users) if matches active session
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser && (currentUser.id === id || (targetEmail && currentUser.email?.toLowerCase() === targetEmail))) {
        const authUpdates = {
          data: {
            ...currentUser.user_metadata,
            ...(dbUpdate.full_name ? { full_name: dbUpdate.full_name } : {}),
            ...(dbUpdate.role ? { role: dbUpdate.role } : {})
          }
        };
        if (targetEmail && targetEmail !== currentUser.email?.toLowerCase()) {
          authUpdates.email = targetEmail;
        }
        await supabase.auth.updateUser(authUpdates);
      }
    } catch (e) {
      console.warn("Supabase Auth updateUser note:", e);
    }

    // 2. Try RPC admin_update_user if present
    let dbUpdated = false;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("admin_update_user", {
        p_id: isIdUuid ? id : null,
        p_email: targetEmail || null,
        p_full_name: dbUpdate.full_name || null,
        p_username: dbUpdate.username || null,
        p_role: dbUpdate.role || null,
        p_status: dbUpdate.status || null
      });
      if (!rpcErr && rpcRes) {
        dbUpdated = true;
      }
    } catch (e) {}

    // 3. Direct Supabase DB update on public.users
    if (!dbUpdated) {
      try {
        if (isIdUuid) {
          const { data, error } = await supabase.from(TABLES.USERS).update(dbUpdate).eq("id", id).select();
          if (!error && data && data.length > 0) dbUpdated = true;
        }
        if (!dbUpdated && targetEmail) {
          const { data, error } = await supabase.from(TABLES.USERS).update(dbUpdate).ilike("email", targetEmail).select();
          if (!error && data && data.length > 0) dbUpdated = true;
        }
        if (!dbUpdated && cleanPatch.username) {
          const { data, error } = await supabase.from(TABLES.USERS).update(dbUpdate).ilike("username", cleanPatch.username.trim()).select();
          if (!error && data && data.length > 0) dbUpdated = true;
        }

        // If user record doesn't exist yet in Supabase, insert them so they now exist
        if (!dbUpdated && targetEmail) {
          const newId = isIdUuid ? id : uuid();
          await supabase.from(TABLES.USERS).insert({
            ...dbUpdate,
            id: newId,
            email: targetEmail,
            created_at: new Date().toISOString()
          });
        }
      } catch (err) {
        console.warn("Supabase DB users update exception:", err);
      }
    }

    // 4. Update active session in sessionStorage if current user changed their own account
    try {
      const sessionRaw = sessionStorage.getItem(STORAGE_KEYS.SESSION || "lsmis_session") || localStorage.getItem(STORAGE_KEYS.SESSION || "lsmis_session");
      if (sessionRaw) {
        const sess = JSON.parse(sessionRaw);
        if (sess && (sess.id === id || (targetEmail && sess.email?.toLowerCase() === targetEmail))) {
          const updatedSess = { ...sess, ...cleanPatch };
          sessionStorage.setItem(STORAGE_KEYS.SESSION || "lsmis_session", JSON.stringify(updatedSess));
          localStorage.removeItem(STORAGE_KEYS.SESSION || "lsmis_session");
          if (authStore && authStore.set) {
            authStore.set({ session: updatedSess });
          }
        }
      }
    } catch (e) {}

    try {
      const targetLabel = cleanPatch.full_name || targetEmail || cleanPatch.username || id;
      await activityService.logActivity({
        action: `Updated personnel account for ${targetLabel}`,
        module: "Personnel Management",
        severity: "info",
        role: "admin",
        new_value: `${cleanPatch.role ? `Role: ${cleanPatch.role}` : ''}${cleanPatch.status ? ` | Status: ${cleanPatch.status}` : ''}${cleanPatch.email ? ` | Email: ${cleanPatch.email}` : ''}`.replace(/^ \| /, '') || 'Account details updated',
        field_changed: "account_update",
      });
    } catch (_) {}

    notifyChange();
  },

  deleteUser: async (id, userMeta = {}) => {
    const isIdUuid = isUuid(id);
    const targetEmail = (userMeta?.email || (typeof id === "string" && id.includes("@") ? id : null))?.trim()?.toLowerCase();
    const targetUsername = userMeta?.username?.trim();

    // 1. Try RPC admin_delete_user
    try {
      await supabase.rpc("admin_delete_user", {
        p_user_id: isIdUuid ? id : null,
        p_email: targetEmail || null
      });
    } catch (e) {}

    // 2. Direct Supabase DB delete on public.users
    try {
      if (isIdUuid) {
        await supabase.from(TABLES.USERS).delete().eq("id", id);
      }
      if (targetEmail) {
        await supabase.from(TABLES.USERS).delete().ilike("email", targetEmail);
      }
      if (targetUsername) {
        await supabase.from(TABLES.USERS).delete().ilike("username", targetUsername);
      }
      // If linked to an owner, also delete that owner record
      if (userMeta?.owner_id) {
        await supabase.from(TABLES.OWNERS).delete().eq("id", userMeta.owner_id);
      }
    } catch (err) {
      console.warn("Supabase DB delete failed:", err);
    }

    try {
      const targetLabel = userMeta?.full_name || userMeta?.name || targetEmail || targetUsername || id;
      const targetRole = userMeta?.role || 'Personnel';
      await activityService.logActivity({
        action: `Deleted personnel account for ${targetLabel} (${targetRole})`,
        module: "Personnel Management",
        severity: "danger",
        role: "admin",
        old_value: `${targetLabel} (${targetRole})`,
        new_value: "Permanently Deleted",
        field_changed: "account_deletion",
      });
    } catch (_) {}

    notifyChange();
  },

  // Reports / audit
  listAuditLogs: async (limit = 150) => {
    try {
      const { data, error } = await supabase
        .from(TABLES.AUDIT_LOGS)
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (_) {}
    return fetchTable(TABLES.AUDIT_LOGS);
  },
  listBackups: () => fetchTable(TABLES.BACKUPS),
  createBackup: async (name) => {
    const row = { id: uuid(), name, size: `${Math.floor(Math.random() * 200) + 50} MB`, date: now(), status: "Complete" };
    try {
      await supabase.from(TABLES.BACKUPS).insert(row);
      await activityService.logActivity({
        action: `Created system database backup "${name}"`,
        module: "Database Backups",
        severity: "info",
        role: "admin",
        new_value: `${name} (${row.size})`,
        field_changed: "database_backup",
      });
    } catch (err) {}
    notifyChange(TABLES.BACKUPS, "insert", row);
    return row;
  },
  deleteBackup: async (id) => {
    try {
      await supabase.from(TABLES.BACKUPS).delete().eq("id", id);
      await activityService.logActivity({
        action: `Deleted system database backup (ID: ${id})`,
        module: "Database Backups",
        severity: "danger",
        role: "admin",
        old_value: String(id),
        new_value: "Deleted",
        field_changed: "backup_deletion",
      });
    } catch (err) {}
    notifyChange(TABLES.BACKUPS, "delete", { id });
  },

  // Settings
  getSettings: async () => (await fetchTable(TABLES.SETTINGS))[0],
  updateSettings: async (patch) => {
    const data = await fetchTable(TABLES.SETTINGS);
    if (data?.[0]) {
      try {
        await supabase.from(TABLES.SETTINGS).update(patch).eq("id", data[0].id);
        await activityService.logActivity({
          action: "Updated system settings configuration",
          module: "Settings",
          severity: "info",
          role: "admin",
          new_value: JSON.stringify(patch),
          field_changed: "system_settings",
        });
      } catch (err) {}
      notifyChange(TABLES.SETTINGS, "update", patch);
    }
  },

  // Cross-module snapshot
  listAll: async () => {
    const [users, livestock, ante, post, payments, notifications, audit, backups] = await Promise.all([
      fetchTable(TABLES.USERS),
      fetchTable(TABLES.LIVESTOCK),
      fetchTable(TABLES.ANTE_MORTEM),
      fetchTable(TABLES.POST_MORTEM),
      fetchTable(TABLES.PAYMENTS),
      fetchTable(TABLES.NOTIFICATIONS),
      fetchTable(TABLES.AUDIT_LOGS),
      fetchTable(TABLES.BACKUPS),
    ]);
    return { users, livestock, inspections: [...(ante || []), ...(post || [])], payments, notifications, audit, backups };
  },

  // Account Termination & 4-Hour Login Restriction (Veterinarian & Staff Personnel ONLY)
  deactivateUserAccount: async ({ userId, email, role, adminUser = "System Administrator" }) => {
    const targetRole = (role || "").toLowerCase().trim();
    if (targetRole !== "vet" && targetRole !== "staff") {
      throw new Error("Only Veterinarian and Staff Personnel accounts can be deactivated.");
    }

    const cleanEmail = (email || "").trim().toLowerCase();
    const lockKey = `deact_${userId || cleanEmail}`;

    if (inFlightOperations.has(lockKey)) {
      throw new Error("A deactivation request for this account is already in progress.");
    }

    inFlightOperations.add(lockKey);

    try {
      const patch = {
        status: "Inactive",
        terminated_at: new Date().toISOString(),
        terminated_until: null,
        termination_reason: "Deactivated by Administrator",
      };

      let updated = false;
      try {
        if (cleanEmail) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).ilike("email", cleanEmail).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
        if (!updated && userId && isUuid(userId)) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).eq("id", userId).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
      } catch (e) {
        console.warn("Supabase DB deactivation note:", e);
      }

      if (!updated) {
        try {
          if (cleanEmail) {
            await supabase.from(TABLES.USERS).update({ status: "Inactive" }).ilike("email", cleanEmail);
          } else if (isUuid(userId)) {
            await supabase.from(TABLES.USERS).update({ status: "Inactive" }).eq("id", userId);
          }
        } catch (_) {}
      }

      try {
        await activityService.terminateSession(userId || cleanEmail, adminUser, {
          reason: "Account Deactivated",
        });
      } catch (e) {}

      const userLabel = cleanEmail || userId;
      await activityService.logActivity({
        action: `Account deactivated by Administrator for ${userLabel} (${targetRole === 'vet' ? 'Veterinarian' : 'Staff'})`,
        module: "Security",
        security_event: "Account Deactivated",
        severity: "warning",
        user: adminUser,
        role: "admin",
        old_value: "Active",
        new_value: "Inactive",
        field_changed: "account_status",
      });

      notifyChange();
      return { success: true };
    } finally {
      inFlightOperations.delete(lockKey);
    }
  },

  activateUserAccount: async ({ userId, email, role, adminUser = "System Administrator" }) => {
    return await adminService.unterminateUserAccount({ userId, email, role, adminUser });
  },

  terminateUserAccount: async ({ userId, email, role, reason = "", adminUser = "System Administrator" }) => {
    const targetRole = (role || "").toLowerCase().trim();
    if (targetRole !== "vet" && targetRole !== "staff") {
      throw new Error("Account termination can strictly only be applied to Veterinarian and Staff Personnel accounts.");
    }

    const cleanEmail = (email || "").trim().toLowerCase();
    const lockKey = `term_${userId || cleanEmail}`;

    if (inFlightOperations.has(lockKey)) {
      throw new Error("A termination request for this account is already in progress.");
    }

    inFlightOperations.add(lockKey);

    try {
      // Server-side validation of actual account status from Supabase before executing termination
      const statusCheck = await adminService.checkUserTerminationStatus(userId || cleanEmail);
      if (statusCheck.isTerminated) {
        throw new Error("This account is already terminated.");
      }

      const nowIso = new Date().toISOString();
      const untilIso = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const cleanReason = (reason || "").trim();

      const patch = {
        status: "Terminated",
        terminated_at: nowIso,
        terminated_until: untilIso,
        termination_reason: cleanReason || null,
      };

      let updated = false;
      try {
        if (cleanEmail) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).ilike("email", cleanEmail).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
        if (!updated && userId && isUuid(userId)) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).eq("id", userId).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
      } catch (e) {
        console.warn("Supabase DB termination note:", e);
      }

      // Fallback if custom columns are missing: encode values into status field
      if (!updated) {
        const fallbackStatus = `Terminated|${nowIso}|${untilIso}|${cleanReason.replace(/\|/g, " ")}`;
        try {
          if (cleanEmail) {
            await supabase.from(TABLES.USERS).update({ status: fallbackStatus }).ilike("email", cleanEmail);
          } else if (isUuid(userId)) {
            await supabase.from(TABLES.USERS).update({ status: fallbackStatus }).eq("id", userId);
          }
        } catch (_) {}
      }

      // Terminate active session in activityService & broadcast real-time session revocation
      try {
        await activityService.terminateSession(userId || cleanEmail, adminUser, {
          reason: cleanReason,
          terminatedUntil: untilIso,
        });
      } catch (e) {}

      // Audit logging
      const userLabel = cleanEmail || userId;
      await activityService.logActivity({
        action: `Account terminated by Administrator for ${userLabel} (${targetRole === 'vet' ? 'Veterinarian' : 'Staff'}). Reason: ${cleanReason || "None specified"}`,
        module: "Security",
        security_event: "Account Terminated",
        severity: "danger",
        user: adminUser,
        role: "admin",
        old_value: "Active",
        new_value: `Terminated (4-Hour Restriction)`,
        field_changed: "account_status",
      });

      notifyChange();
      return { success: true, terminatedUntil: untilIso };
    } finally {
      inFlightOperations.delete(lockKey);
    }
  },

  unterminateUserAccount: async ({ userId, email, role, adminUser = "System Administrator" }) => {
    const cleanEmail = (email || "").trim().toLowerCase();
    const lockKey = `unterm_${userId || cleanEmail}`;

    if (inFlightOperations.has(lockKey)) {
      throw new Error("A restoration request for this account is already in progress.");
    }

    inFlightOperations.add(lockKey);

    try {
      const patch = {
        status: "Active",
        terminated_at: null,
        terminated_until: null,
        termination_reason: null,
      };

      let updated = false;
      try {
        if (cleanEmail) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).ilike("email", cleanEmail).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
        if (!updated && userId && isUuid(userId)) {
          const { data, error } = await supabase.from(TABLES.USERS).update(patch).eq("id", userId).select("id");
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
      } catch (e) {}

      if (!updated) {
        try {
          if (cleanEmail) {
            await supabase.from(TABLES.USERS).update({ status: "Active" }).ilike("email", cleanEmail);
          } else if (isUuid(userId)) {
            await supabase.from(TABLES.USERS).update({ status: "Active" }).eq("id", userId);
          }
        } catch (_) {}
      }

      try {
        localStorage.removeItem("lsmis_session_termination_signal");
        const rawSessions = JSON.parse(localStorage.getItem("lsmis_active_sessions_v2") || "[]");
        const nextSessions = rawSessions.map((s) =>
          (s.email || "").toLowerCase().trim() === cleanEmail
            ? { ...s, terminated: false, status: "Offline" }
            : s
        );
        localStorage.setItem("lsmis_active_sessions_v2", JSON.stringify(nextSessions));
        window.dispatchEvent(new CustomEvent("lsmis_session_unterminated", { detail: { email: cleanEmail } }));
        window.dispatchEvent(new Event("storage"));
      } catch (_) {}

      const userLabel = cleanEmail || userId;
      await activityService.logActivity({
        action: `Stopped termination & restored account access for ${userLabel}`,
        module: "Security",
        security_event: "Account Reactivated",
        severity: "info",
        user: adminUser,
        role: "admin",
        old_value: "Terminated",
        new_value: "Active",
        field_changed: "account_status",
      });

      notifyChange();
      return { success: true };
    } finally {
      inFlightOperations.delete(lockKey);
    }
  },

  checkUserTerminationStatus: async (identifier) => {
    if (!identifier) return { isTerminated: false };
    const cleanId = String(identifier).trim().toLowerCase();

    try {
      let query = supabase.from(TABLES.USERS).select("*");
      if (cleanId.includes("@")) {
        query = query.ilike("email", cleanId);
      } else if (isUuid(cleanId)) {
        query = query.eq("id", cleanId);
      } else {
        query = query.ilike("username", cleanId);
      }

      const { data: userRow } = await query.limit(1).maybeSingle();
      if (!userRow) {
        // Fallback check against local termination signal
        const rawSignal = localStorage.getItem("lsmis_session_termination_signal");
        if (rawSignal) {
          try {
            const sig = JSON.parse(rawSignal);
            if (sig && sig.email && sig.email.toLowerCase() === cleanId) {
              const nowMs = Date.now();
              const untilMs = sig.terminatedUntil ? new Date(sig.terminatedUntil).getTime() : (sig.timestamp + 4 * 3600 * 1000);
              if (nowMs < untilMs) {
                return { isTerminated: true, reason: sig.reason || null, terminatedAt: sig.timestamp, terminatedUntil: untilMs };
              }
            }
          } catch (_) {}
        }
        return { isTerminated: false };
      }

      const roleLower = (userRow.role || "").toLowerCase().trim();
      const isVetOrStaff =
        roleLower === "vet" ||
        roleLower === "staff" ||
        roleLower === "veterinarian" ||
        roleLower.includes("vet") ||
        roleLower.includes("doctor") ||
        roleLower.includes("staff") ||
        roleLower.includes("operator");

      if (!isVetOrStaff) {
        return { isTerminated: false };
      }

      const statusLower = (userRow.status || "").toLowerCase().trim();
      const isDeactivated = statusLower === "inactive" || statusLower === "deactivated";
      const isTerm = statusLower === "terminated" || statusLower.startsWith("terminated") || isDeactivated;
      if (!isTerm) {
        return { isTerminated: false };
      }

      if (isDeactivated) {
        return {
          isTerminated: true,
          isDeactivated: true,
          reason: "Your account has been deactivated by the Administrator.",
          terminatedAt: userRow.updated_at || userRow.created_at,
          terminatedUntil: null,
        };
      }

      const nowMs = Date.now();
      let termAtMs = userRow.terminated_at ? new Date(userRow.terminated_at).getTime() : null;
      let termUntilMs = userRow.terminated_until ? new Date(userRow.terminated_until).getTime() : null;

      if (statusLower.includes("|")) {
        const parts = userRow.status.split("|");
        if (parts[1]) termAtMs = new Date(parts[1]).getTime();
        if (parts[2]) termUntilMs = new Date(parts[2]).getTime();
      }

      if (!termAtMs) termAtMs = userRow.created_at ? new Date(userRow.created_at).getTime() : nowMs;
      if (!termUntilMs) termUntilMs = termAtMs + 4 * 60 * 60 * 1000;

      const reason = userRow.termination_reason || (statusLower.includes("|") ? userRow.status.split("|")[3] : null) || null;

      // Check 4-hour expiration rule
      if (nowMs >= termUntilMs) {
        // Restriction expired! Auto-clear to Active unless kept terminated explicitly by admin
        if (statusLower !== "terminated_permanent") {
          try {
            await supabase.from(TABLES.USERS).update({
              status: "Active",
              terminated_at: null,
              terminated_until: null,
              termination_reason: null
            }).eq("id", userRow.id);
          } catch (_) {}
          return { isTerminated: false };
        }
      }

      return {
        isTerminated: true,
        user: userRow,
        reason,
        terminatedAt: userRow.terminated_at || new Date(termAtMs).toISOString(),
        terminatedUntil: userRow.terminated_until || new Date(termUntilMs).toISOString(),
        remainingMs: termUntilMs - nowMs,
      };
    } catch (err) {
      console.warn("checkUserTerminationStatus error:", err);
      return { isTerminated: false };
    }
  },

  // Single Active Session restriction enforced across all roles (Admin, Vet, Staff, Owner)
  registerActiveSession: async ({ email, role, sessionId }) => {
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) {
      return { sessionId: null };
    }

    // Guard: Do not register an active session if account is currently terminated in Supabase!
    try {
      const statusCheck = await adminService.checkUserTerminationStatus(cleanEmail);
      if (statusCheck.isTerminated) {
        return { sessionId: null, isTerminated: true };
      }
    } catch (_) {}

    const activeSessionId = sessionId || uuid();
    const res = await authSecurityService.registerActiveSession(cleanEmail, activeSessionId);
    return {
      sessionId: res?.session_id || activeSessionId,
      updatedAt: res?.updated_at || new Date().toISOString(),
      is_active_elsewhere: res?.is_active_elsewhere,
      message: res?.message,
    };
  },

  validateUserActiveSession: async (email, currentSessionId, role, sessionLoginTime = null) => {
    if (!email || !currentSessionId) {
      return { isValid: true };
    }

    const cleanEmail = email.toLowerCase().trim();
    try {
      const { data: userRow, error } = await supabase
        .from(TABLES.USERS)
        .select("status, active_session_id, active_session_updated_at")
        .ilike("email", cleanEmail)
        .limit(1)
        .maybeSingle();

      // Network errors, timeouts, or transient connection drops must never be treated as another login
      if (error) {
        console.warn("validateUserActiveSession connection notice (preserving session):", error);
        return { isValid: true };
      }

      // Missing user row or uninitialized record is NOT proof of another login
      if (!userRow) {
        return { isValid: true };
      }

      // Check termination or deactivation status first
      const statusLower = (userRow?.status || "").toLowerCase();
      if (statusLower.startsWith("terminated") || statusLower === "inactive" || statusLower === "deactivated") {
        return { isValid: false, reason: "account_terminated" };
      }

      // Check active session ID mismatch across users and login_security
      let dbSessionId = userRow?.active_session_id || null;
      let dbUpdatedAt = userRow?.active_session_updated_at ? new Date(userRow.active_session_updated_at).getTime() : 0;

      if (!dbSessionId && (userRow?.status || "").includes("SESS:")) {
        dbSessionId = userRow.status.split("SESS:")[1];
      }

      if (!dbSessionId) {
        try {
          const { data: secRow } = await supabase
            .from("login_security")
            .select("active_session_id, active_session_updated_at")
            .ilike("email", cleanEmail)
            .limit(1)
            .maybeSingle();
          if (secRow?.active_session_id) {
            dbSessionId = secRow.active_session_id;
            if (secRow.active_session_updated_at) {
              dbUpdatedAt = new Date(secRow.active_session_updated_at).getTime();
            }
          }
        } catch (_) {}
      }

      // If database has no active session recorded yet, do not treat as conflict
      if (!dbSessionId || typeof dbSessionId !== "string" || !dbSessionId.trim()) {
        return { isValid: true };
      }

      // Matches current session exactly or client stored session — valid!
      const clientSessionId = authSecurityService.getClientSessionId();
      const tabSessionId =
        (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("lsmis_active_session_id") : null) ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("lsmis_active_session_id") : null);
      if (
        dbSessionId.trim() === currentSessionId.trim() ||
        (clientSessionId && dbSessionId.trim() === clientSessionId.trim()) ||
        (tabSessionId && dbSessionId.trim() === tabSessionId.trim())
      ) {
        return { isValid: true };
      }

      // If the session in DB has expired (inactive for > 120s), it is not an active concurrent session
      if (dbUpdatedAt > 0 && Date.now() - dbUpdatedAt > 120000) {
        return { isValid: true };
      }

      // Verify timestamps: a genuine conflict ONLY exists if the database record was registered
      // by a strictly newer session replacing this one
      const myLoginTime = sessionLoginTime ? new Date(sessionLoginTime).getTime() : 0;

      // Only invalidate if the database has a valid update timestamp that is STRICTLY NEWER
      // than our session's creation/login time (with 3-second buffer to handle clock skew / same-login writes).
      if (dbUpdatedAt > 0 && myLoginTime > 0 && (dbUpdatedAt > myLoginTime + 3000)) {
        return { isValid: false, reason: "concurrent_login", activeSessionId: dbSessionId };
      }

      // If we cannot definitively confirm a newer displacement, safely preserve the session
      return { isValid: true };
    } catch (err) {
      console.warn("validateUserActiveSession unexpected error (preserving session):", err);
      return { isValid: true };
    }
  },

  assertActiveSession: async () => {
    let session = null;
    try {
      const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(STORAGE_KEYS.SESSION) : null;
      if (raw) session = JSON.parse(raw);
    } catch (_) {}

    if (!session || !session.email || !session.session_id) {
      return true;
    }

    const val = await adminService.validateUserActiveSession(
      session.email,
      session.session_id,
      session.role,
      session.login_time || session.ts
    );
    if (!val.isValid) {
      if (val.reason === "concurrent_login") {
        sessionStorage.setItem("lsmis_concurrent_logout_notice", "true");
        window.dispatchEvent(
          new CustomEvent("lsmis_single_session_replaced", {
            detail: {
              email: session.email,
              activeSessionId: val.activeSessionId,
              timestamp: Date.now(),
            },
          })
        );
        throw new Error("Your session has ended because your account was signed in elsewhere.");
      }
      if (val.reason === "account_terminated") {
        throw new Error("Your account has been deactivated by the Administrator.");
      }
      throw new Error("Your session is no longer valid. Please sign in again.");
    }
    return true;
  },
};
