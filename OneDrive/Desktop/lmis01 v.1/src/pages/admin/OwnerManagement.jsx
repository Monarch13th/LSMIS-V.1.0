import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, PageHeader, Modal, ConfirmDialog, Badge, Button, StatCard, EmptyState, Input, Select, Textarea, Pagination } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../components/notifications/Toast";
import { ownerAuthService } from "../../services/ownerAuthService";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatDate, formatPhDateTime } from "../../utils/formatters";
import { initials, today } from "../../utils/helpers";
import { ConfirmAdminPasswordModal } from "../../components/admin/ConfirmAdminPasswordModal";
import { useAdminConfirmPassword } from "../../hooks/useAdminConfirmPassword";
import { initRealtimeSync } from "../../services/realtimeSync";

// Official Google 4-Color "G" Brand Logo
const GoogleLogo = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      fill="#EA4335"
    />
  </svg>
);

export const isPendingOwner = (o) => {
  if (!o) return false;
  const st = String(o.status || "").toLowerCase().trim();
  const idStr = String(o.id || o.temp_reg_id || "");
  if (st.includes("pending") || st.includes("verification") || st.includes("review") || st.includes("approval")) return true;
  if (idStr.startsWith("REG") && st !== "approved" && st !== "rejected") return true;
  return false;
};

export const getNormalizedStatus = (o) => {
  if (!o) return "Pending Approval";
  const st = String(o.status || "").toLowerCase().trim();
  if (st === "rejected") return "Rejected";
  if (st === "inactive" || st === "deactivated" || st === "suspended") return "Deactivated";
  if (isPendingOwner(o) || st.includes("pending")) return "Pending Approval";
  return "Approved";
};

/**
 * Normalizes any account ID into the standard "REG-001-2026" or "OWN-001-2026" format.
 * Correctly transforms formats like OWN-2026-0018 -> OWN-018-2026, OWN-2026-0019 -> OWN-019-2026, etc.
 */
export const formatOwnerId = (o, fallbackIndex = 1) => {
  if (!o) return `REG-001-2026`;
  const idStr = String(o.id || o.temp_reg_id || o.owner_id || "").trim();

  // Match prefixes like OWN, REG, OWNER followed by two hyphenated numeric segments
  const matchTwoParts = idStr.match(/^(OWN|REG|OWNER)-(\d+)-(\d+)$/i);
  if (matchTwoParts) {
    const rawPrefix = matchTwoParts[1].toUpperCase();
    const prefix = rawPrefix === "OWNER" ? "OWN" : rawPrefix;
    const p1 = matchTwoParts[2];
    const p2 = matchTwoParts[3];

    let year = 2026;
    let num = 1;

    // Case 1: First part is a 4-digit year (e.g. 2026 in OWN-2026-0018, OWN-2026-0019)
    if (/^20\d{2}$/.test(p1) && !/^20\d{2}$/.test(p2)) {
      year = parseInt(p1, 10);
      num = parseInt(p2, 10);
    }
    // Case 2: Second part is a 4-digit year (e.g. 2026 in OWN-018-2026 or OWN-18-2026)
    else if (/^20\d{2}$/.test(p2)) {
      year = parseInt(p2, 10);
      num = parseInt(p1, 10);
    }
    // Case 3: Fallback order
    else {
      num = parseInt(p1, 10);
      year = parseInt(p2, 10);
    }

    const compactNum = num > 999 ? (num % 1000) || 1 : num;
    return `${prefix}-${String(compactNum).padStart(3, "0")}-${year}`;
  }

  // Format OWNER-012 -> OWN-012-2026
  const legacyOwnerMatch = idStr.match(/^OWNER-(\d+)$/i);
  if (legacyOwnerMatch) {
    const num = parseInt(legacyOwnerMatch[1], 10);
    return `OWN-${String(num).padStart(3, "0")}-2026`;
  }

  // Format OWN-12 -> OWN-012-2026 or REG-12 -> REG-012-2026
  const singlePartMatch = idStr.match(/^(OWN|REG)-(\d+)$/i);
  if (singlePartMatch) {
    const prefix = singlePartMatch[1].toUpperCase();
    const num = parseInt(singlePartMatch[2], 10);
    return `${prefix}-${String(num).padStart(3, "0")}-2026`;
  }

  // If raw UUID (e.g. 2c244c74-55f4-4fdc-9785-aec02f1a4c33) or test string:
  // Convert deterministically into a clean single-line ID: OWN-018-2026 or REG-001-2026
  if (idStr.length > 15 || idStr.includes("test") || idStr.includes("-")) {
    const isApproved = String(o.status || "").toLowerCase() === "approved";
    const prefix = isApproved ? "OWN" : "REG";
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) {
      hash = (hash * 31 + idStr.charCodeAt(i)) % 900;
    }
    const num = Math.abs(hash) + 1;
    const year = new Date(o.registered_date || o.created_at || Date.now()).getFullYear() || 2026;
    return `${prefix}-${String(num).padStart(3, "0")}-${year}`;
  }

  return idStr || `REG-${String(fallbackIndex).padStart(3, "0")}-2026`;
};

// Preset rejection reasons for rapid administrative processing
const PRESET_REJECTION_REASONS = [
  "Incomplete or unverifiable address",
  "Invalid or unreachable mobile contact number",
  "Duplicate registration application detected",
  "Incorrect or unverifiable owner credentials provided",
  "Applicant requested cancellation of registration",
];

