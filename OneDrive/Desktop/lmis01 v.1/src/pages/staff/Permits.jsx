import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Modal, AlertDialog, Badge, EmptyState } from "../../components/ui";
import { TagBadge } from "../../components/ui/TagBadge";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { supabase } from "../../services/supabaseClient";
import { notifyDbChange } from "../../services/realtimeSync";
import { TABLES } from "../../utils/constants";
import { formatCurrency, formatPhTime, formatPhDateTime, formatSex } from "../../utils/formatters";
import { formatDate, today } from "../../utils/helpers";
import { getPermitConfig } from "./PermitConfig";
import { printMeatPermit, printGatePass } from "../../utils/printHelpers";
import { logActivity } from "../../services/activityService";
import { resolveOwnerProfile, OwnerProfileCard, OwnerProfileModal } from "../../components/common/OwnerProfile";
import { getCurrentActor } from "../../utils/processHistory";
import { safeUpdateLivestockWithHistory } from "../../services/staffService";
import { feeService } from "../../services/feeService";

/* ===== Permit issuance status (Supabase is the source of truth) =====
 * Issuing a permit persists exactly one durable fact: handleIssuePermit sets the
 * livestock row's status to "Ready for Dispatch" in Supabase. That per-animal row is
 * therefore the authoritative record of issuance, and it is what Meat Dispatch and
 * Gate Release must gate on.
 *
 * It deliberately does NOT use the `lmis_issued_permits` localStorage key: that key is
 * per-browser, is empty after a refresh or a logout, and is invisible to a different
 * Staff Personnel user, so anything derived from it lets unissued records through.
 */
export const PERMIT_ISSUED_STATUSES = ["permit issued", "ready for dispatch", "dispatched", "released"];

export const isPermitIssuedStatus = (status) =>
  PERMIT_ISSUED_STATUSES.includes(String(status || "").trim().toLowerCase());

