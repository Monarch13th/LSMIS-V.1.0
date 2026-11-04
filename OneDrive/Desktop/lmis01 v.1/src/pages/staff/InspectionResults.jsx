import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Badge, Modal, EmptyState, TagBadge, Pagination } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import { formatPhDateTime, formatDate, formatSex } from "../../utils/formatters";
import { initials, today } from "../../utils/helpers";
import {
  isAnteCondemnedDecision,
  isPostWholeDecision,
  isPostPartialInspection,
  isAnteCondemnedStatus,
  getCondemnationStage,
} from "../vet/condemnationStage";

/**
 * Inspection Results module under Staff Personnel.
 * 
 * 4 Mutually Exclusive Inspection Result Categories:
 * 1. Ante-Mortem:
 *    - Completed ante-mortem inspection records.
 *    - Includes livestock that passed ante-mortem inspection.
 *    - Strictly excludes condemned and partially condemned livestock.
 * 2. Post-Mortem:
 *    - Completed post-mortem inspection records.
 *    - Includes livestock that passed post-mortem inspection.
 *    - Strictly excludes condemned and partially condemned livestock.
 * 3. Partially Condemned:
 *    - All livestock with partially condemned inspection results.
 *    - Shows condemned carcass parts, inspection details, and evidence photos.
 * 4. Condemned:
 *    - All livestock with fully condemned inspection results (whole live animal or entire carcass).
 *    - Shows condemnation reasons, inspection details, and evidence photos.
 * 
 * Consistent UI/UX with Animal Marking records interface.
 */

const TABS = [
  {
    id: "antemortem",
    label: "Ante-Mortem",
    icon: <Icon.Stethoscope size={15} />,
    color: "#10b981",
    badgeBg: "rgba(16, 185, 129, 0.12)",
    badgeColor: "#059669",
    description: "Livestock that passed ante-mortem inspection",
  },
  {
    id: "postmortem",
    label: "Post-Mortem",
    icon: <Icon.Activity size={15} />,
    color: "#0ea5e9",
    badgeBg: "rgba(14, 165, 233, 0.12)",
    badgeColor: "#0284c7",
    description: "Carcasses that passed post-mortem inspection",
  },
  {
    id: "partially_condemned",
    label: "Partially Condemned",
    icon: <Icon.Scissors size={15} />,
    color: "#f59e0b",
    badgeBg: "rgba(245, 158, 11, 0.12)",
    badgeColor: "#b45309",
    description: "Carcasses with partial condemnation of parts or organs",
  },
  {
    id: "condemned",
    label: "Condemned",
    icon: <Icon.AlertTriangle size={15} />,
    color: "#ef4444",
    badgeBg: "rgba(239, 68, 68, 0.12)",
    badgeColor: "#dc2626",
    description: "Whole live animals or carcasses fully condemned",
  },
];