export const OwnerManagement = () => {
  const { session } = useAuth();
  const { showToast } = useToast();

  const [owners, setOwners] = useState([]);
  const [livestock, setLivestock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Filter & Search
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") || searchParams.get("id") || "");
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && ["all", "pending", "approved", "rejected"].includes(urlTab)) return urlTab;
    return "all";
  });
  const [sortBy, setSortBy] = useState("date_desc"); // "date_desc" | "date_asc" | "name_asc"
  const [copiedId, setCopiedId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [selectedOwner, setSelectedOwner] = useState(null);

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && ["all", "pending", "approved", "rejected"].includes(urlTab)) {
      setActiveTab(urlTab);
    }
    const q = searchParams.get("search") || searchParams.get("id");
    if (q) {
      setSearch(q);
      const upperQ = q.trim().toUpperCase();
      const match = (owners || []).find(
        (o) =>
          String(o.id || "").toUpperCase() === upperQ ||
          String(o.temp_reg_id || "").toUpperCase() === upperQ ||
          String(o.name || "").toUpperCase().includes(upperQ)
      );
      if (match) {
        setSelectedOwner(match);
      }
    }
  }, [searchParams, owners]);
  const [historyOwner, setHistoryOwner] = useState(null);
  const [approveConfirmOwner, setApproveConfirmOwner] = useState(null);
  const [rejectModalOwner, setRejectModalOwner] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editModalOwner, setEditModalOwner] = useState(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    contact: "",
    address: "",
    email: "",
    username: "",
    status: "Approved",
  });
  const [deleteModalOwner, setDeleteModalOwner] = useState(null);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch owners and livestock strictly from Supabase
  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else if (owners.length === 0) setLoading(true);

    try {
      let dbOwners = [];
      let dbLivestock = [];
      let dbUsers = [];
      let staffUsers = [];

      try {
        const [oRes, uRes, lRes, sRes] = await Promise.all([
          supabase.from(TABLES.OWNERS).select("*").order("registered_date", { ascending: false }),
          supabase.from(TABLES.USERS).select("*").eq("role", "owner"),
          supabase.from(TABLES.LIVESTOCK).select("*"),
          supabase.from(TABLES.USERS).select("email, role").in("role", ["admin", "vet", "staff"]),
        ]);
        if (!oRes.error && oRes.data) dbOwners = oRes.data;
        if (!uRes.error && uRes.data) dbUsers = uRes.data;
        if (!lRes.error && lRes.data) {
          dbLivestock = lRes.data;
          setLivestock(lRes.data);
        }
        if (!sRes.error && sRes.data) staffUsers = sRes.data;
      } catch (e) {
        console.warn("Supabase query note in OwnerManagement:", e);
      }

      const map = new Map();
      // Primary source: public.owners
      dbOwners.forEach((o) => {
        if (o.id) map.set(o.id, { ...o });
      });

      // Supplemental source: public.users with role='owner'
      dbUsers.forEach((u) => {
        if (!u) return;
        const ownerKey = u.owner_id || u.id;

        // Find if this owner is already in map by ID or by email to prevent duplicate cards
        let existingKey = null;
        if (map.has(ownerKey)) {
          existingKey = ownerKey;
        } else if (u.email) {
          const cleanEmail = u.email.toLowerCase().trim();
          for (const [k, v] of map.entries()) {
            if ((v.email || "").toLowerCase().trim() === cleanEmail) {
              existingKey = k;
              break;
            }
          }
        }

        if (existingKey) {
          // Merge missing fields into existing owner record without creating duplicate
          const existing = map.get(existingKey);
          if (!existing.username && u.username) existing.username = u.username;
          if (!existing.email && u.email) existing.email = u.email;
          if (!existing.contact && u.contact) existing.contact = u.contact;
          if (!existing.address && u.address) existing.address = u.address;
          if (!existing.created_at && u.created_at) existing.created_at = u.created_at;
          if (u.temp_reg_id && !existing.temp_reg_id) existing.temp_reg_id = u.temp_reg_id;
          if (!existing.avatar_url && u.avatar_url) existing.avatar_url = u.avatar_url;
          if (!existing.google_id && u.google_id) existing.google_id = u.google_id;
          if (!existing.auth_provider && u.auth_provider) existing.auth_provider = u.auth_provider;
        } else if (ownerKey) {
          map.set(ownerKey, {
            id: ownerKey,
            temp_reg_id: u.temp_reg_id || (String(ownerKey).startsWith("REG") ? ownerKey : undefined),
            name: u.full_name || u.name || "Owner",
            email: u.email,
            contact: u.contact || "",
            address: u.address || "",
            username: u.username,
            status: isPendingOwner(u) ? "Pending Approval" : (u.status || "Approved"),
            registered_date: u.created_at || today(),
            created_at: u.created_at,
            avatar_url: u.avatar_url || null,
            google_id: u.google_id || null,
            auth_provider: u.auth_provider || (u.google_id ? "google" : "email"),
          });
        }
      });

      // Dynamic Classification: Exclude system personnel (admin, vet, staff) using Supabase as source of truth
      const systemStaffEmails = new Set(
        staffUsers
          .map((s) => (s.email || "").toLowerCase().trim())
          .filter(Boolean)
      );

      let mergedOwners = Array.from(map.values()).filter((o) => {
        if (!o) return false;
        const role = (o.role || "").toLowerCase().trim();
        const email = (o.email || "").toLowerCase().trim();
        if (role === "admin" || role === "vet" || role === "staff") return false;
        if (email && systemStaffEmails.has(email)) return false;
        return true;
      });

      // Normalize statuses
      mergedOwners.forEach((o) => {
        o.status = getNormalizedStatus(o);
      });

      setOwners(mergedOwners);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      console.warn("Failed loading owner management data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    initRealtimeSync();

    let debounceTimer = null;
    const debouncedReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadData(true);
      }, 250);
    };

    const onDbChange = (event) => {
      const changedTable = event?.detail?.table;
      if (!changedTable || changedTable === "*" || changedTable === TABLES.OWNERS || changedTable === TABLES.USERS || changedTable === TABLES.LIVESTOCK) {
        debouncedReload();
      }
    };

    window.addEventListener("storage", debouncedReload);
    window.addEventListener("lmis-db-change", onDbChange);

    // Dedicated Supabase Realtime channel subscription directly in OwnerManagement
    // guarantees instant updates even across different browser sessions / devices
    let ownerChannel = null;
    try {
      ownerChannel = supabase
        .channel("admin_owner_management_realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.OWNERS }, () => {
          debouncedReload();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.USERS }, () => {
          debouncedReload();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: TABLES.LIVESTOCK }, () => {
          debouncedReload();
        })
        .subscribe();
    } catch (err) {
      console.warn("OwnerManagement Supabase channel subscription error:", err);
    }

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener("storage", debouncedReload);
      window.removeEventListener("lmis-db-change", onDbChange);
      if (ownerChannel) {
        supabase.removeChannel(ownerChannel);
      }
    };
  }, []);

  const handleCopyId = (e, formattedId, rawId) => {
    e.stopPropagation();
    const toCopy = formattedId || rawId;
    if (!toCopy) return;
    navigator.clipboard?.writeText(toCopy);
    setCopiedId(toCopy);
    showToast(`Copied ID: ${toCopy}`, "info");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // KPIs (Strictly 3 statuses: Pending Approval, Approved, Rejected)
  const totalCount = owners.length;
  const pendingCount = owners.filter((o) => getNormalizedStatus(o) === "Pending Approval").length;
  const approvedCount = owners.filter((o) => {
    const s = getNormalizedStatus(o);
    return s === "Approved" || s === "Deactivated";
  }).length;
  const rejectedCount = owners.filter((o) => getNormalizedStatus(o) === "Rejected").length;

  // Filtered & Sorted List
  const filteredOwners = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = owners.filter((o, idx) => {
      const displayId = formatOwnerId(o, idx + 1);
      const ownerAnimals = (livestock || []).filter(
        (l) => String(l.owner_id) === String(o.id) || (l.owner_name && l.owner_name.toLowerCase() === (o.name || "").toLowerCase())
      );
      const animalTags = ownerAnimals.map((a) => a.tag_number).filter(Boolean).join(" ").toLowerCase();
      const animalBreeds = ownerAnimals.map((a) => a.breed).filter(Boolean).join(" ").toLowerCase();
      const animalSpecies = ownerAnimals.map((a) => a.species).filter(Boolean).join(" ").toLowerCase();

      const matchSearch =
        !q ||
        displayId.toLowerCase().includes(q) ||
        (o.id || "").toLowerCase().includes(q) ||
        (o.name || "").toLowerCase().includes(q) ||
        (o.email || "").toLowerCase().includes(q) ||
        (o.contact || "").includes(q) ||
        (o.address || "").toLowerCase().includes(q) ||
        (o.username || "").toLowerCase().includes(q) ||
        animalTags.includes(q) ||
        animalBreeds.includes(q) ||
        animalSpecies.includes(q);

      if (!matchSearch) return false;

      const norm = getNormalizedStatus(o);
      if (activeTab === "pending") {
        return norm === "Pending Approval";
      }
      if (activeTab === "approved") {
        return norm === "Approved" || norm === "Deactivated";
      }
      if (activeTab === "rejected") {
        return norm === "Rejected";
      }
      return true;
    });

    // Sort items
    result.sort((a, b) => {
      // Pin pending accounts to the very top in "all" view
      if (activeTab === "all") {
        const aPending = getNormalizedStatus(a) === "Pending Approval" ? 1 : 0;
        const bPending = getNormalizedStatus(b) === "Pending Approval" ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;
      }

      if (sortBy === "name_asc") {
        return (a.name || "").localeCompare(b.name || "");
      }
      if (sortBy === "date_asc") {
        const dateA = new Date(a.created_at || a.registered_date || 0).getTime();
        const dateB = new Date(b.created_at || b.registered_date || 0).getTime();
        return dateA - dateB;
      }
      // default: date_desc
      const dateA = new Date(a.created_at || a.registered_date || 0).getTime();
      const dateB = new Date(b.created_at || b.registered_date || 0).getTime();
      return dateB - dateA;
    });

    return result;
  }, [owners, search, activeTab, sortBy]);

  const { confirmModalProps, confirmAdminAction } = useAdminConfirmPassword();

  // Actions
  const handleApprove = async () => {
    if (!approveConfirmOwner) return;
    const targetOwner = approveConfirmOwner;
    confirmAdminAction({
      title: "Approve Livestock Owner Registration",
      actionDescription: `You are approving registration for owner "${targetOwner.name}". Please enter your password to confirm authorization.`,
      confirmButtonText: "Confirm Approval",
      danger: false,
      actionContext: {
        action: `Approved owner registration for ${targetOwner.name}`,
        module: "Owner Management",
      },
      onConfirm: async () => {
        setActionLoading(true);
        try {
          const res = await ownerAuthService.approveOwner({
            regId: targetOwner.id,
            email: targetOwner.email,
            adminUser: session || { name: "System Administrator", email: "admin1@gmail.com" },
          });

          if (res?.emailSent) {
            showToast(`Owner ${targetOwner.name} approved successfully. Approval email sent to ${res.email || targetOwner.email || "owner"}.`, "success");
          } else if (res?.emailError) {
            showToast(`Owner ${targetOwner.name} approved successfully. (Note: Email notice: ${res.emailError})`, "success");
          } else {
            showToast(res.message || "Owner approved successfully!", "success");
          }

          setApproveConfirmOwner(null);
          if (selectedOwner?.id === targetOwner.id) {
            setSelectedOwner(null);
          }
          // Optimistically update owner status to Approved at 0ms
          setOwners((prev) =>
            prev.map((o) =>
              o.id === targetOwner.id
                ? { ...o, status: "Approved", id: res?.ownerId || o.id }
                : o
            )
          );
          loadData(true);
        } catch (err) {
          showToast(err.message || "Failed to approve owner.", "error");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleReject = (targetOwner) => {
    if (!targetOwner) return;
    setRejectModalOwner(targetOwner);
    setRejectReason(PRESET_REJECTION_REASONS[0]);
  };

  const executeReject = (targetOwner, selectedReason) => {
    if (!targetOwner) return;
    const finalReason = selectedReason || rejectReason || "Application rejected by administrator.";

    confirmAdminAction({
      title: "Confirm Application Rejection",
      actionDescription: `You are rejecting registration for owner "${targetOwner.name}". Please enter your password to authorize this action.`,
      confirmButtonText: "Authorize Rejection",
      danger: true,
      actionContext: {
        action: `Rejected owner registration for ${targetOwner.name}`,
        module: "Owner Management",
        danger: true,
      },
      onConfirm: async () => {
        setActionLoading(true);
        try {
          const res = await ownerAuthService.rejectOwner({
            regId: targetOwner.id,
            reason: finalReason,
            adminUser: session || { name: "System Administrator", email: "admin1@gmail.com" },
          });

          if (res?.emailSent) {
            showToast(`Registration for ${targetOwner.name} was rejected. Rejection email sent to ${res.email || targetOwner.email || "owner"}.`, "info");
          } else if (res?.emailError) {
            showToast(`Registration for ${targetOwner.name} was rejected. (Note: Email notice: ${res.emailError})`, "warning");
          } else {
            showToast(`Registration for ${targetOwner.name} was rejected.`, "info");
          }

          setRejectModalOwner(null);
          if (selectedOwner?.id === targetOwner.id) {
            setSelectedOwner(null);
          }
          // Optimistically update owner status to Rejected at 0ms
          setOwners((prev) =>
            prev.map((o) =>
              o.id === targetOwner.id
                ? { ...o, status: "Rejected" }
                : o
            )
          );
          loadData(true);
        } catch (err) {
          showToast(err.message || "Failed to reject registration.", "error");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleToggleDeactivateOwner = (owner) => {
    if (!owner) return;
    const ownerName = owner.name || owner.username || owner.email || "Owner";
    const statusStr = String(owner.status || "").toLowerCase().trim();
    const isDeactivated = statusStr === "inactive" || statusStr === "deactivated" || statusStr === "suspended";

    if (isDeactivated) {
      confirmAdminAction({
        title: "Confirm Owner Account Activation",
        actionDescription: `You are about to activate the owner account for "${ownerName}". This will restore login and livestock registration access immediately across all devices. Enter administrator password to authorize.`,
        confirmButtonText: "Activate Account",
        danger: false,
        actionContext: {
          action: `Activated owner account for ${ownerName}`,
          module: "Owner Management",
        },
        onConfirm: async () => {
          setActionLoading(true);
          try {
            await ownerAuthService.activateOwner({
              ownerId: owner.id,
              adminUser: session || { name: "System Administrator", email: "admin1@gmail.com" },
            });
            showToast(`Account for ${ownerName} has been activated`, "success");
            setOwners((prev) =>
              prev.map((o) => (o.id === owner.id ? { ...o, status: "Approved" } : o))
            );
            loadData(true);
          } catch (err) {
            console.error(err);
            showToast(err.message || "Failed to activate owner account", "error");
          } finally {
            setActionLoading(false);
          }
        },
      });
    } else {
      confirmAdminAction({
        title: "Confirm Owner Account Deactivation",
        actionDescription: `You are about to deactivate the owner account for "${ownerName}". All active sessions will be terminated and portal login access will be blocked until reactivated. Enter administrator password to authorize.`,
        confirmButtonText: "Deactivate Account",
        danger: true,
        actionContext: {
          action: `Deactivated owner account for ${ownerName}`,
          module: "Owner Management",
          danger: true,
        },
        onConfirm: async () => {
          setActionLoading(true);
          try {
            await ownerAuthService.deactivateOwner({
              ownerId: owner.id,
              adminUser: session || { name: "System Administrator", email: "admin1@gmail.com" },
            });
            showToast(`Account for ${ownerName} has been deactivated`, "success");
            setOwners((prev) =>
              prev.map((o) => (o.id === owner.id ? { ...o, status: "Deactivated" } : o))
            );
            loadData(true);
          } catch (err) {
            console.error(err);
            showToast(err.message || "Failed to deactivate owner account", "error");
          } finally {
            setActionLoading(false);
          }
        },
      });
    }
  };

  const openEditOwnerModal = (o) => {
    setEditModalOwner(o);
    setEditConfirmOpen(false);
    setEditFormData({
      name: o.name || "",
      contact: o.contact || "",
      address: o.address || "",
      email: o.email || "",
      username: o.username || "",
      status: getNormalizedStatus(o),
      oldEmail: o.email || "",
    });
  };

  const handleSaveEditOwner = async () => {
    if (!editModalOwner) return;
    if (!editFormData.name.trim()) {
      showToast("Owner Full Name is required.", "error");
      return;
    }
    const targetOwner = editModalOwner;
    const formData = { ...editFormData };

    confirmAdminAction({
      title: "Update Owner Account Profile",
      actionDescription: `Updating account details for owner "${formData.name}". Please enter password to authorize database modifications.`,
      confirmButtonText: "Confirm Profile Update",
      danger: false,
      actionContext: {
        action: `Updated owner profile for ${formData.name}`,
        module: "Owner Management",
      },
      onConfirm: async () => {
        setActionLoading(true);
        try {
          await ownerAuthService.updateOwner({
            ownerId: targetOwner.id,
            patch: formData,
            adminUser: session?.name || "System Administrator",
          });

          // Immediately update local state so table updates right away
          setOwners((prev) =>
            prev.map((o) =>
              o.id === targetOwner.id
                ? {
                    ...o,
                    name: formData.name,
                    contact: formData.contact,
                    address: formData.address,
                    email: formData.email,
                    username: formData.username,
                    status: formData.status,
                  }
                : o
            )
          );

          showToast(`Account details for "${formData.name}" updated successfully in database!`, "success");
          setEditConfirmOpen(false);
          setEditModalOwner(null);
          if (selectedOwner?.id === targetOwner.id) {
            setSelectedOwner({ ...selectedOwner, ...formData });
          }
          await loadData();
        } catch (err) {
          showToast(err.message || "Failed to update owner in Supabase.", "error");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleDeleteOwner = async () => {
    if (!deleteModalOwner) return;
    const targetOwner = deleteModalOwner;

    confirmAdminAction({
      title: "Delete Owner Account Record",
      actionDescription: `Permanently deleting owner account "${targetOwner.name}". This action removes all records from database. Enter password to confirm.`,
      confirmButtonText: "Confirm Permanent Deletion",
      danger: true,
      actionContext: {
        action: `Deleted owner account for ${targetOwner.name}`,
        module: "Owner Management",
        danger: true,
      },
      onConfirm: async () => {
        setActionLoading(true);
        try {
          await ownerAuthService.deleteOwner({
            ownerId: targetOwner.id,
            email: targetOwner.email,
            adminUser: session?.name || "System Administrator",
          });
          showToast(`Owner ${targetOwner.name} deleted from Supabase database.`, "success");
          setDeleteModalOwner(null);
          if (selectedOwner?.id === targetOwner.id) {
            setSelectedOwner(null);
          }
          // Optimistically remove deleted owner from local list
          setOwners((prev) => prev.filter((o) => o.id !== targetOwner.id));
          loadData(true);
        } catch (err) {
          showToast(err.message || "Failed to delete owner from Supabase.", "error");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const getStatusBadge = (o) => {
    const status = getNormalizedStatus(o);
    if (status === "Pending Approval") {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "0.78rem",
          fontWeight: 700,
          color: "#b45309",
          whiteSpace: "nowrap",
        }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#f59e0b",
          }} />
          Pending Approval
        </span>
      );
    }
    if (status === "Rejected") {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "0.78rem",
          fontWeight: 700,
          color: "var(--color-danger, #ef4444)",
          whiteSpace: "nowrap",
        }}>
          <Icon.X size={13} style={{ strokeWidth: 2.5 }} />
          Rejected
        </span>
      );
    }
    if (status === "Deactivated") {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "0.78rem",
          fontWeight: 700,
          color: "#dc2626",
          whiteSpace: "nowrap",
        }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#dc2626",
          }} />
          Inactive
        </span>
      );
    }
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "0.78rem",
        fontWeight: 700,
        color: "var(--color-success, #10b981)",
        whiteSpace: "nowrap",
      }}>
        <Icon.Check size={13} style={{ strokeWidth: 3 }} />
        Approved
      </span>
    );
  };

  const openOwnerDetail = async (owner) => {
    if (!owner) return;
    setSelectedOwner(owner);
    try {
      if (owner.id || owner.email) {
        let query = supabase.from(TABLES.OWNERS).select("*");
        if (owner.id) {
          query = query.eq("id", owner.id);
        } else {
          query = query.ilike("email", owner.email);
        }
        const { data: freshOwner, error } = await query.maybeSingle();
        if (freshOwner && !error) {
          setSelectedOwner((prev) =>
            prev && (prev.id === owner.id || prev.email === owner.email)
              ? { ...prev, ...freshOwner }
              : prev
          );
        }
      }
    } catch (err) {
      console.warn("Real-time owner detail query notice:", err);
    }
  };

  return (
    <div className="admin-owners-page records-page-container" style={{ width: "100%", padding: 0 }}>
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
        {/* Single-line Header Toolbar matching Reference Standard */}
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
          {/* Left: Segmented Status Tabs */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {[
              { key: "all", label: "All Owners", count: totalCount, icon: <Icon.Users size={14} /> },
              { key: "pending", label: "Pending Approval", count: pendingCount, icon: <Icon.AlertCircle size={14} /> },
              { key: "approved", label: "Approved", count: approvedCount, icon: <Icon.CheckCircle size={14} /> },
              { key: "rejected", label: "Rejected", count: rejectedCount, icon: <Icon.XCircle size={14} /> },
            ].map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); setPage(1); }}
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
            <div style={{ position: "relative", width: 240 }}>
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
                placeholder="Search ID, name, email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
                  onClick={() => { setSearch(""); setPage(1); }}
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

            {/* Sort Selector */}
            <div style={{ position: "relative" }}>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  height: 34,
                  padding: "0 26px 0 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  fontSize: 12,
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  outline: "none",
                  cursor: "pointer",
                  appearance: "none",
                }}
              >
                <option value="date_desc">Newest First</option>
                <option value="date_asc">Oldest First</option>
                <option value="name_asc">Name (A–Z)</option>
              </select>
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--color-text-muted)", fontSize: 10 }}>▼</span>
            </div>
          </div>
        </div>

        {/* Responsive Table Container */}
        <div className="records-scrollable-content table-wrap" style={{ width: "100%", overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", flex: 1, minHeight: 0 }}>
          <table
            className="table"
            style={{
              width: "100%",
              minWidth: "1060px",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              margin: 0,
            }}
          >
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "25%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  OWNER DETAILS
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  CONTACT &amp; ADDRESS
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  DATE REGISTERED
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  STATUS
                </th>
                <th style={{ padding: "12px 14px", fontSize: "0.72rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center", whiteSpace: "nowrap", minWidth: "220px" }}>
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOwners.map((o, idx) => {
                const normStatus = getNormalizedStatus(o);
                const isPending = normStatus === "Pending Approval";
                const isRejected = normStatus === "Rejected";
                const isDeactivated = normStatus === "Deactivated";
                const isApproved = normStatus === "Approved" || isDeactivated;
                const displayId = formatOwnerId(o, idx + 1);

                return (
                  <tr
                    key={o.id || idx}
                    onClick={() => openOwnerDetail(o)}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      cursor: "pointer",
                      background: isPending
                        ? "rgba(254, 243, 199, 0.25)"
                        : isRejected
                        ? "rgba(254, 242, 242, 0.25)"
                        : "#ffffff",
                      transition: "background 0.12s ease",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = isPending
                        ? "rgba(254, 243, 199, 0.45)"
                        : isRejected
                        ? "rgba(254, 242, 242, 0.45)"
                        : "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isPending
                        ? "rgba(254, 243, 199, 0.25)"
                        : isRejected
                        ? "rgba(254, 242, 242, 0.25)"
                        : "#ffffff")
                    }
                  >
                    {/* Column 1: Owner Details */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        {o.avatar_url ? (
                          <img
                            src={o.avatar_url}
                            alt={o.name}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              if (e.currentTarget.nextSibling) {
                                e.currentTarget.nextSibling.style.display = "flex";
                              }
                            }}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "8px",
                              objectFit: "cover",
                              flexShrink: 0,
                              border: "1px solid var(--color-border)",
                            }}
                          />
                        ) : null}
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "8px",
                            background: isApproved
                              ? "linear-gradient(135deg, #059669 0%, #047857 100%)"
                              : isPending
                              ? "linear-gradient(135deg, #d97706 0%, #b45309 100%)"
                              : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                            color: "#ffffff",
                            fontWeight: 800,
                            fontSize: "0.82rem",
                            display: o.avatar_url ? "none" : "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {initials(o.name) || "OW"}
                        </div>
                        <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                          <div
                            style={{
                              fontSize: "0.86rem",
                              fontWeight: 700,
                              color: "var(--color-text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                            title={o.name}
                          >
                            <span>{o.name}</span>
                            {(o.auth_provider === "google" || o.google_id) && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: "0.68rem",
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: "rgba(66, 133, 244, 0.12)",
                                  color: "#2563eb",
                                  border: "1px solid rgba(66, 133, 244, 0.25)",
                                  flexShrink: 0,
                                }}
                                title="Registered with Google account"
                              >
                                <GoogleLogo size={11} /> Google
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: "0.74rem",
                              color: "var(--color-text-muted)",
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={o.email || o.username || ""}
                          >
                            {o.username && <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>@{o.username} · </span>}
                            <span>{o.email || "No email"}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Contact & Address */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", overflow: "hidden" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#0284c7", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                        <Icon.Phone size={12} style={{ flexShrink: 0 }} />
                        {o.contact ? (
                          <span>{o.contact}</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "0.74rem",
                          color: "#64748b",
                          marginTop: 3,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                        title={o.address || "No address on file"}
                      >
                        <Icon.MapPin size={12} style={{ color: "#94a3b8", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.address || "No address on file"}</span>
                      </div>
                    </td>

                    {/* Column 3: Date Registered */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon.Calendar size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                        <span>{formatDate(o.registered_date || o.created_at)}</span>
                      </div>
                    </td>

                    {/* Column 4: Approval Status */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      {getStatusBadge(o)}
                    </td>

                    {/* Column 6: Actions */}
                    <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "center", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "6px", justifyContent: "center", alignItems: "center", flexWrap: "nowrap" }}>
                        {isPending ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openOwnerDetail(o); }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                                height: "30px",
                                padding: "0 9px",
                                borderRadius: "6px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                background: "var(--color-surface)",
                                color: "var(--color-text)",
                                border: "1px solid var(--color-border)",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                              title="View pending registration details"
                              aria-label="View Owner Details"
                            >
                              <Icon.Eye size={13} />
                              <span>View</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setApproveConfirmOwner(o); }}
                              disabled={actionLoading}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                                height: "30px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                background: "#059669",
                                color: "#ffffff",
                                border: "1px solid #047857",
                                cursor: actionLoading ? "not-allowed" : "pointer",
                                opacity: actionLoading ? 0.6 : 1,
                                boxShadow: "0 1px 2px rgba(5, 150, 105, 0.2)",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = "#047857"; }}
                              onMouseLeave={(e) => { if (!actionLoading) e.currentTarget.style.background = "#059669"; }}
                              title="Approve owner registration"
                            >
                              <Icon.Check size={13} style={{ strokeWidth: 2.5 }} />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleReject(o); }}
                              disabled={actionLoading}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                                height: "30px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                background: "#dc2626",
                                color: "#ffffff",
                                border: "1px solid #b91c1c",
                                cursor: actionLoading ? "not-allowed" : "pointer",
                                opacity: actionLoading ? 0.6 : 1,
                                boxShadow: "0 1px 2px rgba(220, 38, 38, 0.2)",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => { if (!actionLoading) e.currentTarget.style.background = "#b91c1c"; }}
                              onMouseLeave={(e) => { if (!actionLoading) e.currentTarget.style.background = "#dc2626"; }}
                              title="Reject owner registration"
                            >
                              <Icon.X size={13} style={{ strokeWidth: 2.5 }} />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : isRejected ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openOwnerDetail(o); }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              height: "30px",
                              padding: "0 9px",
                              borderRadius: "6px",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              background: "var(--color-surface)",
                              color: "var(--color-text)",
                              border: "1px solid var(--color-border)",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                            title="View rejected registration details"
                            aria-label="View Owner Details"
                          >
                            <Icon.Eye size={13} />
                            <span>View</span>
                          </button>
                        ) : (
                          /* Approved / Active Owner Account: Deactivate Only */
                          isDeactivated ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleToggleDeactivateOwner(o); }}
                              disabled={actionLoading}
                              style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: "1px solid #bbf7d0",
                                background: "#f0fdf4",
                                color: "#166534",
                                cursor: actionLoading ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 600,
                                transition: "all 0.15s ease",
                              }}
                              title="Activate owner account"
                            >
                              <Icon.CheckCircle size={14} style={{ color: "#16a34a" }} />
                              <span>Activate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleToggleDeactivateOwner(o); }}
                              disabled={actionLoading}
                              style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: "1px solid #fecaca",
                                background: "#fef2f2",
                                color: "#991b1b",
                                cursor: actionLoading ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 600,
                                transition: "all 0.15s ease",
                              }}
                              title="Deactivate owner account"
                            >
                              <Icon.XCircle size={14} style={{ color: "#dc2626" }} />
                              <span>Deactivate</span>
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {filteredOwners.length === 0 && (
          <div style={{ padding: "40px 20px" }}>
            <EmptyState
              title="No owner records found"
              message={
                search
                  ? `No livestock owners match "${search}". Try checking for spelling or resetting search filters.`
                  : activeTab === "pending"
                  ? "There are currently no pending owner registrations awaiting administrative review."
                  : "No livestock owners found in this filter category."
              }
              icon={<Icon.Users size={40} />}
              action={
                search || activeTab !== "all" || sortBy !== "date_desc" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSearch(""); setActiveTab("all"); setSortBy("date_desc"); }}
                  >
                    Reset All Filters
                  </Button>
                ) : null
              }
            />
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: APPROVE OWNER CONFIRMATION */}
      {/* ========================================================================= */}
      <Modal
        open={!!approveConfirmOwner}
        onClose={() => setApproveConfirmOwner(null)}
        title="Approve Owner Account Registration"
        size="md"
      >
        {approveConfirmOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: "8px",
              padding: "12px 14px",
              color: "#065f46",
              fontSize: "0.85rem",
              lineHeight: 1.45,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}>
              <Icon.CheckCircle size={18} style={{ color: "#059669", flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>You are approving this prospective livestock owner.</strong>
                <div style={{ marginTop: 2, fontSize: "0.8rem" }}>
                  Approving will automatically assign the official Owner ID (e.g. <code>OWN-001-2026</code>) and activate portal sign-in access.
                </div>
              </div>
            </div>

            <div style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: "0.85rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Owner Full Name:</span>
                <strong style={{ color: "var(--color-text)" }}>{approveConfirmOwner.name}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Email Address:</span>
                <span className="mono font-semibold" style={{ color: "var(--color-text)" }}>{approveConfirmOwner.email}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Contact Number:</span>
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{approveConfirmOwner.contact}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Address:</span>
                <span style={{ color: "var(--color-text)", textAlign: "right", maxWidth: "260px" }}>{approveConfirmOwner.address}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Current Reference:</span>
                <span className="mono" style={{ color: "var(--color-warning, #d97706)", fontWeight: 700 }}>{formatOwnerId(approveConfirmOwner)}</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <Button variant="outline" size="sm" onClick={() => setApproveConfirmOwner(null)} disabled={actionLoading}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleApprove} disabled={actionLoading}>
                {actionLoading ? <span className="spinner" /> : <Icon.Check size={14} />}
                <span>Approve</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: REJECT OWNER */}
      {/* ========================================================================= */}
      <Modal
        open={!!rejectModalOwner}
        onClose={() => setRejectModalOwner(null)}
        title="Reject Owner Account Registration"
        size="md"
      >
        {rejectModalOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              padding: "12px 14px",
              color: "#991b1b",
              fontSize: "0.85rem",
              lineHeight: 1.45,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}>
              <Icon.AlertTriangle size={18} style={{ color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>You are rejecting this prospective livestock owner application.</strong>
                <div style={{ marginTop: 2, fontSize: "0.8rem", color: "#b91c1c" }}>
                  An official notice will be recorded in Supabase, and a rejection email explaining the reason will be sent to the applicant.
                </div>
              </div>
            </div>

            <div style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: "0.85rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Owner Full Name:</span>
                <strong style={{ color: "var(--color-text)" }}>{rejectModalOwner.name}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Email Address:</span>
                <span className="mono font-semibold" style={{ color: "var(--color-text)" }}>{rejectModalOwner.email}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", paddingBottom: 6 }}>
                <span style={{ color: "var(--color-text-muted)" }}>Contact Number:</span>
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{rejectModalOwner.contact}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Current Reference:</span>
                <span className="mono" style={{ color: "var(--color-warning, #d97706)", fontWeight: 700 }}>{formatOwnerId(rejectModalOwner)}</span>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                Reason for Rejection <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{
                  width: "100%",
                  height: "38px",
                  padding: "0 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "0.84rem",
                  color: "#1e293b",
                  background: "#ffffff",
                  outline: "none",
                  cursor: "pointer",
                  marginBottom: rejectReason === "other" ? 8 : 0,
                }}
              >
                {PRESET_REJECTION_REASONS.map((r, i) => (
                  <option key={i} value={r}>{r}</option>
                ))}
                <option value="other">Other / Custom Reason...</option>
              </select>

              {rejectReason === "other" && (
                <textarea
                  id="custom-rejection-reason"
                  rows={3}
                  placeholder="Enter specific administrative reason for rejection..."
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "0.84rem",
                    boxSizing: "border-box",
                    marginTop: 6,
                    outline: "none",
                  }}
                />
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <Button variant="outline" size="sm" onClick={() => setRejectModalOwner(null)} disabled={actionLoading}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  let reasonToSend = rejectReason;
                  if (rejectReason === "other") {
                    const customEl = document.getElementById("custom-rejection-reason");
                    reasonToSend = customEl?.value?.trim() || "Registration rejected by administrator.";
                  }
                  executeReject(rejectModalOwner, reasonToSend);
                }}
                disabled={actionLoading}
              >
                {actionLoading ? <span className="spinner" /> : <Icon.X size={14} />}
                <span>Confirm Rejection</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {/* ========================================================================= */}
      {/* MODAL 3: OWNER REGISTRATION DETAILS (TABLE VIEW) */}
      {/* ========================================================================= */}
      <Modal
        open={!!selectedOwner}
        onClose={() => setSelectedOwner(null)}
        title="Owner Registration Details"
        size="lg"
        footer={
          <Button variant="outline" size="sm" onClick={() => setSelectedOwner(null)}>
            Close
          </Button>
        }
      >
        {selectedOwner && (() => {
          const ownerName = selectedOwner.name || selectedOwner.full_name || "—";
          const regDateRaw = selectedOwner.registered_date || selectedOwner.created_at;
          const regDate = formatPhDateTime(regDateRaw) || formatDate(regDateRaw) || "—";
          const adminNote = selectedOwner.rejection_reason || selectedOwner.notes;

          const sections = [
            {
              title: "Account Identification",
              rows: [
                { icon: <Icon.Tag size={14} />, field: "Owner ID", value: formatOwnerId(selectedOwner), mono: true, strong: true, accent: "#0369a1" },
                { icon: <Icon.User size={14} />, field: "Full Name", value: ownerName, strong: true },
                { icon: <Icon.Key size={14} />, field: "Username", value: selectedOwner.username ? `@${selectedOwner.username}` : "—", mono: true },
                {
                  icon: <Icon.ShieldCheck size={14} />,
                  field: "Auth Provider",
                  custom: (selectedOwner.auth_provider === "google" || selectedOwner.google_id) ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#2563eb", fontWeight: 700, fontSize: "0.82rem" }}>
                      <GoogleLogo size={13} /> Google OAuth (Connected)
                    </span>
                  ) : (
                    <span style={{ color: "var(--color-text)", fontWeight: 500 }}>
                      Email & Password
                    </span>
                  ),
                },
              ],
            },
            {
              title: "Contact Information",
              rows: [
                { icon: <Icon.Mail size={14} />, field: "Email Address", value: selectedOwner.email || "—", mono: true },
                { icon: <Icon.Phone size={14} />, field: "Contact Number", value: selectedOwner.contact || selectedOwner.phone || "—", mono: true },
                { icon: <Icon.MapPin size={14} />, field: "Address", value: selectedOwner.address || "—" },
              ],
            },
            {
              title: "Registration & Compliance",
              rows: [
                { icon: <Icon.Calendar size={14} />, field: "Registration Date", value: regDate },
                { icon: <Icon.ShieldCheck size={14} />, field: "Account Status", custom: getStatusBadge(selectedOwner) },
                {
                  icon: <Icon.FileText size={14} />,
                  field: "Terms & User Agreement",
                  custom: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#047857", fontWeight: 600 }}>
                      <Icon.CheckCircle size={14} /> Accepted
                    </span>
                  ),
                },
                ...(adminNote ? [{ icon: <Icon.Info size={14} />, field: "Administrative Remarks", value: adminNote }] : []),
              ],
            },
          ];

          const labelCell = {
            width: "34%",
            padding: "11px 18px",
            borderRight: "1px solid #e5e7eb",
            borderBottom: "1px solid #eef2f6",
            background: "#fafbfc",
            color: "#475569",
            fontSize: "0.8rem",
            fontWeight: 600,
            verticalAlign: "middle",
          };
          const valueCell = {
            padding: "11px 18px",
            borderBottom: "1px solid var(--color-border)",
            color: "var(--color-text)",
            fontSize: "0.86rem",
            verticalAlign: "middle",
            wordBreak: "break-word",
          };

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Record Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                  paddingBottom: 16,
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                  {selectedOwner.avatar_url ? (
                    <img
                      src={selectedOwner.avatar_url}
                      alt={ownerName}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        if (e.currentTarget.nextSibling) {
                          e.currentTarget.nextSibling.style.display = "flex";
                        }
                      }}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "2px solid #3b82f6",
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "#0f3d66",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "1rem",
                      letterSpacing: "0.02em",
                      display: selectedOwner.avatar_url ? "none" : "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {initials(ownerName) || "OW"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--color-text)", lineHeight: 1.25 }}>{ownerName}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: "0.78rem", color: "var(--color-text-muted)", flexWrap: "wrap" }}>
                      <span className="mono" style={{ color: "var(--color-info)", fontWeight: 600 }}>{formatOwnerId(selectedOwner)}</span>
                      <span style={{ color: "var(--color-border)" }}>|</span>
                      <span>Livestock Owner Account</span>
                    </div>
                  </div>
                </div>
                <div>{getStatusBadge(selectedOwner)}</div>
              </div>

              {/* Structured Details Table */}
              <div style={{ overflowX: "auto", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", textAlign: "left" }}>
                  <colgroup>
                    <col style={{ width: "34%" }} />
                    <col />
                  </colgroup>
                  <tbody>
                    {sections.map((section, sIdx) => (
                      <Fragment key={`sec-${sIdx}`}>
                        <tr>
                          <th
                            colSpan={2}
                            style={{
                              padding: "9px 18px",
                              background: "#f1f5f9",
                              borderTop: sIdx === 0 ? "none" : "1px solid #e2e8f0",
                              borderBottom: "1px solid #e2e8f0",
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              color: "#334155",
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                            }}
                          >
                            {section.title}
                          </th>
                        </tr>
                        {section.rows.map((row, rIdx) => (
                          <tr key={`row-${sIdx}-${rIdx}`}>
                            <td style={labelCell}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                                <span style={{ color: "#94a3b8", display: "inline-flex" }}>{row.icon}</span>
                                {row.field}
                              </span>
                            </td>
                            <td
                              className={row.mono ? "mono" : ""}
                              style={{
                                ...valueCell,
                                fontWeight: row.strong ? 600 : 500,
                                color: row.value === "—" ? "#94a3b8" : row.accent || valueCell.color,
                              }}
                            >
                              {row.custom
                                ? row.custom
                                : typeof row.value === "object" && row.value !== null
                                ? (row.value.label ?? row.value.value ?? "—")
                                : row.value}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons inside Details Modal */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, paddingTop: 10 }}>
                <Button variant="outline" size="sm" onClick={() => setSelectedOwner(null)}>
                  Close
                </Button>
                {getNormalizedStatus(selectedOwner) !== "Pending Approval" && getNormalizedStatus(selectedOwner) !== "Rejected" && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const toEdit = selectedOwner;
                      setSelectedOwner(null);
                      openEditOwnerModal(toEdit);
                    }}
                  >
                    <Icon.Edit size={14} />
                    <span>Edit Profile</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5: VERIFICATION HISTORY AUDIT TRAIL */}
      {/* ========================================================================= */}
      <Modal
        open={!!historyOwner}
        onClose={() => setHistoryOwner(null)}
        title="Owner Account Verification History"
        size="md"
      >
        {historyOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "14px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}>
              <div>
                <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#0f172a" }}>{historyOwner.name}</h4>
                <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>
                  ID: <strong>{formatOwnerId(historyOwner)}</strong> · {historyOwner.email}
                </div>
              </div>
              {getStatusBadge(historyOwner)}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ padding: "10px 12px", borderRadius: "8px", background: "#ffffff", border: "1px solid #e2e8f0" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#0f172a" }}>Registration Application Submitted</div>
                  <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                    Registered on {formatDate(historyOwner.registered_date || historyOwner.created_at)}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#047857", marginTop: 2, fontWeight: 600 }}>
                    User Agreement Accepted
                  </div>
                </div>
              </div>

              <div style={{ padding: "10px 12px", borderRadius: "8px", background: "#ffffff", border: "1px solid #e2e8f0" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#0f172a" }}>
                    Administrator Approval: {historyOwner.approved_by ? "Approved" : "Pending Review"}
                  </div>
                  {historyOwner.approved_by ? (
                    <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                      Approved by <strong>{historyOwner.approved_by}</strong> on {formatDate(historyOwner.approved_at)}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                      Application is currently pending Administrator evaluation.
                    </div>
                  )}
                </div>
              </div>

              {historyOwner.rejection_reason && (
                <div style={{ padding: "10px 12px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#991b1b" }}>Rejection Recorded</div>
                    <div style={{ fontSize: "0.74rem", color: "#b91c1c" }}>{historyOwner.rejection_reason}</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
              <Button variant="outline" size="sm" onClick={() => setHistoryOwner(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 6: EDIT OWNER ACCOUNT DETAILS IN SUPABASE */}
      {/* ========================================================================= */}
      <Modal
        open={!!editModalOwner}
        onClose={() => setEditModalOwner(null)}
        title="Edit Livestock Producer / Owner Details"
        size="md"
      >
        {editModalOwner && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditConfirmOpen(true);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            {/* Warning / Alert Banner */}
            <div style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: "8px",
              padding: "10px 14px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              color: "#92400e"
            }}>
              <Icon.AlertTriangle size={18} style={{ color: "#d97706", flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: "0.8rem", lineHeight: 1.45 }}>
                <strong style={{ color: "#78350f", display: "block", marginBottom: 2 }}>
                  Warning: Modifying Producer Account Details
                </strong>
                <span>
                  Changes made here will be updated directly in the Supabase database (<strong>public.owners</strong> &amp; <strong>public.users</strong>). Modifying contact, email, or status will directly affect system records and portal authentication.
                </span>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Account Reference ID
              </label>
              <input
                type="text"
                disabled
                value={formatOwnerId(editModalOwner)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#f1f5f9",
                  color: "#64748b",
                  fontSize: "0.85rem",
                  fontFamily: "monospace",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Full Name <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <Input
                type="text"
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                placeholder="e.g. Juan Dela Cruz"
                required
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Contact Number
                </label>
                <Input
                  type="text"
                  value={editFormData.contact}
                  onChange={(e) => setEditFormData({ ...editFormData, contact: e.target.value })}
                  placeholder="09171234567"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Username
                </label>
                <Input
                  type="text"
                  value={editFormData.username}
                  onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                  placeholder="username (optional)"
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Email Address
              </label>
              <Input
                type="email"
                value={editFormData.email}
                onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                placeholder="owner@example.com"
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Address
              </label>
              <Textarea
                rows={2}
                value={editFormData.address}
                onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                placeholder="Purok, Barangay, City / Municipality"
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Account Status
              </label>
              <select
                value={editFormData.status}
                onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "0.85rem",
                  color: "#0f172a",
                }}
              >
                <option value="Pending Approval">Pending Approval</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            {editFormData.status === "Rejected" && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "#991b1b" }}>
                <Icon.AlertTriangle size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                <span>Warning: Setting status to <strong>Rejected</strong> will restrict this producer's login access.</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditModalOwner(null)} disabled={actionLoading}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={actionLoading || !editFormData.name.trim()}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* CONFIRMATION WARNING ALERT DIALOG FOR EDITING DETAILS */}
      <ConfirmDialog
        open={editConfirmOpen}
        onCancel={() => setEditConfirmOpen(false)}
        onConfirm={handleSaveEditOwner}
        title="Confirm Account Details Update"
        message={`Are you sure you want to update the details for "${editFormData.name}"? This action directly updates database records in Supabase and sets the account status to "${editFormData.status}".`}
        confirmText="Confirm & Save"
        confirmVariant="warning"
        loading={actionLoading}
      />

      {/* ========================================================================= */}
      {/* MODAL 7: DELETE OWNER ACCOUNT CONFIRMATION IN SUPABASE */}
      {/* ========================================================================= */}
      <Modal
        open={!!deleteModalOwner}
        onClose={() => setDeleteModalOwner(null)}
        title="Delete Livestock Owner Account"
        size="sm"
      >
        {deleteModalOwner && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#dc2626" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon.AlertTriangle size={20} style={{ color: "#dc2626" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#991b1b" }}>
                  Confirm Permanent Account Deletion
                </div>
                <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                  This will permanently delete this owner record from the Supabase database.
                </div>
              </div>
            </div>

            <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "0.82rem" }}>
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: "#64748b" }}>Owner Name: </span>
                <strong style={{ color: "#0f172a" }}>{deleteModalOwner.name}</strong>
              </div>
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: "#64748b" }}>Account Reference: </span>
                <code style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, color: "#0369a1" }}>
                  {formatOwnerId(deleteModalOwner)}
                </code>
              </div>
              {deleteModalOwner.email && (
                <div>
                  <span style={{ color: "#64748b" }}>Email: </span>
                  <span style={{ color: "#334155" }}>{deleteModalOwner.email}</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <Button variant="outline" size="sm" onClick={() => setDeleteModalOwner(null)} disabled={actionLoading}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteOwner} disabled={actionLoading}>
                {actionLoading ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmAdminPasswordModal {...confirmModalProps} />
    </div>
  );
};