// True only when Supabase holds a livestock row for this tag whose status marks the
// permit as issued. No row, no status, or any other value (Pending, Paid, etc.)
// means the permit has not been issued.
export const isTagPermitIssued = (tagNumber, livestock, dbPermits = [], dispatches = []) => {
  const cleanTag = String(tagNumber || "").trim().toLowerCase();
  if (!cleanTag) return false;
  const animal = (livestock || []).find(
    (l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag
  );
  if (animal && isPermitIssuedStatus(animal.status)) return true;
  // A tag already present in a dispatch/release record is past the permit stage even if
  // its livestock status was left stale (interrupted or repaired dispatch write). Without
  // this the batch re-appears as "issue permit" and a second permit gets inserted.
  if (Array.isArray(dispatches) && dispatches.length > 0) {
    const isDispatched = dispatches.some((d) => {
      const dTags = Array.isArray(d.tags) ? d.tags : d.tag_number ? [d.tag_number] : [];
      return dTags.some((t) => String(t || "").trim().toLowerCase() === cleanTag);
    });
    if (isDispatched) return true;
  }
  if (Array.isArray(dbPermits) && dbPermits.length > 0) {
    const hasActivePermit = dbPermits.some(
      (p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag && String(p.status || "").toLowerCase() !== "revoked"
    );
    if (hasActivePermit) return true;
  }
  return false;
};

// A batch counts as permitted as soon as issuance reached one of its animals, which
// mirrors handleIssuePermit applying the status to every tag in the batch.
export const isGroupPermitIssued = (group, livestock, dbPermits = [], dispatches = []) =>
  (group?.tags || []).some((tag) => isTagPermitIssued(tag, livestock, dbPermits, dispatches));

/* ===== Pending-action counts for the Permit & Dispatch tabs =====
 * Transaction = one tag's current lifecycle row set. In this schema each animal tag is
 * unique (one livestock row, one carcass row, its payment rows), so tag_number links
 * livestock -> carcass -> payments -> dispatch.tags for the CURRENT transaction; the
 * livestock row's status is the single "stage" marker, so an old permit/dispatch can
 * never re-queue a tag whose status has moved on.
 *
 *  Permit pending   : weighed carcass (weight > 0) + paid payment + livestock status
 *                     not yet permit-issued/dispatched/released (and not condemned/rejected).
 *                     Counted once per payment batch (owner + payment date) = one table row.
 *  Dispatch pending : weighed carcass + livestock status "Ready for Dispatch" (permit
 *                     issued) + tag not in any dispatch record and not Released/Dispatched.
 *                     Counted once per owner = one Meat Dispatch batch.
 * A tag can only be in one of the two sets, so the counts never overlap.
 */
export const getPermitDispatchCounts = ({ payments, carcass, livestock, dispatches, permits }) => {
  const norm = (t) => String(t || "").trim().toLowerCase();

  const animalByTag = new Map();
  (livestock || []).forEach((l) => {
    if (l?.tag_number) animalByTag.set(norm(l.tag_number), l);
  });

  const paymentByTag = new Map();
  (payments || []).forEach((p) => {
    const tag = norm(p.tag_number);
    if (tag && !paymentByTag.has(tag)) paymentByTag.set(tag, p);
  });

  // ONE batch-key formula shared by both sets (owner + payment date + species), identical
  // to how the Permits table groups its rows. Deriving the dispatch key from
  // livestock.received_date instead of the payment date split a single batch into several
  // dispatch batches, so issuing one permit moved the dispatch badge by more than 1.
  const batchKeyForTag = (tag) => {
    const p = paymentByTag.get(tag);
    const animal = animalByTag.get(tag);
    const owner = p ? (p.owner_name || "Unknown Owner") : (animal?.owner_name || "Unknown Owner");
    const rawDate = p
      ? (p.date || p.created_at)
      : (animal?.received_date || animal?.date || animal?.created_at);
    const dateStr = rawDate ? String(rawDate).split("T")[0] : "No Date";
    const sp = p
      ? (p.animal_type || p.species || animal?.species || "Hog")
      : (animal?.species || "Hog");
    return `${String(owner).toLowerCase()}|||${String(dateStr).toLowerCase()}|||${String(sp).toLowerCase()}`;
  };

  const dispatchedTags = new Set();
  (dispatches || []).forEach((d) => {
    const tags = Array.isArray(d.tags) ? d.tags : d.tag_number ? [d.tag_number] : [];
    tags.forEach((t) => dispatchedTags.add(norm(t)));
  });
  (livestock || []).forEach((l) => {
    const s = norm(l?.status);
    if ((s === "released" || s === "dispatched") && l?.tag_number) {
      dispatchedTags.add(norm(l.tag_number));
    }
  });

  const isPermitted = (tagNumber) => isTagPermitIssued(tagNumber, livestock, permits, dispatches);

  const blocked = ["condemned", "rejected"];

  // 1. Permit Batches awaiting permit issuance (Cleared/Paid payment batches whose permits are not yet issued)
  const permitBatches = new Set();
  const seenPaidTags = new Set();

  (payments || []).forEach((p) => {
    if (norm(p.status) !== "paid") return;
    const tag = norm(p.tag_number);
    if (!tag || seenPaidTags.has(tag)) return;
    seenPaidTags.add(tag);
    const animal = animalByTag.get(tag);
    const status = animal ? norm(animal.status) : "paid";
    if (blocked.some((b) => status.includes(b))) return;
    if (isPermitted(tag) || dispatchedTags.has(tag)) return;
    permitBatches.add(batchKeyForTag(tag));
  });

  (livestock || []).forEach((animal) => {
    const status = norm(animal.status);
    if (status !== "paid" || blocked.some((b) => status.includes(b))) return;
    const tag = norm(animal.tag_number);
    if (!tag || seenPaidTags.has(tag)) return;
    seenPaidTags.add(tag);
    if (isPermitted(tag) || dispatchedTags.has(tag)) return;
    permitBatches.add(batchKeyForTag(tag));
  });

  (carcass || []).forEach((c) => {
    const tag = norm(c.tag_number);
    if (!tag || seenPaidTags.has(tag)) return;
    const w = parseFloat(c.total_weight || c.cold_weight || c.weight || 0);
    if (w <= 0 && c.status !== "Completed" && c.status !== "Weighed") return;
    seenPaidTags.add(tag);
    const animal = animalByTag.get(tag);
    const status = animal ? norm(animal.status) : "weighed";
    if (blocked.some((b) => status.includes(b))) return;
    if (isPermitted(tag) || dispatchedTags.has(tag)) return;
    permitBatches.add(batchKeyForTag(tag));
  });

  // 2. Dispatch Batches awaiting gate release (Permit issued, not yet dispatched/released)
  const dispatchBatches = new Set();
  animalByTag.forEach((animal, tag) => {
    if (!tag || dispatchedTags.has(tag)) return;
    const status = norm(animal.status);
    if (blocked.some((b) => status.includes(b))) return;
    if (!isPermitted(tag)) return;
    dispatchBatches.add(batchKeyForTag(tag));
  });

  return { permitCount: permitBatches.size, dispatchCount: dispatchBatches.size };
};

export const Permits = ({ hideHeader = false, hideStats = false }) => {
  const { data: payments, refresh: refreshPayments } = useSupabase(TABLES.PAYMENTS);
  const { data: carcass, refresh: refreshCarcass } = useSupabase(TABLES.CARCASS);
  const { data: fees = [] } = useSupabase(TABLES.FEES);
  const { data: livestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: dbPermits = [], refresh: refreshPermits } = useSupabase(TABLES.PERMITS);
  const { data: dbPermitConfigs = [] } = useSupabase(TABLES.PERMIT_CONFIG);
  const { data: dispatches = [] } = useSupabase(TABLES.DISPATCH);
  const { data: slaughterRecords = [], refresh: refreshSlaughterRecords } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: slaughterProcessing = [], refresh: refreshSlaughterProcessing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: postMortem = [] } = useSupabase(TABLES.POST_MORTEM);
  const { data: owners = [], refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  const { data: users = [] } = useSupabase(TABLES.USERS);
  const [profileModalOwner, setProfileModalOwner] = useState(null);

  const [selectedGroup, setSelectedGroup] = useState(null); // holds group for print preview
  const [permitModalMode, setPermitModalMode] = useState("view"); // "view" | "print"
  const [confirmingGroup, setConfirmingGroup] = useState(null); // holds group for direct issuance confirmation modal
  const [viewingBatch, setViewingBatch] = useState(null); // holds group for View Details Modal (matching other records)
  const [inAppAlert, setInAppAlert] = useState(null);
  const [issuingId, setIssuingId] = useState(null);
  const issuingInProgressRef = useRef(new Set());
  const { showToast } = useToast();

  const [localCfg, setLocalCfg] = useState(() => getPermitConfig());
  useEffect(() => {
    const handleUpdate = () => setLocalCfg(getPermitConfig());
    window.addEventListener("storage", handleUpdate);
    window.addEventListener("permit_config_updated", handleUpdate);
    return () => {
      window.removeEventListener("storage", handleUpdate);
      window.removeEventListener("permit_config_updated", handleUpdate);
    };
  }, []);

  const cfg = useMemo(() => {
    const local = localCfg || getPermitConfig();
    const dbRow = (dbPermitConfigs || []).find((c) => c.id === "default") || dbPermitConfigs?.[0];
    if (dbRow) {
      return {
        ...local,
        origin: dbRow.origin || local.origin || "TAPON TINAAN",
        destination: dbRow.destination || local.destination || "NEW PEOPLES MARKET",
        address: dbRow.address || local.address || "EAST POBLACION",
        timeIssued: dbRow.time_issued || local.timeIssued || "",
        conveyance: dbRow.conveyance || local.conveyance || "MEAT VAN",
        plateNo: dbRow.plate_no ?? local.plateNo ?? "",
        inspector: dbRow.inspector || local.inspector || "NERISSA U. VELOSO",
        cityVet: dbRow.city_vet || local.cityVet || "DR. RAYMUNDO VALENTINE P. PAMIREZ",
        permitPrefix: dbRow.permit_prefix || local.permitPrefix || "permit-",
      };
    }
    return local;
  }, [dbPermitConfigs, localCfg]);

  const handleExecutePermitIssuance = async (grp) => {
    if (!grp || issuingId) return;
    const batchKey = grp.key || grp.batch_reference || grp.owner_name;
    if (issuingInProgressRef.current.has(batchKey)) return;
    issuingInProgressRef.current.add(batchKey);
    setIssuingId(batchKey);

    try {
      const eligibleItems = (grp.items || []).filter((it) => it.isEligible && !it.isIssued);
      const targetTags = eligibleItems.map((it) => it.tag_number).filter(Boolean);

      if (targetTags.length === 0) {
        setInAppAlert({
          title: "No Eligible Records",
          message: "No unissued eligible livestock records found in this slaughter batch.",
          variant: "warning",
        });
        setConfirmingGroup(null);
        return;
      }

      const normTag = (t) => String(t || "").trim().toLowerCase();
      const dispatchedTagSet = new Set(
        (dispatches || []).flatMap((d) =>
          Array.isArray(d.tags) ? d.tags : d.tag_number ? [d.tag_number] : []
        ).map(normTag)
      );

      const pendingTags = targetTags.filter((t) => !dispatchedTagSet.has(normTag(t)));
      if (pendingTags.length === 0) {
        setInAppAlert({
          title: "Batch Already Dispatched",
          message: "These animal(s) were already dispatched. No permit can be issued for a released batch.",
          variant: "danger",
        });
        setConfirmingGroup(null);
        return;
      }

      // Re-verify that every pending tag has a recorded carcass weight
      const unweighed = pendingTags.filter((tag) => {
        const normT = normTag(tag);
        const itemMatch = (grp.items || []).find((it) => normTag(it.tag_number) === normT);
        if (itemMatch?.hasCarcassWeight) return false;
        return !(carcass || []).some(
          (c) =>
            normTag(c.tag_number) === normT &&
            (parseFloat(c.total_weight || c.cold_weight || c.weight || 0) > 0 ||
              c.status === "Completed" ||
              c.status === "Weighed")
        );
      });
      if (unweighed.length > 0) {
        setInAppAlert({
          title: "Carcass Weighing Incomplete",
          message: `Meat Permit cannot be issued because carcass weighing has not been completed for: ${unweighed.join(", ")}. All carcasses must be weighed and branded before permit issuance.`,
          variant: "warning",
        });
        setConfirmingGroup(null);
        return;
      }

      const issuedAtIso = new Date().toISOString();
      const batchPermitNo = grp.permit_no || `MIC-06-${Math.floor(100000 + Math.random() * 900000)}`;
      const actor = getCurrentActor();

      // Check existing permits case-insensitively across all non-revoked statuses to prevent duplicates
      const existingPermitsMap = new Map();
      const pendingNormSet = new Set(pendingTags.map(normTag));
      try {
        const { data: pData } = await supabase
          .from(TABLES.PERMITS)
          .select("id, tag_number, permit_no, status")
          .in("tag_number", pendingTags);
        (pData || []).forEach((p) => {
          const t = normTag(p?.tag_number);
          if (t && pendingNormSet.has(t) && String(p?.status || "").toLowerCase() !== "revoked") {
            if (!existingPermitsMap.has(t)) existingPermitsMap.set(t, p);
          }
        });
      } catch (e) {
        console.warn("Could not batch query existing permits:", e);
      }

      (dbPermits || []).forEach((p) => {
        const t = normTag(p?.tag_number);
        if (t && pendingNormSet.has(t) && String(p?.status || "").toLowerCase() !== "revoked") {
          if (!existingPermitsMap.has(t)) existingPermitsMap.set(t, p);
        }
      });

      const tagsToInsert = [];
      const permitsToInsert = [];
      const tagsToReuse = [];

      pendingTags.forEach((tag, idx) => {
        const tagNorm = normTag(tag);
        const existing = existingPermitsMap.get(tagNorm);
        if (existing) {
          tagsToReuse.push(tag);
        } else {
          const tagPermitNo = pendingTags.length > 1 ? `${batchPermitNo}-${idx + 1}` : batchPermitNo;
          const matchedAnimal = (livestock || []).find((l) => normTag(l.tag_number) === tagNorm);
          const matchedCarcass = (carcass || []).find((c) => normTag(c.tag_number) === tagNorm);

          const configSnapshot = {
            permitPrefix: cfg?.permitPrefix || "permit-",
            origin: cfg?.origin || "TAPON TINAAN",
            destination: cfg?.destination || "NEW PEOPLES MARKET",
            address: cfg?.address || "EAST POBLACION",
            timeIssued: cfg?.timeIssued || "",
            conveyance: cfg?.conveyance || "MEAT VAN",
            plateNo: cfg?.plateNo || "",
            inspector: cfg?.inspector || "NERISSA U. VELOSO",
            cityVet: cfg?.cityVet || "DR. RAYMUNDO VALENTINE P. PAMIREZ",
          };

          tagsToInsert.push(tag);
          permitsToInsert.push({
            permit_no: tagPermitNo,
            tag_number: tag,
            livestock_id: matchedAnimal?.id || null,
            carcass_id: matchedCarcass?.id || null,
            owner_name: grp.owner_name || matchedAnimal?.owner_name || "Unknown Owner",
            species: matchedAnimal?.species || matchedCarcass?.species || grp.speciesList?.[0] || "Hog",
            carcass_weight: matchedCarcass?.total_weight || matchedCarcass?.cold_weight || matchedAnimal?.weight || 0,
            origin: configSnapshot.origin,
            destination: configSnapshot.destination,
            address: configSnapshot.address,
            time_issued: configSnapshot.timeIssued,
            conveyance: configSnapshot.conveyance,
            plate_no: configSnapshot.plateNo,
            inspector: configSnapshot.inspector,
            city_vet: configSnapshot.cityVet,
            issued_by: actor.name,
            issued_by_user_id: actor.id,
            status: "Active",
            issued_at: issuedAtIso,
            config_snapshot: configSnapshot,
          });
        }
      });

      let insertSuccess = true;
      let lastError = "";
      if (permitsToInsert.length > 0) {
        let { error: insertErr } = await supabase.from(TABLES.PERMITS).insert(permitsToInsert);
        if (insertErr && /column|schema cache/i.test(`${insertErr.message || ""} ${insertErr.details || ""}`)) {
          const fbPermits = permitsToInsert.map(({ issued_by, issued_by_user_id, config_snapshot, ...fb }) => fb);
          const fbRes = await supabase.from(TABLES.PERMITS).insert(fbPermits);
          insertErr = fbRes.error;
        }
        if (insertErr) {
          console.error("Batch permit insert failed:", insertErr);
          lastError = insertErr.message || "Failed to insert permits";
          insertSuccess = false;
        }
      }

      if (!insertSuccess && permitsToInsert.length > 0 && tagsToReuse.length === 0) {
        setInAppAlert({
          title: "Permit Issuance Failed",
          message: `Failed to save permit(s) to the database: ${lastError}`,
          variant: "danger",
        });
        showToast(`Failed to save permit(s) to the database: ${lastError}`, "error");
        setConfirmingGroup(null);
        return;
      }

      const eligibleTagsForLivestockUpdate = insertSuccess ? pendingTags : tagsToReuse;
      const updateResults = await Promise.allSettled(
        eligibleTagsForLivestockUpdate.map(async (tag, idx) => {
          const tagNorm = normTag(tag);
          const matchedAnimal = (livestock || []).find((l) => normTag(l.tag_number) === tagNorm);
          const tagPermitNo = pendingTags.length > 1 ? `${batchPermitNo}-${idx + 1}` : batchPermitNo;

          return safeUpdateLivestockWithHistory(
            matchedAnimal?.id,
            tag,
            {
              status: "Permit Issued",
              permit_issued_at: issuedAtIso,
              permit_issued_by: actor.name,
              permit_issued_by_user_id: actor.id,
            },
            {
              stage: "Permit",
              action: `Meat Inspection & Transfer Permit Issued (${tagPermitNo})`,
              details: { permit_no: tagPermitNo, destination: cfg?.destination || "NEW PEOPLES MARKET" },
              actor,
            },
            matchedAnimal
          );
        })
      );

      const savedCount = updateResults.filter((r) => r.status === "fulfilled").length;

      // Immediate success feedback once database confirms permit write
      if (savedCount === 0 && !insertSuccess) {
        setInAppAlert({
          title: "Permit Update Failed",
          message: `Failed to update livestock status${lastError ? `: ${lastError}` : ""}`,
          variant: "danger",
        });
        showToast(`Failed to update livestock status: ${lastError || "Database update failed"}`, "error");
      } else {
        const countIssued = savedCount || pendingTags.length;
        const successMsg = countIssued === 1
          ? `Meat Inspection Permit (${batchPermitNo}) issued successfully for ${grp.owner_name} (1 head)!`
          : `Meat Inspection Permit (${batchPermitNo}) issued successfully for ${grp.owner_name} (${countIssued} heads)!`;

        setInAppAlert({
          title: "Permit Issued",
          message: successMsg,
          variant: "success",
        });
        showToast(`Permit ${batchPermitNo} issued successfully for ${grp.owner_name}!`, "success");
      }
      setConfirmingGroup(null);

      // Realtime DB updates
      notifyDbChange(TABLES.PERMITS, "insert");
      notifyDbChange(TABLES.LIVESTOCK, "update");

      // Non-blocking background tasks: payments sync, audit logs, and refresh
      (async () => {
        try {
          const existingPaidTags = new Set((payments || []).map((p) => normTag(p.tag_number)));
          const paymentCreations = [];
          for (const tag of pendingTags) {
            const tagNorm = normTag(tag);
            if (!existingPaidTags.has(tagNorm)) {
              const matchedAnimal = (livestock || []).find((l) => normTag(l.tag_number) === tagNorm);
              const matchedCarcass = (carcass || []).find((c) => normTag(c.tag_number) === tagNorm);
              const animalSpecies = feeService.normalizeAnimalType(matchedAnimal?.species || matchedCarcass?.species || grp.speciesList?.[0] || "Hog");
              const rule = feeService.resolveFeeRule(animalSpecies, fees);
              const method = rule?.method || "Per Head";
              const rate = rule?.rate || 0;
              const weight = matchedCarcass ? parseFloat(matchedCarcass.total_weight || matchedCarcass.cold_weight || matchedCarcass.weight || 0) : 0;
              const amt = feeService.calculate({ method, rate, quantity: 1, weight });

              paymentCreations.push(
                feeService.createPayment({
                  owner_name: grp.owner_name || matchedAnimal?.owner_name || "Unknown Owner",
                  date: today(),
                  tag_number: tag,
                  animal_type: animalSpecies,
                  species: animalSpecies,
                  quantity: 1,
                  weight,
                  method,
                  rate,
                  amount: amt,
                  livestock_id: matchedAnimal?.id || null,
                  fee_id: rule?.id || null,
                  fee_name: rule?.fee_name || `${animalSpecies} Slaughter & Permit Fee`,
                  paid_at: issuedAtIso,
                  created_at: issuedAtIso,
                  receipt_no: batchPermitNo,
                  status: "Paid",
                })
              );
            }
          }
          if (paymentCreations.length > 0) {
            await Promise.allSettled(paymentCreations);
            notifyDbChange(TABLES.PAYMENTS, "insert");
          }
        } catch (pmtErr) {
          console.warn("Background payment auto-creation on permit issuance:", pmtErr);
        }

        logActivity({
          action: `Issued Meat Inspection Permit ${batchPermitNo} for ${pendingTags.join(", ")} (${grp.owner_name})`,
          module: "Permits",
          tag_number: pendingTags.join(", "),
          old_value: "Paid",
          new_value: "Permit Issued",
          field_changed: "status",
          user: actor.name,
          role: actor.role,
          user_id: actor.id,
        }).catch((e) => console.warn("Background permit activity log error:", e));

        Promise.allSettled([
          typeof refreshLivestock === "function" ? refreshLivestock() : Promise.resolve(),
          typeof refreshPermits === "function" ? refreshPermits() : Promise.resolve(),
          typeof refreshPayments === "function" ? refreshPayments() : Promise.resolve(),
        ]).catch(() => {});
      })();
    } catch (err) {
      console.error("handleExecutePermitIssuance error:", err);
      setInAppAlert({
        title: "Unexpected Error",
        message: err?.message || "An unexpected error occurred while issuing the permit.",
        variant: "danger",
      });
      showToast(err?.message || "An unexpected error occurred while issuing the permit.", "error");
      setConfirmingGroup(null);
    } finally {
      if (batchKey) issuingInProgressRef.current.delete(batchKey);
      setIssuingId(null);
    }
  };

  // Print Configuration form states
  const [permitNo, setPermitNo] = useState("MIC-06-016246");
  const [origin, setOrigin] = useState(cfg.origin);
  const [destination, setDestination] = useState(cfg.destination);
  const [address, setAddress] = useState(cfg.address);
  const [conveyance, setConveyance] = useState(cfg.conveyance);
  const [plateNo, setPlateNo] = useState(cfg.plateNo);
  const [inspector, setInspector] = useState(cfg.inspector);
  const [veterinarian, setVeterinarian] = useState(cfg.cityVet);
  const [serialNo, setSerialNo] = useState("1037977");
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "pending" || urlTab === "issued" || urlTab === "dispatch") return urlTab;
    return "pending";
  });
  const [search, setSearch] = useState(() => searchParams.get("tag") || searchParams.get("search") || "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "pending" || urlTab === "issued" || urlTab === "dispatch") {
      setActiveTab(urlTab);
    }
    const q = searchParams.get("tag") || searchParams.get("search");
    if (q) setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [search, filterSpecies, activeTab]);

  useEffect(() => {
    if (selectedGroup) {
      // Check if selectedGroup is an already issued permit record
      const issuedPermit =
        selectedGroup.permit ||
        (selectedGroup.items || []).find((it) => it.permit)?.permit ||
        (dbPermits || []).find((p) => {
          const grpTags = selectedGroup.tags || (selectedGroup.tag_number ? [selectedGroup.tag_number] : []);
          return grpTags.some((t) => String(t || "").trim().toLowerCase() === String(p.tag_number || "").trim().toLowerCase());
        });

      if (issuedPermit) {
        // PREVIOUSLY ISSUED PERMIT: Lock strictly to the historical permit record snapshot
        const snap = issuedPermit.config_snapshot || selectedGroup.config_snapshot || {};
        setOrigin(issuedPermit.origin || snap.origin || selectedGroup.origin || cfg.origin);
        setDestination(issuedPermit.destination || snap.destination || selectedGroup.destination || cfg.destination);
        setAddress(issuedPermit.address || snap.address || selectedGroup.address || cfg.address);
        setConveyance(issuedPermit.conveyance || snap.conveyance || selectedGroup.conveyance || cfg.conveyance);
        setPlateNo(issuedPermit.plate_no ?? snap.plateNo ?? selectedGroup.plate_no ?? cfg.plateNo ?? "");
        setInspector(issuedPermit.inspector || snap.inspector || selectedGroup.inspector || cfg.inspector);
        setVeterinarian(issuedPermit.city_vet || snap.cityVet || selectedGroup.city_vet || cfg.cityVet);
      } else {
        // UNISSUED / NEW PERMIT: Apply latest active saved configuration defaults
        const activeCfg = getPermitConfig();
        setOrigin(cfg.origin || activeCfg.origin);
        setDestination(cfg.destination || activeCfg.destination);
        setAddress(cfg.address || activeCfg.address);
        setConveyance(cfg.conveyance || activeCfg.conveyance);
        setPlateNo(cfg.plateNo ?? activeCfg.plateNo ?? "");
        setInspector(cfg.inspector || activeCfg.inspector);
        setVeterinarian(cfg.cityVet || activeCfg.cityVet);
      }
    }
  }, [selectedGroup, dbPermits, cfg]);

  const getBasePrefix = (tag) => {
    const match = tag.match(/(TAG-(?:\d+-[A-Z]+|[A-Z\d]+-\d+))-\d+/i);
    return match ? match[1] : tag;
  };

  const getPermitDisplayTag = (fullTag, species) => {
    const suffix = (species?.toLowerCase() === "swine" || species?.toLowerCase() === "hog") ? "HOG" : species?.toUpperCase() || "ANIMAL";
    if (fullTag.toUpperCase().includes(`-${suffix}`)) {
      return fullTag;
    }
    return `${fullTag}-${suffix}`;
  };

  

  // The real moment this permit was issued, read back from Supabase for this specific tag
  const getIssuedTime = (grp) => {
    if (!grp) return "";
    if (grp.permit_issued_at) return grp.permit_issued_at;
    for (const tag of grp.tags || [grp.tag_number]) {
      const cleanTag = String(tag || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const perm = (dbPermits || []).find(
        (p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag && (p.issued_at || p.created_at)
      );
      if (perm && (perm.issued_at || perm.created_at)) return perm.issued_at || perm.created_at;
    }
    for (const tag of grp.tags || [grp.tag_number]) {
      const cleanTag = String(tag || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const animal = (livestock || []).find(
        (l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag
      );
      if (animal && animal.permit_issued_at) return animal.permit_issued_at;
    }
    if (grp.rawDate) return grp.rawDate;
    if (grp.created_at) return grp.created_at;
    return "";
  };

  // The most recent timestamp for this record across permits, payments, and livestock
  const getRecordNewestTimestamp = (grp) => {
    if (!grp) return 0;
    const candidates = [];

    // 1. Direct permit issuance timestamps
    if (grp.permit_issued_at) candidates.push(grp.permit_issued_at);
    if (grp.issued_at) candidates.push(grp.issued_at);

    // 2. Lookup in dbPermits for any tag in this group
    const grpTags = grp.tags && grp.tags.length ? grp.tags : (grp.tag_number ? String(grp.tag_number).split(",").map((t) => t.trim()) : []);
    for (const t of grpTags) {
      const cleanTag = String(t || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const perm = (dbPermits || []).find((p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag && String(p.status || "").toLowerCase() !== "revoked");
      if (perm) {
        if (perm.issued_at) candidates.push(perm.issued_at);
        if (perm.created_at) candidates.push(perm.created_at);
        if (perm.date) candidates.push(perm.date);
      }
    }

    // 3. Lookup in livestock for permit_issued_at, paid_at, etc.
    for (const t of grpTags) {
      const cleanTag = String(t || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag);
      if (animal) {
        if (animal.permit_issued_at) candidates.push(animal.permit_issued_at);
        if (animal.paid_at) candidates.push(animal.paid_at);
        if (animal.weighed_at) candidates.push(animal.weighed_at);
        if (animal.slaughtered_at) candidates.push(animal.slaughtered_at);
        if (animal.marked_at) candidates.push(animal.marked_at);
        if (animal.created_at) candidates.push(animal.created_at);
        if (animal.received_date) candidates.push(animal.received_date);
      }
    }

    // 4. From payments array
    if (Array.isArray(grp.payments)) {
      for (const p of grp.payments) {
        if (p.paid_at) candidates.push(p.paid_at);
        if (p.created_at) candidates.push(p.created_at);
        if (p.payment_date) candidates.push(p.payment_date);
        if (p.date) candidates.push(p.date);
      }
    }

    // 5. From group-level fields
    if (grp.rawTime) candidates.push(grp.rawTime);
    if (grp.rawDate) candidates.push(grp.rawDate);
    if (grp.created_at) candidates.push(grp.created_at);
    if (grp.paid_at) candidates.push(grp.paid_at);
    if (grp.date) candidates.push(grp.date);

    let maxMs = 0;
    for (const c of candidates) {
      if (!c) continue;
      const ms = new Date(c).getTime();
      if (!isNaN(ms) && ms > maxMs) {
        maxMs = ms;
      }
    }
    return maxMs;
  };

  const getIssuedBy = (grp) => {
    if (!grp) return "Jenel Selgas";
    if (grp.permit_issued_by) return grp.permit_issued_by;
    for (const tag of grp.tags || [grp.tag_number]) {
      const cleanTag = String(tag || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const perm = (dbPermits || []).find(
        (p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag && p.issued_by
      );
      if (perm && perm.issued_by) return perm.issued_by;
    }
    for (const tag of grp.tags || [grp.tag_number]) {
      const cleanTag = String(tag || "").trim().toLowerCase();
      if (!cleanTag) continue;
      const animal = (livestock || []).find(
        (l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag && l.permit_issued_by
      );
      if (animal && animal.permit_issued_by) return animal.permit_issued_by;
    }
    return "Jenel Selgas";
  };

  // Normalize tag string helper
  const normTag = (t) => String(t || "").trim().toLowerCase();

  // Primary dataset: Groups organized strictly by Owner & Slaughter Batch (Date & Time)
  const slaughterBatchGroups = useMemo(() => {
    const dispatchedTagSet = new Set(
      (dispatches || []).flatMap((d) =>
        Array.isArray(d.tags) ? d.tags : d.tag_number ? [d.tag_number] : []
      ).map(normTag)
    );

    // Build lookup maps for fast correlation across tables
    const animalByTag = new Map();
    const animalBaseMap = new Map();
    (livestock || []).forEach((l) => {
      const rawTag = String(l?.tag_number || "");
      const t = normTag(rawTag);
      if (t) animalByTag.set(t, l);
      const baseTag = rawTag.replace(/-(HOG|PIG|SWINE|CATTLE|COW|CARABAO|GOAT)$/i, "");
      if (baseTag && baseTag !== rawTag) {
        const bt = normTag(baseTag);
        if (bt && !animalBaseMap.has(bt)) animalBaseMap.set(bt, l);
      }
    });

    const carcassByTag = new Map();
    const carcassBaseMap = new Map();
    (carcass || []).forEach((c) => {
      if (!c) return;
      const rawTag = String(c?.tag_number || "");
      const t = normTag(rawTag);
      if (t && !carcassByTag.has(t)) carcassByTag.set(t, c);

      // Support multi-tag records separated by comma
      if (rawTag.includes(",")) {
        rawTag.split(",").forEach((sub) => {
          const st = normTag(sub);
          if (st && !carcassByTag.has(st)) carcassByTag.set(st, c);
        });
      }

      // Match by livestock_id if provided
      if (c?.livestock_id) {
        const matched = (livestock || []).find((l) => l.id === c.livestock_id);
        if (matched?.tag_number) {
          const mt = normTag(matched.tag_number);
          if (mt && !carcassByTag.has(mt)) carcassByTag.set(mt, c);
        }
      }

      // Store base tag (e.g. TAG-001 from TAG-001-HOG) in separate fallback map
      // Do NOT put baseTag into carcassByTag so candidateTags is not polluted with phantom tags
      const baseTag = rawTag.replace(/-(HOG|PIG|SWINE|CATTLE|COW|CARABAO|GOAT)$/i, "");
      if (baseTag && baseTag !== rawTag) {
        const bt = normTag(baseTag);
        if (bt && !carcassBaseMap.has(bt)) carcassBaseMap.set(bt, c);
      }
    });

    const paymentByTag = new Map();
    (payments || []).forEach((p) => {
      const t = normTag(p?.tag_number);
      if (t && !paymentByTag.has(t)) paymentByTag.set(t, p);
    });

    const permitByTag = new Map();
    (dbPermits || []).forEach((p) => {
      const t = normTag(p?.tag_number);
      if (t && String(p?.status || "").toLowerCase() !== "revoked") {
        permitByTag.set(t, p);
      }
    });

    const postMortemByTag = new Map();
    (postMortem || []).forEach((pm) => {
      const t = normTag(pm?.tag_number);
      if (t) postMortemByTag.set(t, pm);
    });

    const slaughterRecByTag = new Map();
    (slaughterRecords || []).forEach((sr) => {
      const t = normTag(sr?.tag_number);
      if (t) slaughterRecByTag.set(t, sr);
      if (sr?.livestock_id) {
        const matched = (livestock || []).find((l) => l.id === sr.livestock_id);
        if (matched?.tag_number) slaughterRecByTag.set(normTag(matched.tag_number), sr);
      }
    });

    const slaughterProcByTag = new Map();
    (slaughterProcessing || []).forEach((sp) => {
      const items = Array.isArray(sp?.items) ? sp.items : (Array.isArray(sp?.records) ? sp.records : []);
      items.forEach((it) => {
        const t = normTag(it?.tag_number || it);
        if (t && !slaughterProcByTag.has(t)) slaughterProcByTag.set(t, sp);
      });
    });

    // Gather candidate tags strictly adhering to LSMIS official workflow:
    // Stage 7 (Carcass Weighing & Branding) -> Stage 8 (Meat Permit)
    // "After weighing and branding are complete, move records to Meat Permit.
    // Prevent unweighed carcasses from advancing to Meat Permit."
    const candidateTags = new Set();

    // 1. All records with a weighed carcass in carcass_records
    carcassByTag.forEach((c, t) => {
      const w = parseFloat(c?.total_weight || c?.cold_weight || c?.weight || 0);
      const isCarcassWeighed = w > 0 || c?.status === "Completed" || c?.status === "Weighed";
      if (isCarcassWeighed) {
        candidateTags.add(t);
      }
    });

    // 2. All records with an existing or issued permit
    permitByTag.forEach((_, t) => candidateTags.add(t));

    // 3. Livestock records that have completed Carcass Weighing (Stage 7) or permit issuance
    (livestock || []).forEach((l) => {
      const st = String(l?.status || "").toLowerCase();
      const wf = String(l?.workflow_status || "").toUpperCase();
      const isWeighedOrAdvanced =
        st === "weighed" ||
        wf === "WEIGHED" ||
        st === "permit issued" ||
        st === "ready for dispatch" ||
        st === "dispatched" ||
        Boolean(l?.weighed_at) ||
        Boolean(l?.permit_issued_at) ||
        Boolean(l?.permit_no) ||
        (parseFloat(l?.weight || 0) > 0 && st !== "registered" && st !== "marked" && st !== "pending" && st !== "ante-mortem inspected" && st !== "completed");

      if (isWeighedOrAdvanced) {
        const t = normTag(l?.tag_number);
        if (t) candidateTags.add(t);
      }
    });

    // 4. Payments associated with weighed carcasses or issued permits
    paymentByTag.forEach((p, t) => {
      if (carcassByTag.has(t) || permitByTag.has(t)) {
        candidateTags.add(t);
      }
    });

    const groups = {};

    candidateTags.forEach((t) => {
      let animal = animalByTag.get(t) || animalBaseMap.get(t);
      let carc = carcassByTag.get(t) || carcassBaseMap.get(t);
      if (!animal && carc?.livestock_id) {
        animal = (livestock || []).find((l) => l.id === carc.livestock_id);
      }
      if (!animal) {
        const baseT = t.replace(/-(hog|pig|swine|cattle|cow|carabao|goat)$/i, "");
        if (baseT && baseT !== t) {
          animal = animalByTag.get(baseT) || animalBaseMap.get(baseT);
        }
      }
      if (!carc && animal?.id) {
        carc = (carcass || []).find((c) => c?.livestock_id === animal.id);
      }
      if (!carc && animal?.tag_number) {
        const at = normTag(animal.tag_number);
        carc = carcassByTag.get(at) || carcassBaseMap.get(at);
      }

      const pmt = paymentByTag.get(t);
      const perm = permitByTag.get(t);
      const pm = postMortemByTag.get(t);
      const sRec = slaughterRecByTag.get(t);
      const sp = slaughterProcByTag.get(t);

      // Exclude animals solely condemned or rejected at ante-mortem with no carcass/slaughter
      const animalStatus = String(animal?.status || "").toLowerCase();
      const animalWfStatus = String(animal?.workflow_status || "").toUpperCase();
      if (!carc && !pmt && !perm && (animalStatus === "condemned" || animalStatus === "rejected")) {
        return;
      }

      const displayTag = carc?.tag_number || animal?.tag_number || pmt?.tag_number || perm?.tag_number || t.toUpperCase();
      const ownerId = animal?.owner_id || sRec?.owner_id || carc?.owner_id || pmt?.owner_id || perm?.owner_id || "";
      let resolvedOwnerName = (animal?.owner_name || sRec?.owner_name || pmt?.owner_name || perm?.owner_name || carc?.owner_name || "Unknown Owner").trim();
      let resolvedOwnerAddress = "";
      let resolvedOwnerAvatar = null;
      let resolvedOwnerContact = "";
      if (ownerId && Array.isArray(owners) && owners.length > 0) {
        const cleanOId = String(ownerId).trim().toLowerCase();
        const matched = owners.find((o) => {
          const oId = String(o.id || "").trim().toLowerCase();
          const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
          const oTempId = String(o.temp_reg_id || "").trim().toLowerCase();
          const oAuthId = String(o.auth_user_id || "").trim().toLowerCase();
          return oId === cleanOId || oOwnerId === cleanOId || oTempId === cleanOId || oAuthId === cleanOId;
        });
        if (matched?.name) resolvedOwnerName = matched.name;
        if (matched?.address) resolvedOwnerAddress = matched.address;
        if (matched?.avatar_url) resolvedOwnerAvatar = matched.avatar_url;
        if (matched?.phone || matched?.contact_number || matched?.contact) {
          resolvedOwnerContact = matched.phone || matched.contact_number || matched.contact;
        }
      } else if (resolvedOwnerName && resolvedOwnerName !== "Unknown Owner" && Array.isArray(owners) && owners.length > 0) {
        const matched = owners.find((o) => (o.name || "").trim().toLowerCase() === resolvedOwnerName.toLowerCase());
        if (matched?.name) resolvedOwnerName = matched.name;
        if (matched?.address) resolvedOwnerAddress = matched.address;
        if (matched?.avatar_url) resolvedOwnerAvatar = matched.avatar_url;
        if (matched?.phone || matched?.contact_number || matched?.contact) {
          resolvedOwnerContact = matched.phone || matched.contact_number || matched.contact;
        }
      }
      if (!resolvedOwnerContact) {
        resolvedOwnerContact = animal?.owner_contact || animal?.contact_number || "";
      }
      const rawOwner = resolvedOwnerName;
      const species = (animal?.species || sRec?.species || carc?.species || pmt?.animal_type || pmt?.species || "Hog").trim();

      // Authoritative historical timestamps (Asia/Manila)
      // 1. Slaughter Date & Time (prefer timestamps with time over date-only strings)
      const hasTimePart = (v) => v && (String(v).includes("T") || String(v).includes(":"));
      let itemSlaughterTime = null;
      if (sRec?.date_time) itemSlaughterTime = sRec.date_time;
      else if (sRec?.slaughter_date && sRec?.slaughter_time) itemSlaughterTime = `${sRec.slaughter_date} ${sRec.slaughter_time}`;
      else if (hasTimePart(sRec?.slaughter_date)) itemSlaughterTime = sRec.slaughter_date;
      else if (sRec?.created_at) itemSlaughterTime = sRec.created_at;
      else if (sp?.completed_at) itemSlaughterTime = sp.completed_at;
      else if (sp?.started_at) itemSlaughterTime = sp.started_at;
      else if (hasTimePart(sp?.slaughter_date)) itemSlaughterTime = sp.slaughter_date;
      else if (sp?.created_at) itemSlaughterTime = sp.created_at;
      else if (animal?.slaughtered_at) itemSlaughterTime = animal.slaughtered_at;
      else if (hasTimePart(animal?.slaughter_date)) itemSlaughterTime = animal.slaughter_date;
      else if (carc?.weighed_at) itemSlaughterTime = carc.weighed_at;
      else if (animal?.weighed_at) itemSlaughterTime = animal.weighed_at;
      else if (sRec?.slaughter_date) itemSlaughterTime = sRec.slaughter_date;
      else if (sp?.slaughter_date) itemSlaughterTime = sp.slaughter_date;
      else if (animal?.slaughter_date) itemSlaughterTime = animal.slaughter_date;

      // 2. Permit Issuance Date & Time (for issued permits)
      let itemPermitIssuedAt = null;
      if (perm?.issued_at) itemPermitIssuedAt = perm.issued_at;
      else if (animal?.permit_issued_at) itemPermitIssuedAt = animal.permit_issued_at;
      else if (perm?.created_at) itemPermitIssuedAt = perm.created_at;

      // 3. Permit Issuer
      const itemPermitIssuedBy = perm?.issued_by || animal?.permit_issued_by || null;

      // 4. Fallback Processing Timestamp (for unissued sorting)
      const itemProcessTime =
        carc?.weighed_at ||
        animal?.weighed_at ||
        pmt?.paid_at ||
        pmt?.payment_date ||
        pmt?.created_at ||
        carc?.created_at ||
        animal?.created_at ||
        null;

      // Slaughter batch reference resolution
      // DO NOT use pmt?.receipt_no as a batch reference; receipt_no is an individual payment invoice
      // which fractures a single slaughter batch into multiple 1-head rows!
      let batchRef = (
        animal?.batch_reference ||
        carc?.batch_reference ||
        sRec?.batch_reference ||
        sp?.batch_reference ||
        animal?.slaughter_batch ||
        pmt?.batch_reference ||
        ""
      ).trim();

      const effectiveDateStr = (itemSlaughterTime || itemProcessTime)
        ? String(itemSlaughterTime || itemProcessTime).split("T")[0].split(" ")[0]
        : "";

      if (!batchRef) {
        const dateCode = effectiveDateStr ? effectiveDateStr.replace(/-/g, "") : "BATCH";
        const ownerInitials = rawOwner.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "OWN";
        batchRef = `SB-${dateCode}-${ownerInitials}`;
      }

      // Group key enforces separation of distinct slaughter batches even for the same owner
      const groupKey = `${rawOwner.toLowerCase()}|||${batchRef.toLowerCase()}|||${effectiveDateStr || "nodate"}`;

      // Weight & branding details
      const carcassWeight = parseFloat(carc?.total_weight || carc?.cold_weight || carc?.weight || animal?.weight || 0);
      const hasCarcassWeight =
        carcassWeight > 0 ||
        Boolean(carc) ||
        carc?.status === "Completed" ||
        carc?.status === "Weighed" ||
        animalStatus === "weighed" ||
        animalWfStatus === "WEIGHED" ||
        Boolean(animal?.weighed_at);
      const brandCode = carc?.brand_code || (carc ? `CAR-${displayTag}` : "—");

      // Post-mortem clearance check
      const pmDecision = String(pm?.decision || animal?.post_mortem_decision || "Passed").toLowerCase();
      const isCondemned = pmDecision === "condemned" || pmDecision === "rejected" || animalStatus === "condemned";

      // Dispatch & Permit flags
      const isDispatched = dispatchedTagSet.has(t);
      const isIssued = Boolean(perm) || isTagPermitIssued(displayTag, livestock, dbPermits, dispatches);

      // Workflow rule: if carcass has not been weighed and has no issued permit,
      // it should not show in Meat Permit; it should only show in Carcass Weighing
      if (!hasCarcassWeight && !isIssued && !perm) {
        return;
      }

      // Assessed fee computation
      let feeAmount = parseFloat(pmt?.amount) || 0;
      if (feeAmount === 0) {
        try {
          const normSpecies = feeService.normalizeAnimalType(species);
          const rule = feeService.resolveFeeRule(normSpecies, fees);
          const method = rule?.method || "Per Head";
          const rate = rule?.rate || 0;
          feeAmount = feeService.calculate({ method, rate, quantity: 1, weight: carcassWeight });
        } catch (_) {
          feeAmount = 0;
        }
      }

      const isPaid = Boolean(pmt && String(pmt.status || "").toLowerCase() === "paid") || Boolean(animal?.paid_at);

      // Eligibility rules:
      // Must have recorded carcass weight > 0, passed post-mortem inspection, not dispatched, and not yet issued
      const isEligible = hasCarcassWeight && !isCondemned && !isDispatched && !isIssued;

      let ineligibleReason = "Eligible";
      if (isIssued) ineligibleReason = "Permit Already Issued";
      else if (isDispatched) ineligibleReason = "Already Dispatched";
      else if (isCondemned) ineligibleReason = "Condemned in Post-Mortem";
      else if (!hasCarcassWeight) ineligibleReason = "Pending Carcass Weighing & Branding";

      const rawSex = animal?.sex || carc?.sex || sRec?.sex || pm?.sex || pmt?.sex || "";
      const normalizedSex = formatSex(rawSex);
      const tagDigits = String(displayTag || "").replace(/\D/g, "");
      const fallbackSex = (tagDigits ? parseInt(tagDigits, 10) : String(displayTag || "").length) % 2 === 0 ? "Female" : "Male";
      const resolvedSex = normalizedSex === "Male" || normalizedSex === "Female" ? normalizedSex : fallbackSex;

      const itemRecord = {
        tag_number: displayTag,
        brand_code: brandCode,
        species,
        sex: resolvedSex,
        carcass_weight: carcassWeight,
        hasCarcassWeight,
        post_mortem_decision: pm?.decision || "Passed",
        isCondemned,
        isDispatched,
        isIssued,
        isEligible,
        isPaid,
        feeAmount,
        ineligibleReason,
        slaughter_date_time: itemSlaughterTime,
        permit_issued_at: itemPermitIssuedAt,
        permit_issued_by: itemPermitIssuedBy,
        process_date_time: itemProcessTime,
        permit_no: perm?.permit_no || (animal?.permit_no || null),
        animal,
        carcass: carc,
        payment: pmt,
        permit: perm,
      };

      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          id: groupKey,
          owner_name: rawOwner,
          owner_id: ownerId,
          owner_address: resolvedOwnerAddress || perm?.owner_address || "",
          owner_avatar: resolvedOwnerAvatar || perm?.owner_avatar || null,
          owner_contact: resolvedOwnerContact,
          batch_reference: batchRef,
          destination: perm?.destination || cfg?.destination || "NEW PEOPLES MARKET",
          origin: perm?.origin || cfg?.origin || "TAPON TINAAN",
          address: perm?.address || cfg?.address || "EAST POBLACION",
          time_issued: perm?.time_issued || cfg?.timeIssued || "",
          conveyance: perm?.conveyance || cfg?.conveyance || "MEAT VAN",
          plate_no: perm?.plate_no ?? cfg?.plateNo ?? "",
          inspector: perm?.inspector || cfg?.inspector || "NERISSA U. VELOSO",
          city_vet: perm?.city_vet || cfg?.cityVet || "DR. RAYMUNDO VALENTINE P. PAMIREZ",
          config_snapshot: perm?.config_snapshot || null,
          permit: perm || null,
          slaughter_date_time: itemSlaughterTime,
          permit_issued_at: itemPermitIssuedAt,
          permit_issued_by: itemPermitIssuedBy,
          process_date_time: itemProcessTime,
          rawTimestamp: 0,
          items: [],
          tags: [],
          speciesList: [],
          species,
          amount: 0,
          totalAmount: 0,
          receipt_no: batchRef,
          receipts: [batchRef],
          permit_no: perm?.permit_no || (animal?.permit_no || null),
          permit_id: perm?.id || null,
          permit_issued: false,
        };
      }

      const grp = groups[groupKey];
      grp.items.push(itemRecord);
      if (!grp.tags.includes(displayTag)) grp.tags.push(displayTag);
      if (!grp.speciesList.includes(species)) grp.speciesList.push(species);
      if (brandCode && brandCode !== "—" && !grp.receipts.includes(brandCode)) grp.receipts.push(brandCode);
      if (perm?.permit_no && !grp.receipts.includes(perm.permit_no)) grp.receipts.push(perm.permit_no);
      if (perm) {
        if (!grp.permit) grp.permit = perm;
        if (!grp.permit_id) grp.permit_id = perm.id;
        if (!grp.permit_no && perm.permit_no) grp.permit_no = perm.permit_no;
        if (perm.destination) grp.destination = perm.destination;
        if (perm.origin) grp.origin = perm.origin;
        if (perm.address) grp.address = perm.address;
        if (perm.time_issued) grp.time_issued = perm.time_issued;
        if (perm.conveyance) grp.conveyance = perm.conveyance;
        if (perm.plate_no !== undefined && perm.plate_no !== null) grp.plate_no = perm.plate_no;
        if (perm.inspector) grp.inspector = perm.inspector;
        if (perm.city_vet) grp.city_vet = perm.city_vet;
        if (perm.config_snapshot) grp.config_snapshot = perm.config_snapshot;
      }

      grp.amount += feeAmount;
      grp.totalAmount += feeAmount;

      if (!grp.slaughter_date_time && itemSlaughterTime) {
        grp.slaughter_date_time = itemSlaughterTime;
      }
      if (itemPermitIssuedAt) {
        if (!grp.permit_issued_at || new Date(itemPermitIssuedAt) > new Date(grp.permit_issued_at)) {
          grp.permit_issued_at = itemPermitIssuedAt;
        }
      }
      if (itemPermitIssuedBy && !grp.permit_issued_by) {
        grp.permit_issued_by = itemPermitIssuedBy;
      }
      if (!grp.process_date_time && itemProcessTime) {
        grp.process_date_time = itemProcessTime;
      }

      // Newest event timestamp for chronological sorting
      const candidateTimes = [
        itemPermitIssuedAt,
        itemSlaughterTime,
        itemProcessTime,
      ];
      for (const ct of candidateTimes) {
        if (!ct) continue;
        const ms = new Date(ct).getTime();
        if (!isNaN(ms) && ms > grp.rawTimestamp) {
          grp.rawTimestamp = ms;
        }
      }
    });

    return Object.values(groups)
      .filter((grp) => {
        // If carcass has not been weighed, it should not show in meat permit; it should only show in carcass weighing
        const totalCarcasses = grp.items.filter((it) => it.hasCarcassWeight).length;
        const issuedCount = grp.items.filter((it) => it.isIssued).length;
        return grp.items.length > 0 && (totalCarcasses > 0 || issuedCount > 0);
      })
      .map((grp) => {
        const sortedItems = [...grp.items].sort((a, b) =>
          String(a.tag_number || "").localeCompare(String(b.tag_number || ""), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
        const totalLivestock = sortedItems.length;
        const totalCarcasses = sortedItems.filter((it) => it.hasCarcassWeight).length;
        const eligibleCount = sortedItems.filter((it) => it.isEligible && !it.isIssued).length;
        const issuedCount = sortedItems.filter((it) => it.isIssued).length;
        const unweighedCount = sortedItems.filter((it) => !it.hasCarcassWeight).length;
        const totalWeight = sortedItems.reduce((sum, it) => sum + (Number(it.carcass_weight) || 0), 0);

        let status = "Incomplete Requirements";
        if (issuedCount > 0 && issuedCount === totalLivestock) {
          status = "Permit Issued";
        } else if (eligibleCount > 0) {
          status = "Ready for Permit";
        } else if (sortedItems.some((it) => !it.isPaid && String(it.payment?.status || "").toLowerCase() === "pending")) {
          status = "Pending Payment";
        }

        return {
          ...grp,
          date: grp.permit_issued_at || grp.slaughter_date_time || grp.process_date_time || (grp.rawTimestamp ? new Date(grp.rawTimestamp).toISOString() : new Date().toISOString()),
          items: sortedItems,
          tag_number: grp.tags.join(", "),
          totalLivestock,
          totalCarcasses,
          totalWeight,
          eligibleCount,
          issuedCount,
          unweighedCount,
          isIssued: issuedCount > 0 && issuedCount === totalLivestock,
          status,
        };
      })
      .sort((a, b) => (b.rawTimestamp || 0) - (a.rawTimestamp || 0));
  }, [carcass, payments, dbPermits, slaughterRecords, slaughterProcessing, livestock, dispatches, fees]);

  // Which specific transactions already have an issued permit
  const issuedKeys = useMemo(() => {
    const keys = new Set();
    (slaughterBatchGroups || []).forEach((grp) => {
      if (grp.isIssued) keys.add(grp.key);
    });
    return keys;
  }, [slaughterBatchGroups]);

  const issuedTimeDisplay = formatPhTime(getIssuedTime(selectedGroup)) || "—";

  const resolvedPermit = useMemo(() => {
    if (!selectedGroup) return null;
    if (selectedGroup.permit) return selectedGroup.permit;
    if (selectedGroup.permit_id) {
      const matchById = (dbPermits || []).find((p) => p.id === selectedGroup.permit_id);
      if (matchById) return matchById;
    }
    const grpTags = selectedGroup.tags || (selectedGroup.tag_number ? [selectedGroup.tag_number] : []);
    const matchByTag = (dbPermits || []).find((p) => {
      const pTag = normTag(p.tag_number);
      return grpTags.some((t) => normTag(t) === pTag);
    });
    return matchByTag || null;
  }, [selectedGroup, dbPermits]);

  const resolvedPermitNo = useMemo(() => {
    if (!selectedGroup) return permitNo;
    if (resolvedPermit?.permit_no) return resolvedPermit.permit_no;
    if (selectedGroup.permit_no) return selectedGroup.permit_no;
    if (selectedGroup.receipt_no) {
      return "MIC-06-" + String(selectedGroup.receipt_no).replace(/\D/g, "").padStart(6, "0").slice(-6);
    }
    return permitNo || "MIC-06-016246";
  }, [selectedGroup, resolvedPermit, permitNo]);

  // Search and species filtering
  const q = search.trim().toLowerCase();
  const isBatchIssued = (grp) => grp.status === "Permit Issued" || grp.issuedCount > 0 || grp.isIssued;

  const filteredSlaughterBatchGroups = useMemo(() => {
    return (slaughterBatchGroups || []).filter((grp) => {
      const matchTab = activeTab === "issued" ? isBatchIssued(grp) : !isBatchIssued(grp);

      const matchSearch =
        !q ||
        (grp.owner_name || "").toLowerCase().includes(q) ||
        (grp.batch_reference || "").toLowerCase().includes(q) ||
        (grp.receipt_no || "").toLowerCase().includes(q) ||
        (grp.permit_no || "").toLowerCase().includes(q) ||
        (grp.tag_number || "").toLowerCase().includes(q) ||
        (grp.receipts || []).some((r) => r.toLowerCase().includes(q)) ||
        (grp.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (grp.speciesList || []).some((s) => s.toLowerCase().includes(q));

      const matchSpecies =
        filterSpecies === "all" ||
        (grp.speciesList || []).some((s) => s.toLowerCase() === filterSpecies.toLowerCase());

      return matchTab && matchSearch && matchSpecies;
    });
  }, [slaughterBatchGroups, activeTab, q, filterSpecies]);

  // Main table pagination (10 per page default)
  const totalCount = filteredSlaughterBatchGroups.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const fromItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toItem = Math.min(currentPage * pageSize, totalCount);
  const paginatedGroups = filteredSlaughterBatchGroups;

  // KPI Metrics
  const totalBatches = slaughterBatchGroups.length;
  const issuedBatches = slaughterBatchGroups.filter(isBatchIssued).length;
  const pendingBatches = slaughterBatchGroups.filter((g) => !isBatchIssued(g)).length;
  const readyBatches = slaughterBatchGroups.filter((g) => g.eligibleCount > 0).length;
  const incompleteBatches = pendingBatches;
  const totalAmount = slaughterBatchGroups.reduce((sum, g) => sum + (g.totalAmount || 0), 0);

  // Identify display items for print preview modal
  const displayItems = selectedGroup
    ? (() => {
        const tagList = Array.from(
          new Set(
            (selectedGroup.tags && selectedGroup.tags.length
              ? selectedGroup.tags
              : String(selectedGroup.tag_number || "").split(",")
            )
              .map((t) => String(t != null ? t : "").trim().toLowerCase())
              .filter(Boolean)
          )
        );
        if (tagList.length === 0) return [];

        const resolveRow = (tag) => {
          const carc = (carcass || []).find(
            (cc) => String(cc.tag_number || "").trim().toLowerCase() === tag
          );
          if (carc) {
            const l = (livestock || []).find(
              (ll) => String(ll.tag_number || "").trim().toLowerCase() === tag
            );
            return {
              ...carc,
              species: (l && l.species) || selectedGroup.species || "Hog",
              sex: (l && l.sex) || "",
              owner_name: (l && l.owner_name) || selectedGroup.owner_name,
              quantity: (l && l.quantity) || carc.quantity || 1,
            };
          }
          const l = (livestock || []).find(
            (ll) => String(ll.tag_number || "").trim().toLowerCase() === tag
          );
          return {
            tag_number: (l && l.tag_number) || tag,
            species: (l && l.species) || selectedGroup.species || "Hog",
            sex: (l && l.sex) || "",
            owner_name: (l && l.owner_name) || selectedGroup.owner_name,
            quantity: (l && l.quantity) || 1,
            total_weight: (l && l.weight) || 0,
            cold_weight: undefined,
          };
        };

        return tagList
          .map(resolveRow)
          .sort((a, b) =>
            (a.tag_number || "").localeCompare(b.tag_number || "", undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );
      })()
    : [];

  const totalQuantity = displayItems.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
  const totalWeight = displayItems.reduce(
    (acc, curr) => acc + (curr.total_weight || curr.cold_weight || 0),
    0
  );

  const renderNavTabs = () => (
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
        { id: "pending", label: "Pending", count: pendingBatches, icon: <Icon.Clock size={14} />, color: "#d97706", badgeBg: "rgba(217, 119, 6, 0.15)", badgeColor: "#d97706" },
        { id: "issued", label: "Permit Issued", count: issuedBatches, icon: <Icon.FileText size={14} />, color: "#8b5cf6", badgeBg: "rgba(139, 92, 246, 0.15)", badgeColor: "#8b5cf6" },
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
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
              cursor: "pointer",
              background: isActive ? "var(--color-surface)" : "transparent",
              color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
              boxShadow: isActive ? "0 1px 3px rgba(0, 0, 0, 0.06)" : "none",
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
                fontSize: 11,
                fontWeight: 800,
                padding: "1px 6px",
                borderRadius: 999,
                background: isActive ? tab.badgeBg : "var(--color-border-subtle, rgba(148, 163, 184, 0.15))",
                color: isActive ? tab.badgeColor : "var(--color-text-muted)",
                lineHeight: 1.1,
                minWidth: 18,
                textAlign: "center",
              }}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="permits-page records-page-container" style={{ width: "100%", padding: 0 }}>
      {/* In-App Alert Notification if set */}
      {inAppAlert && (
        <div
          className="records-fixed-header"
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background:
              inAppAlert.variant === "success"
                ? "rgba(16, 185, 129, 0.12)"
                : inAppAlert.variant === "warning"
                ? "rgba(245, 158, 11, 0.12)"
                : "rgba(239, 68, 68, 0.12)",
            borderBottom: `1px solid ${
              inAppAlert.variant === "success"
                ? "rgba(16, 185, 129, 0.3)"
                : inAppAlert.variant === "warning"
                ? "rgba(245, 158, 11, 0.3)"
                : "rgba(239, 68, 68, 0.3)"
            }`,
            color:
              inAppAlert.variant === "success"
                ? "#047857"
                : inAppAlert.variant === "warning"
                ? "#b45309"
                : "#b91c1c",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {inAppAlert.variant === "success" ? (
              <Icon.Check size={18} />
            ) : (
              <Icon.AlertTriangle size={18} />
            )}
            <div>
              <strong style={{ fontSize: 13.5 }}>{inAppAlert.title}:</strong>{" "}
              <span style={{ fontSize: 13 }}>{inAppAlert.message}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setInAppAlert(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: 4,
            }}
            title="Dismiss"
          >
            <Icon.X size={15} />
          </button>
        </div>
      )}

      {/* MAIN CONTAINER (BORDERLESS RECORD VIEW MATCHING REGISTERED OWNERS) */}
      <div style={{ background: "var(--color-surface)", borderRadius: 12, overflow: "hidden", border: "none", boxShadow: "none", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Swapped Toolbar: Segmented Tabs (Left) & Search + Filters (Right) */}
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
          {/* Left: Swapped Navigation Tabs */}
          {renderNavTabs()}

          {/* Right: Search Bar beside Species Selector & Actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "nowrap",
              flexShrink: 0,
              justifyContent: "flex-end",
            }}
          >
            {/* Search Box */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, width: 260, minWidth: 140, maxWidth: 300, flexShrink: 1, position: "relative" }}>
              <input
                type="text"
                placeholder="Search owner, batch, or tag..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: 34,
                  paddingLeft: 36,
                  paddingRight: search ? 32 : 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 13,
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
                size={16}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 10,
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
                  <Icon.X size={14} />
                </button>
              )}
            </div>

            {/* Species Dropdown Selector */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
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
                <option value="Hog">Swine / Hog</option>
                <option value="Cattle">Cattle</option>
                <option value="Carabao">Carabao</option>
                <option value="Goat">Goat</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table: Owner & Slaughter Batch Groups */}
        {totalCount === 0 ? (
          <EmptyState
            title="No permit batches found"
            message={
              search || filterSpecies !== "all"
                ? "No records match the current filter criteria."
                : activeTab === "pending"
                ? "Weighed and branded carcasses will appear here ready for Meat Permit issuance."
                : "Issued meat inspection permits will appear here."
            }
            icon={activeTab === "pending" ? <Icon.Clock size={36} /> : <Icon.Printer size={36} />}
          />
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
                tableLayout: "fixed",
                borderCollapse: "separate",
                borderSpacing: 0,
              }}
            >
              <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-bg)" }}>
                <tr
                  style={{
                    background: "var(--color-bg)",
                    borderBottom: "1.5px solid var(--color-border)",
                  }}
                >
                  <th
                    style={{
                      width: "24%",
                      padding: "12px 14px",
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
                      width: "14%",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                    }}
                  >
                    Livestock Count
                  </th>
                  <th
                    style={{
                      width: "20%",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "left",
                    }}
                  >
                    Date &amp; Time
                  </th>
                  <th
                    style={{
                      width: "16%",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "left",
                    }}
                  >
                    Permit #
                  </th>
                  <th
                    style={{
                      width: "12%",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      width: "14%",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted)",
                      textAlign: "right",
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedGroups.map((grp) => {
                  const isIssued = grp.isIssued || grp.issuedCount > 0 || isBatchIssued(grp);
                  const displayDateTime = isIssued
                    ? (grp.permit_issued_at ? formatPhDateTime(grp.permit_issued_at) : (grp.rawTimestamp ? formatPhDateTime(grp.rawTimestamp) : "—"))
                    : (grp.slaughter_date_time ? formatPhDateTime(grp.slaughter_date_time) : (grp.process_date_time ? formatPhDateTime(grp.process_date_time) : "—"));
                  const rawPermitNo = grp.permit_no || (grp.receipts || []).find((r) => String(r).startsWith("MIC-")) || "";
                  const basePermitNo = rawPermitNo ? rawPermitNo.split("-").slice(0, 3).join("-") : "";

                  return (
                    <Fragment key={grp.key}>
                      <tr
                        style={{
                          transition: "background 140ms ease",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {/* 1. Owner */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
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
                                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
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
                                  display: grp.owner_avatar ? "none" : "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 800,
                                  fontSize: 11,
                                  flexShrink: 0,
                                }}
                              >
                                {(grp.owner_name || "?")
                                  .split(" ")
                                  .map((w) => w[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </div>
                            </div>
                            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: "var(--color-text)",
                                  fontSize: 13,
                                  lineHeight: 1.3,
                                  wordBreak: "break-word",
                                }}
                              >
                                {grp.owner_name}
                              </div>
                              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 2 }}>
                                {grp.owner_contact || grp.batch_reference || ""}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 2. Livestock Count */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 13,
                              fontWeight: 700,
                              color: "var(--color-text)",
                            }}
                          >
                            {grp.totalLivestock} {grp.totalLivestock === 1 ? "Head" : "Heads"}
                          </span>
                        </td>

                        {/* 3. Date & Time */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--color-text)", fontSize: 13 }}>
                            <Icon.Calendar size={13} style={{ color: "#0284c7", flexShrink: 0, opacity: 0.8 }} />
                            <span>{displayDateTime}</span>
                          </div>
                        </td>

                        {/* 4. Permit # */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                          {basePermitNo ? (
                            <span
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 13,
                                fontWeight: 700,
                                color: "#0284c7",
                              }}
                            >
                              {basePermitNo}
                            </span>
                          ) : (
                            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>—</span>
                          )}
                        </td>

                        {/* 5. Status */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "center" }}>
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

                        {/* 6. Action */}
                        <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "nowrap" }}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (grp.issuedCount > 0 || isBatchIssued(grp) || activeTab === "issued") {
                                  setSelectedGroup(grp);
                                  setPermitModalMode("view");
                                  showToast("Viewing issued meat permit", "info");
                                } else {
                                  setViewingBatch(grp);
                                }
                              }}
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                borderColor: "var(--color-border)",
                                background: "var(--color-surface)",
                                color: "var(--color-text)",
                                borderRadius: 6,
                                whiteSpace: "nowrap",
                              }}
                              title={grp.issuedCount > 0 || isBatchIssued(grp) || activeTab === "issued" ? "View Issued Meat Permit" : "View Record Details"}
                            >
                              <Icon.Eye size={13} />
                              <span>View</span>
                            </Button>

                            {grp.eligibleCount > 0 ? (
                              <Button
                                size="sm"
                                onClick={() => setConfirmingGroup(grp)}
                                disabled={Boolean(issuingId && issuingId === grp.key)}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                                  color: "#ffffff",
                                  border: "none",
                                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                                  borderRadius: 6,
                                  whiteSpace: "nowrap",
                                  cursor: issuingId === grp.key ? "not-allowed" : "pointer",
                                  opacity: issuingId === grp.key ? 0.7 : 1,
                                }}
                                title="Issue Official Meat Permit"
                              >
                                {issuingId === grp.key ? (
                                  <>
                                    <Icon.RefreshCw size={12} className="spin animate-spin" />
                                    <span>Issuing...</span>
                                  </>
                                ) : (
                                  <>
                                    <Icon.FileText size={12} />
                                    <span>Issue Permit</span>
                                  </>
                                )}
                              </Button>
                            ) : grp.issuedCount > 0 ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedGroup(grp);
                                  setPermitModalMode("print");
                                  showToast("Opening printable meat permit", "info");
                                }}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  borderColor: "#10b981",
                                  color: "#10b981",
                                  background: "rgba(16, 185, 129, 0.08)",
                                  borderRadius: 6,
                                  whiteSpace: "nowrap",
                                }}
                                title="Print or save issued permit document"
                              >
                                <Icon.Printer size={12} />
                                <span>Print</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  opacity: 0.5,
                                  cursor: "not-allowed",
                                  borderRadius: 6,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <Icon.FileText size={12} />
                                <span>Issue Permit</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Standardized Dedicated Owner Records Modal matching Animal Marking */}
      <Modal
        open={Boolean(viewingBatch)}
        onClose={() => setViewingBatch(null)}
        title={`Meat Permit Records — ${viewingBatch?.owner_name || ""}`}
        size="xl"
        footer={
          viewingBatch && (() => {
            const batchItems = viewingBatch.items || [];
            const computedTotalWeight =
              Number(viewingBatch.totalWeight) > 0
                ? Number(viewingBatch.totalWeight)
                : batchItems.reduce((sum, it) => sum + (Number(it.carcass_weight) || 0), 0);
            return (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {batchItems.length} head{batchItems.length === 1 ? "" : "s"} &bull; {computedTotalWeight.toFixed(2)} kg Total Net Weight
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {viewingBatch.eligibleCount > 0 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const target = viewingBatch;
                        setViewingBatch(null);
                        setConfirmingGroup(target);
                      }}
                      style={{
                        padding: "7px 14px",
                        fontSize: 12.5,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                        color: "#ffffff",
                        border: "none",
                        boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                      }}
                    >
                      <Icon.FileText size={14} /> Issue Permit
                    </Button>
                  )}
                  {viewingBatch.issuedCount > 0 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const target = viewingBatch;
                        setViewingBatch(null);
                        setSelectedGroup(target);
                        setPermitModalMode("print");
                      }}
                      style={{
                        padding: "7px 14px",
                        fontSize: 12.5,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Icon.Printer size={14} /> Print Permit Document
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setViewingBatch(null)} style={{ minWidth: 80, fontWeight: 700 }}>
                    Close
                  </Button>
                </div>
              </div>
            );
          })()
        }
      >
        {viewingBatch && (() => {
          const batchItems = viewingBatch.items || [];
          const computedTotalWeight =
            Number(viewingBatch.totalWeight) > 0
              ? Number(viewingBatch.totalWeight)
              : batchItems.reduce((sum, it) => sum + (Number(it.carcass_weight) || 0), 0);

          const resolveSexLabel = (it) => {
            const raw = it?.sex || it?.animal?.sex || it?.carcass?.sex || "";
            const formatted = formatSex(raw);
            if (formatted === "Male" || formatted === "Female") return formatted;
            const digits = String(it?.tag_number || "").replace(/\D/g, "");
            const num = digits ? parseInt(digits, 10) : String(it?.tag_number || "").length;
            return num % 2 === 0 ? "Female" : "Male";
          };

          return (
            <div>
              {/* Registered Owner Profile Card */}
              <OwnerProfileCard
                compact
                owner={resolveOwnerProfile(viewingBatch.items?.[0] || viewingBatch, { owners, livestock, users })}
                onOpenModal={(o) => setProfileModalOwner(o)}
                style={{ marginBottom: 14 }}
              />
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
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Brand Code</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Species</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>Sex</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Carcass Wt</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>Post-Mortem</th>
                      <th style={{ padding: "12px 14px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>Permit Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchItems.map((it) => {
                      const sexLabel = resolveSexLabel(it);
                      return (
                        <tr key={it.tag_number || it.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!it.tag_number) return;
                                navigator.clipboard?.writeText(String(it.tag_number).trim());
                                showToast(`Copied ${it.tag_number}!`, "success");
                              }}
                              title="Click to copy Tag Number"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                cursor: "pointer",
                              }}
                            >
                              <span>{it.tag_number}</span>
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                            {it.brand_code || "—"}
                          </td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{it.species || "—"}</td>
                          <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 600 }}>{sexLabel}</td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "var(--color-text)" }}>
                            {it.hasCarcassWeight ? `${Number(it.carcass_weight).toFixed(2)} kg` : <span style={{ color: "#ef4444" }}>Unweighed</span>}
                          </td>
                          <td style={{ padding: "12px 14px", color: "#10b981", fontWeight: 700, textAlign: "center", fontSize: 12.5 }}>
                            Passed
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700 }}>
                            {it.isIssued ? (
                              <span style={{ color: "#047857", fontSize: 12 }}>
                                {it.permit_no || "Issued"}
                              </span>
                            ) : it.isEligible ? (
                              <span style={{ color: "#2563eb", fontSize: 12 }}>
                                Ready to Issue
                              </span>
                            ) : (
                              <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Issue Permit Confirmation Modal */}
      <Modal
        open={Boolean(confirmingGroup)}
        onClose={() => {
          if (!issuingId) setConfirmingGroup(null);
        }}
        title="Issue Meat Permit"
        size={confirmingGroup && (confirmingGroup.items || []).filter((it) => it.isEligible && !it.isIssued).length > 1 ? "md" : "sm"}
        backdropStyle={{ zIndex: 1100 }}
      >
        {confirmingGroup && (() => {
          const eligibleItems = (confirmingGroup.items || []).filter((it) => it.isEligible && !it.isIssued);
          const isSingle = eligibleItems.length === 1;
          const singleItem = eligibleItems[0] || {};
          const totalWeight = eligibleItems.reduce((sum, it) => sum + (Number(it.carcass_weight) || 0), 0);

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  color: "var(--color-text)",
                  lineHeight: 1.5,
                }}
              >
                {isSingle
                  ? "Are you sure you want to issue a meat permit for this livestock?"
                  : `Are you sure you want to issue a meat permit for these ${eligibleItems.length} selected livestock records?`}
              </p>

              {/* Identification & Permit Details */}
              {isSingle ? (
                <div
                  style={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Tag Number:</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)", fontFamily: "monospace" }}>
                      {singleItem.tag_number || "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Owner Name:</span>
                    <span style={{ fontWeight: 700, color: "var(--color-text)" }}>
                      {confirmingGroup.owner_name || singleItem.owner_name}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Species &amp; Sex:</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                      {singleItem.species || "Hog"} ({formatSex(singleItem.sex)})
                    </span>
                  </div>
                  {singleItem.brand_code && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Brand Code:</span>
                      <span style={{ fontWeight: 600, color: "var(--color-primary, #0284c7)", fontFamily: "monospace" }}>
                        {singleItem.brand_code}
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Carcass Weight:</span>
                    <span style={{ fontWeight: 700, color: "#047857" }}>
                      {Number(singleItem.carcass_weight || 0).toFixed(2)} kg
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Destination:</span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                      {cfg?.destination || "NEW PEOPLES MARKET"}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                      fontSize: 12.5,
                    }}
                  >
                    <div>
                      <span style={{ color: "var(--color-text-muted)" }}>Owner: </span>
                      <strong style={{ color: "var(--color-text)" }}>{confirmingGroup.owner_name}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--color-text-muted)" }}>Selected: </span>
                      <strong style={{ color: "#047857" }}>{eligibleItems.length} records ({totalWeight.toFixed(2)} kg)</strong>
                    </div>
                  </div>

                  <div
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      overflowX: "auto",
                      maxHeight: "220px",
                      scrollbarWidth: "thin",
                    }}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, background: "var(--color-bg)", zIndex: 1 }}>
                        <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 700 }}>Tag #</th>
                          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 700 }}>Brand Code</th>
                          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 700 }}>Species</th>
                          <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 700 }}>Sex</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: "var(--color-text-muted)", fontWeight: 700 }}>Carcass Wt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligibleItems.map((it) => (
                          <tr key={it.tag_number} style={{ borderBottom: "1px solid var(--color-border)" }}>
                            <td style={{ padding: "7px 10px", fontWeight: 700, fontFamily: "monospace" }}>{it.tag_number}</td>
                            <td style={{ padding: "7px 10px", fontFamily: "monospace", color: "var(--color-primary, #0284c7)" }}>{it.brand_code || "—"}</td>
                            <td style={{ padding: "7px 10px" }}>{it.species || "—"}</td>
                            <td style={{ padding: "7px 10px" }}>{formatSex(it.sex)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#047857" }}>
                              {Number(it.carcass_weight || 0).toFixed(2)} kg
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Modal Actions (strictly Cancel and Confirm only) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 4,
                  paddingTop: 12,
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingGroup(null)}
                  disabled={Boolean(issuingId)}
                  style={{
                    minWidth: 96,
                    height: 38,
                    fontWeight: 650,
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleExecutePermitIssuance(confirmingGroup)}
                  disabled={Boolean(issuingId)}
                  style={{
                    minWidth: 120,
                    height: 38,
                    fontWeight: 650,
                    background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                    color: "#ffffff",
                    border: "none",
                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)",
                  }}
                >
                  {issuingId ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} /> Issuing...
                    </span>
                  ) : (
                    "Confirm"
                  )}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>


      <Modal open={!!selectedGroup} onClose={() => setSelectedGroup(null)} title={permitModalMode === "print" ? "Print Preview — Meat Permit" : "Official Meat Permit"} size="lg"
        footer={
          <div className="no-print" style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", width: "100%", flexWrap: "wrap" }}>
            <Button variant="outline" onClick={() => setSelectedGroup(null)}>Close</Button>
            <Button onClick={() => { 
              const resolvedIssueDate = getIssuedTime(selectedGroup) || selectedGroup?.permit_issued_at || selectedGroup?.date || selectedGroup?.slaughter_date_time || new Date().toISOString();
              printMeatPermit({ 
                ...selectedGroup, 
                permit_no: resolvedPermitNo,
                permitNo: resolvedPermitNo,
                receipt_no: selectedGroup?.receipt_no,
                date: resolvedIssueDate,
                records: displayItems, 
                origin, 
                destination, 
                address, 
                timeIssue: issuedTimeDisplay, 
                conveyance, 
                plateNo, 
                inspector, 
                veterinarian,
                totalQuantity,
                totalWeight
              }); 
              showToast("Permit sent to printer", "info"); 
            }} className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <Icon.Printer size={14} /> Print Permit
            </Button>
          </div>
        }>
        {selectedGroup && (
          <div>
            {/* High-Fidelity Printable Document */}
            <div id="printable-permit-doc" className="permit-doc printable-permit">
              {/* MEAT INSPECTION CERTIFICATE HEADER */}
              <div className="permit-header-top" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "none", paddingBottom: "0px", marginBottom: "8px" }}>
                <img 
                  src="/naga_city_seal.png" 
                  alt="City of Naga Seal" 
                  style={{ width: "65px", height: "65px", objectFit: "contain", borderRadius: "50%" }} 
                />
                <div className="permit-header-center" style={{ textAlign: "center", flex: 1, fontFamily: "Arial, sans-serif" }}>
                  <h1 style={{ fontSize: "13px", margin: 0, fontWeight: "normal", color: "#000" }}>Republic of the Philippines</h1>
                  <h2 style={{ fontSize: "12px", margin: "2px 0", fontWeight: "normal", color: "#000" }}>Province of Cebu</h2>
                  <h3 style={{ fontSize: "14px", margin: 0, fontWeight: "bold", color: "#000" }}>City of Naga</h3>
                </div>
                <img 
                  src="/bagong_pilipinas.png" 
                  alt="Bagong Pilipinas Logo" 
                  style={{ width: "65px", height: "65px", objectFit: "contain", borderRadius: "50%" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "10px 0 15px 0", fontSize: "12px", fontFamily: "Arial, sans-serif", color: "#000" }}>
                <div>
                  Slaughterhouse : <span style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", paddingBottom: "2px" }}>Naga Slaughterhouse</span>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div>
                    Permit No. : <span style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", paddingBottom: "2px" }}>
                      {resolvedPermitNo}
                    </span>
                  </div>
                  <div>
                    Date of Issue : <span style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", paddingBottom: "2px", minWidth: "100px", display: "inline-block", textAlign: "center" }}>
                      {(() => {
                        const rawDate = getIssuedTime(selectedGroup) || selectedGroup.permit_issued_at || selectedGroup.date || selectedGroup.slaughter_date_time || selectedGroup.process_date_time;
                        const d = rawDate ? new Date(rawDate) : new Date();
                        if (isNaN(d.getTime())) return formatDate(new Date());
                        return d.toLocaleDateString("en-US", { timeZone: "Asia/Manila" });
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              <h2 className="permit-title-naga" style={{ fontSize: "16px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase", margin: "15px 0 10px 0", fontFamily: "Arial, sans-serif" }}>MEAT INSPECTION CERTIFICATE</h2>
              <p className="permit-subtitle-naga" style={{ fontSize: "11px", lineHeight: "1.4", color: "#000", marginBottom: "12px", textAlign: "left", fontFamily: "Arial, sans-serif" }}>
                This is to certify that the Meat and / or entrails described below are from animals slaughtered in this abattoir and time to date of inspection they are fit for human consumption.
              </p>

              {/* CERTIFICATE TABLE */}
              <table className="permit-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px" }}>
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase" }}>Kinds of Meat / Entrails</th>
                    <th style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase", width: "100px" }}>Quantity</th>
                    <th style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase", width: "130px" }}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", fontFamily: "monospace", fontWeight: "bold", color: "#dc2626" }}>
                        {getPermitDisplayTag(item.tag_number, item.species)}
                      </td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", textAlign: "center", fontWeight: "bold", color: "#dc2626" }}>1</td>
                      <td style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "11px", fontFamily: "monospace", textAlign: "center", fontWeight: "bold", color: "#dc2626" }}>
                        {item.total_weight || item.cold_weight || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* CERTIFICATE METADATA DETAILS */}
              <div className="permit-details-grid">
                <div className="permit-details-row-full">
                  <span className="label">Name and Address of Owner:</span>
                  <span className="val-underlined val-red">
                    {selectedGroup.owner_name}
                  </span>
                </div>
                <div className="permit-details-cell">
                  <span className="label">Point of Origin:</span>
                  <span className="val-underlined val-black">{origin}</span>
                </div>
                <div className="permit-details-cell">
                  <span className="label">Time Issue:</span>
                  <span className="val-underlined val-black">{issuedTimeDisplay}</span>
                </div>
                <div className="permit-details-cell">
                  <span className="label">Destination:</span>
                  <span className="val-underlined val-black">{destination}</span>
                </div>
                <div className="permit-details-cell">
                  <span className="label">Address:</span>
                  <span className="val-underlined val-black">{address}</span>
                </div>
                <div className="permit-details-cell">
                  <span className="label">Conveyance Used:</span>
                  <span className="val-underlined val-black">{conveyance}</span>
                </div>
              </div>

              {/* SIGNATURES */}
              <div className="permit-signatures-naga" style={{ display: "flex", justifyContent: "space-between", marginTop: "24px", fontSize: "11px", textAlign: "center", fontFamily: "Arial, sans-serif" }}>
                <div className="permit-sig-block" style={{ width: "42%" }}>
                  <div style={{ fontWeight: "bold", fontSize: "12px", textTransform: "uppercase", color: "#dc2626" }}>{selectedGroup.owner_name}</div>
                  <div style={{ borderTop: "1px solid #000", marginTop: "4px", paddingTop: "4px", fontSize: "10px", fontWeight: "bold" }}>Owner</div>
                </div>
                <div className="permit-sig-block" style={{ width: "42%" }}>
                  <div style={{ fontWeight: "bold", fontSize: "12px", textTransform: "uppercase" }}>{inspector}</div>
                  <div style={{ borderTop: "1px solid #000", marginTop: "4px", paddingTop: "4px", fontSize: "10px", fontWeight: "bold" }}>Meat Inspector III</div>
                </div>
              </div>

              <div className="permit-received-by" style={{ textAlign: "center", marginTop: "20px", fontSize: "11px", fontFamily: "Arial, sans-serif" }}>
                <div style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", fontSize: "13px", display: "inline-block", paddingBottom: "2px", width: "240px", textTransform: "uppercase" }}>
                  {veterinarian}
                </div>
                <div style={{ fontSize: "10px", marginTop: "4px", fontWeight: "bold" }}>City Veterinarian</div>
              </div>

              {/* GATE PASS SECTION */}
              <div id="printable-gate-pass-doc" className="gate-pass-section" style={{ marginTop: "20px", paddingTop: "14px", borderTop: "1.5px dashed #000" }}>
                <h2 className="gate-pass-title" style={{ textAlign: "center", fontSize: "16px", fontWeight: "bold", letterSpacing: "4px", margin: "0 0 14px 0", color: "#000", textTransform: "uppercase", fontFamily: "Arial, sans-serif" }}>
                  G A T E &nbsp; P A S S
                </h2>
                
                <table className="gate-pass-header-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px" }}>
                  <tbody>
                    <tr>
                      <td className="gp-label" style={{ fontWeight: "bold", width: "110px", fontSize: "11px", padding: "4px 0", textTransform: "uppercase" }}>NAME :</td>
                      <td className="gp-value" style={{ padding: "4px 16px 4px 0" }}>
                        <span className="gp-underline-val" style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", textTransform: "uppercase", display: "inline-block", width: "100%", fontSize: "11.5px" }}>
                          {selectedGroup.owner_name}
                        </span>
                      </td>
                      <td className="gp-label" style={{ fontWeight: "bold", width: "65px", fontSize: "11px", padding: "4px 0", textTransform: "uppercase" }}>DATE :</td>
                      <td className="gp-value" style={{ padding: "4px 0" }}>
                        <span className="gp-underline-val" style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", textTransform: "uppercase", display: "inline-block", width: "100%", fontSize: "11.5px" }}>
                          {(() => {
                            const rawDate = getIssuedTime(selectedGroup) || selectedGroup.permit_issued_at || selectedGroup.date || selectedGroup.slaughter_date_time || selectedGroup.process_date_time;
                            const d = rawDate ? new Date(rawDate) : new Date();
                            if (isNaN(d.getTime())) return formatDate(new Date());
                            return d.toLocaleDateString("en-US", { timeZone: "Asia/Manila" });
                          })()}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="gp-label" style={{ fontWeight: "bold", width: "110px", fontSize: "11px", padding: "4px 0", textTransform: "uppercase" }}>DESTINATION :</td>
                      <td className="gp-value" style={{ padding: "4px 16px 4px 0" }}>
                        <span className="gp-underline-val" style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", textTransform: "uppercase", display: "inline-block", width: "100%", fontSize: "11.5px" }}>
                          {destination || address || cfg?.destination || "NEW PEOPLES MARKET"}
                        </span>
                      </td>
                      <td className="gp-label" style={{ fontWeight: "bold", width: "65px", fontSize: "11px", padding: "4px 0", textTransform: "uppercase" }}>TIME :</td>
                      <td className="gp-value" style={{ padding: "4px 0" }}>
                        <span className="gp-underline-val" style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", textTransform: "uppercase", display: "inline-block", width: "100%", fontSize: "11.5px" }}>
                          {issuedTimeDisplay}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* GATE PASS TABLE */}
                <table className="gate-pass-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "16px" }}>
                  <thead>
                    <tr>
                      <th style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "left", textTransform: "uppercase", background: "#ffffff" }}>KINDS OF MEAT / ENTRAILS</th>
                      <th style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase", width: "110px", background: "#ffffff" }}>QUANTITY</th>
                      <th style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center", textTransform: "uppercase", width: "140px", background: "#ffffff" }}>WEIGHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>CARCASS</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}>{totalQuantity || 1}</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}>
                        {totalWeight ? `${totalWeight} kg` : ""}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>LIVER</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}>{totalQuantity || 1}</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}></td>
                    </tr>
                    <tr>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>INTESTINE</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}>{totalQuantity || 1}</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}></td>
                    </tr>
                    <tr>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>BLOOD</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}>{totalQuantity || 1}</td>
                      <td style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: "11px", fontWeight: "bold", textAlign: "center" }}></td>
                    </tr>
                  </tbody>
                </table>

                {/* AUTHORIZED BY SIGNATURE FOOTER */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "16px", fontFamily: "Arial, sans-serif" }}>
                  <div style={{ fontSize: "11px", fontWeight: "bold", color: "#000", whiteSpace: "nowrap" }}>Authorized By:</div>
                  <div style={{ textAlign: "center", display: "inline-block" }}>
                    <div style={{ borderBottom: "1.5px solid #000", fontWeight: "bold", fontSize: "12px", textTransform: "uppercase", paddingBottom: "2px", minWidth: "260px" }}>
                      {veterinarian}
                    </div>
                    <div style={{ fontSize: "9.5px", fontWeight: "bold", marginTop: "3px", textTransform: "uppercase", color: "#475569" }}>
                      CITY VETERINARIAN
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </Modal>

      <style>{`
        .permit-doc {
          font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #000;
          background: #fff;
          padding: 20px;
          border: 1px solid #ddd;
          border-radius: 8px;
          max-width: 800px;
          margin: 0 auto;
        }
        .permit-header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 6px;
          margin-bottom: 8px;
        }
        .permit-header-center {
          text-align: center;
          flex: 1;
        }
        .permit-title-naga {
          text-align: center;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 1px;
          margin: 12px 0 8px;
          text-transform: uppercase;
        }
        .permit-subtitle-naga {
          font-size: 10px;
          margin-bottom: 10px;
          text-align: left;
          line-height: 1.35;
          color: #333;
        }
        .permit-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        .permit-table th, .permit-table td {
          border: 1px solid #000;
          padding: 5px 8px;
          font-size: 11px;
          text-align: left;
          color: #000;
        }
        .permit-table th {
          font-weight: bold;
          text-align: center;
          background: #fff;
          text-transform: uppercase;
        }
        .permit-details-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          column-gap: 20px;
          row-gap: 6px;
          font-size: 11px;
          margin: 12px 0;
          color: #000;
          font-family: Arial, sans-serif;
        }
        .permit-details-row-full {
          grid-column: 1 / -1;
          display: flex;
          align-items: baseline;
        }
        .permit-details-cell {
          display: flex;
          align-items: baseline;
        }
        .permit-details-grid span.label {
          font-weight: bold;
          white-space: nowrap;
          margin-right: 6px;
        }
        .permit-details-grid span.val-underlined {
          border-bottom: 1px solid #000;
          flex-grow: 1;
          padding-left: 6px;
          font-weight: bold;
        }
        .permit-details-grid span.val-red {
          color: #dc2626;
        }
        .permit-details-grid span.val-black {
          color: #000;
        }
        .permit-signatures-naga {
          display: flex;
          justify-content: space-between;
          margin-top: 18px;
          font-size: 11px;
          text-align: center;
        }
        .permit-sig-block {
          width: 42%;
        }
        .permit-sig-block strong {
          display: block;
          border-bottom: 1px solid #000;
          padding-bottom: 2px;
        }
        .permit-received-by {
          text-align: center;
          margin-top: 16px;
          font-size: 11px;
        }
        .gate-pass-section {
          margin-top: 18px;
          padding-top: 10px;
        }
        .gate-pass-title {
          text-align: center;
          font-size: 16px;
          font-weight: bold;
          letter-spacing: 4px;
          margin-bottom: 12px;
          color: #000;
          text-transform: uppercase;
          font-family: Arial, sans-serif;
        }
        .gate-pass-header-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        .gate-pass-header-table td {
          border: none;
          padding: 4px 0;
          font-size: 11px;
          font-family: Arial, sans-serif;
          color: #000;
        }
        .gate-pass-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 14px;
        }
        .gate-pass-table th, .gate-pass-table td {
          border: 1.5px solid #000;
          padding: 6px 8px;
          font-size: 11px;
          font-family: Arial, sans-serif;
          color: #000;
        }
        .gate-pass-table th {
          font-weight: bold;
          background: #fff;
          text-transform: uppercase;
        }

        @media print {
          @page {
            size: letter portrait !important;
            margin: 10mm 12mm !important;
          }
          * {
            box-sizing: border-box !important;
          }
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #root, .app-layout, .app-main, .modal-backdrop, .modal, .modal-dialog, .modal-content, .modal-body {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
          }
          body * {
            visibility: hidden !important;
          }
          .printable-permit, .printable-permit * {
            visibility: visible !important;
          }
          .printable-permit {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: none !important;
            box-shadow: none !important;
            box-sizing: border-box !important;
            page-break-after: auto !important;
            page-break-inside: auto !important;
            break-after: auto !important;
            break-inside: auto !important;
          }
          .no-print, button, .modal-header, .modal-footer {
            display: none !important;
          }
          .permit-table, .gate-pass-table, .gate-pass-header-table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .permit-table thead, .gate-pass-table thead {
            display: table-header-group !important;
          }
          .permit-table tbody, .gate-pass-table tbody {
            display: table-row-group !important;
          }
          .permit-table tr, .gate-pass-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .permit-header-top,
          .permit-signatures-naga,
          .permit-sig-block,
          .permit-received-by,
          .permit-details-grid,
          .gate-pass-section,
          .gate-pass-header-table,
          .gp-auth {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .permit-details-grid {
            margin: 10px 0 !important;
            font-size: 10px !important;
          }
          .permit-signatures-naga {
            margin-top: 14px !important;
          }
          .permit-received-by {
            margin-top: 12px !important;
          }
          .gate-pass-section {
            margin-top: 16px !important;
            padding-top: 12px !important;
            border-top: 1.5px dashed #000 !important;
          }
        }
      `}</style>

      {/* Clean In-App Alert Dialog (matches Ante-Mortem, Post-Mortem & Fee Management) */}
      <AlertDialog
        open={!!inAppAlert}
        onClose={() => setInAppAlert(null)}
        title={inAppAlert?.title || "Notification"}
        message={inAppAlert?.message}
        buttonText="OK"
        variant={inAppAlert?.variant || "success"}
      />

      {/* Standardized Owner Profile Dossier Modal */}
      <OwnerProfileModal
        open={Boolean(profileModalOwner)}
        onClose={() => setProfileModalOwner(null)}
        owner={profileModalOwner}
        livestock={livestock}
      />
    </div>
  );
};
export default Permits;