export const InspectionResults = ({ initialTab = "antemortem" }) => {
  // Query Supabase tables directly with real-time updates and zero mock data
  const { data: anteInspections = [], loading: loadingAnte, refresh: refreshAnte } = useSupabase(TABLES.ANTE_MORTEM, [], { mockStore: false });
  const { data: postInspections = [], loading: loadingPost, refresh: refreshPost } = useSupabase(TABLES.POST_MORTEM, [], { mockStore: false });
  const { data: condemnationRecords = [], loading: loadingCond, refresh: refreshCond } = useSupabase(TABLES.CONDEMNATION_RECORDS, [], { mockStore: false });
  const { data: condemnedCuts = [], loading: loadingCuts, refresh: refreshCuts } = useSupabase(TABLES.POST_MORTEM_CONDEMNED_CUTS, [], { mockStore: false });
  const { data: evidenceRecords = [], loading: loadingEv, refresh: refreshEv } = useSupabase(TABLES.EVIDENCE_RECORDS, [], { mockStore: false });
  const { data: livestock = [], loading: loadingLive, refresh: refreshLive } = useSupabase(TABLES.LIVESTOCK, [], { mockStore: false });
  const { data: owners = [], loading: loadingOwners, refresh: refreshOwners } = useSupabase(TABLES.OWNERS, [], { mockStore: false });

  const loading = (loadingAnte || loadingPost || loadingCond || loadingCuts || loadingEv || loadingLive || loadingOwners) &&
    anteInspections.length === 0 && postInspections.length === 0;

  const refreshAll = () => {
    refreshAnte?.();
    refreshPost?.();
    refreshCond?.();
    refreshCuts?.();
    refreshEv?.();
    refreshLive?.();
    refreshOwners?.();
  };

  // URL search params sync
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizeTabId = (t) => {
    const raw = String(t || "").toLowerCase().trim();
    if (raw === "postmortem" || raw === "post-mortem" || raw === "result" || raw === "post") return "postmortem";
    if (raw === "partial" || raw === "partially_condemned" || raw === "partially-condemned" || raw === "parts") return "partially_condemned";
    if (raw === "condemned" || raw === "condemnation" || raw === "whole") return "condemned";
    return "antemortem";
  };

  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    return normalizeTabId(urlTab || initialTab);
  });

  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal states
  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);
  const [modalFilterSpecies, setModalFilterSpecies] = useState("all");
  const [viewingDetails, setViewingDetails] = useState(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isEnlarged, setIsEnlarged] = useState(false);

  useEffect(() => {
    setActivePhotoIndex(0);
    setZoomLevel(1);
    setIsEnlarged(false);
  }, [viewingDetails]);

  useEffect(() => {
    if (!viewingDetails) return;
    const tagPhotos = viewingDetails.photos || [];
    const handleKeyDown = (e) => {
      if (tagPhotos.length > 1) {
        if (e.key === "ArrowLeft") {
          setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : tagPhotos.length - 1));
        } else if (e.key === "ArrowRight") {
          setActivePhotoIndex((prev) => (prev < tagPhotos.length - 1 ? prev + 1 : 0));
        }
      }
      if (e.key === "Escape" && isEnlarged) {
        setIsEnlarged(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewingDetails, isEnlarged]);

  // Sync tab from props/searchParams
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) {
      setActiveTab(normalizeTabId(urlTab));
    } else if (initialTab) {
      setActiveTab(normalizeTabId(initialTab));
    }
  }, [initialTab, searchParams]);

  useEffect(() => {
    setPage(1);
    setSelectedOwnerKey(null);
    setModalFilterSpecies("all");
  }, [activeTab, search, filterSpecies, sortBy]);

  // Helper: Extract all evidence photos for an animal / inspection
  const extractPhotos = (item) => {
    const urls = [];
    const cleanTag = String(item?.tag_number || "").trim().toLowerCase();

    const addUrl = (url) => {
      if (!url || typeof url !== "string") return;
      const trimmed = url.trim();
      if (trimmed && !urls.includes(trimmed)) urls.push(trimmed);
    };

    addUrl(item?.photo_url);
    addUrl(item?.file_url);
    addUrl(item?.file_preview);

    if (Array.isArray(item?.photos)) {
      item.photos.forEach((p) => {
        if (typeof p === "string") addUrl(p);
        else if (p?.url) addUrl(p.url);
        else if (p?.data) addUrl(p.data);
      });
    }

    if (Array.isArray(item?.file_urls)) {
      item.file_urls.forEach((u) => typeof u === "string" && addUrl(u));
    }

    if (Array.isArray(item?.condemned_parts)) {
      item.condemned_parts.forEach((p) => {
        addUrl(p?.photo_url);
        addUrl(p?.file_url);
      });
    }

    if (cleanTag) {
      // From post_mortem_condemned_cuts
      (condemnedCuts || []).forEach((c) => {
        if (String(c.tag_number || "").trim().toLowerCase() === cleanTag) {
          addUrl(c.photo_url);
          addUrl(c.file_url);
        }
      });

      // From condemnation_records
      (condemnationRecords || []).forEach((c) => {
        if (String(c.tag_number || "").trim().toLowerCase() === cleanTag) {
          addUrl(c.photo_url);
          addUrl(c.file_url);
        }
      });

      // From evidence_records
      (evidenceRecords || []).forEach((ev) => {
        if (String(ev.tag_number || "").trim().toLowerCase() === cleanTag) {
          addUrl(ev.file_url);
          addUrl(ev.file_preview);
          if (Array.isArray(ev.photos)) {
            ev.photos.forEach((p) => {
              if (typeof p === "string") addUrl(p);
              else if (p?.url) addUrl(p.url);
              else if (p?.data) addUrl(p.data);
            });
          }
          if (Array.isArray(ev.file_urls)) {
            ev.file_urls.forEach((u) => typeof u === "string" && addUrl(u));
          }
        }
      });
    }

    return urls;
  };

  // Helper: Resolve owner information
  const resolveOwner = (item, animal) => {
    const directId = item?.owner_id || animal?.owner_id;
    if (directId) {
      const cleanOId = String(directId).trim().toLowerCase();
      const found = (owners || []).find((o) => {
        const oId = String(o.id || "").trim().toLowerCase();
        const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
        const oAuthId = String(o.auth_user_id || "").trim().toLowerCase();
        return oId === cleanOId || oOwnerId === cleanOId || oAuthId === cleanOId;
      });
      if (found) {
        return {
          id: found.id || directId,
          name: found.name || animal?.owner_name || item?.owner_name || "—",
          avatar: found.avatar_url || null,
          contact: found.contact || found.phone || found.email || "—",
          address: found.address || "—",
        };
      }
    }
    const name = animal?.owner_name || item?.owner_name || "—";
    if (name && name !== "—" && name !== "Unknown") {
      const found = (owners || []).find((o) => String(o.name || "").trim().toLowerCase() === name.trim().toLowerCase());
      if (found) {
        return {
          id: found.id,
          name: found.name,
          avatar: found.avatar_url || null,
          contact: found.contact || found.phone || found.email || "—",
          address: found.address || "—",
        };
      }
    }
    return {
      id: directId || null,
      name: name,
      avatar: null,
      contact: "—",
      address: "—",
    };
  };

  // ---------------------------------------------------------------------------
  // Build Mutually Exclusive Sets of Condemned & Partially Condemned Animals
  // ---------------------------------------------------------------------------
  const { allWholeCondemnedTags, allPartialCondemnedTags } = useMemo(() => {
    const wholeSet = new Set();
    const partialSet = new Set();

    // 1. Ante-Mortem inspections marked Condemned or Rejected
    (anteInspections || []).forEach((i) => {
      const d = String(i.decision || "").trim().toLowerCase();
      if (isAnteCondemnedDecision(d) || d.includes("reject") || d.includes("condemn")) {
        if (i.tag_number) wholeSet.add(String(i.tag_number).trim().toLowerCase());
      }
    });

    // 2. Post-Mortem inspections marked Whole Carcass Condemned
    (postInspections || []).forEach((p) => {
      const d = String(p.decision || "").trim().toLowerCase();
      if (isPostWholeDecision(d)) {
        if (p.tag_number) wholeSet.add(String(p.tag_number).trim().toLowerCase());
      } else if (isPostPartialInspection(p) || (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0)) {
        if (p.tag_number) partialSet.add(String(p.tag_number).trim().toLowerCase());
      }
    });

    // 3. Post-Mortem Condemned Cuts table
    (condemnedCuts || []).forEach((c) => {
      const part = String(c.part || "").trim().toLowerCase();
      const tag = String(c.tag_number || "").trim().toLowerCase();
      if (!tag) return;
      if (part.includes("whole") || part.includes("entire")) {
        wholeSet.add(tag);
      } else {
        partialSet.add(tag);
      }
    });

    // 4. Condemnation Records table
    (condemnationRecords || []).forEach((c) => {
      const tag = String(c.tag_number || "").trim().toLowerCase();
      if (!tag) return;
      const stage = getCondemnationStage(c);
      const part = String(c.part || "").trim().toLowerCase();

      if (stage === "Ante-Mortem" || part === "live animal" || part.includes("whole") || part.includes("entire")) {
        wholeSet.add(tag);
      } else {
        partialSet.add(tag);
      }
    });

    // 5. Livestock table status check
    (livestock || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim().toLowerCase();
      if (!tag) return;
      if (isAnteCondemnedStatus(l.status)) {
        wholeSet.add(tag);
      }
    });

    // Whole condemnation takes strict precedence over partial condemnation
    wholeSet.forEach((t) => partialSet.delete(t));

    return { allWholeCondemnedTags: wholeSet, allPartialCondemnedTags: partialSet };
  }, [anteInspections, postInspections, condemnedCuts, condemnationRecords, livestock]);

  // ---------------------------------------------------------------------------
  // Category 1: Ante-Mortem Passed Records
  // - Completed ante-mortem inspection records.
  // - Passed ante-mortem inspection.
  // - Strictly excludes condemned and partially condemned livestock.
  // ---------------------------------------------------------------------------
  const anteMortemPassedRecords = useMemo(() => {
    return (anteInspections || [])
      .filter((i) => {
        const tag = String(i.tag_number || "").trim().toLowerCase();
        if (!tag) return false;

        // Exclude any tag that was condemned or partially condemned
        if (allWholeCondemnedTags.has(tag) || allPartialCondemnedTags.has(tag)) return false;

        // Decision must be passed / approved
        const d = String(i.decision || "").trim().toLowerCase();
        if (isAnteCondemnedDecision(d) || d.includes("reject") || d.includes("condemn")) return false;

        // Check animal status if present
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === tag);
        if (animal && isAnteCondemnedStatus(animal.status)) return false;

        return true;
      })
      .map((i) => {
        const tag = String(i.tag_number || "").trim();
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === tag.toLowerCase());
        const owner = resolveOwner(i, animal);
        const photos = extractPhotos({ ...i, tag_number: tag });

        return {
          id: i.id || `ante-${tag}`,
          tag_number: tag,
          species: i.species || animal?.species || "Livestock",
          breed: animal?.breed || "—",
          sex: animal?.sex || "—",
          age: animal?.age || "—",
          owner,
          date: i.inspected_at || i.date || animal?.created_at || today(),
          findings: i.findings || "Normal clinical appearance, fit for slaughter",
          remarks: i.remarks || "—",
          decision: i.decision || "Passed",
          inspector: i.inspector_name || "Dr. Dave",
          category: "antemortem",
          statusBadge: "Passed Ante-Mortem",
          photos,
          condemnedParts: [],
          raw: i,
        };
      });
  }, [anteInspections, livestock, allWholeCondemnedTags, allPartialCondemnedTags, owners, condemnedCuts, condemnationRecords, evidenceRecords]);

  // ---------------------------------------------------------------------------
  // Category 2: Post-Mortem Passed Records
  // - Completed post-mortem inspection records.
  // - Passed post-mortem inspection.
  // - Strictly excludes condemned and partially condemned livestock.
  // ---------------------------------------------------------------------------
  const postMortemPassedRecords = useMemo(() => {
    return (postInspections || [])
      .filter((p) => {
        const tag = String(p.tag_number || "").trim().toLowerCase();
        if (!tag) return false;

        // Exclude any tag that was condemned or partially condemned
        if (allWholeCondemnedTags.has(tag) || allPartialCondemnedTags.has(tag)) return false;

        // Decision must be passed cleanly without partial cuts or whole condemnation
        const d = String(p.decision || "").trim().toLowerCase();
        if (isPostWholeDecision(d) || isPostPartialInspection(p)) return false;
        if (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0) return false;

        return true;
      })
      .map((p) => {
        const tag = String(p.tag_number || "").trim();
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === tag.toLowerCase());
        const owner = resolveOwner(p, animal);
        const photos = extractPhotos({ ...p, tag_number: tag });

        return {
          id: p.id || `post-${tag}`,
          tag_number: tag,
          species: p.species || animal?.species || "Carcass",
          breed: animal?.breed || "—",
          sex: animal?.sex || "—",
          age: animal?.age || "—",
          owner,
          date: p.inspected_at || p.date || today(),
          findings: p.findings || "Carcass and viscera free of pathology, approved for food",
          remarks: p.remarks || "—",
          decision: p.decision || "Passed",
          inspector: p.inspector_name || "Dr. Dave",
          category: "postmortem",
          statusBadge: "Passed Post-Mortem",
          photos,
          condemnedParts: [],
          raw: p,
        };
      });
  }, [postInspections, livestock, allWholeCondemnedTags, allPartialCondemnedTags, owners, condemnedCuts, condemnationRecords, evidenceRecords]);

  // ---------------------------------------------------------------------------
  // Category 3: Partially Condemned Records
  // - All livestock with partially condemned inspection results.
  // - Shows condemned carcass parts, inspection details, and evidence photos.
  // ---------------------------------------------------------------------------
  const partiallyCondemnedRecords = useMemo(() => {
    const map = new Map();

    // A. Post-mortem inspections with partial condemnation
    (postInspections || []).forEach((p) => {
      const tag = String(p.tag_number || "").trim();
      const normTag = tag.toLowerCase();
      if (!normTag || allWholeCondemnedTags.has(normTag)) return;

      const isPartial = isPostPartialInspection(p) ||
        (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0);

      if (isPartial) {
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
        const owner = resolveOwner(p, animal);

        const partsList = [];
        if (Array.isArray(p.condemned_parts)) {
          p.condemned_parts.forEach((cp) => {
            if (cp && cp.part && !String(cp.part).toLowerCase().includes("whole")) {
              partsList.push({
                part: cp.part,
                weight_kg: Number(cp.weight_kg || cp.weight || 0),
                reason: cp.reason || cp.cause || p.findings || "Pathological condition",
                disposition: cp.disposition || "Condemned / Rendered",
                photo_url: cp.photo_url || null,
              });
            }
          });
        }

        map.set(normTag, {
          id: p.id || `partial-${normTag}`,
          tag_number: tag,
          species: p.species || animal?.species || "Carcass",
          breed: animal?.breed || "—",
          sex: animal?.sex || "—",
          age: animal?.age || "—",
          owner,
          date: p.inspected_at || p.date || today(),
          findings: p.findings || "Localized pathology identified on specific carcass parts",
          remarks: p.remarks || "—",
          decision: "Partially Condemned",
          inspector: p.inspector_name || "Dr. Dave",
          category: "partially_condemned",
          statusBadge: "Partially Condemned",
          condemnedParts: partsList,
          photos: [],
          raw: p,
        });
      }
    });

    // B. Post-Mortem Condemned Cuts table
    (condemnedCuts || []).forEach((c) => {
      const tag = String(c.tag_number || "").trim();
      const normTag = tag.toLowerCase();
      if (!normTag || allWholeCondemnedTags.has(normTag)) return;
      const partName = String(c.part || "").trim();
      if (partName.toLowerCase().includes("whole")) return;

      let existing = map.get(normTag);
      if (!existing) {
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
        const owner = resolveOwner(c, animal);
        existing = {
          id: c.id || `cut-${normTag}`,
          tag_number: tag,
          species: c.species || animal?.species || "Carcass",
          breed: animal?.breed || "—",
          sex: animal?.sex || "—",
          age: animal?.age || "—",
          owner,
          date: c.date || c.created_at || today(),
          findings: c.findings || c.reason || "Part condemned during post-mortem",
          remarks: c.notes || "—",
          decision: "Partially Condemned",
          inspector: c.inspector || "Dr. Dave",
          category: "partially_condemned",
          statusBadge: "Partially Condemned",
          condemnedParts: [],
          photos: [],
          raw: c,
        };
        map.set(normTag, existing);
      }

      const alreadyAdded = existing.condemnedParts.some(
        (p) => p.part.toLowerCase() === partName.toLowerCase() && p.reason === (c.reason || "")
      );
      if (!alreadyAdded) {
        existing.condemnedParts.push({
          part: partName || "Carcass Part",
          weight_kg: Number(c.weight_kg || 0),
          reason: c.reason || c.findings || "Unfit cut",
          disposition: c.disposition || "Condemned / Rendered",
          photo_url: c.photo_url || null,
        });
      }
    });

    // C. Condemnation records with post-mortem cuts
    (condemnationRecords || []).forEach((c) => {
      const tag = String(c.tag_number || "").trim();
      const normTag = tag.toLowerCase();
      if (!normTag || allWholeCondemnedTags.has(normTag)) return;
      if (getCondemnationStage(c) !== "Post-Mortem") return;
      const partName = String(c.part || "").trim();
      if (partName.toLowerCase().includes("whole") || partName.toLowerCase().includes("entire")) return;

      let existing = map.get(normTag);
      if (!existing) {
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
        const owner = resolveOwner(c, animal);
        existing = {
          id: c.id || `cond-${normTag}`,
          tag_number: tag,
          species: c.species || animal?.species || "Carcass",
          breed: animal?.breed || "—",
          sex: animal?.sex || "—",
          age: animal?.age || "—",
          owner,
          date: c.date || today(),
          findings: c.findings || c.reason || "Localized condemnation recorded",
          remarks: c.notes || "—",
          decision: "Partially Condemned",
          inspector: c.inspector || "Dr. Dave",
          category: "partially_condemned",
          statusBadge: "Partially Condemned",
          condemnedParts: [],
          photos: [],
          raw: c,
        };
        map.set(normTag, existing);
      }

      const alreadyAdded = existing.condemnedParts.some((p) => p.part.toLowerCase() === partName.toLowerCase());
      if (!alreadyAdded) {
        existing.condemnedParts.push({
          part: partName || "Carcass Part",
          weight_kg: Number(c.weight_kg || 0),
          reason: c.reason || c.notes || "Condemned cut",
          disposition: c.disposition || "Condemned / Rendered",
          photo_url: c.photo_url || c.file_url || null,
        });
      }
    });

    // Attach all photos to each partially condemned animal
    const result = Array.from(map.values()).map((item) => {
      const photos = extractPhotos(item);
      const partsTotalKg = item.condemnedParts.reduce((sum, p) => sum + (Number(p.weight_kg) || 0), 0);
      return {
        ...item,
        photos,
        partsTotalKg,
      };
    });

    return result;
  }, [postInspections, condemnedCuts, condemnationRecords, livestock, allWholeCondemnedTags, owners, evidenceRecords]);

  // ---------------------------------------------------------------------------
  // Category 4: Fully Condemned Records
  // - All livestock with fully condemned inspection results (whole animal / carcass).
  // - Shows condemnation reasons, inspection details, and evidence photos.
  // ---------------------------------------------------------------------------
  const fullyCondemnedRecords = useMemo(() => {
    const map = new Map();

    // A. Ante-Mortem fully condemned
    (anteInspections || []).forEach((i) => {
      const d = String(i.decision || "").trim().toLowerCase();
      const isCond = isAnteCondemnedDecision(d) || d.includes("reject") || d.includes("condemn");
      if (!isCond || !i.tag_number) return;
      const tag = String(i.tag_number).trim();
      const normTag = tag.toLowerCase();

      const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
      const owner = resolveOwner(i, animal);

      map.set(normTag, {
        id: i.id || `whole-ante-${normTag}`,
        tag_number: tag,
        species: i.species || animal?.species || "Livestock",
        breed: animal?.breed || "—",
        sex: animal?.sex || "—",
        age: animal?.age || "—",
        owner,
        date: i.inspected_at || i.date || animal?.created_at || today(),
        stage: "Ante-Mortem (Live Animal)",
        reason: i.remarks || i.findings || "Live animal unfit for slaughter",
        findings: i.findings || "Severe clinical abnormalities detected during intake inspection",
        disposition: "Condemned / Disposed",
        inspector: i.inspector_name || "Dr. Dave",
        category: "condemned",
        statusBadge: "Condemned",
        photos: [],
        raw: i,
      });
    });

    // B. Post-Mortem fully condemned (whole carcass)
    (postInspections || []).forEach((p) => {
      const d = String(p.decision || "").trim().toLowerCase();
      if (!isPostWholeDecision(d) || !p.tag_number) return;
      const tag = String(p.tag_number).trim();
      const normTag = tag.toLowerCase();

      const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
      const owner = resolveOwner(p, animal);

      map.set(normTag, {
        id: p.id || `whole-post-${normTag}`,
        tag_number: tag,
        species: p.species || animal?.species || "Carcass",
        breed: animal?.breed || "—",
        sex: animal?.sex || "—",
        age: animal?.age || "—",
        owner,
        date: p.inspected_at || p.date || today(),
        stage: "Post-Mortem (Whole Carcass)",
        reason: p.remarks || p.findings || "Whole carcass condemned for human consumption",
        findings: p.findings || "Systemic lesions / disease observed across entire carcass",
        disposition: "Condemned & Rendered",
        inspector: p.inspector_name || "Dr. Dave",
        category: "condemned",
        statusBadge: "Condemned",
        photos: [],
        raw: p,
      });
    });

    // C. Condemnation records table with whole condemnation
    (condemnationRecords || []).forEach((c) => {
      const tag = String(c.tag_number || "").trim();
      const normTag = tag.toLowerCase();
      if (!normTag) return;
      const stage = getCondemnationStage(c);
      const part = String(c.part || "").trim().toLowerCase();

      const isWhole = stage === "Ante-Mortem" || part === "live animal" || part.includes("whole") || part.includes("entire");
      if (!isWhole) return;

      const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === normTag);
      const owner = resolveOwner(c, animal);

      const existing = map.get(normTag);
      map.set(normTag, {
        id: c.id || existing?.id || `cond-${normTag}`,
        tag_number: tag,
        species: c.species || animal?.species || existing?.species || "Livestock",
        breed: animal?.breed || existing?.breed || "—",
        sex: animal?.sex || existing?.sex || "—",
        age: animal?.age || existing?.age || "—",
        owner: owner.name !== "—" ? owner : (existing?.owner || owner),
        date: c.date || existing?.date || today(),
        stage: stage === "Ante-Mortem" ? "Ante-Mortem (Live Animal)" : "Post-Mortem (Whole Carcass)",
        reason: c.reason || existing?.reason || "Total condemnation ordered by veterinary inspector",
        findings: c.findings || c.notes || existing?.findings || "Not recorded",
        disposition: c.disposition || existing?.disposition || "Condemned / Rendered",
        inspector: c.inspector || existing?.inspector || "Dr. Dave",
        category: "condemned",
        statusBadge: "Condemned",
        photos: [],
        raw: c,
      });
    });

    // D. Livestock marked condemned at intake/antemortem
    (livestock || []).forEach((l) => {
      const tag = String(l.tag_number || "").trim();
      const normTag = tag.toLowerCase();
      if (!normTag) return;
      if (!isAnteCondemnedStatus(l.status) || map.has(normTag)) return;

      const owner = resolveOwner(l, l);
      map.set(normTag, {
        id: l.id || `live-${normTag}`,
        tag_number: tag,
        species: l.species || "Livestock",
        breed: l.breed || "—",
        sex: l.sex || "—",
        age: l.age || "—",
        owner,
        date: l.received_date || l.created_at || today(),
        stage: "Ante-Mortem (Live Animal)",
        reason: l.remarks || l.rejection_reason || "Marked as Condemned at Intake",
        findings: l.remarks || "Unfit for slaughter during live animal evaluation",
        disposition: "Condemned / Disposed",
        inspector: "Dr. Dave",
        category: "condemned",
        statusBadge: "Condemned",
        photos: [],
        raw: l,
      });
    });

    return Array.from(map.values()).map((item) => {
      const photos = extractPhotos(item);
      return {
        ...item,
        photos,
      };
    });
  }, [anteInspections, postInspections, condemnationRecords, livestock, owners, condemnedCuts, evidenceRecords]);

  // Current category records mapped to the active tab
  const currentCategoryRecords = useMemo(() => {
    switch (activeTab) {
      case "postmortem":
        return postMortemPassedRecords;
      case "partially_condemned":
        return partiallyCondemnedRecords;
      case "condemned":
        return fullyCondemnedRecords;
      case "antemortem":
      default:
        return anteMortemPassedRecords;
    }
  }, [activeTab, anteMortemPassedRecords, postMortemPassedRecords, partiallyCondemnedRecords, fullyCondemnedRecords]);

  // Category counts
  const categoryCounts = useMemo(() => ({
    antemortem: anteMortemPassedRecords.length,
    postmortem: postMortemPassedRecords.length,
    partially_condemned: partiallyCondemnedRecords.length,
    condemned: fullyCondemnedRecords.length,
  }), [anteMortemPassedRecords, postMortemPassedRecords, partiallyCondemnedRecords, fullyCondemnedRecords]);

  // ---------------------------------------------------------------------------
  // Owner-Grouped Records (Consistent with Animal Marking Records Table)
  // ---------------------------------------------------------------------------
  const groupedOwnerRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groupsMap = new Map();

    currentCategoryRecords.forEach((item) => {
      // Species filter
      if (filterSpecies !== "all") {
        const sp = String(item.species || "").toLowerCase();
        if (sp !== filterSpecies.toLowerCase()) return;
      }

      // Search filter on record fields
      if (q) {
        const tag = String(item.tag_number || "").toLowerCase();
        const ownerName = String(item.owner?.name || "").toLowerCase();
        const species = String(item.species || "").toLowerCase();
        const inspector = String(item.inspector || "").toLowerCase();
        const findings = String(item.findings || "").toLowerCase();
        const reason = String(item.reason || "").toLowerCase();
        const parts = Array.isArray(item.condemnedParts)
          ? item.condemnedParts.map((p) => `${p.part} ${p.reason}`).join(" ").toLowerCase()
          : "";

        const match =
          tag.includes(q) ||
          ownerName.includes(q) ||
          species.includes(q) ||
          inspector.includes(q) ||
          findings.includes(q) ||
          reason.includes(q) ||
          parts.includes(q);

        if (!match) return;
      }

      const owner = item.owner || {};
      const key = String(owner.id || owner.name || "unknown").trim().toLowerCase();

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          owner_name: owner.name && owner.name !== "—" ? owner.name : "Unknown Owner",
          owner_avatar: owner.avatar,
          owner_contact: owner.contact,
          owner_address: owner.address,
          items: [],
          speciesSet: new Set(),
          latestDate: null,
        });
      }

      const group = groupsMap.get(key);
      group.items.push(item);
      if (item.species) group.speciesSet.add(item.species);

      const itemDate = item.date ? new Date(item.date).getTime() : 0;
      const currentLatest = group.latestDate ? new Date(group.latestDate).getTime() : 0;
      if (itemDate > currentLatest) {
        group.latestDate = item.date;
      }
    });

    const groups = Array.from(groupsMap.values()).map((g) => ({
      ...g,
      count: g.items.length,
      speciesList: Array.from(g.speciesSet),
      rawDate: g.latestDate,
    }));

    // Sorting
    groups.sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.rawDate || 0) - new Date(b.rawDate || 0);
      }
      if (sortBy === "owner") {
        return a.owner_name.localeCompare(b.owner_name);
      }
      if (sortBy === "tag_asc") {
        const tagA = a.items[0]?.tag_number || "";
        const tagB = b.items[0]?.tag_number || "";
        return tagA.localeCompare(tagB);
      }
      if (sortBy === "tag_desc") {
        const tagA = a.items[0]?.tag_number || "";
        const tagB = b.items[0]?.tag_number || "";
        return tagB.localeCompare(tagA);
      }
      // default: newest
      return new Date(b.rawDate || 0) - new Date(a.rawDate || 0);
    });

    return groups;
  }, [currentCategoryRecords, search, filterSpecies, sortBy]);

  // Paginated dataset
  const totalPages = Math.max(1, Math.ceil(groupedOwnerRecords.length / pageSize));
  const paginatedOwnerGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return groupedOwnerRecords.slice(start, start + pageSize);
  }, [groupedOwnerRecords, page, pageSize]);

  // Active viewing owner
  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return groupedOwnerRecords.find((g) => g.key === selectedOwnerKey) || null;
  }, [groupedOwnerRecords, selectedOwnerKey]);

  // Filtered items inside owner modal by species
  const ownerModalFilteredItems = useMemo(() => {
    if (!selectedOwnerView) return [];
    if (modalFilterSpecies === "all") return selectedOwnerView.items;
    return selectedOwnerView.items.filter(
      (item) => String(item.species || "").toLowerCase() === modalFilterSpecies.toLowerCase()
    );
  }, [selectedOwnerView, modalFilterSpecies]);

  // Active tab metadata
  const currentTabMeta = TABS.find((t) => t.id === activeTab) || TABS[0];

  return (
    <div
      className="inspection-results-page"
      style={{
        width: "100%",
        padding: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Main Record List Container (Standardized with Animal Marking) */}
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
        {/* Search & Filter Toolbar */}
        <div
          className="records-fixed-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            minHeight: 54,
            boxSizing: "border-box",
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {/* Left: 4 Inspection Result Category Tabs */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "var(--color-bg)",
              padding: 3,
              borderRadius: 9,
              border: "1px solid var(--color-border)",
              gap: 4,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = categoryCounts[tab.id] || 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSearchParams({ tab: tab.id });
                  }}
                  style={{
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: isActive ? "var(--color-surface)" : "transparent",
                    color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                    boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.1)" : "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 140ms ease",
                    whiteSpace: "nowrap",
                  }}
                  title={tab.description}
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
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right: Search Box & Species Filter */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", flexShrink: 0, justifyContent: "flex-end" }}>
            {/* Search Box */}
            <div
              style={{
                width: 220,
                position: "relative",
                display: "flex",
                alignItems: "center",
                background: "var(--color-bg)",
                border: `1px solid ${searchFocused ? "var(--color-primary, #10b981)" : "var(--color-border)"}`,
                borderRadius: 8,
                boxShadow: searchFocused ? "0 0 0 3px rgba(16, 185, 129, 0.14)" : "none",
                transition: "all 0.2s ease",
                height: 34,
                flexShrink: 0,
              }}
            >
              <Icon.Search
                size={15}
                style={{
                  position: "absolute",
                  left: 10,
                  color: searchFocused ? "var(--color-primary, #10b981)" : "var(--color-text-muted)",
                  pointerEvents: "none",
                  transition: "color 0.2s ease",
                  zIndex: 10,
                }}
              />
              <input
                type="text"
                placeholder={`Search ${currentTabMeta.label.toLowerCase()}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: "100%",
                  height: "100%",
                  paddingLeft: 32,
                  paddingRight: search ? 28 : 10,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--color-text)",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 7,
                    background: "var(--color-border)",
                    border: "none",
                    borderRadius: "50%",
                    width: 17,
                    height: 17,
                    color: "var(--color-text)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                  title="Clear search"
                >
                  <Icon.X size={11} />
                </button>
              )}
            </div>

            {/* Species Filter */}
            <select
              value={filterSpecies}
              onChange={(e) => setFilterSpecies(e.target.value)}
              style={{
                height: 34,
                padding: "0 10px",
                fontSize: 12.5,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                cursor: "pointer",
                outline: "none",
                minWidth: 115,
                flexShrink: 0,
              }}
            >
              <option value="all">All Species</option>
              <option value="Hog">Hog</option>
              <option value="Cattle">Cattle</option>
              <option value="Carabao">Carabao</option>
              <option value="Goat">Goat</option>
            </select>
          </div>
        </div>

        {/* Content Table Area */}
        {loading ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
            <Icon.Loader size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 10 }} />
            <div>Loading verified Supabase inspection records...</div>
          </div>
        ) : groupedOwnerRecords.length === 0 ? (
          <EmptyState
            title={
              search
                ? `No ${currentTabMeta.label.toLowerCase()} records match "${search}"`
                : `No ${currentTabMeta.label.toLowerCase()} records found`
            }
            message={
              search
                ? "Try adjusting your search criteria or species filter."
                : `Verified records will appear here as veterinary inspections are conducted.`
            }
            icon={currentTabMeta.icon}
          />
        ) : (
          /* ================= MAIN OWNER LIST TABLE (MATCHES ANIMAL MARKING PATTERN) ================= */
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
            <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Owner Name</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Inspection Date</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>Total Records</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Inspection Status</th>
                  <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOwnerGroups.map((grp) => {
                  return (
                    <tr
                      key={grp.key}
                      onClick={() => setSelectedOwnerKey(grp.key)}
                      style={{
                        transition: "background 140ms ease",
                        borderBottom: "1px solid var(--color-border)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Owner Details */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
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
                                  width: 34,
                                  height: 34,
                                  borderRadius: "50%",
                                  objectFit: "cover",
                                  flexShrink: 0,
                                  border: "1px solid var(--color-border)",
                                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                                }}
                              />
                            ) : null}
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: "50%",
                                background:
                                  activeTab === "antemortem"
                                    ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                                    : activeTab === "postmortem"
                                    ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                                    : activeTab === "partially_condemned"
                                    ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
                                    : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                                color: "#ffffff",
                                display: grp.owner_avatar ? "none" : "flex",
                                alignItems: "center",
                                justifyCenter: "center",
                                justifyContent: "center",
                                fontWeight: 700,
                                fontSize: 12,
                                flexShrink: 0,
                              }}
                            >
                              {initials(grp.owner_name)}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                              {grp.owner_name}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                              {grp.count} {grp.count === 1 ? "record" : "records"} &bull; {grp.owner_contact !== "—" ? grp.owner_contact : "Direct Intake"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Calendar size={13} style={{ opacity: 0.75, color: currentTabMeta.color }} />
                          <span>{grp.rawDate ? formatPhDateTime(grp.rawDate) : "—"}</span>
                        </div>
                      </td>

                      {/* Species */}
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          {grp.speciesList.join(", ") || "Livestock"}
                        </span>
                      </td>

                      {/* Total Records */}
                      <td style={{ padding: "14px 18px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 700,
                            color: currentTabMeta.color,
                          }}
                        >
                          {grp.count} head{grp.count > 1 ? "s" : ""}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12.5,
                            fontWeight: 700,
                            color: currentTabMeta.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {activeTab === "antemortem" ? (
                            <>
                              <Icon.CheckCircle size={14} /> Passed Ante-Mortem ({grp.count})
                            </>
                          ) : activeTab === "postmortem" ? (
                            <>
                              <Icon.CheckCircle size={14} /> Passed Post-Mortem ({grp.count})
                            </>
                          ) : activeTab === "partially_condemned" ? (
                            <>
                              <Icon.Scissors size={14} /> Partially Condemned ({grp.count})
                            </>
                          ) : (
                            <>
                              <Icon.AlertTriangle size={14} /> Fully Condemned ({grp.count})
                            </>
                          )}
                        </span>
                      </td>

                      {/* Action */}
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOwnerKey(grp.key);
                          }}
                          style={{
                            padding: "6px 14px",
                            fontSize: 12,
                            fontWeight: 700,
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Icon.Eye size={13} /> View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {!loading && groupedOwnerRecords.length > 0 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--color-border)" }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={groupedOwnerRecords.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* Standardized Dedicated Owner Records Modal (Consistent with Animal Marking) */}
      {/* ========================================================================= */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => {
          setSelectedOwnerKey(null);
          setModalFilterSpecies("all");
        }}
        title={`${currentTabMeta.label} Records — ${selectedOwnerView?.owner_name || ""}`}
        headerRight={
          selectedOwnerView && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Species filter in modal header */}
              <div style={{ position: "relative", minWidth: 140 }}>
                <select
                  value={modalFilterSpecies}
                  onChange={(e) => setModalFilterSpecies(e.target.value)}
                  style={{
                    height: 32,
                    padding: "0 24px 0 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    appearance: "none",
                    backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 6px center",
                    backgroundSize: "12px",
                  }}
                >
                  <option value="all">All Species ({selectedOwnerView.items.length})</option>
                  {["Hog", "Cattle", "Carabao", "Goat"].map((sp) => {
                    const count = selectedOwnerView.items.filter((i) => String(i.species || "").toLowerCase() === sp.toLowerCase()).length;
                    return (
                      <option key={sp} value={sp}>
                        {sp} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {ownerModalFilteredItems.length} {ownerModalFilteredItems.length === 1 ? "record" : "records"} for {selectedOwnerView?.owner_name}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedOwnerKey(null);
                setModalFilterSpecies("all");
              }}
              style={{ minWidth: 80, fontWeight: 700 }}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedOwnerView && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "55vh",
                border: "none",
                boxShadow: "none",
                scrollbarWidth: "thin",
              }}
            >
              <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, border: "none" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                  <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Tag Number</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species &amp; Sex</th>
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Inspection Date</th>
                    {activeTab === "partially_condemned" ? (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Condemned Parts</th>
                    ) : activeTab === "condemned" ? (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Condemnation Reason</th>
                    ) : (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Veterinary Findings</th>
                    )}
                    <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Result</th>
                    {(activeTab === "partially_condemned" || activeTab === "condemned") && (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Evidence Photos</th>
                    )}
                    {(activeTab === "partially_condemned" || activeTab === "condemned") && (
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ownerModalFilteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={(activeTab === "partially_condemned" || activeTab === "condemned") ? 7 : 5} style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
                        No records match species filter &quot;{modalFilterSpecies}&quot;.
                      </td>
                    </tr>
                  ) : (
                    ownerModalFilteredItems.map((item) => {
                      return (
                        <tr
                          key={item.id}
                          style={{
                            borderBottom: "1px solid var(--color-border)",
                            transition: "background 120ms ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          {/* Tag Number */}
                          <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                            <TagBadge tag={item.tag_number} species={item.species} />
                          </td>

                          {/* Species & Sex */}
                          <td style={{ padding: "12px 14px", verticalAlign: "middle", fontSize: 12.5, fontWeight: 600 }}>
                            <div>{item.species}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                              {formatSex(item.sex)} {item.age && item.age !== "—" ? `· ${item.age}` : ""}
                            </div>
                          </td>

                          {/* Inspection Date */}
                          <td style={{ padding: "12px 14px", verticalAlign: "middle", fontSize: 12, color: "var(--color-text)" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <Icon.Calendar size={12} style={{ opacity: 0.7, color: currentTabMeta.color }} />
                              <span>{item.date ? formatPhDateTime(item.date) : "—"}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                              by {item.inspector || "Dr. Dave"}
                            </div>
                          </td>

                          {/* Specific Category Column */}
                          {activeTab === "partially_condemned" ? (
                            <td style={{ padding: "12px 14px", verticalAlign: "middle", maxWidth: 280 }}>
                              {item.condemnedParts && item.condemnedParts.length > 0 ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {item.condemnedParts.map((p, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "3px 8px",
                                        borderRadius: 6,
                                        background: "rgba(245, 158, 11, 0.12)",
                                        border: "1px solid rgba(245, 158, 11, 0.3)",
                                        color: "#b45309",
                                        fontSize: 11,
                                        fontWeight: 700,
                                      }}
                                    >
                                      {p.part} {p.weight_kg > 0 ? `(${p.weight_kg} kg)` : ""}
                                      {p.reason ? ` · ${p.reason}` : ""}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                                  {item.findings || "Partially condemned"}
                                </span>
                              )}
                            </td>
                          ) : activeTab === "condemned" ? (
                            <td style={{ padding: "12px 14px", verticalAlign: "middle", maxWidth: 280 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    background: "rgba(239, 68, 68, 0.12)",
                                    color: "#dc2626",
                                    border: "1px solid rgba(239, 68, 68, 0.3)",
                                  }}
                                >
                                  {item.stage || "Condemned"}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                                {item.reason || item.findings}
                              </div>
                            </td>
                          ) : (
                            <td style={{ padding: "12px 14px", verticalAlign: "middle", maxWidth: 280, fontSize: 12, color: "var(--color-text)" }}>
                              <div style={{ lineHeight: 1.4 }}>{item.findings || "Normal clinical appearance"}</div>
                              {item.remarks && item.remarks !== "—" && (
                                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                                  Note: {item.remarks}
                                </div>
                              )}
                            </td>
                          )}

                          {/* Result */}
                          <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 12,
                                fontWeight: 700,
                                color: currentTabMeta.color,
                              }}
                            >
                              {activeTab === "antemortem" || activeTab === "postmortem" ? (
                                <>
                                  <Icon.CheckCircle size={13} /> {item.decision || "Passed"}
                                </>
                              ) : activeTab === "partially_condemned" ? (
                                <>
                                  <Icon.Scissors size={13} /> Partial
                                </>
                              ) : (
                                <>
                                  <Icon.AlertTriangle size={13} /> Condemned
                                </>
                              )}
                            </span>
                          </td>

                          {/* Evidence Photos (Partially Condemned & Condemned only) */}
                          {(activeTab === "partially_condemned" || activeTab === "condemned") && (
                            <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                              {item.photos && item.photos.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setViewingDetails(item)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    border: "1px solid var(--color-border)",
                                    background: "var(--color-bg)",
                                    color: "var(--color-primary, #10b981)",
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                  title="Click to view evidence photos"
                                >
                                  <Icon.Camera size={12} />
                                  <span>{item.photos.length} Photo{item.photos.length > 1 ? "s" : ""}</span>
                                </button>
                              ) : (
                                <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>None</span>
                              )}
                            </td>
                          )}

                          {/* Action - Details button (Partially Condemned & Condemned only) */}
                          {(activeTab === "partially_condemned" || activeTab === "condemned") && (
                            <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "right" }}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setViewingDetails(item)}
                                style={{
                                  padding: "5px 12px",
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <Icon.Eye size={12} /> Details
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* Condemnation Evidence Viewer Modal (Matching Vet Personnel View Details) */}
      {/* ========================================================================= */}
      {viewingDetails && (viewingDetails.category === "partially_condemned" || viewingDetails.category === "condemned") && (() => {
        const tagPhotos = viewingDetails.photos || [];
        const currentPhotoIndex = Math.min(activePhotoIndex, Math.max(0, tagPhotos.length - 1));
        const currentPhotoUrl = tagPhotos[currentPhotoIndex] || null;
        const isAnte = viewingDetails.category === "condemned" && viewingDetails.stage?.includes("Ante");
        const isWhole = viewingDetails.category === "condemned";
        const ownerDisplay = viewingDetails.owner?.name && viewingDetails.owner.name !== "—" ? viewingDetails.owner.name : "Not recorded";
        const condemnationTypeDisplay =
          viewingDetails.category === "condemned"
            ? (isAnte ? "Ante-Mortem · Whole Animal Condemnation" : "Post-Mortem · Whole Carcass Condemnation")
            : "Post-Mortem · Partial Condemnation";
        const findingsDisplay = viewingDetails.findings || viewingDetails.reason || "Not recorded";
        const currentPhotoPart = viewingDetails.condemnedParts?.[currentPhotoIndex]?.part || viewingDetails.condemnedParts?.[0]?.part || null;

        return (
          <Modal
            open={Boolean(viewingDetails)}
            onClose={() => setViewingDetails(null)}
            title="Condemnation Evidence Viewer"
            size="xl"
            closeOnBackdropClick
          >
            <div className="vet-evidence-viewer-root">
              <div className="vet-evidence-viewer-grid">
                {/* ── LEFT: PRIMARY PHOTO & FILE VIEWER ── */}
                <div className="vet-evidence-viewer-media-col">
                  {/* Viewer Top Bar */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                      padding: "8px 12px",
                      background: "#1e293b",
                      borderBottom: "1px solid #334155",
                      color: "#f8fafc",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#e2e8f0",
                          background: "#0f172a",
                          padding: "3px 9px",
                          borderRadius: 6,
                          border: "1px solid #334155",
                        }}
                      >
                        {tagPhotos.length > 0 ? `${currentPhotoIndex + 1} of ${tagPhotos.length}` : "0 of 0"}
                      </span>
                      {currentPhotoPart && (
                        <span style={{ color: "#94a3b8", fontSize: 11.5, fontWeight: 600 }}>
                          Part: <strong style={{ color: "#f1f5f9" }}>{currentPhotoPart}</strong>
                        </span>
                      )}
                      {tagPhotos.length > 1 && (
                        <span style={{ color: "#64748b", fontSize: 11 }} className="vet-ev-kbd-hint">
                          Use ← / → keys to navigate
                        </span>
                      )}
                    </div>

                    {/* Zoom & Action Controls */}
                    {tagPhotos.length > 0 && currentPhotoUrl && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setZoomLevel((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                          disabled={zoomLevel <= 1}
                          title="Zoom out"
                          style={{
                            height: 26,
                            padding: "0 8px",
                            borderRadius: 5,
                            border: "1px solid #475569",
                            background: zoomLevel <= 1 ? "#0f172a" : "#334155",
                            color: zoomLevel <= 1 ? "#475569" : "#f8fafc",
                            fontSize: 13,
                            fontWeight: 800,
                            cursor: zoomLevel <= 1 ? "not-allowed" : "pointer",
                          }}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoomLevel(1)}
                          title="Reset zoom to 100%"
                          style={{
                            height: 26,
                            padding: "0 8px",
                            borderRadius: 5,
                            border: "1px solid #475569",
                            background: "#0f172a",
                            color: "#e2e8f0",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            minWidth: 46,
                          }}
                        >
                          {Math.round(zoomLevel * 100)}%
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.5).toFixed(1)))}
                          disabled={zoomLevel >= 2.5}
                          title="Zoom in"
                          style={{
                            height: 26,
                            padding: "0 8px",
                            borderRadius: 5,
                            border: "1px solid #475569",
                            background: zoomLevel >= 2.5 ? "#0f172a" : "#334155",
                            color: zoomLevel >= 2.5 ? "#475569" : "#f8fafc",
                            fontSize: 13,
                            fontWeight: 800,
                            cursor: zoomLevel >= 2.5 ? "not-allowed" : "pointer",
                          }}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEnlarged(true)}
                          title="Enlarge image to full screen"
                          style={{
                            height: 26,
                            padding: "0 9px",
                            borderRadius: 5,
                            border: "1px solid #0284c7",
                            background: "#0284c7",
                            color: "#ffffff",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Icon.Eye size={12} /> Enlarge
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(currentPhotoUrl, "_blank", "noopener,noreferrer")}
                          title="Open original file in a new tab"
                          style={{
                            height: 26,
                            padding: "0 9px",
                            borderRadius: 5,
                            border: "1px solid #475569",
                            background: "#334155",
                            color: "#f8fafc",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Icon.ExternalLink size={12} /> Open
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Primary Media Stage */}
                  <div
                    style={{
                      position: "relative",
                      flex: 1,
                      minHeight: 360,
                      maxHeight: "min(62vh, 520px)",
                      background: "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: zoomLevel > 1 ? "auto" : "hidden",
                      padding: 12,
                    }}
                  >
                    {tagPhotos.length === 0 ? (
                      <div
                        style={{
                          padding: "36px 24px",
                          textAlign: "center",
                          color: "#cbd5e1",
                          maxWidth: 380,
                        }}
                      >
                        <div
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: "50%",
                            background: "rgba(148, 163, 184, 0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 12px",
                            color: "#94a3b8",
                          }}
                        >
                          <Icon.FileText size={26} />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
                          No evidence file exists for this record
                        </div>
                        <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                          No photo or document file is attached to this condemnation record.
                        </div>
                      </div>
                    ) : (
                      <img
                        src={currentPhotoUrl}
                        alt={`Evidence for ${viewingDetails.tag_number}`}
                        onClick={() => setIsEnlarged(true)}
                        title="Click to enlarge photo"
                        style={{
                          width: zoomLevel > 1 ? `${zoomLevel * 100}%` : "100%",
                          height: zoomLevel > 1 ? "auto" : "100%",
                          maxWidth: zoomLevel > 1 ? "none" : "100%",
                          maxHeight: zoomLevel > 1 ? "none" : "min(56vh, 480px)",
                          objectFit: "contain",
                          borderRadius: 6,
                          cursor: "zoom-in",
                          transition: "opacity 0.15s ease",
                        }}
                      />
                    )}

                    {/* Previous / Next Controls when multiple photos exist */}
                    {tagPhotos.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : tagPhotos.length - 1))}
                          aria-label="Previous photo"
                          title="Previous photo (Left arrow)"
                          style={{
                            position: "absolute",
                            left: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "rgba(15, 23, 42, 0.82)",
                            color: "#ffffff",
                            border: "1px solid rgba(255,255,255,0.25)",
                            borderRadius: "50%",
                            width: 38,
                            height: 38,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
                            zIndex: 4,
                          }}
                        >
                          <Icon.ChevronLeft size={20} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePhotoIndex((prev) => (prev < tagPhotos.length - 1 ? prev + 1 : 0))}
                          aria-label="Next photo"
                          title="Next photo (Right arrow)"
                          style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "rgba(15, 23, 42, 0.82)",
                            color: "#ffffff",
                            border: "1px solid rgba(255,255,255,0.25)",
                            borderRadius: "50%",
                            width: 38,
                            height: 38,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
                            zIndex: 4,
                          }}
                        >
                          <Icon.ChevronRight size={20} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Multi-Photo Thumbnail Strip */}
                  {tagPhotos.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "#1e293b",
                        borderTop: "1px solid #334155",
                        overflowX: "auto",
                      }}
                    >
                      {tagPhotos.map((photoUrl, idx) => {
                        const isSelected = idx === currentPhotoIndex;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActivePhotoIndex(idx)}
                            style={{
                              width: 58,
                              height: 42,
                              padding: 0,
                              borderRadius: 6,
                              overflow: "hidden",
                              border: isSelected ? "2px solid #38bdf8" : "1px solid #475569",
                              background: "#0f172a",
                              cursor: "pointer",
                              flexShrink: 0,
                              position: "relative",
                              opacity: isSelected ? 1 : 0.72,
                            }}
                          >
                            <img
                              src={photoUrl}
                              alt={`Thumbnail ${idx + 1}`}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── RIGHT: COMPACT LABELED DETAILS LIST ── */}
                <div className="vet-evidence-viewer-details-col">
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      fontSize: 11.5,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Condemnation Record Details
                  </div>

                  <dl className="vet-evidence-viewer-dl">
                    {/* 1. Owner */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Owner</dt>
                      <dd>{ownerDisplay}</dd>
                    </div>

                    {/* 2. Tag Number */}
                    <div className="vet-evidence-viewer-row">
                      <dt>{isAnte ? "Livestock Tag #" : "Carcass Tag #"}</dt>
                      <dd>
                        <TagBadge tag={viewingDetails.tag_number} species={viewingDetails.species} />
                      </dd>
                    </div>

                    {/* 3. Species */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Species</dt>
                      <dd>{viewingDetails.species || "Not recorded"}</dd>
                    </div>

                    {/* 4. Condemnation Type */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Condemnation Type</dt>
                      <dd
                        style={{
                          fontWeight: 700,
                          color: isWhole ? "var(--color-danger, #dc2626)" : "var(--color-warning, #d97706)",
                        }}
                      >
                        {condemnationTypeDisplay}
                      </dd>
                    </div>

                    {/* 5. Condemned Part / Affected Area */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Condemned Part / Affected Area</dt>
                      <dd>
                        {isWhole ? (
                          <div>
                            <span style={{ fontWeight: 700 }}>
                              {isAnte ? "Live Animal (Whole)" : "Whole Carcass"}
                            </span>
                            {viewingDetails.reason ? (
                              <span style={{ color: "var(--color-text-muted)" }}> · {viewingDetails.reason}</span>
                            ) : null}
                          </div>
                        ) : viewingDetails.condemnedParts && viewingDetails.condemnedParts.length > 0 ? (
                          viewingDetails.condemnedParts.length === 1 ? (
                            <div>
                              <span style={{ fontWeight: 700 }}>{viewingDetails.condemnedParts[0].part}</span>
                              {viewingDetails.condemnedParts[0].reason ? (
                                <span style={{ color: "var(--color-text-muted)" }}> · {viewingDetails.condemnedParts[0].reason}</span>
                              ) : null}
                              {viewingDetails.condemnedParts[0].weight_kg > 0 ? (
                                <span style={{ color: "#b45309", fontWeight: 600 }}> ({viewingDetails.condemnedParts[0].weight_kg} kg)</span>
                              ) : null}
                            </div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                              {viewingDetails.condemnedParts.map((rp, i) => (
                                <li key={i} style={{ fontSize: 12.5 }}>
                                  <span style={{ fontWeight: 700 }}>{rp.part}</span>
                                  {rp.reason ? <span style={{ color: "var(--color-text-muted)" }}> · {rp.reason}</span> : null}
                                  {rp.weight_kg > 0 ? <span style={{ color: "#b45309", fontWeight: 600 }}> ({rp.weight_kg} kg)</span> : null}
                                </li>
                              ))}
                            </ul>
                          )
                        ) : (
                          "Not recorded"
                        )}
                      </dd>
                    </div>

                    {/* 6. Findings */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Findings</dt>
                      <dd style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{findingsDisplay}</dd>
                    </div>

                    {/* 7. Condemnation Date & Time */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Condemnation Date & Time</dt>
                      <dd>{viewingDetails.date ? formatPhDateTime(viewingDetails.date) : "—"}</dd>
                    </div>

                    {/* 8. Condemned By */}
                    <div className="vet-evidence-viewer-row" style={{ borderBottom: "none" }}>
                      <dt>Condemned By</dt>
                      <dd style={{ fontWeight: 600 }}>{viewingDetails.inspector || "Dr. Dave"}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Modal Actions Footer */}
              <div
                className="form-actions"
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Button variant="outline" onClick={() => setViewingDetails(null)}>
                  Close
                </Button>
              </div>

              {/* Fullscreen Enlarge Lightbox when user clicks image or Enlarge */}
              {isEnlarged && currentPhotoUrl && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Enlarged evidence photo"
                  onClick={() => setIsEnlarged(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2, 6, 23, 0.92)",
                    zIndex: 1200,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 20,
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "relative",
                      maxWidth: "94vw",
                      maxHeight: "90vh",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <img
                      src={currentPhotoUrl}
                      alt={`Enlarged evidence for ${viewingDetails.tag_number}`}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "85vh",
                        objectFit: "contain",
                        borderRadius: 8,
                        boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setIsEnlarged(false)}
                      style={{
                        position: "absolute",
                        top: -14,
                        right: -14,
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "#ffffff",
                        color: "#0f172a",
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: 16,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Modal>
        );
      })()}



      {/* Embedded Evidence Viewer CSS Styles Matching Vet Personnel Reference */}
      <style>{`
        .vet-evidence-viewer-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(290px, 0.95fr);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 820px) {
          .vet-evidence-viewer-grid {
            grid-template-columns: 1fr;
          }
          .vet-ev-kbd-hint {
            display: none;
          }
        }
        .vet-evidence-viewer-media-col {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--color-border);
          border-radius: 10px;
          overflow: hidden;
          background: #0f172a;
        }
        .vet-evidence-viewer-details-col {
          border: 1px solid var(--color-border);
          border-radius: 10px;
          background: var(--color-surface);
          overflow: hidden;
        }
        .vet-evidence-viewer-dl {
          margin: 0;
          padding: 0;
        }
        .vet-evidence-viewer-row {
          display: grid;
          grid-template-columns: 135px minmax(0, 1fr);
          gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--color-border);
          font-size: 12.5px;
          align-items: baseline;
        }
        .vet-evidence-viewer-row dt {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: var(--color-text-muted);
        }
        .vet-evidence-viewer-row dd {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text);
          word-break: break-word;
        }
      `}</style>
    </div>
  );
};

// Route wrapper exports preserving existing application routes
export const AntemortemStatus = () => <InspectionResults initialTab="antemortem" />;
export const PostmortemStatus = () => <InspectionResults initialTab="postmortem" />;
export const PostmortemResult = () => <InspectionResults initialTab="postmortem" />;

export default InspectionResults;
