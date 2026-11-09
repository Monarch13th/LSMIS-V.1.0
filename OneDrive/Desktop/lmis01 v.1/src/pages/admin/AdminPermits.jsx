import { useState, useMemo, useEffect } from "react";
import { Icon } from "../../components/icons";
import { TagBadge } from "../../components/ui/TagBadge";
import { EmptyState } from "../../components/ui/EmptyState";
import { useSupabase } from "../../hooks/useSupabase";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import { formatPhDateTime } from "../../utils/formatters";
import { initials } from "../../utils/helpers";

/**
 * AdminPermits
 * Strictly view-only administrative monitoring of all Meat Permit records.
 * Organized and grouped by issuance date & time (newest first, Asia/Manila timezone).
 * Status is strictly "Issued" or "Pending".
 */
export const AdminPermits = () => {
  const { data: dbPermits = [], refresh: refreshPermits, loading: loadingPermits } = useSupabase(TABLES.PERMITS);
  const { data: livestock = [], refresh: refreshLivestock, loading: loadingLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: carcass = [], refresh: refreshCarcass } = useSupabase(TABLES.CARCASS);
  const { data: owners = [] } = useSupabase(TABLES.OWNERS);

  const [activeTab, setActiveTab] = useState("pending"); // 'pending' | 'issued'
  const [search, setSearch] = useState("");
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // Realtime subscription to permits and livestock
  useEffect(() => {
    const channel = supabase
      .channel("admin-permits-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.PERMITS }, () => {
        refreshPermits?.();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.LIVESTOCK }, () => {
        refreshLivestock?.();
        refreshCarcass?.();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshPermits, refreshLivestock, refreshCarcass]);

  // Lookup maps for fast resolution
  const ownersMap = useMemo(() => {
    const map = new Map();
    (owners || []).forEach((o) => {
      if (o.name) map.set(o.name.trim().toLowerCase(), o);
      if (o.id) map.set(String(o.id).trim().toLowerCase(), o);
      if (o.owner_id) map.set(String(o.owner_id).trim().toLowerCase(), o);
    });
    return map;
  }, [owners]);

  // Group records by issuance date & time (newest records first)
  const allGroups = useMemo(() => {
    const groupsMap = new Map();
    const norm = (t) => String(t || "").trim().toLowerCase();

    // 1. Process all durable permit records stored in Supabase (Status: Issued)
    (dbPermits || []).forEach((p) => {
      if (String(p.status || "").toLowerCase() === "revoked") return;

      const rawIssuedAt = p.issued_at || p.created_at;
      const dateKey = rawIssuedAt ? String(rawIssuedAt).slice(0, 19) : "no-date";
      const ownerClean = (p.owner_name || "Unknown Owner").trim();
      // Derive base permit number (e.g. MIC-06-978526 from MIC-06-978526-1)
      const basePermitNo = p.permit_no ? String(p.permit_no).replace(/-\d+$/, "") : "Permit";
      const groupKey = `issued|||${dateKey}|||${ownerClean.toLowerCase()}|||${basePermitNo.toLowerCase()}`;

      if (!groupsMap.has(groupKey)) {
        const ownerObj = ownersMap.get(ownerClean.toLowerCase()) || null;
        groupsMap.set(groupKey, {
          key: groupKey,
          status: "Issued",
          rawDate: rawIssuedAt,
          timestamp: rawIssuedAt ? new Date(rawIssuedAt).getTime() : 0,
          owner_name: ownerClean,
          owner_avatar: ownerObj?.avatar_url || p.owner_avatar || null,
          owner_contact: ownerObj?.phone || ownerObj?.contact || "—",
          base_permit_no: basePermitNo,
          permit_numbers: new Set(),
          items: [],
          speciesList: new Set(),
          tags: new Set(),
          total_weight: 0,
        });
      }

      const grp = groupsMap.get(groupKey);
      if (p.permit_no) grp.permit_numbers.add(p.permit_no);
      if (p.tag_number) grp.tags.add(p.tag_number);
      if (p.species) grp.speciesList.add(p.species);
      const w = parseFloat(p.carcass_weight || 0);
      grp.total_weight += isNaN(w) ? 0 : w;

      grp.items.push({
        id: p.id,
        tag_number: p.tag_number,
        permit_no: p.permit_no,
        species: p.species || "Hog",
        weight: w,
      });
    });

    // 2. Identify weighed carcasses awaiting permit issuance (Status: Pending)
    const issuedTags = new Set();
    (dbPermits || []).forEach((p) => {
      if (p.tag_number && String(p.status || "").toLowerCase() !== "revoked") {
        issuedTags.add(norm(p.tag_number));
      }
    });

    (livestock || []).forEach((l) => {
      if (!l.tag_number) return;
      const tag = norm(l.tag_number);
      const isIssuedInLivestock =
        String(l.status || "").toLowerCase() === "permit issued" ||
        String(l.status || "").toLowerCase() === "released" ||
        String(l.status || "").toLowerCase() === "dispatched" ||
        Boolean(l.permit_no) ||
        Boolean(l.permit_issued_at);

      if (isIssuedInLivestock || issuedTags.has(tag)) return;

      // Check if weighed
      const isWeighed =
        String(l.status || "").toLowerCase() === "weighed" ||
        Boolean(l.weighed_at) ||
        (carcass || []).some((c) => norm(c.tag_number) === tag && parseFloat(c.total_weight || c.cold_weight || c.weight || 0) > 0);

      // Exclude condemned / rejected
      const isCondemned = String(l.status || "").toLowerCase().includes("condemned") || String(l.status || "").toLowerCase().includes("rejected");

      if (isWeighed && !isCondemned) {
        const rawDate = l.weighed_at || l.updated_at || l.created_at;
        const dateKey = rawDate ? String(rawDate).slice(0, 16) : "no-date";
        const ownerClean = (l.owner_name || "Unknown Owner").trim();
        const groupKey = `pending|||${dateKey}|||${ownerClean.toLowerCase()}`;

        if (!groupsMap.has(groupKey)) {
          const ownerObj = ownersMap.get(ownerClean.toLowerCase()) || null;
          groupsMap.set(groupKey, {
            key: groupKey,
            status: "Pending",
            rawDate,
            timestamp: rawDate ? new Date(rawDate).getTime() : 0,
            owner_name: ownerClean,
            owner_avatar: ownerObj?.avatar_url || null,
            owner_contact: ownerObj?.phone || ownerObj?.contact || "—",
            base_permit_no: "Pending Issuance",
            permit_numbers: new Set(),
            items: [],
            speciesList: new Set(),
            tags: new Set(),
            total_weight: 0,
          });
        }

        const grp = groupsMap.get(groupKey);
        grp.tags.add(l.tag_number);
        if (l.species) grp.speciesList.add(l.species);
        const carcObj = (carcass || []).find((c) => norm(c.tag_number) === tag);
        const w = parseFloat(carcObj?.total_weight || carcObj?.cold_weight || carcObj?.weight || l.weight || 0);
        grp.total_weight += isNaN(w) ? 0 : w;

        grp.items.push({
          id: l.id,
          tag_number: l.tag_number,
          permit_no: "Pending",
          species: l.species || "Hog",
          weight: w,
        });
      }
    });

    // Convert groups to sorted array (newest records displayed first)
    const result = Array.from(groupsMap.values()).map((grp) => ({
      ...grp,
      permit_numbers: Array.from(grp.permit_numbers),
      speciesList: Array.from(grp.speciesList),
      tags: Array.from(grp.tags),
      total_heads: grp.items.length,
    }));

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }, [dbPermits, livestock, carcass, ownersMap]);

  // Counts for tabs (number of batches matching Staff view)
  const tabCounts = useMemo(() => {
    let issued = 0;
    let pending = 0;
    allGroups.forEach((g) => {
      if (g.status === "Issued") issued++;
      else if (g.status === "Pending") pending++;
    });
    return {
      issued,
      pending,
    };
  }, [allGroups]);

  // Filtered groups based on tab, search, and species
  const filteredGroups = useMemo(() => {
    return allGroups.filter((grp) => {
      // Tab filter
      if (activeTab === "issued" && grp.status !== "Issued") return false;
      if (activeTab === "pending" && grp.status !== "Pending") return false;

      // Species filter
      if (filterSpecies !== "all") {
        const matches = grp.speciesList.some(
          (sp) => String(sp).toLowerCase() === filterSpecies.toLowerCase()
        );
        if (!matches) return false;
      }

      // Search filter (Permit #, Owner Name, or Tag #)
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesOwner = grp.owner_name.toLowerCase().includes(q);
        const matchesPermit = grp.base_permit_no.toLowerCase().includes(q) ||
          grp.permit_numbers.some((pn) => pn.toLowerCase().includes(q));
        const matchesTag = grp.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesOwner && !matchesPermit && !matchesTag) return false;
      }

      return true;
    });
  }, [allGroups, activeTab, filterSpecies, search]);

  const totalPages = Math.ceil(filteredGroups.length / pageSize) || 1;
  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredGroups.slice(start, start + pageSize);
  }, [filteredGroups, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, filterSpecies, search]);

  const isLoading = loadingPermits || loadingLivestock;

  return (
    <div className="permits-page records-page-container" style={{ width: "100%", padding: 0 }}>
      {/* MAIN CONTAINER (Matches Staff Personnel Meat Permit page layout & design) */}
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
        {/* Fixed Header: Segmented Tabs (Left) & Search + Filters (Right) */}
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
            background: "var(--color-surface)",
            minHeight: 54,
            boxSizing: "border-box",
          }}
        >
          {/* Left: Navigation Tabs (Matching Staff Meat Permit: Pending & Permit Issued) */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "var(--color-bg)",
              padding: "3px",
              borderRadius: 9,
              border: "1px solid var(--color-border)",
              gap: 4,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {[
              { id: "pending", label: "Pending", count: tabCounts.pending, icon: <Icon.Clock size={14} />, color: "#d97706", badgeBg: "rgba(217, 119, 6, 0.15)", badgeColor: "#d97706" },
              { id: "issued", label: "Permit Issued", count: tabCounts.issued, icon: <Icon.FileText size={14} />, color: "#8b5cf6", badgeBg: "rgba(139, 92, 246, 0.15)", badgeColor: "#8b5cf6" },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setPage(1);
                  }}
                  style={{
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 600,
                    border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
                    cursor: "pointer",
                    background: isActive ? "var(--color-surface)" : "transparent",
                    color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                    boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 140ms ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: isActive ? tab.color : "var(--color-text-muted)", display: "flex" }}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 800,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isActive ? tab.badgeBg : "var(--color-border)",
                      color: isActive ? tab.badgeColor : "var(--color-text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right: Search Bar & Species Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", flexShrink: 0 }}>
            {/* Search Box */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, width: 240, minWidth: 140, maxWidth: 300, position: "relative" }}>
              <input
                type="text"
                placeholder="Search permit, owner, tag..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  paddingLeft: 34,
                  paddingRight: search ? 30 : 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12.5,
                  outline: "none",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  transition: "all 0.15s ease",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--color-primary, #10b981)";
                  e.target.style.background = "var(--color-surface)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--color-border)";
                  e.target.style.background = "var(--color-bg)";
                }}
              />
              <Icon.Search
                size={14}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                  }}
                  title="Clear search"
                >
                  <Icon.X size={13} />
                </button>
              )}
            </div>

            {/* Species Dropdown Selector */}
            <select
              value={filterSpecies}
              onChange={(e) => setFilterSpecies(e.target.value)}
              style={{
                height: 34,
                width: "auto",
                minWidth: 110,
                fontSize: 12.5,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                padding: "0 28px 0 10px",
                cursor: "pointer",
                outline: "none",
                appearance: "none",
                backgroundImage:
                  "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
                backgroundSize: "13px",
              }}
              title="Filter by species"
            >
              <option value="all">All Species</option>
              <option value="Hog">Hog</option>
              <option value="Cattle">Cattle</option>
              <option value="Carabao">Carabao</option>
              <option value="Goat">Goat</option>
            </select>
          </div>
        </div>

        {/* Content: View-Only Table */}
        {isLoading ? (
          <div style={{ flex: 1, minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 20px", color: "var(--color-text-muted)", fontSize: 13.5 }}>
            Loading permit records...
          </div>
        ) : filteredGroups.length === 0 ? (
          <div style={{ flex: 1, minHeight: 340, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
            <EmptyState
              title="No permit records found"
              message={
                search || filterSpecies !== "all"
                  ? "No records match your search or filter criteria."
                  : activeTab === "pending"
                  ? "No pending permits awaiting clearance."
                  : "No meat inspection permit records found."
              }
              icon={<Icon.FileText size={38} />}
            />
          </div>
        ) : (
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
            <table
              className="table"
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
              }}
            >
              <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "left",
                    }}
                  >
                    Owner
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Livestock Count
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Date and Time
                  </th>
                  {activeTab !== "pending" && (
                    <th
                      style={{
                        padding: "12px 16px",
                        fontSize: 11.5,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--color-text-muted)",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Permit #
                    </th>
                  )}
                  <th
                    style={{
                      padding: "12px 16px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    STATUS
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedGroups.map((grp) => {
                  const isIssued = grp.status === "Issued";

                  return (
                    <tr
                      key={grp.key}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        transition: "background 140ms ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* 1. Owner */}
                      <td style={{ padding: "13px 16px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}>
                            {grp.owner_avatar ? (
                              <img
                                src={grp.owner_avatar}
                                alt={grp.owner_name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  if (e.currentTarget.nextSibling) {
                                    e.currentTarget.nextSibling.style.display = "flex";
                                  }
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  objectFit: "cover",
                                  flexShrink: 0,
                                  border: "1px solid var(--color-border)",
                                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.08)",
                                }}
                              />
                            ) : null}
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                                color: "#ffffff",
                                fontSize: 11,
                                fontWeight: 800,
                                display: grp.owner_avatar ? "none" : "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13, lineHeight: 1.3 }}>
                              {grp.owner_name}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                              {grp.owner_contact}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Livestock Count */}
                      <td style={{ padding: "13px 16px", verticalAlign: "middle", textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--color-text)",
                          }}
                        >
                          {grp.total_heads} {grp.total_heads === 1 ? "Head" : "Heads"}
                        </span>
                      </td>

                      {/* 3. Date and Time */}
                      <td style={{ padding: "13px 16px", verticalAlign: "middle" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--color-text)", fontSize: 13 }}>
                          <Icon.Calendar size={13} style={{ color: "#0284c7", flexShrink: 0, opacity: 0.8 }} />
                          <span>{grp.rawDate ? formatPhDateTime(grp.rawDate) : "—"}</span>
                        </div>
                      </td>

                      {/* 4. Permit # */}
                      {activeTab !== "pending" && (
                        <td style={{ padding: "13px 16px", verticalAlign: "middle" }}>
                          {isIssued ? (
                            <span
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 13,
                                fontWeight: 700,
                                color: "#0284c7",
                              }}
                            >
                              {grp.base_permit_no}
                            </span>
                          ) : (
                            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>—</span>
                          )}
                        </td>
                      )}

                      {/* 5. Issued */}
                      <td style={{ padding: "13px 16px", verticalAlign: "middle", textAlign: "center" }}>
                        {isIssued ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 9px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: "rgba(16, 185, 129, 0.12)",
                              color: "#059669",
                              border: "1px solid rgba(16, 185, 129, 0.3)",
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#10b981",
                                flexShrink: 0,
                              }}
                            />
                            <span>Issued</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 9px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: "rgba(245, 158, 11, 0.12)",
                              color: "#d97706",
                              border: "1px solid rgba(245, 158, 11, 0.3)",
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#f59e0b",
                                flexShrink: 0,
                              }}
                            />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer / Pagination */}
        {filteredGroups.length > pageSize && (
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "var(--color-surface)",
              fontSize: 12.5,
              color: "var(--color-text-muted)",
            }}
          >
            <span>
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredGroups.length)} of {filteredGroups.length} batches
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: page === 1 ? "var(--color-text-muted)" : "var(--color-text)",
                  cursor: page === 1 ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: page === totalPages ? "var(--color-text-muted)" : "var(--color-text)",
                  cursor: page === totalPages ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

