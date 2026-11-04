import { supabase } from "./supabaseClient";
import { TABLES } from "../utils/constants";
import {
  num, toDate, pickDate, recency, isSameMonth, isPaidPayment, sumPaid, countDecisions,
  deltaText, calculateInspectionCategoryCounts,
  PAYMENT_DATE_FIELDS, LIVESTOCK_DATE_FIELDS, INSPECTION_DATE_FIELDS,
} from "../utils/dashboardMetrics";

// In-memory cache for ultra-fast tab switches and page navigations
let _cachedMetrics = null;
let _cachedTime = 0;
const CACHE_TTL_MS = 25000; // 25s fresh window
let _inFlightPromise = null;

/**
 * Fetch and compute Admin Dashboard operational metrics with high performance.
 * - Queries run in parallel with strictly projected scalar columns (no full-table select *).
 * - Drastically reduces network transfer, memory pressure, and render blocking.
 * - Caches computed metrics so switching back to the dashboard is instantaneous.
 */
export async function fetchAdminDashboardData(forceRefresh = false) {
  const nowMs = Date.now();
  if (!forceRefresh && _cachedMetrics && nowMs - _cachedTime < CACHE_TTL_MS) {
    return _cachedMetrics;
  }

  if (_inFlightPromise) {
    return _inFlightPromise;
  }

  _inFlightPromise = (async () => {
    try {
      const nowDt = new Date();
      const lastMonthDt = new Date(nowDt.getFullYear(), nowDt.getMonth() - 1, 1);

      // Targeted parallel queries for Admin operations and throughput
      const [
        usersRes,
        livestockRes,
        anteRes,
        postRes,
        slaughterRes,
        permitsRes,
        pendingOwnersRes,
      ] = await Promise.all([
        supabase
          .from(TABLES.USERS)
          .select("id, full_name, email, role, status, last_login, created_at", { count: "exact" }),
        supabase
          .from(TABLES.LIVESTOCK)
          .select("id, tag_number, species, sex, status, marked, received_date, owner_name, registered_at", { count: "exact" })
          .order("registered_at", { ascending: false })
          .limit(100),
        supabase
          .from(TABLES.ANTE_MORTEM)
          .select("id, tag_number, decision, date, inspected_at, inspector_name", { count: "exact" }),
        supabase
          .from(TABLES.POST_MORTEM)
          .select("id, tag_number, decision, date, inspected_at, inspector_name", { count: "exact" }),
        supabase
          .from(TABLES.SLAUGHTER_RECORDS)
          .select("id, tag_number, species, owner_name, status, scheduled_date, slaughter_date", { count: "exact" }),
        supabase
          .from(TABLES.PERMITS)
          .select("id, permit_no, tag_number, owner_name, species, carcass_weight, status, issued_at, created_at", { count: "exact" })
          .order("issued_at", { ascending: false })
          .limit(100),
        supabase
          .from(TABLES.OWNERS)
          .select("id, status, name, email, created_at, registered_date")
          .or("status.ilike.%pending%,id.like.REG%"),
      ]);

      if (anteRes.error) console.warn("AdminDashboard ante-mortem query notice:", anteRes.error);
      if (postRes.error) console.warn("AdminDashboard post-mortem query notice:", postRes.error);

      const users = usersRes.data || [];
      const livestock = livestockRes.data || [];
      const ante = anteRes.data || [];
      const post = postRes.data || [];
      const slaughter = slaughterRes.data || [];
      const permits = permitsRes.data || [];
      const pendingOwners = (pendingOwnersRes.data || []).filter((o) => {
        const st = String(o.status || "").toLowerCase();
        const id = String(o.id || "");
        return (
          st.includes("pending") ||
          (id.startsWith("REG") && st !== "approved" && st !== "rejected" && st !== "suspended")
        );
      });

      // Calculate key operational figures with resilient fallback
      let anteCount = typeof anteRes.count === "number" ? anteRes.count : (ante.length || 0);
      let postCount = typeof postRes.count === "number" ? postRes.count : (post.length || 0);

      if (anteRes.error) {
        try {
          const { count } = await supabase.from(TABLES.ANTE_MORTEM).select("id", { count: "exact", head: true });
          if (typeof count === "number") anteCount = count;
        } catch (e) { }
      }
      if (postRes.error) {
        try {
          const { count } = await supabase.from(TABLES.POST_MORTEM).select("id", { count: "exact", head: true });
          if (typeof count === "number") postCount = count;
        } catch (e) { }
      }

      const inspectionsTotalCount = anteCount + postCount;

      const livestockTotalCount = typeof livestockRes.count === "number" ? livestockRes.count : livestock.length;
      const slaughterTotalCount = typeof slaughterRes.count === "number" ? slaughterRes.count : slaughter.length;
      const permitsTotalCount = typeof permitsRes.count === "number" ? permitsRes.count : permits.length;

      const activeUsers = users.filter((u) => String(u.status || "").toLowerCase() === "active").length;
      const restrictedUsers = users.length - activeUsers;

      const registeredThisMonth = livestock.filter((l) =>
        isSameMonth(pickDate(l, LIVESTOCK_DATE_FIELDS), nowDt)
      ).length;

      const permitsThisMonth = permits.filter((p) =>
        isSameMonth(toDate(p.issued_at || p.created_at), nowDt)
      ).length;

      const recentUsers = [...users]
        .sort((a, b) => recency(b, ["last_login", "created_at"]) - recency(a, ["last_login", "created_at"]))
        .slice(0, 6);

      const recentPermits = [...permits].slice(0, 6);

      const recentLivestock = [...livestock].slice(0, 6);

      const throughputStats = {
        livestockCount: livestockTotalCount,
        slaughterCount: slaughterTotalCount,
        inspectionCount: inspectionsTotalCount,
        inspectionsCount: inspectionsTotalCount,
        permitCount: permitsTotalCount,
      };

      const metrics = {
        users,
        livestockCount: livestockTotalCount,
        slaughterCount: slaughterTotalCount,
        inspectionsCount: inspectionsTotalCount,
        permitCount: permitsTotalCount,
        permitsThisMonth,
        throughputStats,
        activeUsers,
        restrictedUsers,
        registeredThisMonth,
        recentUsers,
        recentPermits,
        recentLivestock,
        pendingOwnersCount: pendingOwners.length,
        pendingOwners: pendingOwners.slice(0, 6),
        hasSyncIssue: Boolean(
          usersRes.error || livestockRes.error || anteRes.error || postRes.error || permitsRes.error
        ),
      };

      _cachedMetrics = metrics;
      _cachedTime = Date.now();
      return metrics;
    } finally {
      _inFlightPromise = null;
    }
  })();

  return _inFlightPromise;
}

/**
 * Invalidate the dashboard cache when an authoritative mutation occurs.
 */
export function invalidateAdminDashboardCache() {
  _cachedMetrics = null;
  _cachedTime = 0;
}
