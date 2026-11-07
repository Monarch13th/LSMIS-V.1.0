// Additional Vet module pages
import { ModulePage } from "../../components/ModulePage";
import { RoleReportsModule } from "../../components/reports/RoleReportsModule";
import { Card, PageHeader, Button, Input, Select, Textarea, Modal, ConfirmDialog, AlertDialog, Badge, StatCard, EmptyState, Pagination } from "../../components/ui";
import { TagBadge } from "../../components/ui/TagBadge";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/notifications/Toast";
import { useSupabase } from "../../hooks/useSupabase";
import { useAuth } from "../../hooks/useAuth";
import { TABLES } from "../../utils/constants";
import { formatDate, formatPhDateTime, formatCertDateTime, formatSex } from "../../utils/formatters";
import { today, initials } from "../../utils/helpers";
import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import { vetService } from "../../services/vetService";
import { InspectionForm, CONDEMNED_PARTS_LIST, CONDEMNED_REASONS_LIST, CARCASS_AREAS, SPECIFIC_PARTS_BY_AREA } from "../../components/forms/InspectionForm";
import {
  getCondemnationStage,
  matchesStage,
  isAnteCondemnedStatus,
  isPostCondemnedStatus,
  isPostWholeDecision,
  isPostPartialInspection,
  isAnteCondemnedDecision,
  getPostOutcome,
  evidenceMatchesStage,
  cleanTag as tagKey,
} from "./condemnationStage";
import {
  useCondemnationEvidenceIndex,
  getEvidenceScope as getEvidenceScopeFor,
  getEvidencePartLabel as getEvidencePartLabelFor,
  getEvidenceSpecies as getEvidenceSpeciesFor,
} from "./condemnationEvidenceIndex";
import {
  collectCondemnationEvidencePhotos,
  resolveEvidencePhotoUrl,
} from "./condemnationEvidencePhotos";
import { ProcessHistoryTimeline } from "../../components/common/ProcessHistoryTimeline";
import { getCurrentActor } from "../../utils/processHistory";

/* ---------- Ante-mortem records & inspection history ---------- */
export const AnteMortemRecords = () => null;

export const AnimalInspectionHistory = () => {
  const { data: livestock = [] } = useSupabase(TABLES.LIVESTOCK);
  const { data: owners = [] } = useSupabase(TABLES.OWNERS);
  const { data: anteMortem = [] } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: postMortem = [] } = useSupabase(TABLES.POST_MORTEM);
  const { data: diseases = [] } = useSupabase("diseases");
  const { data: carcass = [] } = useSupabase(TABLES.CARCASS);
  const { data: condemnedRecords = [] } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const [search, setSearch] = useState("");
  const [filterSpecies, setFilterSpecies] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expandedTag, setExpandedTag] = useState(null);

  // Build enriched animal records
  const animals = livestock.map((l) => {
    const ante = anteMortem.filter((a) => (a.livestock_id && a.livestock_id === l.id) || (a.tag_number === l.tag_number && (!a.livestock_id || l.status !== "Pending")));
    const post = postMortem.filter((p) => p.tag_number === l.tag_number);
    const dis  = diseases.filter((d) => d.tag_number === l.tag_number);
    const car  = carcass.find((c) => c.tag_number === l.tag_number);
    const lastAnte = ante.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const overallStatus = dis.some((d) => d.status === "Active") ? "Disease"
      : lastAnte?.decision === "Rejected" ? "Unfit"
      : l.status === "Rejected" ? "Unfit"
      : "Healthy";
    return { ...l, ante, post, dis, car, overallStatus };
  });

  const filtered = animals.filter((a) => {
    const q = search.trim().toLowerCase();
    const resolvedOwner = (a.owner_name || (owners.find((o) => o.id === a.owner_id)?.name) || "").toLowerCase();
    const rawOwner = (a.owner_name || "").toLowerCase();
    const breed = (a.breed || "").toLowerCase();
    const markingCode = (a.marking_code || "").toLowerCase();
    const id = String(a.id || "").toLowerCase();
    const matchQ =
      !q ||
      (a.tag_number || "").toLowerCase().includes(q) ||
      resolvedOwner.includes(q) ||
      rawOwner.includes(q) ||
      (a.species || "").toLowerCase().includes(q) ||
      breed.includes(q) ||
      markingCode.includes(q) ||
      id.includes(q);
    const matchSp = !filterSpecies || a.species === filterSpecies;
    const matchSt = !filterStatus || a.overallStatus === filterStatus;
    return matchQ && matchSp && matchSt;
  });

  const healthy  = animals.filter((a) => a.overallStatus === "Healthy").length;
  const { condemned, partiallyCondemned } = useMemo(() => {
    const whole = new Set();
    const ante = new Set();
    const partial = new Set();
    const addTag = (set, tag) => { const k = tagKey(tag); if (k) set.add(k); };
    (condemnedRecords || []).forEach((r) => {
      const part = String(r.part || "").toLowerCase();
      if (part.includes("whole") || part.includes("entire")) addTag(whole, r.tag_number);
      else if (part.includes("live animal")) addTag(ante, r.tag_number);
      else if (part) addTag(partial, r.tag_number);
    });
    (anteMortem || []).forEach((a) => { if (isAnteCondemnedDecision(a.decision)) addTag(ante, a.tag_number); });
    (livestock || []).forEach((l) => { if (isAnteCondemnedStatus(l.status)) addTag(ante, l.tag_number); });
    (postMortem || []).forEach((p) => {
      if (isPostWholeDecision(p.decision)) addTag(whole, p.tag_number);
      else if (isPostPartialInspection(p)) addTag(partial, p.tag_number);
    });
    whole.forEach((t) => partial.delete(t));
    ante.forEach((t) => partial.delete(t));
    return { condemned: new Set([...ante, ...whole]).size, partiallyCondemned: partial.size };
  }, [condemnedRecords, anteMortem, livestock, postMortem]);
  const speciesList = [...new Set(livestock.map((l) => l.species).filter(Boolean))];

  const statusColor = (s) => s === "Healthy" ? "#10b981" : s === "Disease" ? "#f59e0b" : "#ef4444";
  const statusBg    = (s) => s === "Healthy" ? "rgba(16,185,129,0.1)" : s === "Disease" ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)";
  const decisionBadge = (d) => (
    <span style={{ fontSize: 12, fontWeight: 600,
      color: d === "Approved" ? "#10b981" : "#ef4444" }}>{d}</span>
  );

  const TimelineEvent = ({ icon, title, detail, date, color, badge }) => (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
          {badge}
        </div>
        {detail && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{detail}</div>}
      </div>
      {date && <div style={{ fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{new Date(date).toLocaleDateString()}</div>}
    </div>
  );

  return (
    <div style={{ padding: "0 0 32px" }}>
      {/* Header */}
      <PageHeader title="Inspection History" subtitle="Inspection records and timeline per animal" icon={<Icon.ClipboardCheck />} />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Animals", value: animals.length, color: "#6366f1", icon: <Icon.Users /> },
          { label: "Healthy", value: healthy, color: "#10b981", icon: <Icon.Check /> },
          { label: "Condemned", value: condemned, color: "#ef4444", icon: <Icon.X /> },
          { label: "Partially Condemned", value: partiallyCondemned, color: "#f59e0b", icon: <Icon.AlertTriangle /> },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${s.color}18`, display: "flex", alignItems: "center", justifyContent: "center", color: s.color, fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tag, owner, species…"
            style={{ width: "100%", paddingLeft: 36, paddingRight: 12, height: 38, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)", color: "var(--color-text)", fontSize: 13, boxSizing: "border-box", outline: "none" }}
          />
          <Icon.Search
            size={16}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-text-muted, #94a3b8)",
              pointerEvents: "none",
              zIndex: 10
            }}
          />
        </div>
        <select value={filterSpecies} onChange={(e) => setFilterSpecies(e.target.value)}
          style={{ height: 38, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)", color: "var(--color-text)", fontSize: 13, padding: "0 12px", cursor: "pointer" }}>
          <option value="">All Species</option>
          {speciesList.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          style={{ height: 38, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)", color: "var(--color-text)", fontSize: 13, padding: "0 12px", cursor: "pointer" }}>
          <option value="">All Statuses</option>
          <option>Healthy</option>
          <option>Unfit</option>
          <option>Disease</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)", marginLeft: "auto" }}>{filtered.length} animal{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Animal Cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🐾</div>
          <div style={{ fontSize: 15 }}>No animals found</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((a) => {
            const isOpen = expandedTag === a.tag_number;
            const totalEvents = a.ante.length + a.post.length + a.dis.length + (a.car ? 1 : 0);
            return (
              <div key={a.tag_number} style={{ background: "var(--color-surface)", border: `1px solid var(--color-border)`, borderRadius: 14, overflow: "hidden", transition: "box-shadow 0.2s", boxShadow: isOpen ? "0 4px 24px rgba(0,0,0,0.12)" : "none" }}>
                {/* Card Header */}
                <button onClick={() => setExpandedTag(isOpen ? null : a.tag_number)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  {/* Status dot */}
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: statusColor(a.overallStatus), boxShadow: `0 0 0 3px ${statusBg(a.overallStatus)}`, flexShrink: 0 }} />

                  {/* Tag + species */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "var(--color-text)" }}>{a.tag_number}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-secondary)" }}>{a.species}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: statusColor(a.overallStatus) }}>{a.overallStatus}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                      <span>Owner: <strong style={{ color: "var(--color-text-secondary)" }}>{a.owner_name || "—"}</strong></span>
                      {a.sex && <span style={{ marginLeft: 12 }}>Sex: <strong style={{ color: "var(--color-text-secondary)" }}>{formatSex(a.sex)}</strong></span>}
                      {a.age_months && <span style={{ marginLeft: 12 }}>Age: {a.age_months}</span>}
                    </div>
                  </div>

                  {/* Event count + chevron */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{totalEvents} record{totalEvents !== 1 ? "s" : ""}</span>
                    <span style={{ color: "var(--color-text-muted)", transition: "transform 0.2s", display: "block", transform: isOpen ? "rotate(180deg)" : "none" }}><Icon.ChevronDown /></span>
                  </div>
                </button>

                {/* Expanded Timeline */}
                {isOpen && (
                  <div style={{ padding: "0 20px 20px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "16px 0 8px" }}>Inspection Timeline</div>

                    {totalEvents === 0 ? (
                      <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "12px 0" }}>No inspection records found for this animal.</div>
                    ) : (
                      <div>
                        {/* Ante-Mortem */}
                        {a.ante.map((ev, i) => (
                          <TimelineEvent key={`ante-${i}`}
                            icon={<Icon.Eye />} color="#6366f1"
                            title="Ante-Mortem Inspection"
                            detail={ev.findings || ev.notes || "—"}
                            date={ev.created_at}
                            badge={decisionBadge(ev.decision)}
                          />
                        ))}
                        {/* Post-Mortem */}
                        {a.post.map((ev, i) => (
                          <TimelineEvent key={`post-${i}`}
                            icon={<Icon.Layers />} color="#0ea5e9"
                            title="Carcass Post-Mortem Inspection"
                            detail={ev.findings || ev.notes || "—"}
                            date={ev.created_at}
                            badge={decisionBadge(ev.decision)}
                          />
                        ))}
                        {/* Disease */}
                        {a.dis.map((ev, i) => (
                          <TimelineEvent key={`dis-${i}`}
                            icon={<Icon.AlertTriangle />} color="#f59e0b"
                            title={`Disease: ${ev.disease || "Unknown"}`}
                            detail={`Severity: ${ev.severity || "—"} · Status: ${ev.status || "—"}`}
                            date={ev.created_at}
                            badge={<span style={{ fontSize: 12, fontWeight: 600,
                              color: ev.status === "Active" ? "#ef4444" : ev.status === "Monitoring" ? "#f59e0b" : "#10b981" }}>{ev.status}</span>}
                          />
                        ))}
                        {/* Carcass */}
                        {a.car && (
                          <TimelineEvent
                            icon={<Icon.Scale />} color="#10b981"
                            title="Carcass Weight Recorded"
                            detail={`Total: ${a.car.total_weight ?? "—"} kg · Dressed: ${a.car.dressed_weight ?? "—"} kg · Grade: ${a.car.quality_grade || "—"}`}
                            date={a.car.created_at}
                            badge={decisionBadge(a.car.decision || "Approved")}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const AnimalHealthHistory = AnimalInspectionHistory;


/* ---------- Post-mortem: carcass, organ, records ---------- */
export const CarcassInspection = () => {
  const { data: post, refresh } = useSupabase(TABLES.POST_MORTEM);
  const { data: livestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: processing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSuccessAlert, setModalSuccessAlert] = useState(null);
  const [inAppAlert, setInAppAlert] = useState(null);
  const { showToast } = useToast();

  const save = async (payload) => {
    try {
      const animal = livestock.find((l) => l.tag_number === payload.tag_number);
      await vetService.createInspection("Post-Mortem", { ...payload, livestock_id: animal?.id || "", species: animal?.species || "Unknown" });
      const successMsg = `Carcass inspection successfully recorded and certified for tag ${payload.tag_number || ""}!`;

      // Intercept success state: trigger clean in-app alert notification
      setInAppAlert({
        title: "Carcass Inspection Certified",
        message: successMsg,
      });

      // Trigger application alert notification (toast & in-modal alert)
      showToast(successMsg, "success");
      setModalSuccessAlert(successMsg);

      // Keep modal open: do NOT call setModalOpen(false)
      refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to record carcass inspection", "error");
    }
  };

  const eligibleAnimals = livestock.filter(
    (l) => processing.some((p) => p.tag_number === l.tag_number && p.status === "Completed") &&
           !post.some((i) => i.tag_number === l.tag_number)
  );

  return (
    <div>
      <ModulePage
        title="Carcass Inspection" subtitle="Inspect carcass condition and quality" icon={<Icon.Layers />}
        primaryAction={{
          label: "New Carcass Inspection",
          icon: <Icon.Plus />,
          onClick: () => {
            setModalSuccessAlert(null);
            setModalOpen(true);
          }
        }}
        stats={[
          { label: "Inspected", value: post.length, icon: <Icon.Layers />, color: "sky" },
          { label: "Passed", value: post.filter((i) => i.decision === "Approved").length, icon: <Icon.Check />, color: "emerald" },
        ]}
        columns={inspCols()} rows={post} searchKeys={["tag_number"]}
      />

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setModalSuccessAlert(null); }}
        title="New Carcass Inspection"
        size="lg"
        dialogStyle={{
          maxWidth: 820,
          width: "95vw",
          height: "82vh",
          maxHeight: 700,
          minHeight: 520,
          display: "flex",
          flexDirection: "column",
        }}
        headerStyle={{ padding: "14px 20px", flexWrap: "nowrap", gap: 12, flexShrink: 0 }}
        bodyStyle={{
          padding: "18px 20px 0 20px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
        hideCloseButton={true}
        alert={modalSuccessAlert}
      >
        <InspectionForm
          type="Post-Mortem"
          livestock={eligibleAnimals}
          onSubmit={save}
          onCancel={() => { setModalOpen(false); setModalSuccessAlert(null); }}
        />
      </Modal>

      {/* Clean In-App Alert Dialog (replaces native window.alert to provide polished in-app UX) */}
      <AlertDialog
        open={!!inAppAlert}
        onClose={() => setInAppAlert(null)}
        title={inAppAlert?.title || "Notification"}
        message={inAppAlert?.message}
        buttonText="OK"
        variant="success"
      />
    </div>
  );
};

export const OrganInspection = () => {
  const { data: organs, refresh } = useSupabase("organ_inspections");
  const { data: livestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: processing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const [modalOpen, setModalOpen] = useState(false);
  const { showToast } = useToast();
  const [selectedOwner, setSelectedOwner] = useState("");
  const [form, setForm] = useState({ organ: "Liver", finding: "", decision: "Approved" });

  const eligibleAnimals = livestock.filter((l) =>
    processing.some((p) => p.tag_number === l.tag_number && p.status === "Completed")
  );

  // Group eligible animals by owner
  const eligibleGroups = [];
  const ownerToTags = {};
  
  eligibleAnimals.forEach((l) => {
    const owner = l.owner_name || "Unknown Owner";
    if (!ownerToTags[owner]) {
      ownerToTags[owner] = [];
    }
    ownerToTags[owner].push(l.tag_number);
  });

  Object.entries(ownerToTags).forEach(([owner, tags]) => {
    eligibleGroups.push({
      owner_name: owner,
      tags,
      label: `${owner} (${tags.length} head${tags.length !== 1 ? "s" : ""})`
    });
  });
  eligibleGroups.sort((a, b) => (a.owner_name || "").localeCompare(b.owner_name || ""));

  const save = async (e) => {
    e.preventDefault();
    if (!selectedOwner || !form.finding) {
      showToast("Select owner and fill findings", "error");
      return;
    }
    const group = eligibleGroups.find(g => g.owner_name === selectedOwner);
    if (!group || !group.tags.length) {
      showToast("No eligible tags found", "error");
      return;
    }
    try {
      for (const tag of group.tags) {
        await vetService.createOrganInspection({
          tag_number: tag,
          organ: form.organ,
          finding: form.finding,
          decision: form.decision
        });
      }
      showToast("Organ inspection recorded", "success");
      setModalOpen(false);
      setForm({ organ: "Liver", finding: "", decision: "Approved" });
      setSelectedOwner("");
      refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to record organ inspection", "error");
    }
  };

  return (
    <div>
      <ModulePage
        title="Organ Inspection" subtitle="Detailed organ-by-organ examination" icon={<Icon.Heart />}
        primaryAction={{ label: "New Organ Inspection", icon: <Icon.Plus />, onClick: () => setModalOpen(true) }}
        columns={[
          { key: "id", label: "ID", mono: true },
          { key: "tag_number", label: "Tag #", bold: true },
          { key: "organ", label: "Organ" },
          { key: "finding", label: "Finding", truncate: true },
          { key: "decision", label: "Decision", badge: true },
        ]}
        rows={organs} searchKeys={["tag_number", "organ"]}
      />

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setSelectedOwner(""); }} title="New Organ Inspection">
        <form onSubmit={save}>
          <Select label="Select Owner / Animals" required value={selectedOwner} onChange={(e) => setSelectedOwner(e.target.value)}>
            <option value="">-- Select --</option>
            {eligibleGroups.map((g) => (
              <option key={g.owner_name} value={g.owner_name}>{g.label}</option>
            ))}
          </Select>

          <Select label="Organ" required value={form.organ} onChange={(e) => setForm({ ...form, organ: e.target.value })}>
            <option>Liver</option>
            <option>Lungs</option>
            <option>Heart</option>
            <option>Kidneys</option>
            <option>Spleen</option>
            <option>Intestines</option>
            <option>Other</option>
          </Select>

          <Input label="Finding" required placeholder="e.g. Normal, congestion, parasites..." value={form.finding} onChange={(e) => setForm({ ...form, finding: e.target.value })} />

          <Select label="Decision" value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })}>
            <option>Approved</option>
            <option>Rejected</option>
          </Select>

          <div className="form-actions">
            <Button type="button" variant="outline" onClick={() => { setModalOpen(false); setSelectedOwner(""); }}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export const PostMortemRecords = () => null;

/* ---------- Disease monitoring ---------- */
/* ---------- Disease monitoring ---------- */
export const DiseaseRecords = () => {
  const { data } = useSupabase("diseases");
  return (
    <ModulePage
      title="Disease Records" subtitle="Recorded diseases and conditions" icon={<Icon.Heart />}
      stats={[
        { label: "Active Cases", value: data.filter((d) => d.status === "Active").length, icon: <Icon.AlertTriangle />, color: "rose", filterKey: "status", filterValue: "Active", toastMsg: "Filtering by Active" },
        { label: "Monitoring", value: data.filter((d) => d.status === "Monitoring").length, icon: <Icon.Eye />, color: "amber", filterKey: "status", filterValue: "Monitoring", toastMsg: "Filtering by Monitoring" },
      ]}
      columns={diseaseCols()} rows={data} searchKeys={["tag_number", "disease"]}
      filters={[
        { key: "status", label: "All Statuses", options: [{ value: "Active", label: "Active" }, { value: "Monitoring", label: "Monitoring" }, { value: "Resolved", label: "Resolved" }] }
      ]}
    />
  );
};

export const DiseaseCases = () => {
  const { data, refresh } = useSupabase("diseases");
  const { data: livestock } = useSupabase(TABLES.LIVESTOCK);
  const [modalOpen, setModalOpen] = useState(false);
  const { showToast } = useToast();
  const [form, setForm] = useState({ tag_number: "", disease: "", severity: "Medium", status: "Active" });

  const save = async (e) => {
    e.preventDefault();
    if (!form.tag_number || !form.disease) {
      showToast("Fill in tag and disease name", "error");
      return;
    }
    try {
      const animal = livestock.find(l => l.tag_number === form.tag_number);
      await vetService.createDisease({
        ...form,
        livestock_id: animal?.id || "",
        species: animal?.species || "Unknown"
      });
      showToast("Disease case logged", "success");
      setModalOpen(false);
      setForm({ tag_number: "", disease: "", severity: "Medium", status: "Active" });
      refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to log disease", "error");
    }
  };

  return (
    <div>
      <ModulePage
        title="Disease Cases" subtitle="Open disease investigation cases" icon={<Icon.AlertTriangle />}
        primaryAction={{ label: "New Case", icon: <Icon.Plus />, onClick: () => setModalOpen(true) }}
        columns={diseaseCols()} rows={data} searchKeys={["tag_number", "disease"]}
        rowActions={() => [{ icon: <Icon.Eye />, title: "View Details", variant: "edit", toast: "Viewing details" }]}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Log New Disease Case">
        <form onSubmit={save}>
          <Select label="Select Animal Tag" required value={form.tag_number} onChange={(e) => setForm({ ...form, tag_number: e.target.value })}>
            <option value="">-- Choose animal --</option>
            {livestock.map((l) => (
              <option key={l.id} value={l.tag_number}>{l.tag_number} - {l.species}</option>
            ))}
          </Select>

          <Input label="Disease / Symptom" required placeholder="e.g. Pneumonia, Hog Cholera, Fever..." value={form.disease} onChange={(e) => setForm({ ...form, disease: e.target.value })} />

          <Select label="Severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </Select>

          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>Active</option>
            <option>Monitoring</option>
            <option>Resolved</option>
          </Select>

          <div className="form-actions">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">Log Case</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export const DiseaseReports = () => {
  const { data } = useSupabase("diseases");
  return (
    <ModulePage
      title="Disease Reports" subtitle="Disease surveillance summary" icon={<Icon.PieChart />}
      columns={diseaseCols()} rows={data} searchKeys={["disease"]}
    />
  );
};

const diseaseCols = () => [
  { key: "tag_number", label: "Tag #", mono: true, bold: true },
  { key: "species", label: "Species" },
  { key: "disease", label: "Disease" },
  { key: "severity", label: "Severity", render: (r) => <span className={`badge ${r.severity === "High" ? "badge-rejected" : r.severity === "Low" ? "badge-approved" : "badge-pending"}`}>{r.severity}</span> },
  { key: "date", label: "Date", render: (r) => formatDate(r.date) },
  { key: "status", label: "Status", badge: true },
];

/* ---------- Condemnation ---------- */
const CONDEMNATION_REASONS = [
  "Abnormal Appearance",
  "Wounds or Lesions",
  "Parasites",
  "Signs of Disease",
  "Other (Specify)",
];

const DISPOSAL_METHODS = ["Incineration", "Burying / Deep Pit", "Rendering", "Chemical Treatment", "Other"];

export const CONDEMNED_LOCATIONS = [
  "Thoracic Cavity",
  "Abdominal Cavity",
  "Pelvic Cavity",
  "Forequarter",
  "Hindquarter",
  "Head & Neck",
  "Visceral Organs",
  "General / Systemic",
  "Intake Holding Pen",
  "Other",
];

export const DISPOSITION_OPTIONS = [
  "Condemned / Rendered",
  "Denatured & Disposed per NMIS Guidelines",
  "Municipal Incinerator Pit",
  "Deep Burial with Lime",
  "Rejected / Sent Back to Source",
];

export const formatManilaDateTime = (val) => {
  if (!val) return "Not recorded";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "Not recorded";

  const isDateOnly = typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
  if (isDateOnly) {
    const [y, m, day] = val.trim().split("-").map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
    return dateObj.toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const resolveCondemningPersonnel = ({ record, livestock, inspection, cut, users = [] }) => {
  const isRealName = (name) => {
    if (!name || typeof name !== "string") return false;
    const n = name.trim();
    if (!n || n === "—" || n === "-" || n.toLowerCase() === "not recorded" || n.toLowerCase() === "unknown") return false;
    return true;
  };

  if (isRealName(record?.inspector)) return record.inspector.trim();

  const recUserId = record?.inspector_id || record?.created_by_user_id;
  if (recUserId) {
    const matchedUser = (users || []).find((u) => String(u?.id || "").trim() === String(recUserId).trim());
    if (matchedUser?.full_name && isRealName(matchedUser.full_name)) return matchedUser.full_name.trim();
  }

  if (isRealName(cut?.inspector)) return cut.inspector.trim();
  if (cut?.inspector_id) {
    const matchedUser = (users || []).find((u) => String(u?.id || "").trim() === String(cut.inspector_id).trim());
    if (matchedUser?.full_name && isRealName(matchedUser.full_name)) return matchedUser.full_name.trim();
  }

  if (isRealName(livestock?.post_inspected_by)) return livestock.post_inspected_by.trim();
  if (isRealName(livestock?.ante_inspected_by)) return livestock.ante_inspected_by.trim();

  if (livestock?.post_inspected_by_user_id) {
    const matchedUser = (users || []).find((u) => String(u?.id || "").trim() === String(livestock.post_inspected_by_user_id).trim());
    if (matchedUser?.full_name && isRealName(matchedUser.full_name)) return matchedUser.full_name.trim();
  }
  if (livestock?.ante_inspected_by_user_id) {
    const matchedUser = (users || []).find((u) => String(u?.id || "").trim() === String(livestock.ante_inspected_by_user_id).trim());
    if (matchedUser?.full_name && isRealName(matchedUser.full_name)) return matchedUser.full_name.trim();
  }

  if (isRealName(inspection?.inspector || inspection?.inspector_name)) {
    return (inspection.inspector || inspection.inspector_name).trim();
  }
  if (inspection?.inspector_id || inspection?.created_by_user_id) {
    const matchedUser = (users || []).find((u) => String(u?.id || "").trim() === String(inspection.inspector_id || inspection.created_by_user_id).trim());
    if (matchedUser?.full_name && isRealName(matchedUser.full_name)) return matchedUser.full_name.trim();
  }

  if (isRealName(record?.created_by)) return record.created_by.trim();

  return "Not recorded";
};

export const NEW_CONDEMNATION_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

export const parseCondemnationTimestampMs = (val) => {
  if (!val) return NaN;
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    const d = new Date(`${val.trim()}T00:00:00+08:00`);
    return d.getTime();
  }
  const d = new Date(val);
  return d.getTime();
};

export const isCondemnationWithin12Hours = (val, nowMs = Date.now()) => {
  const ts = parseCondemnationTimestampMs(val);
  if (isNaN(ts)) return false;
  const elapsed = nowMs - ts;
  return elapsed >= -5 * 60 * 1000 && elapsed < NEW_CONDEMNATION_WINDOW_MS;
};

export const isCondemnationWithin24Hours = isCondemnationWithin12Hours;

export const formatNewCondemnationRemaining = (val, nowMs = Date.now()) => {
  const ts = parseCondemnationTimestampMs(val);
  if (isNaN(ts)) return "";
  const remainingMs = NEW_CONDEMNATION_WINDOW_MS - Math.max(0, nowMs - ts);
  if (remainingMs <= 0) return "";
  const totalMins = Math.ceil(remainingMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
};

export const resolveCondemnationTimestamp = ({
  record,
  livestock = [],
  ante = [],
  post = [],
  postCuts = [],
  condemned = [],
  evidence = [],
  stage = "Ante-Mortem",
}) => {
  const cleanTag = String(record?.tag_number || "").trim().toLowerCase();
  const cleanId = String(record?.livestock_id || "").trim().toLowerCase();

  const matchedLs = (livestock || []).find((l) => {
    const lTag = String(l?.tag_number || "").trim().toLowerCase();
    const lId = String(l?.id || "").trim().toLowerCase();
    return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
  });

  const matchedCut =
    stage === "Post-Mortem"
      ? (postCuts || []).find((c) => {
          const cTag = String(c?.tag_number || "").trim().toLowerCase();
          const cId = String(c?.livestock_id || "").trim().toLowerCase();
          return (cleanId && cId === cleanId) || (cleanTag && cTag === cleanTag);
        })
      : null;

  const matchedInsp =
    stage === "Post-Mortem"
      ? (post || []).find((p) => {
          const pTag = String(p?.tag_number || "").trim().toLowerCase();
          const pId = String(p?.livestock_id || "").trim().toLowerCase();
          return (cleanId && pId === cleanId) || (cleanTag && pTag === cleanTag);
        })
      : (ante || []).find((a) => {
          const aTag = String(a?.tag_number || "").trim().toLowerCase();
          const aId = String(a?.livestock_id || "").trim().toLowerCase();
          return (cleanId && aId === cleanId) || (cleanTag && aTag === cleanTag);
        });

  const matchedCond = (condemned || []).find((c) => {
    const cTag = String(c?.tag_number || "").trim().toLowerCase();
    const cId = String(c?.livestock_id || "").trim().toLowerCase();
    return ((cleanId && cId === cleanId) || (cleanTag && cTag === cleanTag)) && matchesStage(c, stage);
  });

  const matchedEv = (evidence || []).find((e) => {
    const eTag = String(e?.tag_number || "").trim().toLowerCase();
    const eId = String(e?.livestock_id || "").trim().toLowerCase();
    return (
      ((cleanId && eId === cleanId) || (cleanTag && eTag === cleanTag)) &&
      (!e?.inspection_type || String(e.inspection_type).toLowerCase() === String(stage).toLowerCase()) &&
      e?.created_at
    );
  });

  const hasExactTime = (v) => typeof v === "string" && (v.includes("T") || /\d{2}:\d{2}/.test(v));

  const exactCandidates =
    stage === "Post-Mortem"
      ? [
          !record?.is_synthetic ? record?.created_at : null,
          matchedCut?.created_at,
          matchedLs?.post_inspected_at,
          matchedEv?.created_at,
          matchedInsp?.created_at,
          matchedCond?.created_at,
          record?.created_at,
        ]
      : [
          !record?.is_synthetic ? record?.created_at : null,
          matchedLs?.ante_inspected_at,
          matchedEv?.created_at,
          matchedInsp?.created_at,
          matchedCond?.created_at,
          record?.created_at,
        ];

  const exactMatch = exactCandidates.find((c) => c && hasExactTime(c));
  if (exactMatch) return exactMatch;

  return (
    record?.created_at ||
    (stage === "Post-Mortem"
      ? matchedCut?.created_at || matchedLs?.post_inspected_at || matchedInsp?.created_at
      : matchedLs?.ante_inspected_at || matchedInsp?.created_at) ||
    matchedEv?.created_at ||
    matchedCond?.date ||
    record?.date ||
    matchedInsp?.date ||
    matchedLs?.received_date ||
    null
  );
};

// Reactive clock that schedules an exact timeout for the next record expiring at its
// 24-hour boundary so highlights clear automatically without lag or unnecessary re-renders.
const use24HourRefreshClock = (timestamps = []) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const currentNow = Date.now();
    let nextExpiryDelay = Infinity;
    (timestamps || []).forEach((val) => {
      const ts = parseCondemnationTimestampMs(val);
      if (!isNaN(ts)) {
        const expiryMs = ts + NEW_CONDEMNATION_WINDOW_MS;
        const delay = expiryMs - currentNow;
        if (delay > 0 && delay < nextExpiryDelay) {
          nextExpiryDelay = delay;
        }
      }
    });

    let timeoutId = null;
    if (Number.isFinite(nextExpiryDelay) && nextExpiryDelay <= NEW_CONDEMNATION_WINDOW_MS) {
      timeoutId = setTimeout(() => {
        setNowMs(Date.now());
      }, Math.min(nextExpiryDelay + 100, 2147483647));
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [timestamps]);

  return nowMs;
};

export const CondemnedMeatRecords = ({ type, hideHeader = false, hideStats = false }) => {
  const { data: condemned, refresh } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: ante } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post } = useSupabase(TABLES.POST_MORTEM);
  const { data: livestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: owners = [] } = useSupabase(TABLES.OWNERS);
  const { data: processing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: allEvidence = [] } = useSupabase(
    TABLES.EVIDENCE_RECORDS || "evidence_records"
  );
  const { data: postCuts = [] } = useSupabase(TABLES.POST_MORTEM_CONDEMNED_CUTS || "post_mortem_condemned_cuts");
  const { data: users = [] } = useSupabase(TABLES.USERS);
  const { showToast } = useToast();

  const [missingPhotoUrls, setMissingPhotoUrls] = useState(() => new Set());
  const markPhotoMissing = useCallback((url) => {
    if (!url) return;
    const key = String(url).split("?")[0];
    setMissingPhotoUrls((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const isPhotoMissing = useCallback(
    (url) => !!url && missingPhotoUrls.has(String(url).split("?")[0]),
    [missingPhotoUrls]
  );

  // Helper: convert any value to a displayable browser URL.
  // Handles full https URLs, data: URIs, and raw Supabase storage paths.
  const resolveStorageUrl = (val) => {
    return resolveEvidencePhotoUrl(val);
  };

  const [addOpen, setAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewRec, setViewRec] = useState(null);
  const [scopeFilter, setScopeFilter] = useState("all"); // "all" | "partial" | "whole"
  const [searchCondemned, setSearchCondemned] = useState("");
  const [addScope, setAddScope] = useState("partial"); // "partial" | "whole"
  const [formPhotos, setFormPhotos] = useState([]); // [{ id, file, url, preview, dataUrl, name }]
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const recordFileInputRef = useRef(null);


  const [form, setForm] = useState({
    tag_number: "",
    species: "",
    reason: CONDEMNATION_REASONS[0],
    part: type === "Ante-Mortem" ? "Live Animal" : (CONDEMNED_PARTS_LIST[0] || "Head"),
    custom_part: "",
    location: type === "Ante-Mortem" ? "Intake Holding Pen" : "",
    quantity: type === "Ante-Mortem" ? "1 head" : "",
    weight_kg: "",
    disposition: "Condemned / Rendered",
    inspector: getCurrentActor().name || "Dr. Dave",
    notes: ""
  });
  const [partsList, setPartsList] = useState([
    { part: CONDEMNED_PARTS_LIST[0] || "Head", custom_part: "", weight_kg: "", reason: CONDEMNATION_REASONS[0] }
  ]);
  const [saving, setSaving] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const getRecordPhotos = (record) => {
    if (!record) return [];
    return collectCondemnationEvidencePhotos({
      target: record,
      type,
      evidence: allEvidence,
      post,
      condemned,
      postCuts,
    });
  };

  const handleOpenEdit = (rec) => {
    setAttemptedSave(false);
    setEditingRecord(rec);
    const scope = getCondemnationScope(rec);
    setAddScope(scope);

    const existing = getRecordPhotos(rec).map((p, idx) => ({
      id: `existing-${idx}`,
      url: p.url,
      preview: p.url,
      name: p.name,
      file_path: p.file_path || null,
    }));
    setFormPhotos(existing);

    const w = rec.weight_kg != null && rec.weight_kg !== ""
      ? String(rec.weight_kg)
      : (parseFloat(String(rec.quantity || "").replace(/[^0-9.]/g, "")) || "");

    const isCustomPart = !CONDEMNED_PARTS_LIST.includes(rec.part) && rec.part !== "Whole Carcass" && rec.part !== "Live Animal";

    setForm({
      tag_number: rec.tag_number || "",
      species: rec.species || "",
      reason: rec.reason || CONDEMNATION_REASONS[0],
      part: isCustomPart ? "Other" : (rec.part || (scope === "whole" ? "Whole Carcass" : (CONDEMNED_PARTS_LIST[0] || "Head"))),
      custom_part: isCustomPart ? rec.part : "",
      location: rec.location || (type === "Ante-Mortem" ? "Intake Holding Pen" : ""),
      quantity: rec.quantity || (type === "Ante-Mortem" ? "1 head" : (w ? `${w} kg` : "")),
      weight_kg: w ? String(w) : "",
      disposition: rec.disposition || "Condemned / Rendered",
      inspector: rec.inspector || "Dr. Dave",
      notes: rec.notes || "",
    });

    setAddOpen(true);
  };

  const handleOpenAdd = () => {
    setAttemptedSave(false);
    setEditingRecord(null);
    setFormPhotos([]);
    setAddScope("partial");
    setForm({
      tag_number: "",
      species: "",
      reason: CONDEMNATION_REASONS[0],
      part: type === "Ante-Mortem" ? "Live Animal" : (CONDEMNED_PARTS_LIST[0] || "Head"),
      custom_part: "",
      location: type === "Ante-Mortem" ? "Intake Holding Pen" : "",
      quantity: type === "Ante-Mortem" ? "1 head" : "",
      weight_kg: "",
      disposition: "Condemned / Rendered",
      inspector: "Dr. Dave",
      notes: "",
    });
    setPartsList([
      { part: CONDEMNED_PARTS_LIST[0] || "Head", custom_part: "", weight_kg: "", reason: CONDEMNATION_REASONS[0] }
    ]);
    setAddOpen(true);
  };

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = 3 - formPhotos.length;
    if (remainingSlots <= 0) {
      showToast("Maximum of 3 evidence photos allowed", "warning");
      e.target.value = "";
      return;
    }

    if (files.length > remainingSlots) {
      showToast(`Maximum 3 photos allowed. Adding first ${remainingSlots} photo(s).`, "info");
    }

    const accepted = files.slice(0, remainingSlots);
    // Convert each file to a persistent base64 dataUrl so previews survive page refresh
    accepted.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        setFormPhotos((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random() + idx,
            file,
            name: file.name,
            preview: dataUrl,
            dataUrl,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };


  const handleRemovePhoto = (id, e) => {
    if (e) e.stopPropagation();
    setFormPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // Animals eligible for condemnation
  const eligibleAnimals = useMemo(() => {
    if (type === "Ante-Mortem") {
      const anteApprovedTags = new Set(
        (ante || [])
          .filter((a) => {
            const dec = String(a.decision || "").toLowerCase();
            return dec.includes("approv") || dec.includes("pass");
          })
          .map((a) => String(a.tag_number || "").trim().toLowerCase())
      );
      return (livestock || []).filter((l) => {
        const tag = String(l.tag_number || "").trim().toLowerCase();
        const s = String(l.status || "").toLowerCase();
        if (anteApprovedTags.has(tag)) return false;
        if (
          s.includes("approv") ||
          s.includes("pass") ||
          s.includes("marked") ||
          s.includes("slaughter") ||
          s === "completed" ||
          s === "released"
        ) {
          return false;
        }
        return !processing.some((p) => p.tag_number === l.tag_number && p.status === "Completed");
      });
    }
    const tags = new Set([
      ...post.map((p) => p.tag_number),
      ...processing.map((p) => p.tag_number),
      ...livestock.map((l) => l.tag_number)
    ].filter(Boolean));
    return livestock.filter((l) => tags.has(l.tag_number));
  }, [type, livestock, processing, post, ante]);

  // Helper to determine whether a condemnation is Partial (cuts/organs) or Whole (entire carcass/animal)
  const getCondemnationScope = (record) => {
    if (!record) return "whole";

    const part = String(record.part || "").trim().toLowerCase();
    const decision = String(record.decision || "").trim().toLowerCase();

    // 1. Part is Whole Carcass or Live Animal or Entire Carcass -> ALWAYS WHOLE
    if (
      part === "whole carcass" ||
      part === "entire carcass" ||
      part === "live animal" ||
      part.includes("whole carcass") ||
      part.includes("entire carcass")
    ) {
      return "whole";
    }

    // 2. Official Whole Condemnation decisions -> ALWAYS WHOLE
    if (
      decision === "condemned" ||
      decision === "rejected" ||
      decision === "whole carcass condemned" ||
      decision === "totally condemned"
    ) {
      return "whole";
    }

    // 3. Official Partial Condemnation decisions -> ALWAYS PARTIAL
    if (
      decision === "passed with partial condemnation" ||
      decision === "partially condemned" ||
      decision === "partial" ||
      decision.includes("partial")
    ) {
      return "partial";
    }

    // 4. Explicit scope property if already set
    if (record.scope === "whole" || record.scope === "partial") {
      return record.scope;
    }

    // 5. Part is a known individual organ/cut (and not whole) -> PARTIAL
    if (CONDEMNED_PARTS_LIST.some((p) => p !== "Other" && part === p.toLowerCase())) {
      return "partial";
    }

    const combined = `${record.notes || ""} ${record.reason || ""} ${record.findings || ""} ${record.quantity || ""}`.toLowerCase();

    // 6. Descriptive keywords for whole
    if (
      combined.includes("whole carcass") ||
      combined.includes("entire carcass") ||
      combined.includes("whole condemnation") ||
      combined.includes("full carcass")
    ) {
      return "whole";
    }

    // 7. Descriptive keywords for partial
    if (
      combined.includes("carcass passed") ||
      combined.includes("partial") ||
      combined.includes("cut:") ||
      combined.includes("condemned cut")
    ) {
      return "partial";
    }

    // Ante-Mortem condemnations always target the live animal (whole scope);
    // unclassified Post-Mortem records default to a condemned cut (partial scope).
    return getCondemnationStage(record) === "Ante-Mortem" ? "whole" : "partial";
  };

  const cleanCondemnationReason = (rawReason) => {
    if (!rawReason) return "Unfit for human consumption";
    let str = String(rawReason).trim();

    // Remove "· Condemned cuts: ..." and anything after it
    str = str.split(/·\s*Condemned cuts:/i)[0].trim();
    // Remove any "(undefined kg)" or "(undefined"
    str = str.replace(/\(undefined\s*kg\)/gi, "").replace(/\(undefined\)/gi, "").trim();

    // If it has "[Reason]" brackets, extract what's inside the brackets!
    const bracketMatches = Array.from(str.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1].trim());
    if (bracketMatches.length > 0) {
      const uniqueReasons = Array.from(new Set(bracketMatches));
      return uniqueReasons.join(", ");
    }

    // Remove prefixes:
    str = str
      .replace(/^Whole Carcass Condemned:\s*/i, "")
      .replace(/^Post-Mortem Whole Condemned:\s*/i, "")
      .replace(/^Ante-Mortem Condemned:\s*/i, "")
      .replace(/^Passed with Partial Condemnation:\s*/i, "")
      .replace(/^Post-Mortem Partial Condemnation:\s*/i, "")
      .replace(/^Condemned:\s*/i, "")
      .trim();

    // If it still contains "Left Foreleg - 1 kg", extract just the pathology
    if (str.includes(" - ") && str.includes("kg")) {
      const parts = str.split(";").map((s) => {
        return s.replace(/^[^-]+-\s*[\d.]+\s*kg\s*/i, "").trim();
      });
      str = parts.filter(Boolean).join(", ");
    }

    return str || "Pathology / Disease Signs";
  };

  const cleanCondemnedParts = (r) => {
    const scope = getCondemnationScope(r);
    if (scope === "whole") {
      return [r.part === "Live Animal" ? "Live Animal" : "Entire Carcass"];
    }

    if (r.part && r.part !== "Condemned Cut" && r.part !== "Excised Cut") {
      return [r.part];
    }

    if (Array.isArray(r.condemned_parts) && r.condemned_parts.length > 0) {
      const parts = r.condemned_parts.map((cp) => cp.part).filter(Boolean);
      if (parts.length > 0) return parts;
    }

    // Look inside raw reason / notes text
    const text = `${r.reason || ""} ${r.notes || ""}`;
    const found = [];
    for (const p of CONDEMNED_PARTS_LIST) {
      if (p !== "Other" && new RegExp(`\\b${p}\\b`, "i").test(text)) {
        found.push(p);
      }
    }

    if (found.length > 0) {
      return found;
    }

    return [r.part || "Excised Cut"];
  };

  const cleanWeightAndQty = (r) => {
    const scope = getCondemnationScope(r);
    if (scope === "whole") {
      const w = parseFloat(r.weight_kg);
      if (!isNaN(w) && w > 0) {
        return { main: `${w.toFixed(2)} kg`, sub: "Whole Carcass" };
      }
      return { main: "Full Carcass", sub: "" };
    }

    // Partial cut
    const w = parseFloat(r.weight_kg);
    if (!isNaN(w) && w > 0) {
      return { main: `${w.toFixed(2)} kg`, sub: r.quantity || "1 cut" };
    }

    // Parse weight from reason text if e.g. "Left Foreleg - 1 kg; Right Foreleg - 2 kg"
    const text = `${r.reason || ""} ${r.notes || ""}`;
    const cleanText = text.split(/·\s*Condemned cuts:/i)[0];
    const matches = Array.from(cleanText.matchAll(/([\d.]+)\s*kg/gi));
    if (matches.length > 0) {
      const totalW = matches.reduce((sum, m) => sum + (parseFloat(m[1]) || 0), 0);
      if (totalW > 0) {
        const cutCount = matches.length;
        return { main: `${totalW.toFixed(2)} kg`, sub: `${cutCount} ${cutCount === 1 ? "cut" : "cuts"}` };
      }
    }

    return { main: r.quantity || "1 Cut", sub: "" };
  };

  // Also include animals rejected in inspections
  const rejectedFromInspection = (type === "Ante-Mortem" ? ante : post).filter((i) =>
    i.decision === "Rejected" || i.decision === "Condemned" ||
    (i.decision && (i.decision.toLowerCase().includes("reject") || i.decision.toLowerCase().includes("condemn")))
  );

  const filteredCondemned = useMemo(() => {
    // Strict Ante-Mortem vs Post-Mortem separation, derived from each record itself
    // (never from "does this tag have an ante inspection").
    const list = condemned.filter((c) => matchesStage(c, type)).map((c) => {
      const animal = livestock.find((l) => (l.tag_number || "").trim().toLowerCase() === (c.tag_number || "").trim().toLowerCase());
      return { ...c, sex: c.sex || animal?.sex || "" };
    });

    const existingTags = new Set(list.map((c) => String(c.tag_number).trim()));

    if (type === "Ante-Mortem") {
      // Merge rejected/condemned ante inspections
      (ante || []).forEach((a) => {
        const isCond = a.decision === "Rejected" || a.decision === "Condemned" ||
          (a.decision && (a.decision.toLowerCase().includes("reject") || a.decision.toLowerCase().includes("condemn")));
        if (isCond && a.tag_number && !existingTags.has(String(a.tag_number).trim())) {
          existingTags.add(String(a.tag_number).trim());
          const animal = livestock.find((l) => l.tag_number === a.tag_number);
          let cleanReason = a.reason || "";
          if (!cleanReason && a.findings) {
            const f = a.findings.trim();
            const tagEscaped = String(a.tag_number).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const m = f.match(new RegExp(`${tagEscaped}\\s*\\(([^)]+)\\)`, "i"));
            if (m && m[1]) {
              cleanReason = m[1].trim();
            } else {
              cleanReason = f.replace(/^Ante-Mortem Condemned:\s*/i, "").replace(/^Condemned:\s*/i, "").trim();
            }
          }
          if (!cleanReason) cleanReason = a.remarks || "Ante-Mortem Condemnation";

          list.push({
            id: a.id || `ante-${a.tag_number}`,
            tag_number: a.tag_number,
            species: a.species || animal?.species || "Livestock",
            sex: a.sex || animal?.sex || "",
            part: "Live Animal",
            reason: cleanReason,
            quantity: "1 Head",
            inspector: a.inspector_name || "Dr. Dave",
            date: a.date || a.created_at || today(),
            notes: a.remarks || "Classified as condemned during Ante-Mortem inspection",
            scope: "whole",
            carcass_fate: "Disposed / Rejected at Intake",
          });
        }
      });

      // Merge condemned livestock from intake / ante-mortem outcome
      // (post-mortem outcomes such as "Partially Condemned" are excluded here)
      (livestock || []).forEach((l) => {
        const isCond = isAnteCondemnedStatus(l.status);
        if (isCond && l.tag_number && !existingTags.has(String(l.tag_number).trim())) {
          existingTags.add(String(l.tag_number).trim());
          list.push({
            id: l.id || `live-${l.tag_number}`,
            tag_number: l.tag_number,
            species: l.species || "Livestock",
            sex: l.sex || "",
            part: "Live Animal",
            reason: l.remarks || l.rejection_reason || "Marked as Condemned at Intake",
            quantity: "1 Head",
            inspector: "Dr. Dave",
            date: l.received_date || l.created_at || today(),
            notes: "Recorded in livestock intake",
            scope: "whole",
            carcass_fate: "Disposed / Rejected at Intake",
          });
        }
      });
    } else {
      // Merge rejected/condemned post-mortem inspections
      (post || []).forEach((p) => {
        const d = String(p.decision || "").trim().toLowerCase();
        const isWholeCondemnedDecision =
          d === "condemned" ||
          d === "rejected" ||
          d === "whole carcass condemned" ||
          d === "totally condemned";

        const isPartialDecision =
          !isWholeCondemnedDecision && (
            d === "passed with partial condemnation" ||
            d === "partially condemned" ||
            d === "partial" ||
            d.includes("partial") ||
            (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0 && !p.condemned_parts.some((cp) => String(cp.part || "").toLowerCase().includes("whole")))
          );

        const isCond = isWholeCondemnedDecision || isPartialDecision;

        if (isCond && p.tag_number) {
          const cleanTag = String(p.tag_number).trim();
          const animal = livestock.find((l) => l.tag_number === cleanTag);

          if (isWholeCondemnedDecision) {
            // Whole Carcass Condemnation: regardless of itemized parts in inspection, this is a WHOLE condemnation
            if (!existingTags.has(cleanTag)) {
              existingTags.add(cleanTag);
              list.push({
                id: p.id || `post-${cleanTag}`,
                tag_number: cleanTag,
                species: p.species || animal?.species || "Carcass",
                sex: p.sex || animal?.sex || "",
                part: "Entire Carcass",
                reason: p.findings || p.remarks || "Whole Carcass Condemnation",
                quantity: "Whole Carcass",
                inspector: p.inspector_name || "Dr. Dave",
                date: p.date || p.created_at || today(),
                notes: p.remarks || "Classified as Whole Carcass Condemned during Post-Mortem inspection",
                scope: "whole",
                carcass_fate: "Disposed / Rendered",
              });
            }
          } else if (isPartialDecision) {
            // Partial Condemnation: cuts are condemned, carcass passes
            if (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0) {
              p.condemned_parts.forEach((cp, idx) => {
                const partKey = `${cleanTag}_${cp.part}_${idx}`;
                if (!existingTags.has(partKey)) {
                  existingTags.add(partKey);
                  const w = parseFloat(cp.weight_kg) || parseFloat(cp.weight) || 0;
                  list.push({
                    id: cp.id || `post-part-${cleanTag}-${idx}`,
                    tag_number: cleanTag,
                    species: p.species || animal?.species || "Carcass",
                    sex: p.sex || animal?.sex || "",
                    part: cp.part || "Condemned Cut",
                    reason: cp.reason || p.findings || "Partial Condemnation",
                    quantity: w > 0 ? `${w.toFixed(2)} kg` : (cp.quantity || "1 Cut"),
                    weight_kg: w > 0 ? w : null,
                    inspector: p.inspector_name || "Dr. Dave",
                    date: p.date || p.created_at || today(),
                    notes: cp.notes || p.remarks || `Condemned part (${cp.part}) during Post-Mortem inspection`,
                    scope: "partial",
                    carcass_fate: "Passed to Weighing",
                  });
                }
              });
            } else if (!existingTags.has(cleanTag)) {
              existingTags.add(cleanTag);
              list.push({
                id: p.id || `post-${cleanTag}`,
                tag_number: cleanTag,
                species: p.species || animal?.species || "Carcass",
                sex: p.sex || animal?.sex || "",
                part: p.part || "Condemned Cut",
                reason: p.findings || p.remarks || "Partial Condemnation",
                quantity: p.quantity || "1 Cut",
                inspector: p.inspector_name || "Dr. Dave",
                date: p.date || p.created_at || today(),
                notes: p.remarks || "Classified as Partial Condemnation - Remainder of carcass passed",
                scope: "partial",
                carcass_fate: "Passed to Weighing",
              });
            }
          }
        }
      });

      // Normalize pre-existing records for whole condemned carcasses so they are scope: "whole"
      list.forEach((item) => {
        const tag = String(item.tag_number || "").trim();
        const matchPost = (post || []).find((p) => String(p.tag_number || "").trim() === tag);
        const postIsWhole = matchPost && (
          matchPost.decision === "Condemned" ||
          matchPost.decision === "Rejected" ||
          matchPost.decision === "Whole Carcass Condemned"
        );
        if (
          postIsWhole ||
          item.part === "Whole Carcass" ||
          item.part === "Entire Carcass" ||
          item.part === "Live Animal"
        ) {
          item.scope = "whole";
          if (item.carcass_fate === "Passed to Weighing" || !item.carcass_fate) {
            item.carcass_fate = "Disposed / Rendered";
          }
        }
      });
    }

    return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [condemned, ante, post, livestock, type]);

  const handleTagChange = (tag) => {
    const animal = livestock.find((l) => l.tag_number === tag);
    setForm((f) => ({
      ...f,
      tag_number: tag,
      species: animal?.species || "",
      part: type === "Ante-Mortem" ? "Live Animal" : (CONDEMNED_PARTS_LIST[0] || "Head"),
      location: type === "Ante-Mortem" ? "Intake Holding Pen" : "Thoracic Cavity",
    }));
  };

  const addPartRow = () => {
    const currentParts = new Set(partsList.map((p) => p.part));
    const nextPart = CONDEMNED_PARTS_LIST.find((p) => p !== "Other" && !currentParts.has(p)) || CONDEMNED_PARTS_LIST[0] || "Head";
    setPartsList((prev) => [
      ...prev,
      { part: nextPart, custom_part: "", weight_kg: "", reason: CONDEMNATION_REASONS[0] }
    ]);
  };

  const removePartRow = (index) => {
    setPartsList((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePartRow = (index, field, value) => {
    setPartsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const currentTotalWeight = useMemo(() => {
    return partsList.reduce((sum, item) => sum + (parseFloat(item.weight_kg) || 0), 0);
  }, [partsList]);

  const handleSave = async (e) => {
    e?.preventDefault?.();
    setAttemptedSave(true);
    if (!form.tag_number) {
      showToast("Please select an animal tag number.", "error");
      return;
    }

    const effectivePart = (type === "Ante-Mortem" || addScope === "whole")
      ? (type === "Ante-Mortem" ? "Live Animal" : "Whole Carcass")
      : (form.part === "Other" ? (form.custom_part?.trim() || "") : form.part);

    if (!effectivePart || !effectivePart.trim()) {
      showToast("Please select a condemned part.", "error");
      return;
    }

    const effectiveLocation = (addScope === "partial"
      ? (form.specific_part === "Other" ? (form.custom_part || "").trim() : (form.specific_part || form.location || "").trim())
      : (form.location || "").trim());
    if (!effectiveLocation) {
      showToast(addScope === "partial" ? "Please select a specific condemned part." : "Please enter the location or area.", "error");
      return;
    }

    const w = parseFloat(form.weight_kg);
    if (isNaN(w) || w <= 0) {
      showToast("Please enter a valid weight greater than 0 kg.", "error");
      return;
    }

    const effectiveReason = (form.reason === "Other" ? (form.custom_reason?.trim() || "") : form.reason) || form.reason;
    if (!effectiveReason || !effectiveReason.trim()) {
      showToast("Please select a pathology or reason.", "error");
      return;
    }

    // Pass the real File plus the Storage key when the photo is already stored, so the
    // upload step can tell a stored object from a browser preview. A preview is never
    // a durable link, so it is deliberately not sent.
    const photosToSubmit = formPhotos
      .map((p) => {
        if (p.file) {
          return { file: p.file, name: p.name, url: p.url || null, file_path: p.file_path || null };
        }
        return { name: p.name, url: p.url || null, file_path: p.file_path || null };
      })
      .filter((p) => p.file || p.file_path);
    if (!photosToSubmit || photosToSubmit.length === 0) {
      showToast("Please upload at least one evidence photo.", "error");
      return;
    }


    if (addScope !== "partial" && (!form.disposition || !form.disposition.trim())) {
      showToast("Please select a disposition.", "error");
      return;
    }

    if (!form.inspector) {
      showToast("Please enter inspector name.", "error");
      return;
    }

    // Edit Mode
    if (editingRecord) {
      setSaving(true);
      try {
        const patch = {
          part: type === "Ante-Mortem" ? "Live Animal" : (addScope === "whole" ? "Whole Carcass" : effectivePart),
          location: effectiveLocation,
          reason: effectiveReason,
          disposition: form.disposition || "Condemned / Rendered",
          weight_kg: w,
          quantity: type === "Ante-Mortem" ? (form.quantity || "1 head") : `${w.toFixed(2)} kg`,
          inspector: form.inspector,
          notes: form.notes || "",
          photos: photosToSubmit,
        };

        await vetService.updateCondemnationRecord(editingRecord.id, patch, form.tag_number);
        showToast("Condemnation record updated successfully", "success");
        setAddOpen(false);
        setEditingRecord(null);
        refresh();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to update condemnation record", "error");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create Mode: Ante-Mortem
    if (type === "Ante-Mortem") {
      setSaving(true);
      try {
        const animal = livestock.find((l) => l.tag_number === form.tag_number);
        await vetService.createCondemnationRecord({
          ...form,
          livestock_id: animal?.id || "",
          species: form.species || animal?.species || "Livestock",
          part: "Live Animal",
          inspection_type: "Ante-Mortem",
          location: effectiveLocation,
          weight_kg: w,
          reason: effectiveReason,
          disposition: form.disposition || "Condemned / Rendered",
          photos: photosToSubmit,
          date: today(),
        });
        showToast("Condemnation record saved successfully", "success");
        setAddOpen(false);
        refresh();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to save condemnation record", "error");
      } finally {
        setSaving(false);
      }
    } else if (addScope === "whole") {
      // Create Mode: Post-Mortem Whole Carcass
      setSaving(true);
      try {
        const animal = livestock.find((l) => l.tag_number === form.tag_number);
        await vetService.createCondemnationRecord({
          tag_number: form.tag_number,
          livestock_id: animal?.id || "",
          species: form.species || animal?.species || "Carcass",
          part: "Whole Carcass",
          inspection_type: "Post-Mortem",
          location: effectiveLocation,
          reason: effectiveReason,
          disposition: form.disposition || "Condemned / Rendered",
          quantity: `${w.toFixed(2)} kg`,
          weight_kg: w,
          inspector: form.inspector,
          notes: form.notes ? form.notes : "Entire carcass condemned and sent for disposal/rendering.",
          photos: photosToSubmit,
          date: today(),
        });
        showToast(`Successfully recorded Whole Carcass Condemnation for Tag #${form.tag_number}!`, "success");
        setAddOpen(false);
        refresh();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to save whole condemnation record", "error");
      } finally {
        setSaving(false);
      }
    } else {
      // Create Mode: Post-Mortem Partial Condemnation
      setSaving(true);
      try {
        const animal = livestock.find((l) => l.tag_number === form.tag_number);
        await vetService.createCondemnationRecord({
          tag_number: form.tag_number,
          livestock_id: animal?.id || "",
          species: form.species || animal?.species || "Carcass",
          part: effectivePart,
          inspection_type: "Post-Mortem",
          location: effectiveLocation,
          reason: effectiveReason,
          disposition: form.disposition || "Denatured & Disposed per NMIS Guidelines",
          quantity: `${w.toFixed(2)} kg`,
          weight_kg: w,
          inspector: form.inspector,
          notes: form.notes ? form.notes : `Partial Condemnation: ${effectivePart} - ${w.toFixed(2)} kg (Remaining carcass passed to weighing)`,
          photos: photosToSubmit,
          date: today()
        });
        showToast(`Successfully recorded partial condemned cut (${effectivePart}) for Tag #${form.tag_number}!`, "success");
        setAddOpen(false);
        refresh();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to save condemnation record", "error");
      } finally {
        setSaving(false);
      }
    }
  };

  const totalKg = filteredCondemned.reduce((sum, r) => {
    const num = parseFloat(r.weight_kg || r.quantity);
    return sum + (isNaN(num) ? 0 : num);
  }, 0);

  const partialRecords = useMemo(() => {
    return filteredCondemned.filter((r) => getCondemnationScope(r) === "partial");
  }, [filteredCondemned]);

  const wholeRecords = useMemo(() => {
    return filteredCondemned.filter((r) => getCondemnationScope(r) === "whole");
  }, [filteredCondemned]);

  // UNIQUE condemned animals / carcasses (by tag): one partial condemnation with several
  // condemned parts = ONE count, and evidence photos never affect the count.
  const partialTagCount = useMemo(
    () => new Set(partialRecords.map((r) => String(r.tag_number || "").trim()).filter(Boolean)).size,
    [partialRecords]
  );
  const wholeTagCount = useMemo(
    () => new Set(wholeRecords.map((r) => String(r.tag_number || "").trim()).filter(Boolean)).size,
    [wholeRecords]
  );
  const condemnedHeadCount = useMemo(
    () => new Set(filteredCondemned.map((r) => String(r.tag_number || "").trim()).filter(Boolean)).size,
    [filteredCondemned]
  );

  const partialKg = useMemo(() => {
    return partialRecords.reduce((sum, r) => {
      const num = parseFloat(r.weight_kg) || parseFloat(String(r.quantity || "").replace(/[^0-9.]/g, "")) || 0;
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [partialRecords]);

  const wholeKg = useMemo(() => {
    return wholeRecords.reduce((sum, r) => {
      const num = parseFloat(r.weight_kg) || parseFloat(String(r.quantity || "").replace(/[^0-9.]/g, "")) || 0;
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [wholeRecords]);

  const reasonCounts = filteredCondemned.reduce((acc, r) => {
    const cleaned = cleanCondemnationReason(r.reason);
    acc[cleaned] = (acc[cleaned] || 0) + 1;
    return acc;
  }, {});
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  const getRecordTimestamp = useCallback(
    (r) =>
      resolveCondemnationTimestamp({
        record: r,
        livestock,
        ante,
        post,
        postCuts,
        condemned,
        evidence: allEvidence,
        stage: type,
      }),
    [livestock, ante, post, postCuts, condemned, allEvidence, type]
  );

  const condemnedTimestamps = useMemo(
    () => (filteredCondemned || []).map((r) => getRecordTimestamp(r)).filter(Boolean),
    [filteredCondemned, getRecordTimestamp]
  );
  const nowMs = use24HourRefreshClock(condemnedTimestamps);

  const displayedRecords = useMemo(() => {
    const filtered = filteredCondemned.filter((r) => {
      const scope = getCondemnationScope(r);
      if (scopeFilter !== "all" && scope !== scopeFilter) return false;
      if (searchCondemned) {
        const q = searchCondemned.trim().toLowerCase();
        const cleanedReason = cleanCondemnationReason(r.reason);
        const parts = cleanCondemnedParts(r).join(" ");
        const animal = (livestock || []).find((l) => (l.id && l.id === r.livestock_id) || (l.tag_number && l.tag_number === r.tag_number));
        const ownerFromAnimal = animal?.owner_name || (owners || []).find((o) => o.id === animal?.owner_id)?.name || "";
        const ownerDirect = r.owner_name || (owners || []).find((o) => o.id === r.owner_id)?.name || "";
        const resolvedOwner = (ownerDirect || ownerFromAnimal || "").toLowerCase();
        const match =
          (r.tag_number || "").toLowerCase().includes(q) ||
          resolvedOwner.includes(q) ||
          (r.species || "").toLowerCase().includes(q) ||
          (r.part || "").toLowerCase().includes(q) ||
          parts.toLowerCase().includes(q) ||
          (r.reason || "").toLowerCase().includes(q) ||
          cleanedReason.toLowerCase().includes(q) ||
          (r.inspector || "").toLowerCase().includes(q) ||
          (r.notes || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const tsA = getRecordTimestamp(a);
      const tsB = getRecordTimestamp(b);
      const isNewA = isCondemnationWithin24Hours(tsA, nowMs);
      const isNewB = isCondemnationWithin24Hours(tsB, nowMs);
      if (isNewA !== isNewB) return isNewA ? -1 : 1;
      const msA = parseCondemnationTimestampMs(tsA);
      const msB = parseCondemnationTimestampMs(tsB);
      if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msB - msA;
      if (!isNaN(msA) && isNaN(msB)) return -1;
      if (isNaN(msA) && !isNaN(msB)) return 1;
      return 0;
    });
  }, [filteredCondemned, scopeFilter, searchCondemned, livestock, owners, getRecordTimestamp, nowMs]);

  return (
    <div>
      {!hideHeader && (
        <PageHeader
          title={type === "Ante-Mortem" ? "Condemned Animals" : "Condemned Meat Records"}
          subtitle={type === "Ante-Mortem" ? "Track and manage all livestock declared unfit for slaughter" : "Track and manage all meat declared unfit for human consumption"}
          icon={<Icon.AlertTriangle />}
          actions={
            <Button
              onClick={handleOpenAdd}
              style={{
                background: "var(--color-danger, #ef4444)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
              }}
            >
              <Icon.Plus size={15} /> {type === "Ante-Mortem" ? "Record Condemned Animal" : "Record Condemned Meat"}
            </Button>
          }
        />
      )}

      {/* Stats */}
      {!hideStats && (
        type === "Post-Mortem" ? (
          <div className="grid grid-4 mb-6" style={{ gap: 16 }}>
            <div className="stat-card sky">
              <div className="stat-card-body">
                <div className="stat-card-label">Total Condemned Meat</div>
                <div className="stat-card-value">
                  {totalKg > 0 ? `${totalKg.toFixed(1)} kg` : `${filteredCondemned.length}`}
                </div>
                <div className="stat-card-trend">{condemnedHeadCount} unique livestock &middot; {filteredCondemned.length} condemnation records</div>
              </div>
              <div className="stat-card-icon stat-icon-sky"><Icon.Scale /></div>
            </div>

            <div className="stat-card amber">
              <div className="stat-card-body">
                <div className="stat-card-label">Partially Condemned</div>
                <div className="stat-card-value" style={{ color: "#d97706" }}>
                  {partialTagCount} <span style={{ fontSize: 13, fontWeight: 600 }}>Carcass{partialTagCount === 1 ? "" : "es"}</span>
                </div>
                <div className="stat-card-trend">
                  <b>{partialKg.toFixed(1)} kg</b> &middot; {partialRecords.length} condemned cut{partialRecords.length === 1 ? "" : "s"} &middot; Main carcass passed to weighing
                </div>
              </div>
              <div className="stat-card-icon stat-icon-amber"><Icon.Layers /></div>
            </div>

            <div className="stat-card rose">
              <div className="stat-card-body">
                <div className="stat-card-label">Whole Carcass Condemned</div>
                <div className="stat-card-value" style={{ color: "#dc2626" }}>
                  {wholeTagCount} <span style={{ fontSize: 13, fontWeight: 600 }}>Carcass{wholeTagCount === 1 ? "" : "es"}</span>
                </div>
                <div className="stat-card-trend">
                  <b>{wholeKg > 0 ? `${wholeKg.toFixed(1)} kg` : "Full Carcass"}</b> &middot; Entire carcass disposed
                </div>
              </div>
              <div className="stat-card-icon stat-icon-rose"><Icon.AlertTriangle /></div>
            </div>

            <div className="stat-card violet">
              <div className="stat-card-body">
                <div className="stat-card-label">Top Pathology Reason</div>
                <div className="stat-card-value" style={{ fontSize: "0.95rem", lineHeight: 1.3 }}>{topReason}</div>
                <div className="stat-card-trend">Most frequent cause</div>
              </div>
              <div className="stat-card-icon stat-icon-violet"><Icon.FileText /></div>
            </div>
          </div>
        ) : (
          <div className="grid grid-3 mb-6">
            <div className="stat-card rose">
              <div className="stat-card-body">
                <div className="stat-card-label">Total Ante-Mortem Condemned</div>
                <div className="stat-card-value">{condemnedHeadCount} heads</div>
                <div className="stat-card-trend">Unique condemned livestock (live animals)</div>
              </div>
              <div className="stat-card-icon stat-icon-rose"><Icon.Cow /></div>
            </div>
            <div className="stat-card violet">
              <div className="stat-card-body">
                <div className="stat-card-label">From Inspections</div>
                <div className="stat-card-value">{rejectedFromInspection.length}</div>
                <div className="stat-card-trend">Antemortem rejects</div>
              </div>
              <div className="stat-card-icon stat-icon-violet"><Icon.ClipboardCheck /></div>
            </div>
            <div className="stat-card sky">
              <div className="stat-card-body">
                <div className="stat-card-label">Top Reason</div>
                <div className="stat-card-value" style={{ fontSize: "0.85rem", lineHeight: 1.3 }}>{topReason}</div>
                <div className="stat-card-trend">Most common cause</div>
              </div>
              <div className="stat-card-icon stat-icon-sky"><Icon.FileText /></div>
            </div>
          </div>
        )
      )}

      {/* Records Section */}
      {(() => {
        const tableContent = (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
            {/* Post-Mortem Partial vs Whole Segmented Scope Sub-tabs & Search */}
            {type === "Post-Mortem" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  background: "var(--color-bg)",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                }}
              >
                {/* Search input with icon and clear button */}
                <div style={{ position: "relative", minWidth: 260 }}>
                  <input
                    type="text"
                    placeholder="Search tag, part, reason..."
                    value={searchCondemned}
                    onChange={(e) => setSearchCondemned(e.target.value)}
                    style={{
                      width: "100%",
                      height: 34,
                      paddingLeft: 32,
                      paddingRight: searchCondemned ? 30 : 12,
                      fontSize: 12.5,
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <Icon.Search
                    size={14}
                    style={{
                      position: "absolute",
                      left: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted)",
                      pointerEvents: "none",
                      zIndex: 10
                    }}
                  />
                  {searchCondemned && (
                    <button
                      type="button"
                      onClick={() => setSearchCondemned("")}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--color-text-muted)",
                        padding: 2,
                        display: "flex",
                      }}
                      title="Clear search"
                    >
                      <Icon.X size={13} />
                    </button>
                  )}
                </div>

                {/* Scope Filter Dropdown */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ position: "relative", minWidth: 240 }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "var(--color-text-muted)",
                        display: "flex",
                        pointerEvents: "none",
                      }}
                    >
                      <Icon.Filter size={14} />
                    </span>
                    <select
                      value={scopeFilter}
                      onChange={(e) => setScopeFilter(e.target.value)}
                      style={{
                        width: "100%",
                        height: 34,
                        paddingLeft: 32,
                        paddingRight: 32,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--color-text)",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        outline: "none",
                        appearance: "none",
                        WebkitAppearance: "none",
                        cursor: "pointer",
                        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="all">All Condemnations ({filteredCondemned.length})</option>
                      <option value="partial">✂️ Partial Condemned ({partialRecords.length} cuts)</option>
                      <option value="whole">🚫 Whole Carcass ({wholeRecords.length} carcasses)</option>
                    </select>
                    <span
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                        color: "var(--color-text-muted)",
                        display: "flex",
                      }}
                    >
                      <Icon.ChevronDown size={14} />
                    </span>
                  </div>
                </div>
              </div>
            )}

            {displayedRecords.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><Icon.AlertTriangle size={32} /></div>
                <div className="empty-state-title">
                  {scopeFilter === "partial"
                    ? "No Partial Condemnation records found"
                    : scopeFilter === "whole"
                    ? "No Whole Carcass Condemnation records found"
                    : "No condemnation records"}
                </div>
                <div className="empty-state-msg">
                  {scopeFilter === "partial"
                    ? "Excised cuts and organs from partial condemnations will appear here"
                    : scopeFilter === "whole"
                    ? "Entire carcasses condemned during post-mortem will appear here"
                    : "All condemned cuts and livestock from inspections will appear here"}
                </div>
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  overflowX: "auto",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    minWidth: 1060,
                    borderCollapse: "collapse",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "12px 14px", paddingLeft: 20, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 150 }}>
                        TAG #
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 110 }}>
                        SPECIES
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 100 }}>
                        SEX
                      </th>
                      {type === "Post-Mortem" && (
                        <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 145 }}>
                          SCOPE
                        </th>
                      )}
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 165 }}>
                        CONDEMNED PART
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", minWidth: 200 }}>
                        REASON / PATHOLOGY
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 130 }}>
                        WEIGHT / QTY
                      </th>
                      {type === "Post-Mortem" && (
                        <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 170 }}>
                          CARCASS FINAL FATE
                        </th>
                      )}
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 140 }}>
                        INSPECTOR
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", whiteSpace: "nowrap", width: 100 }}>
                        DATE
                      </th>
                      <th style={{ padding: "12px 14px", paddingRight: 20, fontWeight: 700, fontSize: 11, letterSpacing: "0.05em", color: "var(--color-text-muted)", textTransform: "uppercase", textAlign: "right", whiteSpace: "nowrap", width: 85 }}>
                        ACTION
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRecords.map((r, idx) => {
                      const scope = getCondemnationScope(r);
                      const isWhole = scope === "whole";
                      const cleanedReason = cleanCondemnationReason(r.reason);
                      const parts = cleanCondemnedParts(r);
                      const weightInfo = cleanWeightAndQty(r);
                      const rawTimestamp = getRecordTimestamp(r);
                      const isNew = isCondemnationWithin24Hours(rawTimestamp, nowMs);

                      return (
                        <tr
                          key={r.id || idx}
                          style={{
                            borderBottom: "1px solid var(--color-border)",
                            background: isNew ? "rgba(245, 158, 11, 0.08)" : "transparent",
                            transition: "background 150ms ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = isNew
                              ? "rgba(245, 158, 11, 0.14)"
                              : "var(--color-surface-hover, rgba(255,255,255,0.04))";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isNew ? "rgba(245, 158, 11, 0.08)" : "transparent";
                          }}
                        >
                          {/* TAG # */}
                          <td
                            style={{
                              padding: "12px 14px",
                              paddingLeft: 17,
                              borderLeft: isNew ? "3px solid #f59e0b" : "3px solid transparent",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <TagBadge tag={r.tag_number} style={{ whiteSpace: "nowrap" }} />
                              {isNew && (
                                <span
                                  title={`Newly condemned (${formatManilaDateTime(rawTimestamp)})`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "2px 6px",
                                    borderRadius: 9999,
                                    fontSize: 9.5,
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                    color: "#ffffff",
                                    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                                    boxShadow: "0 1px 4px rgba(245, 158, 11, 0.35)",
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 5,
                                      height: 5,
                                      borderRadius: "50%",
                                      background: "#ffffff",
                                    }}
                                  />
                                  NEW
                                </span>
                              )}
                            </div>
                          </td>

                          {/* SPECIES */}
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                            {r.species || "—"}
                          </td>

                          {/* SEX */}
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5, color: "var(--color-text)" }}>
                            {formatSex(r.sex)}
                          </td>

                          {/* SCOPE */}
                          {type === "Post-Mortem" && (
                            <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                              {isWhole ? (
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "var(--color-danger, #ef4444)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Whole Carcass
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "var(--color-warning, #f59e0b)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Partial Cut
                                </span>
                              )}
                            </td>
                          )}

                          {/* CONDEMNED PART */}
                          <td style={{ padding: "12px 14px" }}>
                            {isWhole ? (
                              <span
                                style={{
                                  padding: "3px 9px",
                                  borderRadius: 6,
                                  background: "var(--color-bg)",
                                  color: "var(--color-text-secondary)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  display: "inline-block",
                                  border: "1px solid var(--color-border)",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {type === "Ante-Mortem" ? "Live Animal" : "Entire Carcass"}
                              </span>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxWidth: 220 }}>
                                {parts.map((p, pIdx) => (
                                  <span
                                    key={pIdx}
                                    style={{
                                      padding: "3px 8px",
                                      borderRadius: 6,
                                      background: "rgba(245, 158, 11, 0.12)",
                                      color: "var(--color-warning, #f59e0b)",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      display: "inline-block",
                                      border: "1px solid rgba(245, 158, 11, 0.25)",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* REASON / PATHOLOGY */}
                          <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                            <span
                              style={{
                                color: "var(--color-text)",
                                fontSize: 13,
                                lineHeight: 1.45,
                                display: "block",
                                fontWeight: 600,
                              }}
                            >
                              {cleanedReason}
                            </span>
                          </td>

                          {/* WEIGHT / QTY */}
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: "var(--color-text)",
                                  fontFamily: weightInfo.main.includes("kg") ? "monospace" : "inherit",
                                  fontSize: 13,
                                }}
                              >
                                {weightInfo.main}
                              </span>
                              {weightInfo.sub && (
                                <span style={{ color: "var(--color-text-muted)", fontSize: 11, textTransform: "capitalize", marginTop: 1 }}>
                                  {weightInfo.sub}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* CARCASS FINAL FATE */}
                          {type === "Post-Mortem" && (
                            <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                              {isWhole ? (
                                <span
                                  style={{
                                    padding: "4px 9px",
                                    borderRadius: 6,
                                    background: "rgba(239, 68, 68, 0.15)",
                                    color: "var(--color-danger, #ef4444)",
                                    fontWeight: 700,
                                    fontSize: 11.5,
                                    border: "1px solid rgba(239, 68, 68, 0.3)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  ✕ Full Carcass Disposed
                                </span>
                              ) : (
                                <span
                                  style={{
                                    padding: "4px 9px",
                                    borderRadius: 6,
                                    background: "rgba(16, 185, 129, 0.15)",
                                    color: "var(--color-primary, #10b981)",
                                    fontWeight: 700,
                                    fontSize: 11.5,
                                    border: "1px solid rgba(16, 185, 129, 0.3)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  ✓ Passed to Weighing
                                </span>
                              )}
                            </td>
                          )}

                          {/* INSPECTOR */}
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                            {(() => {
                              const cleanTag = String(r.tag_number || "").trim().toLowerCase();
                              const matchedLs = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag);
                              const matchedCut = (postCuts || []).find((c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag);
                              const condemningPersonnel = resolveCondemningPersonnel({ record: r, livestock: matchedLs, cut: matchedCut, users });
                              return (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                                  <span
                                    style={{
                                      width: 24,
                                      height: 24,
                                      borderRadius: "50%",
                                      background: "var(--color-bg)",
                                      color: "var(--color-text)",
                                      border: "1px solid var(--color-border)",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {condemningPersonnel.charAt(0).toUpperCase()}
                                  </span>
                                  <span style={{ color: "var(--color-text)", fontSize: 12.5, fontWeight: 600 }}>
                                    {condemningPersonnel}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>

                          {/* DATE & TIME */}
                          <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ color: isNew ? "var(--color-text)" : "var(--color-text-muted)", fontWeight: isNew ? 700 : 400, fontSize: 12 }}>
                                {formatManilaDateTime(rawTimestamp)}
                              </span>
                            </div>
                          </td>

                          {/* ACTIONS */}
                          <td style={{ padding: "12px 14px", paddingRight: 20, textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setViewRec(r)}
                                style={{
                                  height: 32,
                                  padding: "4px 9px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <Icon.Eye size={13} /> View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenEdit(r)}
                                style={{
                                  height: 32,
                                  padding: "4px 9px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  color: "#0284c7",
                                  borderColor: "#bae6fd",
                                }}
                              >
                                <Icon.Edit size={13} /> Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

        if (hideHeader) {
          return tableContent;
        }

        return (
          <Card
            title={type === "Ante-Mortem" ? "Condemned Animal Records" : "Condemned Meat Records"}
            icon={<Icon.AlertTriangle />}
            action={
              <Button
                size="sm"
                onClick={handleOpenAdd}
                style={{
                  background: "var(--color-danger, #ef4444)",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 12.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Plus size={14} /> {type === "Ante-Mortem" ? "Record Condemned Animal" : "Record Condemned Meat"}
              </Button>
            }
          >
            {tableContent}
          </Card>
        );
      })()}

      {/* Add / Edit Condemnation Modal */}
      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); setEditingRecord(null); }}
        title={editingRecord ? `Edit Condemnation Record — Tag #${form.tag_number}` : (type === "Ante-Mortem" ? "Record Condemned Animal" : "Record Condemned Meat / Parts")}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditingRecord(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{ background: "var(--color-danger, #ef4444)", color: "#fff" }}>
              {saving ? "Saving..." : <><Icon.AlertTriangle size={15} /> {editingRecord ? "Update Condemnation Record" : (type === "Ante-Mortem" ? "Condemn Animal" : "Save Condemned Record")}</>}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {editingRecord ? (
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
              <Input label="Animal Tag Number" value={form.tag_number} disabled />
              <Input label="Species" value={form.species || "Livestock"} disabled />
            </div>
          ) : (
            <>
              <Select label="Animal Tag Number" required value={form.tag_number} onChange={(e) => handleTagChange(e.target.value)}>
                <option value="">-- Select animal --</option>
                {eligibleAnimals.map((l) => (
                  <option key={l.id || l.tag_number} value={l.tag_number}>
                    {l.tag_number} — {l.species} ({l.owner_name || "Unknown Owner"})
                  </option>
                ))}
              </Select>
              {form.species && (
                <Input label="Species" value={form.species} disabled />
              )}
            </>
          )}

          {/* Scope Selector for Post-Mortem when creating */}
          {type === "Post-Mortem" && !editingRecord && (
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", marginBottom: 6 }}>
                Condemnation Scope / Classification <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setAddScope("partial");
                    setForm((f) => ({ ...f, part: CONDEMNED_PARTS_LIST[0] || "Head", location: "Thoracic Cavity" }));
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: addScope === "partial" ? "2px solid #d97706" : "1px solid var(--color-border)",
                    background: addScope === "partial" ? "rgba(245, 158, 11, 0.15)" : "var(--color-surface)",
                    color: addScope === "partial" ? "#d97706" : "var(--color-text)",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Icon.Layers size={15} /> <span>✂️ Partial Condemnation</span>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                    Condemn specific organs or cuts. Remainder of carcass passes to weighing.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddScope("whole");
                    setForm((f) => ({ ...f, part: "Whole Carcass", location: "General / Systemic" }));
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: addScope === "whole" ? "2px solid #dc2626" : "1px solid var(--color-border)",
                    background: addScope === "whole" ? "rgba(239, 68, 68, 0.15)" : "var(--color-surface)",
                    color: addScope === "whole" ? "#ef4444" : "var(--color-text)",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Icon.AlertTriangle size={15} /> <span>🚫 Whole Carcass Condemnation</span>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                    Condemn entire carcass. Carcass is disposed (0 kg proceeds to weighing).
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* 1. Condemned Part & 2. Specific Part / Location */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                {addScope === "partial" ? "Carcass Area" : "Condemned Part"} <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              {type === "Ante-Mortem" ? (
                <Input value="Live Animal" disabled />
              ) : addScope === "whole" ? (
                <Input value="Whole Carcass" disabled />
              ) : (
                <select
                  value={form.part || CARCASS_AREAS[0]}
                  onChange={(e) => {
                    const newArea = e.target.value;
                    const defaultSpecific = SPECIFIC_PARTS_BY_AREA[newArea]?.[0] || "Other";
                    setForm({
                      ...form,
                      part: newArea,
                      specific_part: defaultSpecific,
                      location: defaultSpecific,
                      custom_part: "",
                    });
                  }}
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    fontSize: 13,
                    padding: "0 10px",
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  {CARCASS_AREAS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
            </div>

            {addScope === "partial" ? (
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                  Specific Part <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
                </label>
                <select
                  value={form.specific_part || SPECIFIC_PARTS_BY_AREA[form.part]?.[0] || "Other"}
                  onChange={(e) => {
                    const sp = e.target.value;
                    setForm({
                      ...form,
                      specific_part: sp,
                      location: sp === "Other" ? (form.custom_part || "") : sp,
                      custom_part: sp === "Other" ? form.custom_part : "",
                    });
                  }}
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    fontSize: 13,
                    padding: "0 10px",
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  {(SPECIFIC_PARTS_BY_AREA[form.part || CARCASS_AREAS[0]] || ["Other"]).map((sp) => (
                    <option key={sp} value={sp}>{sp}</option>
                  ))}
                </select>
                {form.specific_part === "Other" && (
                  <input
                    type="text"
                    placeholder="Specify condemned part *..."
                    value={form.custom_part || ""}
                    onChange={(e) => {
                      const cp = e.target.value;
                      setForm({ ...form, custom_part: cp, location: cp });
                    }}
                    style={{
                      width: "100%",
                      height: 34,
                      marginTop: 6,
                      borderRadius: 6,
                      border: "1px solid #f59e0b",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      padding: "0 8px",
                      fontSize: 12,
                    }}
                    required
                  />
                )}
              </div>
            ) : (
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: attemptedSave && !form.location?.trim() ? "#ef4444" : "var(--color-text)", marginBottom: 4 }}>
                  Location / Area <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. General / Systemic..."
                  value={form.location || ""}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 8,
                    border: attemptedSave && !form.location?.trim() ? "1.5px solid #ef4444" : "1px solid var(--color-border)",
                    background: attemptedSave && !form.location?.trim() ? "#fef2f2" : "var(--color-surface)",
                    fontSize: 13,
                    padding: "0 10px",
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                />
              </div>
            )}
          </div>

          {/* 3. Weight (kg) & 4. Pathology / Reason */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: attemptedSave && (!form.weight_kg || parseFloat(form.weight_kg) <= 0) ? "#ef4444" : "var(--color-text)", marginBottom: 4 }}>
                Weight (kg) <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder={type === "Ante-Mortem" ? "e.g. 85.00 (live kg)" : "e.g. 2.50"}
                value={form.weight_kg}
                onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 8,
                  border: attemptedSave && (!form.weight_kg || parseFloat(form.weight_kg) <= 0) ? "1.5px solid #ef4444" : "1px solid var(--color-border)",
                  background: attemptedSave && (!form.weight_kg || parseFloat(form.weight_kg) <= 0) ? "#fef2f2" : "var(--color-surface)",
                  fontSize: 13,
                  padding: "0 10px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  fontFamily: "monospace",
                  boxShadow: attemptedSave && (!form.weight_kg || parseFloat(form.weight_kg) <= 0) ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : "none",
                }}
              />
              {attemptedSave && (!form.weight_kg || parseFloat(form.weight_kg) <= 0) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginTop: 4, display: "block" }}>
                  ⚠️ Weight (kg) is required and must be &gt; 0.
                </span>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                Pathology / Reason <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <select
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  fontSize: 13,
                  padding: "0 10px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                {(CONDEMNED_REASONS_LIST || CONDEMNATION_REASONS).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* If Ante-Mortem: Heads quantity */}
          {type === "Ante-Mortem" && (
            <Input
              label="Quantity (heads)"
              required
              placeholder="e.g. 1 head"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          )}

          {/* 6. Evidence Photos (up to 3 photos directly inside record) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontWeight: 700, fontSize: 13, margin: 0, color: "var(--color-text)" }}>
                Evidence Photos (up to 3) <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: formPhotos.length >= 3 ? "#059669" : formPhotos.length > 0 ? "#0284c7" : "#64748b",
                }}
              >
                {formPhotos.length}/3 Photos
              </span>
            </div>

            {/* Thumbnail previews */}
            {formPhotos.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                  gap: 10,
                  marginBottom: 10,
                  padding: 8,
                  background: "var(--color-bg)",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                }}
              >
                {formPhotos.map((photo, idx) => (
                  <div
                    key={photo.id || idx}
                    style={{
                      position: "relative",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid var(--color-border)",
                      background: "#0f172a",
                      aspectRatio: "1/1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <img
                      src={photo.preview || photo.url}
                      alt={photo.name || `Photo ${idx + 1}`}
                      onClick={() => setLightboxPhoto(photo.preview || photo.url)}
                      style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }}
                      title="Click to view full image"
                    />
                    <button
                      type="button"
                      onClick={(e) => handleRemovePhoto(photo.id, e)}
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        background: "rgba(220, 38, 38, 0.9)",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: 20,
                        height: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                        zIndex: 10,
                      }}
                      title="Remove photo"
                    >
                      <Icon.X size={11} />
                    </button>
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "rgba(15, 23, 42, 0.75)",
                        color: "white",
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 4px",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      Photo {idx + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {formPhotos.length === 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#dc2626", marginTop: 4, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, background: "#fee2e2", padding: "6px 10px", borderRadius: 6, border: "1px solid #fca5a5" }}>
                <Icon.AlertTriangle size={14} /> At least 1 evidence photo is required before saving this condemnation.
              </div>
            )}

            {/* Photo picker trigger */}
            {formPhotos.length < 3 ? (
              <div
                onClick={() => recordFileInputRef.current?.click()}
                style={{
                  cursor: "pointer",
                  border: formPhotos.length === 0 ? "2px dashed #fca5a5" : "2px dashed var(--color-primary, #0284c7)",
                  borderRadius: 10,
                  padding: "12px",
                  textAlign: "center",
                  background: formPhotos.length === 0 ? "#fff5f5" : "rgba(2, 132, 199, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: formPhotos.length === 0 ? "#dc2626" : "var(--color-primary, #0284c7)",
                }}
              >
                <input
                  type="file"
                  multiple
                  ref={recordFileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  onChange={handlePhotoSelect}
                />
                <Icon.Camera size={18} />
                <span>Click to attach photo(s) ({3 - formPhotos.length} slot{3 - formPhotos.length > 1 ? "s" : ""} remaining)</span>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: "#059669", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.CheckCircle size={14} /> 3/3 Maximum photos attached
              </div>
            )}
          </div>

          {/* 7. Disposition - Only shown for Whole Carcass / Ante-Mortem, REMOVED for Partial Condemnation */}
          {addScope !== "partial" && (
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                Disposition <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <select
                value={form.disposition}
                onChange={(e) => setForm({ ...form, disposition: e.target.value })}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  fontSize: 13,
                  padding: "0 10px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                {DISPOSITION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
            <Input
              label="Inspector Name"
              required
              placeholder="Name of the condemning inspector"
              value={form.inspector}
              onChange={(e) => setForm({ ...form, inspector: e.target.value })}
            />
            <Input
              label="Additional Notes / Remarks"
              placeholder="Optional notes or references"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      {/* View Record Modal */}
      <Modal
        open={!!viewRec}
        onClose={() => setViewRec(null)}
        title="Condemnation Record Details"
        size="lg"
        footer={<Button variant="outline" onClick={() => setViewRec(null)}>Close</Button>}
      >
        {viewRec && (() => {
          const recScope = getCondemnationScope(viewRec);
          const isWholeRec = recScope === "whole";
          const recParts = cleanCondemnedParts(viewRec);
          const recWeight = cleanWeightAndQty(viewRec);
          const recReason = cleanCondemnationReason(viewRec.reason);
          const recPhotos = getRecordPhotos(viewRec);

          const cleanTag = String(viewRec.tag_number || "").trim().toLowerCase();
          const matchedAnimal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === cleanTag);
          const matchedCut = (postCuts || []).find((c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag);
          const condemnedInspector = resolveCondemningPersonnel({
            record: viewRec,
            livestock: matchedAnimal,
            cut: matchedCut,
            users,
          });
          const rawTimestamp =
            viewRec.created_at ||
            (type === "Post-Mortem" ? (matchedCut?.created_at || matchedAnimal?.post_inspected_at) : matchedAnimal?.ante_inspected_at) ||
            viewRec.date;
          const condemnationDateTime = formatManilaDateTime(rawTimestamp);

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {type === "Post-Mortem" && (
                <div
                  style={{
                    borderRadius: 8,
                    padding: "10px 14px",
                    background: isWholeRec ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                    border: isWholeRec ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(245, 158, 11, 0.3)",
                    color: isWholeRec ? "var(--color-danger, #ef4444)" : "var(--color-warning, #f59e0b)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {isWholeRec ? (
                    <>
                      <Icon.AlertTriangle size={18} style={{ color: "var(--color-danger, #ef4444)", flexShrink: 0 }} />
                      <div>
                        <div>🚫 Whole Carcass Condemnation</div>
                        <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                          Entire carcass declared unfit for human consumption. Full carcass sent for disposal (0 kg to weighing).
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <Icon.Layers size={18} style={{ color: "var(--color-warning, #f59e0b)", flexShrink: 0 }} />
                      <div>
                        <div>✂️ Partial Condemnation ({recParts.join(", ")})</div>
                        <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                          Specific cut/organ excised and condemned. Remainder of carcass passed to weighing.
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "var(--color-surface)", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Tag Number</div>
                  <div><TagBadge tag={viewRec.tag_number} /></div>
                </div>
                <div style={{ background: "var(--color-surface)", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Species</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: "var(--color-primary, #10b981)" }}>
                    {viewRec.species || "—"}
                  </div>
                </div>
                {[
                  ["Condemned Part", isWholeRec ? (type === "Ante-Mortem" ? "Live Animal" : "Entire Carcass") : recParts.join(", ")],
                  ["Location / Area", viewRec.location || "Thoracic Cavity"],
                  ["Weight / Quantity", recWeight.main + (recWeight.sub ? ` (${recWeight.sub})` : "")],
                  ["Disposition", viewRec.disposition || "Condemned / Rendered"],
                  ["Carcass Final Fate", isWholeRec ? "Disposed / Rendered (0 kg to weighing)" : "Passed to Carcass Weighing"],
                  ["Condemned By", condemnedInspector],
                  ["Condemnation Date & Time", condemnationDateTime],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: "var(--color-surface)", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--color-text)" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "color-mix(in srgb, var(--color-danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--color-danger)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Reason / Pathology</div>
                <div style={{ fontWeight: 700, color: "var(--color-danger)", fontSize: 14 }}>{recReason}</div>
              </div>

              <div style={{ background: "var(--color-surface)", borderRadius: 8, padding: "12px 14px", border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Inspection Findings</div>
                <div style={{ fontSize: "0.88rem", color: "var(--color-text)", fontWeight: 500 }}>
                  {viewRec.findings || viewRec.notes || "Recorded during veterinary examination."}
                </div>
              </div>

              {/* Attached Evidence Photos */}
              <div style={{ background: "var(--color-surface)", borderRadius: 8, padding: "12px 14px", border: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.Camera size={13} style={{ color: "#0284c7" }} /> Attached Evidence Photos ({recPhotos.length})
                  </div>
                  {recPhotos.length > 0 && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Click image to enlarge</span>
                  )}
                </div>

                {recPhotos.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic", padding: "6px 0" }}>
                    No evidence photos attached to this condemnation record.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
                    {recPhotos.map((photo, idx) => (
                      <div
                        key={idx}
                        onClick={() => setLightboxPhoto(photo.url)}
                        style={{
                          borderRadius: 8,
                          overflow: "hidden",
                          border: "1.5px solid var(--color-border)",
                          background: "#0f172a",
                          aspectRatio: "1/1",
                          cursor: "pointer",
                          position: "relative",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                          transition: "transform 0.15s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                        title="Click to view full image"
                      >
                        {isPhotoMissing(photo.url) ? (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#f87171",
                              fontSize: 10,
                              fontWeight: 700,
                              textAlign: "center",
                              padding: 6,
                              gap: 4,
                              background: "rgba(239, 68, 68, 0.12)",
                            }}
                          >
                            <span style={{ fontSize: 14 }}>⚠️</span>
                            <span>Load Failed</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const key = String(photo.url).split("?")[0];
                                setMissingPhotoUrls((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                              }}
                              style={{
                                border: "1px solid #f87171",
                                background: "transparent",
                                color: "#f87171",
                                borderRadius: 4,
                                padding: "2px 6px",
                                fontSize: 9.5,
                                cursor: "pointer",
                                fontWeight: 700,
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <img
                            src={photo.url}
                            alt={photo.name}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={() => markPhotoMissing(photo.url)}
                          />
                        )}
                        <div
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: "rgba(15, 23, 42, 0.75)",
                            color: "white",
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: "2px 4px",
                            textAlign: "center",
                          }}
                        >
                          Photo {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Complete Process History & Audit Timeline */}
              <div style={{ marginTop: 4 }}>
                <ProcessHistoryTimeline
                  livestock={(livestock || []).find((l) => (l.id && l.id === viewRec.livestock_id) || (l.tag_number && l.tag_number === viewRec.tag_number)) || viewRec}
                  title="Livestock & Condemnation Process History"
                />
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Lightbox Preview Modal */}
      {lightboxPhoto && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setLightboxPhoto(null)}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxPhoto}
              alt="Evidence Full View"
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8, objectFit: "contain" }}
              onError={() => markPhotoMissing(lightboxPhoto)}
            />
            {isPhotoMissing(lightboxPhoto) && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  color: "#e2e8f0",
                  fontWeight: 700,
                  background: "#0f172a",
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 28 }}>🖼️</span>
                Photo unavailable
              </div>
            )}
            <button
              type="button"
              onClick={() => setLightboxPhoto(null)}
              style={{
                position: "absolute",
                top: -12,
                right: -12,
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
              }}
            >
              <Icon.X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const DisposalRecords = ({ type }) => {
  const { data: rows, refresh } = useSupabase("disposal_records");
  const { data: condemned } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: ante } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post } = useSupabase(TABLES.POST_MORTEM);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewRec, setViewRec] = useState(null);
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ tag_number: "", method: DISPOSAL_METHODS[0], quantity: "", disposed_by: "", witness: "", status: "Completed", notes: "" });

  const filteredCondemned = condemned.filter((c) => matchesStage(c, type));

  // Tags that have been condemned (from direct records or inspection rejections)
  const condemnedTags = [
    ...filteredCondemned.map((c) => c.tag_number),
    ...(type === "Ante-Mortem" ? ante : post)
      .filter((i) => {
        if (type === "Ante-Mortem") return isAnteCondemnedDecision(i.decision);
        const o = getPostOutcome(i);
        return o.label === "Partially Condemned" || o.label === "Whole Carcass Condemned";
      })
      .map((i) => i.tag_number),
  ];
  const uniqueCondemnedTags = [...new Set(condemnedTags)];

  const filteredRows = rows.filter((r) => uniqueCondemnedTags.includes(r.tag_number));

  const alreadyDisposed = new Set(filteredRows.map((r) => r.tag_number));

  const save = async (e) => {
    e.preventDefault();
    if (!form.tag_number || !form.quantity || !form.disposed_by) {
      showToast("Please fill all required fields", "error");
      return;
    }
    setSaving(true);
    try {
      await vetService.createDisposalRecord(form);
      showToast("Disposal record created successfully", "success");
      setModalOpen(false);
      setForm({ tag_number: "", method: DISPOSAL_METHODS[0], quantity: "", disposed_by: "", witness: "", status: "Completed", notes: "" });
      refresh();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Failed to record disposal", "error");
    } finally {
      setSaving(false);
    }
  };

  const pending = filteredRows.filter((r) => r.status === "Pending");
  const completed = filteredRows.filter((r) => r.status === "Completed");
  const awaitingDisposal = uniqueCondemnedTags.filter((t) => !alreadyDisposed.has(t));

  return (
    <div>
      <PageHeader
        title="Disposal Records"
        subtitle={type === "Ante-Mortem" ? "Track condemned animal disposal operations" : "Track condemned meat disposal operations"}
        icon={<Icon.Trash />}
        actions={
          <Button onClick={() => setModalOpen(true)} style={{ background: "var(--color-danger)" }}>
            <Icon.Plus /> Record Disposal
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-4 mb-6">
        <div className="stat-card rose">
          <div className="stat-card-body">
            <div className="stat-card-label">Awaiting Disposal</div>
            <div className="stat-card-value">{awaitingDisposal.length}</div>
            <div className="stat-card-trend">Condemned, not yet disposed</div>
          </div>
          <div className="stat-card-icon stat-icon-rose"><Icon.AlertTriangle /></div>
        </div>
        <div className="stat-card amber">
          <div className="stat-card-body">
            <div className="stat-card-label">Pending</div>
            <div className="stat-card-value">{pending.length}</div>
            <div className="stat-card-trend">In progress</div>
          </div>
          <div className="stat-card-icon stat-icon-amber"><Icon.Clock /></div>
        </div>
        <div className="stat-card emerald">
          <div className="stat-card-body">
            <div className="stat-card-label">Completed</div>
            <div className="stat-card-value">{completed.length}</div>
            <div className="stat-card-trend">Disposed</div>
          </div>
          <div className="stat-card-icon stat-icon-emerald"><Icon.Check /></div>
        </div>
        <div className="stat-card sky">
          <div className="stat-card-body">
            <div className="stat-card-label">Total Records</div>
            <div className="stat-card-value">{filteredRows.length}</div>
            <div className="stat-card-trend">All disposal logs</div>
          </div>
          <div className="stat-card-icon stat-icon-sky"><Icon.FileText /></div>
        </div>
      </div>

      {/* Awaiting Disposal Alert */}
      {awaitingDisposal.length > 0 && (
        <div style={{ background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)", borderRadius: 12, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <Icon.AlertTriangle size={20} style={{ color: "var(--color-danger)", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-danger)" }}>Disposal Required</div>
            <div style={{ fontSize: "0.85rem", color: "var(--color-muted)" }}>
              {awaitingDisposal.length} condemned {type === "Ante-Mortem" ? "animal" : "meat"}{awaitingDisposal.length > 1 ? "s" : ""} ({awaitingDisposal.join(", ")}) still awaiting proper disposal.
            </div>
          </div>
          <Button size="sm" style={{ marginLeft: "auto", background: "var(--color-danger)" }} onClick={() => setModalOpen(true)}>
            Dispose Now
          </Button>
        </div>
      )}

      {/* Records Table */}
      <Card title="Disposal Records" icon={<Icon.Trash />}>
        {filteredRows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon.Trash size={32} /></div>
            <div className="empty-state-title">No disposal records</div>
            <div className="empty-state-msg">Record the disposal of condemned {type === "Ante-Mortem" ? "animals" : "meat"} here</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tag #</th>
                  <th>Disposal Method</th>
                  <th>Quantity</th>
                  <th>Disposed By</th>
                  <th>Witness</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono font-semibold">{r.tag_number}</td>
                    <td>{r.method}</td>
                    <td>{r.quantity}</td>
                    <td>{r.disposed_by || "—"}</td>
                    <td>{r.witness || "—"}</td>
                    <td className="text-muted">{formatDate(r.date)}</td>
                    <td>
                      <span className={`badge ${r.status === "Completed" ? "badge-approved" : "badge-pending"}`}>{r.status}</span>
                    </td>
                    <td>
                      <Button size="sm" variant="outline" onClick={() => setViewRec(r)}>
                        <Icon.Eye /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Disposal Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Disposal" size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : <><Icon.Check /> Save Disposal</>}
          </Button>
        </>}>
        <form onSubmit={save}>
          <Select label="Animal Tag" required value={form.tag_number} onChange={(e) => setForm({ ...form, tag_number: e.target.value })}>
            <option value="">-- Select condemned animal --</option>
            {uniqueCondemnedTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}{alreadyDisposed.has(tag) ? " (already disposed)" : " ⚠ Awaiting disposal"}
              </option>
            ))}
          </Select>

          <Select label="Disposal Method" required value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {DISPOSAL_METHODS.map((m) => <option key={m}>{m}</option>)}
          </Select>

          <Input label="Quantity / Weight" required placeholder="e.g. 45 kg, whole carcass" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Disposed By" required placeholder="Veterinarian or officer name" value={form.disposed_by} onChange={(e) => setForm({ ...form, disposed_by: e.target.value })} />
            <Input label="Witness" placeholder="Witness name (optional)" value={form.witness} onChange={(e) => setForm({ ...form, witness: e.target.value })} />
          </div>

          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>Completed</option>
            <option>Pending</option>
          </Select>

          <Textarea label="Notes" rows={3} placeholder="Additional notes on disposal process, location, references..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </form>
      </Modal>

      {/* View Modal */}
      <Modal open={!!viewRec} onClose={() => setViewRec(null)} title="Disposal Record Details"
        footer={<Button variant="outline" onClick={() => setViewRec(null)}>Close</Button>}>
        {viewRec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                ["Tag Number", viewRec.tag_number],
                ["Disposal Method", viewRec.method],
                ["Quantity", viewRec.quantity || "—"],
                ["Disposed By", viewRec.disposed_by || "—"],
                ["Witness", viewRec.witness || "—"],
                ["Date", formatDate(viewRec.date)],
              ].map(([label, value]) => (
                <div key={label} style={{ background: "var(--color-surface)", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--color-surface)", borderRadius: 8 }}>
              <span style={{ fontSize: "0.72rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status:</span>
              <span className={`badge ${viewRec.status === "Completed" ? "badge-approved" : "badge-pending"}`}>{viewRec.status}</span>
            </div>
            {viewRec.notes && (
              <div style={{ background: "var(--color-surface)", borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: "0.9rem" }}>{viewRec.notes}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export const EvidenceUpload = ({
  type = "Ante-Mortem",
  hideHeader = false,
  hideStats = false,
  viewerVariant = "vet",
  search: externalSearch,
  filterSpecies: externalSpecies,
}) => {
  const { role } = useAuth();
  const isVetViewer = viewerVariant === "vet" && (!role || role === "vet");

  // Supabase is the source of truth for both Post-Mortem and Ante-Mortem evidence.
  const { data: evidence = [], loading: loadingEvidence, error: errorEvidence, refresh: refreshEvidence } = useSupabase(
    TABLES.EVIDENCE_RECORDS || "evidence_records"
  );
  const { data: ante = [], refresh: refreshAnte } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: post = [], refresh: refreshPost } = useSupabase(TABLES.POST_MORTEM);
  const { data: livestock = [], loading: loadingLivestock, error: errorLivestock, refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: condemned = [], refresh: refreshCondemned } = useSupabase(TABLES.CONDEMNATION_RECORDS);
  const { data: owners = [], loading: loadingOwners, error: errorOwners, refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  // One row per condemned part, written by the Post-Mortem inspection save. It carries
  // photo_url / photo_name and is the only place those photos exist, so it must be read.
  const { data: postCuts = [], refresh: refreshPostCuts } = useSupabase("post_mortem_condemned_cuts");
  const { data: users = [] } = useSupabase(TABLES.USERS);
  const { showToast } = useToast();
  const [viewingEv, setViewingEv] = useState(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [imgLoadState, setImgLoadState] = useState("idle"); // "idle" | "loading" | "loaded" | "error"
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const loadSeqRef = useRef(0);
  const viewerImgRef = useRef(null);
  const lastTriggerRef = useRef(null);

  // Ante-Mortem only. A row can point at a storage object that no longer exists (bucket
  // cleanup, a delete that removed the file but kept the row, an upload that never
  // completed). Such a reference is unrecoverable, so it must report itself instead of
  // rendering a broken image. Keyed by URL without query string so a cache-busting
  // parameter cannot make the same missing file look present again.
  const [missingPhotoUrls, setMissingPhotoUrls] = useState(() => new Set());
  const markPhotoMissing = useCallback((url) => {
    const key = String(url || "").split("?")[0];
    if (!key) return;
    setMissingPhotoUrls((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const unmarkPhotoMissing = useCallback((url) => {
    const key = String(url || "").split("?")[0];
    if (!key) return;
    setMissingPhotoUrls((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  const isPhotoMissing = useCallback(
    (url) => !!url && missingPhotoUrls.has(String(url).split("?")[0]),
    [missingPhotoUrls]
  );

  // Every stored photo for this condemnation, regardless of which field or table it was
  // written to. See condemnationEvidencePhotos for why the lookup has to be this wide.
  const getTagPhotosList = useCallback(
    (targetEv) =>
      collectCondemnationEvidencePhotos({
        target: targetEv,
        type,
        evidence,
        post,
        condemned,
        postCuts,
      }),
    [type, evidence, post, condemned, postCuts]
  );

  const viewerPhotos = useMemo(() => {
    if (!viewingEv) return [];
    const list = getTagPhotosList(viewingEv);
    if (list.length > 0) return list;
    const fallbackUrl = resolveEvidencePhotoUrl(
      viewingEv.file_url || viewingEv.file_preview || viewingEv.photo_url || viewingEv.file_path
    );
    if (fallbackUrl) {
      return [
        {
          id: viewingEv.id || "fallback-0",
          url: fallbackUrl,
          name: viewingEv.file_name || "Evidence File",
          notes: viewingEv.notes || "",
          part: viewingEv.part || "",
          record: viewingEv,
        },
      ];
    }
    return [];
  }, [viewingEv, getTagPhotosList]);

  const currentViewerIndex = activePhotoIndex < viewerPhotos.length ? activePhotoIndex : 0;
  const currentViewerPhoto = viewerPhotos[currentViewerIndex] || null;
  const currentViewerUrl = currentViewerPhoto?.url || null;

  const currentViewerFileKind = useMemo(() => {
    if (!viewingEv) return "none";
    if (!currentViewerUrl) return "none";
    const rawUrl = String(currentViewerUrl).trim();
    const urlNoQuery = rawUrl.split("?")[0].toLowerCase();
    const displayRec = currentViewerPhoto?.record || viewingEv;
    const fileNameLower = String(currentViewerPhoto?.name || displayRec?.file_name || "").trim().toLowerCase();
    const mimeLower = String(displayRec?.mime_type || "").trim().toLowerCase();
    const recType = String(displayRec?.type || "").trim();

    const isPdf =
      urlNoQuery.endsWith(".pdf") ||
      fileNameLower.endsWith(".pdf") ||
      mimeLower === "application/pdf" ||
      rawUrl.startsWith("data:application/pdf");
    const isImageExt =
      /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(urlNoQuery) ||
      /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(fileNameLower) ||
      mimeLower.startsWith("image/") ||
      rawUrl.startsWith("data:image/");
    const isNonImageDoc =
      isPdf ||
      ((recType === "Lab Result" || recType === "Report Document" || recType === "Inspection Slip") && !isImageExt);

    return isNonImageDoc ? "document" : "image";
  }, [viewingEv, currentViewerUrl, currentViewerPhoto]);

  // Reset viewer state cleanly when switching records so no stale content flashes
  useEffect(() => {
    setActivePhotoIndex(0);
    setZoomLevel(1);
    setIsEnlarged(false);
    setRetryCount(0);
  }, [viewingEv?.id, viewingEv?.tag_number]);

  // Reset zoom when switching between photos of the same record
  useEffect(() => {
    setZoomLevel(1);
  }, [currentViewerIndex]);

  // Track loading / error state per photo with sequence token to ignore out-of-order loads
  useEffect(() => {
    const seq = ++loadSeqRef.current;
    if (!viewingEv || currentViewerFileKind !== "image" || !currentViewerUrl) {
      setImgLoadState("idle");
      return;
    }
    if (isPhotoMissing(currentViewerUrl)) {
      setImgLoadState("error");
      return;
    }
    setImgLoadState("loading");
    const raf = requestAnimationFrame(() => {
      if (loadSeqRef.current !== seq) return;
      const el = viewerImgRef.current;
      if (el && el.complete && el.naturalWidth > 0) {
        setImgLoadState("loaded");
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [
    viewingEv?.id,
    viewingEv?.tag_number,
    currentViewerIndex,
    currentViewerUrl,
    currentViewerFileKind,
    retryCount,
    isPhotoMissing,
  ]);

  const closeEvidenceViewer = useCallback(() => {
    setIsEnlarged(false);
    setViewingEv(null);
    setActivePhotoIndex(0);
    setZoomLevel(1);
    setRetryCount(0);
    setImgLoadState("idle");
    const trigger = lastTriggerRef.current;
    if (trigger && typeof trigger.focus === "function") {
      setTimeout(() => {
        trigger.focus();
      }, 0);
    }
  }, []);

  const handleModalDismiss = useCallback(() => {
    if (isEnlarged) {
      setIsEnlarged(false);
      return;
    }
    closeEvidenceViewer();
  }, [isEnlarged, closeEvidenceViewer]);

  // Keyboard arrow navigation when viewing a record with multiple photos
  useEffect(() => {
    if (!viewingEv || viewerPhotos.length <= 1) return;
    const handleArrowKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : viewerPhotos.length - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setActivePhotoIndex((prev) => (prev < viewerPhotos.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleArrowKey);
    return () => window.removeEventListener("keydown", handleArrowKey);
  }, [viewingEv, viewerPhotos.length]);

  const [confirmDeleteEv, setConfirmDeleteEv] = useState(null);
  const [isDeletingEv, setIsDeletingEv] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [internalFilterSpecies, setInternalFilterSpecies] = useState("all");
  const [internalSearchEv, setInternalSearchEv] = useState("");
  const filterSpecies = externalSpecies !== undefined ? externalSpecies : internalFilterSpecies;
  const setFilterSpecies = setInternalFilterSpecies;
  const searchEv = externalSearch !== undefined ? externalSearch : internalSearchEv;
  const setSearchEv = setInternalSearchEv;

  const [searchCondemned, setSearchCondemned] = useState("");
  const [filterCondemnedSpecies, setFilterCondemnedSpecies] = useState("all");
  const [filterCondemnedStatus, setFilterCondemnedStatus] = useState("needs_evidence");
  const [evidenceScopeFilter, setEvidenceScopeFilter] = useState("all"); // "all" | "partial" | "whole"

  const refreshAll = () => {
    refreshEvidence();
    refreshAnte();
    refreshPost();
    refreshLivestock();
    refreshCondemned();
    refreshOwners?.();
    refreshPostCuts?.();
  };

  // Condemnation evidence index: the single derived dataset shared with the
  // Ante-Mortem / Post-Mortem cards, so the card count always equals the number
  // of evidence records rendered below.
  const evidenceIndex = useCondemnationEvidenceIndex(
    type,
    { ante, post, livestock, condemned, evidence, owners },
    { filterSpecies, searchEv, evidenceScopeFilter }
  );
  const {
    allCondemnedList,
    allCondemnedTags,
    repository: filteredEvidenceByContext,
    display: filteredEvidence,
    displayAll: groupedEvidenceByContext,
  } = evidenceIndex;

  const getEvidenceTimestamp = useCallback(
    (ev) =>
      resolveCondemnationTimestamp({
        record: ev,
        livestock,
        ante,
        post,
        postCuts,
        condemned,
        evidence,
        stage: type,
      }),
    [livestock, ante, post, postCuts, condemned, evidence, type]
  );

  const allEvidenceTimestamps = useMemo(
    () => (groupedEvidenceByContext || []).map((ev) => getEvidenceTimestamp(ev)).filter(Boolean),
    [groupedEvidenceByContext, getEvidenceTimestamp]
  );
  const nowMs = use24HourRefreshClock(allEvidenceTimestamps);

  const sortedEvidence = useMemo(() => {
    return [...(filteredEvidence || [])].sort((a, b) => {
      const tsA = getEvidenceTimestamp(a);
      const tsB = getEvidenceTimestamp(b);
      const isNewA = isCondemnationWithin24Hours(tsA, nowMs);
      const isNewB = isCondemnationWithin24Hours(tsB, nowMs);
      if (isNewA !== isNewB) return isNewA ? -1 : 1;
      const msA = parseCondemnationTimestampMs(tsA);
      const msB = parseCondemnationTimestampMs(tsB);
      if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msB - msA;
      if (!isNaN(msA) && isNaN(msB)) return -1;
      if (isNaN(msA) && !isNaN(msB)) return 1;
      return 0;
    });
  }, [filteredEvidence, getEvidenceTimestamp, nowMs]);

  const newEvidenceCount = useMemo(
    () => (sortedEvidence || []).filter((ev) => isCondemnationWithin24Hours(getEvidenceTimestamp(ev), nowMs)).length,
    [sortedEvidence, getEvidenceTimestamp, nowMs]
  );

  const formatCondemnedWeight = (w) => {
    if (!w || isNaN(w) || Number(w) <= 0) return "0 kg";
    const num = Number(w);
    return num % 1 === 0 ? `${num} kg` : `${num.toFixed(2)} kg`;
  };


  // Map each condemned tag to its attached evidence count (per inspection stage)
  const evidenceCountByTag = useMemo(() => {
    const counts = {};
    const inCurrentStageList = (t) => {
      const key = String(t || "").trim().toLowerCase();
      if (!key) return false;
      return allCondemnedTags.some((x) => String(x || "").trim().toLowerCase() === key);
    };
    (evidence || []).forEach((ev) => {
      if (!ev.tag_number) return;
      if (!evidenceMatchesStage(ev, type, inCurrentStageList)) return;
      counts[ev.tag_number] = (counts[ev.tag_number] || 0) + 1;
    });
    return counts;
  }, [evidence, type, allCondemnedTags]);

  // Only condemned livestock with missing or unsubmitted evidence (fileCount === 0)
  const pendingEvidenceCondemnedList = useMemo(() => {
    return allCondemnedList.filter((c) => {
      const fileCount = evidenceCountByTag[c.tag_number] || 0;
      return fileCount === 0;
    });
  }, [allCondemnedList, evidenceCountByTag]);

  // Filtered condemned list for the top table
  const filteredCondemnedList = useMemo(() => {
    const q = searchCondemned.trim().toLowerCase();
    return allCondemnedList.filter((c) => {
      const matchSearch = !q ||
        (c.tag_number || "").toLowerCase().includes(q) ||
        (c.species || "").toLowerCase().includes(q) ||
        (c.breed || "").toLowerCase().includes(q) ||
        (c.owner_name || "").toLowerCase().includes(q) ||
        (c.reason || "").toLowerCase().includes(q) ||
        (c.source || "").toLowerCase().includes(q);
      const matchSpecies = filterCondemnedSpecies === "all" || c.species === filterCondemnedSpecies;
      const fileCount = evidenceCountByTag[c.tag_number] || 0;
      const matchStatus = filterCondemnedStatus === "all" ||
        (filterCondemnedStatus === "with_evidence" && fileCount > 0) ||
        (filterCondemnedStatus === "needs_evidence" && fileCount === 0);
      return matchSearch && matchSpecies && matchStatus;
    });
  }, [allCondemnedList, searchCondemned, filterCondemnedSpecies, filterCondemnedStatus, evidenceCountByTag]);

  const getEvidenceScope = (ev) =>
    getEvidenceScopeFor(ev, type, allCondemnedList, post, condemned);

  const getEvidencePartLabel = (ev) =>
    getEvidencePartLabelFor(ev, type, allCondemnedList, post, condemned);

  const cleanEvidenceNotes = (rawNotes) => {
    if (!rawNotes) return "";
    let str = String(rawNotes).trim();
    str = str.replace(/\[Whole Carcass Condemnation\]\s*/gi, "");
    str = str.replace(/\[Partial Condemnation[^\]]*\]\s*/gi, "");
    return str.trim();
  };

  // Scope totals are computed over the grouped (one-per-condemnation) set so the
  // partial + whole split always adds up to the number of records shown.
  const partialEvidenceCount = useMemo(() => {
    return groupedEvidenceByContext.filter((ev) => getEvidenceScope(ev) === "partial").length;
  }, [groupedEvidenceByContext, allCondemnedList, condemned]);

  const wholeEvidenceCount = useMemo(() => {
    return groupedEvidenceByContext.filter((ev) => getEvidenceScope(ev) === "whole").length;
  }, [groupedEvidenceByContext, allCondemnedList, condemned]);

  const getEvidenceSpecies = (ev) =>
    getEvidenceSpeciesFor(ev, allCondemnedList, livestock);

  const isValidOwnerName = (name) => {
    if (typeof name !== "string") return false;
    const clean = name.trim();
    return (
      clean !== "" &&
      clean !== "—" &&
      clean !== "-" &&
      clean.toLowerCase() !== "unknown" &&
      clean.toLowerCase() !== "unknown owner" &&
      clean.toLowerCase() !== "n/a"
    );
  };

  // Traces condemnation record -> inspection -> livestock -> registered owner
  // using existing relations only (livestock.owner_id -> owners.id is the FK).
  const getEvidenceOwner = (ev) => {
    if (!ev) return "—";

    const cleanTag = String(ev.tag_number || "").trim().toLowerCase();
    const cleanId = String(ev.livestock_id || "").trim();

    // The inspection this evidence belongs to (records may only carry the tag)
    const findInspection = (rows) =>
      (rows || []).find((i) => {
        const iTag = String(i.tag_number || "").trim().toLowerCase();
        const iId = String(i.livestock_id || "").trim();
        return (cleanTag && iTag === cleanTag) || (cleanId && iId === cleanId);
      });
    const stageHint = String(ev.inspection_type || type || "").trim().toLowerCase();
    const inspection =
      (stageHint.includes("post") ? findInspection(post) : findInspection(ante)) ||
      findInspection(ante) ||
      findInspection(post);

    const wantedId = cleanId || String(inspection?.livestock_id || "").trim();
    const animal = (livestock || []).find((l) => {
      const lId = String(l.id || "").trim();
      const lTag = String(l.tag_number || "").trim().toLowerCase();
      return (wantedId && lId === wantedId) || (cleanTag && lTag === cleanTag);
    });

    // livestock -> owners table (canonical display name via the existing FK)
    if (animal) {
      const ownerId = String(animal.owner_id || "").trim().toLowerCase();
      if (ownerId) {
        const owner = (owners || []).find((o) => {
          const oId = String(o.id || "").trim().toLowerCase();
          const oOwnerId = String(o.owner_id || "").trim().toLowerCase();
          const oTempId = String(o.temp_reg_id || "").trim().toLowerCase();
          return oId === ownerId || oOwnerId === ownerId || oTempId === ownerId;
        });
        if (owner && isValidOwnerName(owner.name)) return owner.name.trim();
      }
      if (isValidOwnerName(animal.owner_name)) return animal.owner_name.trim();
    }

    const merged = allCondemnedList.find((c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag);
    if (merged && isValidOwnerName(merged.owner_name)) return merged.owner_name.trim();

    if (isValidOwnerName(ev.owner_name)) return ev.owner_name.trim();
    if (inspection && isValidOwnerName(inspection.owner_name)) return inspection.owner_name.trim();

    return "—";
  };

  const getEvidenceOwnerId = useCallback(
    (ev) => {
      if (!ev) return "";
      const cleanTag = String(ev.tag_number || "").trim().toLowerCase();
      const cleanId = String(ev.livestock_id || "").trim();

      const findInspection = (rows) =>
        (rows || []).find((i) => {
          const iTag = String(i.tag_number || "").trim().toLowerCase();
          const iId = String(i.livestock_id || "").trim();
          return (cleanTag && iTag === cleanTag) || (cleanId && iId === cleanId);
        });
      const stageHint = String(ev.inspection_type || type || "").trim().toLowerCase();
      const inspection =
        (stageHint.includes("post") ? findInspection(post) : findInspection(ante)) ||
        findInspection(ante) ||
        findInspection(post);

      const wantedId = cleanId || String(inspection?.livestock_id || "").trim();
      const animal = (livestock || []).find((l) => {
        const lId = String(l.id || "").trim();
        const lTag = String(l.tag_number || "").trim().toLowerCase();
        return (wantedId && lId === wantedId) || (cleanTag && lTag === cleanTag);
      });

      if (animal?.owner_id) return String(animal.owner_id).trim();
      if (ev.owner_id) return String(ev.owner_id).trim();
      if (inspection?.owner_id) return String(inspection.owner_id).trim();

      const merged = allCondemnedList.find((c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag);
      if (merged?.owner_id) return String(merged.owner_id).trim();

      return "";
    },
    [type, ante, post, livestock, allCondemnedList]
  );

  const getEvidenceSex = useCallback(
    (ev) => {
      if (!ev) return "—";
      const cleanTag = String(ev.tag_number || "").trim().toLowerCase();
      const cleanId = String(ev.livestock_id || "").trim();

      const animal = (livestock || []).find((l) => {
        const lId = String(l.id || "").trim();
        const lTag = String(l.tag_number || "").trim().toLowerCase();
        return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
      });
      if (animal?.sex) return formatSex(animal.sex);

      if (ev.sex) return formatSex(ev.sex);

      const merged = allCondemnedList.find((c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag);
      if (merged?.sex) return formatSex(merged.sex);

      const anteRec = (ante || []).find((a) => String(a.tag_number || "").trim().toLowerCase() === cleanTag);
      if (anteRec?.sex) return formatSex(anteRec.sex);

      const postRec = (post || []).find((p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag);
      if (postRec?.sex) return formatSex(postRec.sex);

      return "—";
    },
    [livestock, allCondemnedList, ante, post]
  );

  const formatSpeciesList = (list) => {
    const arr = (list && list.length > 0 ? list : ["Livestock"]).filter(Boolean);
    const SPECIES_ORDER = ["Hog", "Carabao", "Cattle", "Goat"];
    const sorted = [...arr].sort((a, b) => {
      const idxA = SPECIES_ORDER.indexOf(a);
      const idxB = SPECIES_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return sorted.join(", ");
  };

  const [selectedOwnerKey, setSelectedOwnerKey] = useState(null);

  const groupedEvidenceByOwner = useMemo(() => {
    const map = new Map();

    (sortedEvidence || []).forEach((ev) => {
      const rawOwnerName = getEvidenceOwner(ev);
      const ownerName = rawOwnerName && rawOwnerName !== "—" ? rawOwnerName : "Unassigned Owner";
      const ownerId = getEvidenceOwnerId(ev);
      const key = ownerId ? `owner_id_${ownerId.toLowerCase()}` : `owner_name_${ownerName.toLowerCase().trim()}`;

      const rawTimestamp = getEvidenceTimestamp(ev);
      const sp = getEvidenceSpecies(ev);
      const scope = getEvidenceScope(ev);

      if (!map.has(key)) {
        map.set(key, {
          key,
          owner_id: ownerId,
          owner_name: ownerName,
          items: [],
          speciesSet: new Set(),
          latestTimestamp: rawTimestamp,
          rawDate: rawTimestamp,
          wholeCount: 0,
          partialCount: 0,
        });
      }

      const grp = map.get(key);
      grp.items.push(ev);
      if (sp && sp !== "—" && sp !== "Not recorded") {
        grp.speciesSet.add(sp);
      }
      if (scope === "whole") {
        grp.wholeCount += 1;
      } else if (scope === "partial") {
        grp.partialCount += 1;
      }

      const msEv = parseCondemnationTimestampMs(rawTimestamp);
      const msCurrent = parseCondemnationTimestampMs(grp.latestTimestamp);
      if (!isNaN(msEv) && (isNaN(msCurrent) || msEv > msCurrent)) {
        grp.latestTimestamp = rawTimestamp;
        grp.rawDate = rawTimestamp;
      }
    });

    const groups = Array.from(map.values()).map((grp) => {
      // Sort items within each owner group by actual condemnation timestamp, newest first
      const sortedItems = [...grp.items].sort((a, b) => {
        const msA = parseCondemnationTimestampMs(getEvidenceTimestamp(a));
        const msB = parseCondemnationTimestampMs(getEvidenceTimestamp(b));
        if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msB - msA;
        if (!isNaN(msA) && isNaN(msB)) return -1;
        if (isNaN(msA) && !isNaN(msB)) return 1;
        return 0;
      });

      return {
        ...grp,
        items: sortedItems,
        count: sortedItems.length,
        speciesList: Array.from(grp.speciesSet),
      };
    });

    return groups.sort((a, b) => {
      const msA = parseCondemnationTimestampMs(a.latestTimestamp);
      const msB = parseCondemnationTimestampMs(b.latestTimestamp);
      if (!isNaN(msA) && !isNaN(msB) && msA !== msB) return msB - msA;
      if (!isNaN(msA) && isNaN(msB)) return -1;
      if (isNaN(msA) && !isNaN(msB)) return 1;
      return a.owner_name.localeCompare(b.owner_name, undefined, { sensitivity: "base" });
    });
  }, [sortedEvidence, getEvidenceOwner, getEvidenceOwnerId, getEvidenceTimestamp, getEvidenceSpecies, getEvidenceScope]);

  const selectedOwnerView = useMemo(() => {
    if (!selectedOwnerKey) return null;
    return groupedEvidenceByOwner.find((g) => g.key === selectedOwnerKey) || null;
  }, [selectedOwnerKey, groupedEvidenceByOwner]);

  const ownerScopeCounts = useMemo(() => {
    if (!selectedOwnerKey) return { all: 0, partial: 0, whole: 0 };
    let all = 0;
    let partial = 0;
    let whole = 0;
    (groupedEvidenceByContext || []).forEach((ev) => {
      const rawOwnerName = getEvidenceOwner(ev);
      const ownerName = rawOwnerName && rawOwnerName !== "—" ? rawOwnerName : "Unassigned Owner";
      const ownerId = getEvidenceOwnerId(ev);
      const key = ownerId ? `owner_id_${ownerId.toLowerCase()}` : `owner_name_${ownerName.toLowerCase().trim()}`;
      if (key === selectedOwnerKey) {
        all += 1;
        const scope = getEvidenceScope(ev);
        if (scope === "whole") whole += 1;
        else if (scope === "partial") partial += 1;
      }
    });
    return { all, partial, whole };
  }, [selectedOwnerKey, groupedEvidenceByContext, getEvidenceOwner, getEvidenceOwnerId, getEvidenceScope]);

  // View records pagination (10 per page default)
  const [ownerViewPage, setOwnerViewPage] = useState(1);
  const [ownerViewPageSize, setOwnerViewPageSize] = useState(10);

  useEffect(() => {
    setOwnerViewPage(1);
  }, [selectedOwnerKey, type, evidenceScopeFilter, filterSpecies]);

  const ownerFilteredItems = useMemo(() => {
    if (!selectedOwnerView?.items) return [];
    if (filterSpecies === "all") return selectedOwnerView.items;
    const target = filterSpecies.toLowerCase();
    return selectedOwnerView.items.filter((ev) => {
      const s = getEvidenceSpecies(ev).toLowerCase();
      if (target === "carabao" || target === "caraboa") {
        return s === "carabao" || s === "caraboa";
      }
      return s === target;
    });
  }, [selectedOwnerView, filterSpecies, getEvidenceSpecies]);

  const paginatedOwnerItems = useMemo(() => {
    const start = (ownerViewPage - 1) * ownerViewPageSize;
    return ownerFilteredItems.slice(start, start + ownerViewPageSize);
  }, [ownerFilteredItems, ownerViewPage, ownerViewPageSize]);

  const countEvidenceBySpecies = (sp) => {
    const target = sp.toLowerCase();
    const source = selectedOwnerView
      ? (selectedOwnerView.items || [])
      : groupedEvidenceByContext;
    return source.filter((ev) => {
      const s = getEvidenceSpecies(ev).toLowerCase();
      if (target === "carabao" || target === "caraboa") {
        return s === "carabao" || s === "caraboa";
      }
      return s === target;
    }).length;
  };

  const getTagCondemnedParts = (targetEv) => {
    if (!targetEv) return [];
    const cleanTag = String(targetEv.tag_number || "").trim().toLowerCase();

    // Check if this tag represents a Whole Carcass Condemnation or Ante-Mortem Rejection
    const evScope = getEvidenceScope(targetEv);
    const postRecord = type === "Post-Mortem"
      ? (post || []).find((p) => String(p.tag_number || "").trim().toLowerCase() === cleanTag)
      : null;
    const postDecision = String(postRecord?.decision || "").toLowerCase();
    const isWholeCarcassCond =
      evScope === "whole" ||
      postDecision === "condemned" ||
      postDecision === "rejected" ||
      postDecision === "whole carcass condemned" ||
      postDecision === "totally condemned";

    if (isWholeCarcassCond) {
      const condRec = (condemned || []).find(
        (c) => String(c.tag_number || "").trim().toLowerCase() === cleanTag && matchesStage(c, type)
      );
      const anteRec = (ante || []).find((a) => String(a.tag_number || "").trim().toLowerCase() === cleanTag);
      const isAnte = type === "Ante-Mortem" || targetEv.inspection_type === "Ante-Mortem";
      const partTitle = isAnte ? "Live Animal" : "Whole Carcass";
      const locationText = isAnte ? "Intake / Holding Pen" : "Entire Carcass";
      const rawReason = condRec?.reason || postRecord?.findings || postRecord?.remarks || anteRec?.reason || targetEv.notes || "Whole Carcass Condemnation";
      const cleanReason = String(rawReason)
        .replace(/^Whole Carcass Condemned:\s*/i, "")
        .replace(/^Ante-Mortem Condemned:\s*/i, "")
        .replace(/^Post-Mortem Whole Condemned:\s*/i, "")
        .trim();
      const weightVal = parseFloat(condRec?.weight_kg) || parseFloat(postRecord?.carcass_weight) || parseFloat(postRecord?.weight) || 0;

      return [
        {
          _key: `whole__${cleanTag}`,
          id: condRec?.id || postRecord?.id || `whole-${cleanTag}`,
          part: partTitle,
          location: locationText,
          weight_kg: weightVal > 0 ? weightVal : null,
          quantity: isAnte ? "1 Head" : "Whole Carcass",
          reason: cleanReason || "Unfit for human consumption",
          disposition: condRec?.disposition || postRecord?.disposition || "Condemned / Rendered",
          notes: condRec?.notes || postRecord?.remarks || postRecord?.findings || targetEv.notes || "",
          photos: targetEv.photos || (targetEv.file_url ? [{ url: targetEv.file_url, name: partTitle }] : []),
        }
      ];
    }

    const partsList = [];
    const seenPartKeys = new Set();

    const addPart = (pData) => {
      if (!pData) return;
      const partName = String(pData.part || pData.name || "Condemned Part").trim();
      if (!partName || partName.toLowerCase() === "none") return;

      const locStr = String(pData.location || pData.area || "").trim();
      const partKey = `${partName.toLowerCase()}__${locStr.toLowerCase()}`;
      if (seenPartKeys.has(partKey)) {
        const existing = partsList.find((p) => p._key === partKey);
        if (existing) {
          if ((!existing.location || existing.location === "—") && locStr) existing.location = locStr;
          if ((!existing.weight_kg || existing.weight_kg === 0) && (pData.weight_kg || pData.weight)) {
            existing.weight_kg = parseFloat(pData.weight_kg) || parseFloat(pData.weight) || 0;
          }
          if (!existing.reason && (pData.reason || pData.pathology)) existing.reason = pData.reason || pData.pathology;
          if (!existing.disposition && pData.disposition) existing.disposition = pData.disposition;
          if ((!existing.photos || existing.photos.length === 0) && Array.isArray(pData.photos) && pData.photos.length > 0) {
            existing.photos = pData.photos.slice(0, 3);
          }
        }
        return;
      }
      seenPartKeys.add(partKey);

      const w = parseFloat(pData.weight_kg) || parseFloat(pData.weight) || parseFloat(String(pData.quantity || "").replace(/[^0-9.]/g, "")) || 0;

      let partPhotos = [];
      if (Array.isArray(pData.photos)) {
        partPhotos = pData.photos;
      } else if (pData.photo_url || pData.photo || pData.file_url) {
        partPhotos = [{ url: pData.photo_url || pData.photo || pData.file_url, name: partName }];
      }

      partsList.push({
        _key: partKey,
        id: pData.id || `part-${partsList.length + 1}`,
        part: partName,
        location: locStr || "—",
        weight_kg: w > 0 ? (w % 1 === 0 ? w : parseFloat(w.toFixed(2))) : null,
        quantity: pData.quantity || (w > 0 ? `${w} kg` : "—"),
        reason: pData.reason || pData.pathology || pData.findings || "Condemned",
        disposition: pData.disposition || "Condemned / Rendered",
        notes: pData.notes || pData.findings || "",
        photos: (partPhotos || []).slice(0, 3),
      });
    };

    // 1. Search post-mortem inspections for this tag (Post-Mortem view only)
    if (type === "Post-Mortem") {
      (post || []).forEach((p) => {
        if (String(p.tag_number || "").trim().toLowerCase() === cleanTag) {
          if (Array.isArray(p.condemned_parts) && p.condemned_parts.length > 0) {
            p.condemned_parts.forEach((cp) => {
              addPart({
                ...cp,
                disposition: cp.disposition || p.disposition || "Condemned / Rendered",
                notes: cp.notes || p.remarks || p.findings,
              });
            });
          } else if (p.part && p.part !== "None") {
            addPart({
              part: p.part,
              location: p.location || "—",
              weight_kg: parseFloat(p.weight_kg) || parseFloat(p.weight) || 0,
              reason: p.findings || p.remarks || "Partial Condemnation",
              disposition: p.disposition || "Condemned / Rendered",
              notes: p.remarks || p.findings,
              photos: p.photos,
            });
          }
        }
      });
    }

    // 2. Search condemnation_records table for this tag (current stage only)
    (condemned || []).forEach((c) => {
      if (matchesStage(c, type) && String(c.tag_number || "").trim().toLowerCase() === cleanTag) {
        addPart({
          ...c,
          location: c.location || "—",
          disposition: c.disposition || "Condemned / Rendered",
        });
      }
    });

    // 3. Search ante-mortem inspections if ante (Ante-Mortem view only)
    if (type === "Ante-Mortem" && partsList.length === 0) {
      (ante || []).forEach((a) => {
        if (String(a.tag_number || "").trim().toLowerCase() === cleanTag) {
          const d = String(a.decision || "").trim().toLowerCase();
          if (d === "condemned" || d === "rejected" || (a.findings && a.findings.toLowerCase().includes("condemn"))) {
            addPart({
              part: "Live Animal",
              location: "Intake / Holding Pen",
              weight_kg: parseFloat(a.live_weight) || parseFloat(a.weight) || 0,
              reason: a.reason || a.findings || a.remarks || "Ante-Mortem Condemnation",
              disposition: "Condemned / Rejected",
              notes: a.remarks || a.findings,
              photos: a.photos,
            });
          }
        }
      });
    }

    // 4. Fallback from targetEv itself
    if (partsList.length === 0) {
      if (Array.isArray(targetEv.condemned_parts) && targetEv.condemned_parts.length > 0) {
        targetEv.condemned_parts.forEach((cp) => addPart(cp));
      } else if (targetEv.part) {
        addPart({
          part: targetEv.part,
          location: targetEv.location || "—",
          weight_kg: targetEv.weight_kg,
          reason: targetEv.reason || targetEv.notes,
          disposition: targetEv.disposition || "Condemned / Rendered",
          photos: targetEv.photos,
        });
      } else {
        const partLabel = getEvidencePartLabel(targetEv);
        addPart({
          part: partLabel || (type === "Ante-Mortem" ? "Live Animal" : "Condemned Cut"),
          location: "—",
          weight_kg: targetEv.weight_kg || null,
          reason: cleanEvidenceNotes(targetEv.notes) || "Condemnation",
          disposition: "Condemned / Rendered",
        });
      }
    }

    // 5. Guarantee evidence photos are linked to each part
    const tagPhotos = getTagPhotosList(targetEv);

    partsList.forEach((partItem) => {
      let pPhotos = Array.isArray(partItem.photos) ? partItem.photos : [];
      pPhotos = pPhotos.map((p, pIdx) => {
        const u = typeof p === "string" ? p : (p.url || p.preview || p.file_url || p.file_preview);
        return {
          id: p?.id || `${partItem.part}-photo-${pIdx}`,
          url: u,
          name: p?.name || `${partItem.part} Photo ${pIdx + 1}`,
        };
      }).filter((p) => !!p.url);

      if (pPhotos.length === 0) {
        const cleanPart = partItem.part.toLowerCase();
        const matchingEvPhotos = (evidence || []).filter((ev) => {
          if (String(ev.tag_number || "").trim().toLowerCase() !== cleanTag) return false;
          const notes = `${ev.notes || ""} ${ev.file_name || ""}`.toLowerCase();
          return notes.includes(cleanPart);
        });

        matchingEvPhotos.forEach((ev) => {
          const u = ev.file_url || ev.file_preview || ev.url || ev.image_url;
          if (u) pPhotos.push({ id: ev.id || u, url: u, name: ev.file_name || `${partItem.part} Photo` });
          if (Array.isArray(ev.photos)) {
            ev.photos.forEach((p, pIdx) => {
              const pu = typeof p === "string" ? p : (p.url || p.preview || p.file_url || p.file_preview);
              if (pu) pPhotos.push({ id: p.id || pu, url: pu, name: p.name || `${partItem.part} Photo ${pIdx + 1}` });
            });
          }
        });
      }

      if (pPhotos.length === 0 && tagPhotos.length > 0) {
        pPhotos = tagPhotos.map((tp, idx) => ({ id: tp.id || idx, url: tp.url, name: tp.name || `${partItem.part} Photo ${idx + 1}` }));
      }

      const seenP = new Set();
      partItem.photos = pPhotos.filter((p) => {
        if (!p.url) return false;
        const key = String(p.url).split("?")[0].toLowerCase();
        if (seenP.has(key)) return false;
        seenP.add(key);
        return true;
      }).slice(0, 3);
    });

    return partsList;
  };


  const handleFilterToTag = (tag) => {
    setSearchEv(tag);
    const repoEl = document.getElementById("evidence-repository-card");
    if (repoEl) {
      repoEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Stats
  const statTotalFiles = filteredEvidenceByContext.length;
  const statCondemnedCount = allCondemnedList.length;
  const statPendingEvidenceCount = pendingEvidenceCondemnedList.length;
  const statWithEvidence = allCondemnedList.filter((c) => (evidenceCountByTag[c.tag_number] || 0) > 0).length;
  const statPhotos = filteredEvidenceByContext.filter((ev) => ev.type === "Photo").length;
  const statLabs = filteredEvidenceByContext.filter((ev) => ev.type === "Lab Result").length;
  const statDocs = filteredEvidenceByContext.filter((ev) => ev.type === "Report Document" || ev.type === "Inspection Slip").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!hideHeader && (
        <PageHeader
          title={type === "Ante-Mortem" ? "Ante-Mortem Condemnation Evidence" : "Post-Mortem Condemnation Evidence"}
          subtitle={type === "Ante-Mortem"
            ? "Upload and manage visual evidence, photos, and laboratory reports for all animals declared condemned in Ante-Mortem"
            : "Upload and manage visual evidence, pathology photos, and reports for partial cuts and whole condemned carcasses"}
          icon={<Icon.Upload />}
        />
      )}

      {/* KPI Stats Row */}
      {!hideStats && (
        type === "Post-Mortem" ? (
          <div className="grid grid-4" style={{ gap: 16 }}>
            <StatCard
              label="Total Evidence Files"
              value={statTotalFiles}
              trend="Photos, pathology & lab records"
              icon={<Icon.FileText size={24} />}
              color="sky"
            />
            <StatCard
              label="Partial Condemned Photos"
              value={partialEvidenceCount}
              trend="Visual proof for cuts & organs"
              icon={<Icon.Layers size={24} />}
              color="amber"
            />
            <StatCard
              label="Whole Carcass Photos"
              value={wholeEvidenceCount}
              trend="Visual proof for full carcass disposal"
              icon={<Icon.AlertTriangle size={24} />}
              color="rose"
            />
            <StatCard
              label="Pending Meat Evidence"
              value={statPendingEvidenceCount}
              trend={`${statWithEvidence} completed · ${statCondemnedCount} condemned`}
              icon={<Icon.Clock size={24} />}
              color={statPendingEvidenceCount > 0 ? "rose" : "emerald"}
            />
          </div>
        ) : (
          <div className="grid grid-4" style={{ gap: 16 }}>
            <StatCard
              label="Missing Evidence"
              value={statPendingEvidenceCount}
              trend={`${statWithEvidence} completed · ${statCondemnedCount} condemned total`}
              icon={<Icon.AlertTriangle size={24} />}
              color={statPendingEvidenceCount > 0 ? "rose" : "emerald"}
            />
            <StatCard
              label="Total Evidence Files"
              value={statTotalFiles}
              trend="Photos, labs & inspection records"
              icon={<Icon.FileText size={24} />}
              color="sky"
            />
            <StatCard
              label="Photographic Evidence"
              value={statPhotos}
              trend="Clinical lesions & pathology photos"
              icon={<Icon.Layers size={24} />}
              color="emerald"
            />
            <StatCard
              label="Lab & Report Documents"
              value={statLabs + statDocs}
              trend="Diagnostic sheets & signed reports"
              icon={<Icon.Activity size={24} />}
              color="amber"
            />
          </div>
        )
      )}

      {/* ── EVIDENCE REPOSITORY ── */}
      <div id="evidence-repository-card" style={{ width: "100%" }}>
        {hideHeader ? (
          <div style={{ width: "100%", background: "transparent", border: "none", boxShadow: "none" }}>
            {loadingEvidence || loadingLivestock ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", color: "var(--color-text-muted)" }}>
                <span className="spinner" style={{ width: 28, height: 28, marginBottom: 12 }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Loading condemnation evidence...</span>
              </div>
            ) : errorEvidence || errorLivestock || errorOwners ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 16px", color: "var(--color-danger, #ef4444)", textAlign: "center" }}>
                <Icon.AlertTriangle size={32} style={{ marginBottom: 10 }} />
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
                  Failed to load condemnation evidence
                </p>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 4 }}>
                  {(errorEvidence || errorLivestock || errorOwners)?.message || "A network or server error occurred."}
                </span>
                <Button size="sm" variant="outline" onClick={refreshAll} style={{ marginTop: 12 }}>
                  <Icon.RotateCcw size={13} /> Retry
                </Button>
              </div>
            ) : filteredEvidence.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", color: "var(--color-text-muted)", textAlign: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, color: "var(--color-text-muted)" }}>
                  <Icon.FileText size={28} />
                </div>
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--color-text)" }}>
                  {searchEv
                    ? `No evidence matching "${searchEv}"`
                    : evidenceScopeFilter === "partial"
                    ? "No partial condemnation photos found"
                    : evidenceScopeFilter === "whole"
                    ? "No whole carcass condemnation photos found"
                    : filterSpecies !== "all"
                    ? `No evidence documents found for ${filterSpecies}`
                    : "No evidence documents found"}
                </p>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 4 }}>
                  {searchEv
                    ? "Try searching by a different owner name, tag number, findings, or file."
                    : "Condemnation evidence photos are attached when creating or editing condemnation records."}
                </span>
                {(searchEv || filterSpecies !== "all") && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {searchEv && (
                      <Button size="sm" variant="outline" onClick={() => setSearchEv("")}>
                        Clear Search
                      </Button>
                    )}
                    {filterSpecies !== "all" && (
                      <Button size="sm" variant="outline" onClick={() => setFilterSpecies("all")}>
                        Show All Species
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Main Owner List Table (matches Awaiting List layout) */
              <div className="records-scrollable-content table-wrap" style={{ overflowX: "auto", overflowY: "auto", scrollbarWidth: "thin", border: "none", boxShadow: "none", flex: 1, minHeight: 0 }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Owner Name
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        {type === "Ante-Mortem" ? "Inspection Date" : "Condemnation Date"}
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Species
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>
                        {type === "Ante-Mortem" ? "Condemned Heads" : "Condemned Records"}
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Status / Scope
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedEvidenceByOwner.map((grp) => {
                      return (
                        <tr
                          key={grp.key}
                          onClick={() => setSelectedOwnerKey(grp.key)}
                          style={{
                            cursor: "pointer",
                            transition: "background 140ms ease",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(2, 132, 199, 0.04)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          {/* Owner Name */}
                          <td style={{ padding: "14px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  background:
                                    type === "Ante-Mortem"
                                      ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                                      : "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
                                  color: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 700,
                                  fontSize: 11.5,
                                  flexShrink: 0,
                                }}
                              >
                                {initials(grp.owner_name)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                                  {grp.owner_name}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                  {grp.count} condemned {type === "Ante-Mortem" ? (grp.count === 1 ? "head" : "heads") : (grp.count === 1 ? "record / carcass" : "records / carcasses")}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Date Condemned */}
                          <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon.Calendar size={13} style={{ opacity: 0.7, color: type === "Ante-Mortem" ? "#0284c7" : "#8b5cf6" }} />
                              <span>{grp.latestTimestamp ? formatManilaDateTime(grp.latestTimestamp) : "Date not recorded"}</span>
                            </div>
                          </td>

                          {/* Species */}
                          <td style={{ padding: "14px 18px" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                              {formatSpeciesList(grp.speciesList)}
                            </span>
                          </td>

                          {/* Total Heads / Records */}
                          <td style={{ padding: "14px 18px", textAlign: "center" }}>
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: type === "Ante-Mortem" ? "#0284c7" : "#7c3aed",
                              }}
                            >
                              {grp.count} {type === "Ante-Mortem" ? (grp.count === 1 ? "head" : "heads") : (grp.count === 1 ? "carcass" : "carcasses")}
                            </span>
                          </td>

                          {/* Status / Scope */}
                          <td style={{ padding: "14px 18px" }}>
                            {type === "Ante-Mortem" ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#dc2626",
                                  background: "rgba(220, 38, 38, 0.08)",
                                  border: "1px solid rgba(220, 38, 38, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626" }} />
                                Whole Animal Condemned
                              </span>
                            ) : grp.wholeCount > 0 && grp.partialCount === 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#dc2626",
                                  background: "rgba(220, 38, 38, 0.08)",
                                  border: "1px solid rgba(220, 38, 38, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626" }} />
                                Whole Carcass ({grp.wholeCount})
                              </span>
                            ) : grp.partialCount > 0 && grp.wholeCount === 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#d97706",
                                  background: "rgba(217, 119, 6, 0.08)",
                                  border: "1px solid rgba(217, 119, 6, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706" }} />
                                Partial Cut ({grp.partialCount})
                              </span>
                            ) : (
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#dc2626",
                                    background: "rgba(220, 38, 38, 0.08)",
                                    border: "1px solid rgba(220, 38, 38, 0.2)",
                                    padding: "2px 6px",
                                    borderRadius: 5,
                                  }}
                                >
                                  {grp.wholeCount} Whole
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#d97706",
                                    background: "rgba(217, 119, 6, 0.08)",
                                    border: "1px solid rgba(217, 119, 6, 0.2)",
                                    padding: "2px 6px",
                                    borderRadius: 5,
                                  }}
                                >
                                  {grp.partialCount} Partial
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Action */}
                          <td style={{ padding: "14px 18px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedOwnerKey(grp.key)}
                              style={{
                                height: 32,
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-text)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
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
          </div>
        ) : (
          /* Evidence Repository Card */
          <Card
            title="Evidence Repository"
            icon={<Icon.FileText />}
            badge={
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {newEvidenceCount > 0 && (
                  <span
                    title="Newly condemned within the last 12 hours"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 8px",
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#ffffff",
                      background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                      boxShadow: "0 1px 4px rgba(245, 158, 11, 0.3)",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffffff" }} />
                    {newEvidenceCount} New (12h)
                  </span>
                )}
                <span style={{ color: "#0369a1", fontSize: 12, fontWeight: 700 }}>
                  {sortedEvidence.length} File{sortedEvidence.length !== 1 ? "s" : ""}
                </span>
              </div>
            }
          >
            {/* Repository Toolbar: Search Bar (Left), Species Filter (Center), Scope Filter (Right) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 14,
              }}
            >
              {/* Search Bar (searches owner name, tag #, findings, or file) */}
              <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
                <input
                  type="text"
                  placeholder="Search by owner name, tag #, findings, or file..."
                  value={searchEv}
                  onChange={(e) => setSearchEv(e.target.value)}
                  style={{
                    width: "100%",
                    height: 34,
                    paddingLeft: 32,
                    paddingRight: searchEv ? 28 : 10,
                    fontSize: 12.5,
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <Icon.Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--color-text-muted)",
                    pointerEvents: "none",
                    zIndex: 10
                  }}
                />
                {searchEv && (
                  <button
                    type="button"
                    onClick={() => setSearchEv("")}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      padding: 2,
                      display: "flex",
                    }}
                    title="Clear search"
                  >
                    <Icon.X size={13} />
                  </button>
                )}
              </div>
            </div>

            {loadingEvidence || loadingLivestock ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", color: "var(--color-text-muted)" }}>
                <span className="spinner" style={{ width: 28, height: 28, marginBottom: 12 }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Loading condemnation evidence...</span>
              </div>
            ) : errorEvidence || errorLivestock || errorOwners ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 16px", color: "var(--color-danger, #ef4444)", textAlign: "center" }}>
                <Icon.AlertTriangle size={32} style={{ marginBottom: 10 }} />
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
                  Failed to load condemnation evidence
                </p>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 4 }}>
                  {(errorEvidence || errorLivestock || errorOwners)?.message || "A network or server error occurred."}
                </span>
                <Button size="sm" variant="outline" onClick={refreshAll} style={{ marginTop: 12 }}>
                  <Icon.RotateCcw size={13} /> Retry
                </Button>
              </div>
            ) : filteredEvidence.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", color: "var(--color-text-muted)", textAlign: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, color: "var(--color-text-muted)" }}>
                  <Icon.FileText size={28} />
                </div>
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--color-text)" }}>
                  {searchEv
                    ? `No evidence matching "${searchEv}"`
                    : evidenceScopeFilter === "partial"
                    ? "No partial condemnation photos found"
                    : evidenceScopeFilter === "whole"
                    ? "No whole carcass condemnation photos found"
                    : filterSpecies !== "all"
                    ? `No evidence documents found for ${filterSpecies}`
                    : "No evidence documents found"}
                </p>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 4 }}>
                  {searchEv
                    ? "Try searching by a different owner name, tag number, findings, or file."
                    : "Condemnation evidence photos are attached when creating or editing condemnation records."}
                </span>
                {(searchEv || filterSpecies !== "all") && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {searchEv && (
                      <Button size="sm" variant="outline" onClick={() => setSearchEv("")}>
                        Clear Search
                      </Button>
                    )}
                    {filterSpecies !== "all" && (
                      <Button size="sm" variant="outline" onClick={() => setFilterSpecies("all")}>
                        Show All Species
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Main Owner List Table (matches Awaiting List layout) */
              <div className="table-wrap" style={{ overflowX: "auto", border: "none", boxShadow: "none" }}>
                <table className="table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "var(--color-bg)", borderBottom: "1.5px solid var(--color-border)" }}>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Owner Name
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        {type === "Ante-Mortem" ? "Inspection Date" : "Condemnation Date"}
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Species
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "center" }}>
                        {type === "Ante-Mortem" ? "Condemned Heads" : "Condemned Records"}
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }}>
                        Status / Scope
                      </th>
                      <th style={{ padding: "14px 18px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)", textAlign: "right" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedEvidenceByOwner.map((grp) => {
                      return (
                        <tr
                          key={grp.key}
                          onClick={() => setSelectedOwnerKey(grp.key)}
                          style={{
                            cursor: "pointer",
                            transition: "background 140ms ease",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(2, 132, 199, 0.04)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          {/* Owner Name */}
                          <td style={{ padding: "14px 18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  background:
                                    type === "Ante-Mortem"
                                      ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                                      : "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
                                  color: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 700,
                                  fontSize: 11.5,
                                  flexShrink: 0,
                                }}
                              >
                                {initials(grp.owner_name)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13.5 }}>
                                  {grp.owner_name}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                                  {grp.count} condemned {type === "Ante-Mortem" ? (grp.count === 1 ? "head" : "heads") : (grp.count === 1 ? "record / carcass" : "records / carcasses")}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Date Condemned */}
                          <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text)", fontWeight: 600 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon.Calendar size={13} style={{ opacity: 0.7, color: type === "Ante-Mortem" ? "#0284c7" : "#8b5cf6" }} />
                              <span>{grp.latestTimestamp ? formatManilaDateTime(grp.latestTimestamp) : "Date not recorded"}</span>
                            </div>
                          </td>

                          {/* Species */}
                          <td style={{ padding: "14px 18px" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                              {formatSpeciesList(grp.speciesList)}
                            </span>
                          </td>

                          {/* Total Heads / Records */}
                          <td style={{ padding: "14px 18px", textAlign: "center" }}>
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: type === "Ante-Mortem" ? "#0284c7" : "#7c3aed",
                              }}
                            >
                              {grp.count} {type === "Ante-Mortem" ? (grp.count === 1 ? "head" : "heads") : (grp.count === 1 ? "carcass" : "carcasses")}
                            </span>
                          </td>

                          {/* Status / Scope */}
                          <td style={{ padding: "14px 18px" }}>
                            {type === "Ante-Mortem" ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#dc2626",
                                  background: "rgba(220, 38, 38, 0.08)",
                                  border: "1px solid rgba(220, 38, 38, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626" }} />
                                Whole Animal Condemned
                              </span>
                            ) : grp.wholeCount > 0 && grp.partialCount === 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#dc2626",
                                  background: "rgba(220, 38, 38, 0.08)",
                                  border: "1px solid rgba(220, 38, 38, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626" }} />
                                Whole Carcass ({grp.wholeCount})
                              </span>
                            ) : grp.partialCount > 0 && grp.wholeCount === 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#d97706",
                                  background: "rgba(217, 119, 6, 0.08)",
                                  border: "1px solid rgba(217, 119, 6, 0.2)",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706" }} />
                                Partial Cut ({grp.partialCount})
                              </span>
                            ) : (
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#dc2626",
                                    background: "rgba(220, 38, 38, 0.08)",
                                    border: "1px solid rgba(220, 38, 38, 0.2)",
                                    padding: "2px 6px",
                                    borderRadius: 5,
                                  }}
                                >
                                  {grp.wholeCount} Whole
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#d97706",
                                    background: "rgba(217, 119, 6, 0.08)",
                                    border: "1px solid rgba(217, 119, 6, 0.2)",
                                    padding: "2px 6px",
                                    borderRadius: 5,
                                  }}
                                >
                                  {grp.partialCount} Partial
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Action */}
                          <td style={{ padding: "14px 18px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedOwnerKey(grp.key)}
                              style={{
                                height: 32,
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-text)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
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
          </Card>
        )}
      </div>
      
      {/* Standardized Dedicated Owner Records Modal */}
      <Modal
        open={Boolean(selectedOwnerView)}
        onClose={() => {
          setSelectedOwnerKey(null);
          setFilterSpecies("all");
          setEvidenceScopeFilter("all");
        }}
        title={`Condemnation Records — ${selectedOwnerView?.owner_name || ""}`}
        headerRight={
          selectedOwnerView && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Species Filter */}
              <div style={{ position: "relative", minWidth: 140 }}>
                <select
                  value={filterSpecies}
                  onChange={(e) => {
                    setFilterSpecies(e.target.value);
                    setOwnerViewPage(1);
                  }}
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
                  <option value="all">All Species ({selectedOwnerView.items?.length || 0})</option>
                  {["Hog", "Cattle", "Carabao", "Goat"].map((sp) => (
                    <option key={sp} value={sp}>{sp} ({countEvidenceBySpecies(sp)})</option>
                  ))}
                </select>
              </div>
              {/* Scope Filter for Post-Mortem */}
              {type === "Post-Mortem" && (
                <div style={{ position: "relative", minWidth: 140 }}>
                  <select
                    value={evidenceScopeFilter}
                    onChange={(e) => {
                      setEvidenceScopeFilter(e.target.value);
                      setOwnerViewPage(1);
                    }}
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
                    <option value="all">All Evidence ({ownerScopeCounts.all})</option>
                    <option value="partial">✂️ Partial ({ownerScopeCounts.partial})</option>
                    <option value="whole">🚫 Whole Carcass ({ownerScopeCounts.whole})</option>
                  </select>
                </div>
              )}
            </div>
          )
        }
        size="xl"
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {ownerFilteredItems.length} condemned record{ownerFilteredItems.length === 1 ? "" : "s"}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedOwnerKey(null);
                setFilterSpecies("all");
                setEvidenceScopeFilter("all");
              }}
              style={{ minWidth: 80, fontWeight: 700 }}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedOwnerView && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* All Condemnation Cards for this Owner */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "14px",
                maxHeight: "65vh",
                overflowY: "auto",
                scrollbarWidth: "thin",
                padding: "2px",
              }}
            >
              {ownerFilteredItems.map((ev) => {
                const animalInfo = allCondemnedList.find((c) => c.tag_number === ev.tag_number);
                const scope = getEvidenceScope(ev);
                const isWhole = scope === "whole";
                const cutLabel = getEvidencePartLabel(ev);
                const tagPhotosList = getTagPhotosList(ev);
                const thumbPhoto = tagPhotosList[0] || null;
                const photoCount = tagPhotosList.length;
                const rawTimestamp = getEvidenceTimestamp(ev);
                const isNew = isCondemnationWithin24Hours(rawTimestamp, nowMs);
                const scopeBadgeLabel =
                  type === "Post-Mortem"
                    ? isWhole
                      ? "Whole Carcass"
                      : `Partial · ${cutLabel || "Cut"}`
                    : "Whole Animal";
                const rawNotesText = cleanEvidenceNotes(ev.notes) || "Not recorded";
                const conciseFindings =
                  rawNotesText
                    .replace(/^Condemnation\s*\((?:Live Animal|Whole Carcass|Primal Cut)\)\s*:\s*/i, "")
                    .trim() || rawNotesText;
                const resolvedSpecies = animalInfo?.species || getEvidenceSpecies(ev) || "Not recorded";
                const resolvedSex = getEvidenceSex(ev);
                const resolvedOwner = getEvidenceOwner(ev) || selectedOwnerView.owner_name;
                const defaultBorder = isNew ? "1.5px solid #f59e0b" : "1px solid var(--color-border)";
                return (
                  <div
                    key={ev.id}
                    className="evidence-card"
                    role="button"
                    tabIndex={0}
                    style={{
                      border: defaultBorder,
                      borderRadius: "12px",
                      background: isNew
                        ? "linear-gradient(180deg, rgba(254, 243, 199, 0.28) 0%, var(--color-surface) 46%)"
                        : "var(--color-surface)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      cursor: "pointer",
                      position: "relative",
                      transition: "all 0.16s ease",
                    }}
                    onClick={() => { setViewingEv(ev); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingEv(ev); } }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "135px",
                        background: "#0f172a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {thumbPhoto?.url ? (
                        <img src={thumbPhoto.url} alt={thumbPhoto.name || "Evidence"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Icon.FileText size={32} style={{ color: "#94a3b8" }} />
                      )}
                      <span
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          background: isWhole ? "rgba(220, 38, 38, 0.9)" : "rgba(217, 119, 6, 0.9)",
                          color: "#ffffff",
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 4,
                        }}
                      >
                        {scopeBadgeLabel}
                      </span>
                      {photoCount > 1 && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: 8,
                            right: 8,
                            background: "rgba(15, 23, 42, 0.8)",
                            color: "#ffffff",
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          +{photoCount - 1} photos
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--color-text)",
                          }}
                        >
                          {ev.tag_number || "Not recorded"}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-primary, #10b981)" }}>
                          {resolvedSpecies} {resolvedSex && resolvedSex !== "—" ? `· ${resolvedSex}` : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Icon.User size={12} style={{ display: "inline", marginRight: 4 }} />
                        {resolvedOwner}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text)",
                          background: "var(--color-bg)",
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--color-border)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.35,
                        }}
                        title={conciseFindings}
                      >
                        {conciseFindings}
                      </div>
                      <div style={{ marginTop: "auto", paddingTop: 6, borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {formatPhDateTime(rawTimestamp)}
                        </span>
                        <span
                          style={{ fontSize: 11, fontWeight: 700, color: "var(--color-primary, #0284c7)", cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingEv(ev);
                          }}
                        >
                          View Details →
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* Vet Personnel Condemnation Evidence View File Modal */}
      <Modal
        open={!!viewingEv}
        onClose={handleModalDismiss}
        title="Condemnation Evidence Viewer"
        size={isVetViewer ? "xl" : "md"}
        closeOnBackdropClick={isVetViewer}
      >
        {viewingEv && (() => {
          const tagPhotos = viewerPhotos;
          const currentPhotoIndex = currentViewerIndex;
          const currentPhoto = currentViewerPhoto || {
            url: null,
            name: viewingEv.file_name || "",
            notes: viewingEv.notes || "",
            part: viewingEv.part || "",
            record: viewingEv,
          };
          const displayRecord = currentPhoto.record || viewingEv;

          const cleanTag = String(displayRecord?.tag_number || viewingEv?.tag_number || "").trim().toLowerCase();
          const cleanId = String(displayRecord?.livestock_id || viewingEv?.livestock_id || "").trim();
          const stage = displayRecord?.inspection_type || type || "Ante-Mortem";
          const scope = getEvidenceScope(displayRecord);
          const isWhole = scope === "whole";

          // Look up source records without inventing values
          const matchedAnimal = (livestock || []).find((l) => {
            const lId = String(l.id || "").trim();
            const lTag = String(l.tag_number || "").trim().toLowerCase();
            return (cleanId && lId === cleanId) || (cleanTag && lTag === cleanTag);
          });
          const matchedAnte = (ante || []).find((a) => {
            const aTag = String(a.tag_number || "").trim().toLowerCase();
            const aId = String(a.livestock_id || "").trim();
            return (cleanTag && aTag === cleanTag) || (cleanId && aId === cleanId);
          });
          const matchedPost = (post || []).find((p) => {
            const pTag = String(p.tag_number || "").trim().toLowerCase();
            const pId = String(p.livestock_id || "").trim();
            return (cleanTag && pTag === cleanTag) || (cleanId && pId === cleanId);
          });
          const matchedInspection = stage === "Post-Mortem" ? (matchedPost || matchedAnte) : (matchedAnte || matchedPost);
          const matchedCondemnedRows = (condemned || []).filter(
            (c) => cleanTag && String(c.tag_number || "").trim().toLowerCase() === cleanTag && matchesStage(c, stage)
          );

          // 1. Owner
          const rawOwner = getEvidenceOwner(displayRecord);
          const ownerDisplay = isValidOwnerName(rawOwner) ? rawOwner : "Not recorded";

          // 2. Livestock / Carcass ID & Tag Number
          const tagValue = String(displayRecord?.tag_number || viewingEv?.tag_number || matchedAnimal?.tag_number || "").trim();
          const rawEntityId =
            matchedAnimal?.id ||
            displayRecord?.livestock_id ||
            viewingEv?.livestock_id ||
            matchedInspection?.livestock_id ||
            "";
          const cleanEntityId =
            String(rawEntityId).trim() &&
            !String(rawEntityId).startsWith("synth-") &&
            !String(rawEntityId).startsWith("whole-")
              ? String(rawEntityId).trim()
              : "";

          // 3. Species (only real values, never generic fallback like "Livestock" or "Carcass")
          const isRealSpecies = (val) => {
            if (!val || typeof val !== "string") return false;
            const s = val.trim().toLowerCase();
            return s !== "" && s !== "—" && s !== "-" && s !== "livestock" && s !== "carcass" && s !== "unknown" && s !== "n/a";
          };
          const speciesCandidates = [
            matchedAnimal?.species,
            displayRecord?.species,
            viewingEv?.species,
            matchedInspection?.species,
            matchedCondemnedRows[0]?.species,
          ];
          const resolvedSpecies = speciesCandidates.find(isRealSpecies)?.trim() || "Not recorded";

          // 4. Condemnation Type
          const condemnationTypeDisplay =
            stage === "Ante-Mortem"
              ? "Ante-Mortem · Whole Animal Condemnation"
              : isWhole
              ? "Post-Mortem · Whole Carcass Condemnation"
              : "Post-Mortem · Partial Condemnation";

          // 5. Condemned Part / Affected Area (from real database/inspection records, no guessing)
          const recordedParts = [];
          const seenPartKeys = new Set();
          const pushPartItem = (partName, area, weightKg) => {
            const pClean = String(partName || "").trim();
            if (!pClean || pClean === "—" || pClean.toLowerCase() === "none") return;
            const aClean = String(area || "").trim();
            const validArea = aClean && aClean !== "—" && aClean !== "-" ? aClean : "";
            const wNum = parseFloat(weightKg);
            const validWeight = !isNaN(wNum) && wNum > 0 ? (wNum % 1 === 0 ? `${wNum} kg` : `${wNum.toFixed(2)} kg`) : "";
            const key = `${pClean.toLowerCase()}__${validArea.toLowerCase()}`;
            if (seenPartKeys.has(key)) return;
            seenPartKeys.add(key);
            recordedParts.push({
              part: pClean,
              area: validArea,
              weight: validWeight,
            });
          };

          if (stage === "Post-Mortem" && Array.isArray(matchedPost?.condemned_parts)) {
            matchedPost.condemned_parts.forEach((cp) => {
              pushPartItem(cp?.part || cp?.name, cp?.location || cp?.area, cp?.weight_kg || cp?.weight);
            });
          }
          matchedCondemnedRows.forEach((cr) => {
            pushPartItem(cr?.part, cr?.location, cr?.weight_kg || cr?.weight);
          });
          if (stage === "Post-Mortem") {
            (postCuts || []).forEach((cut) => {
              if (cleanTag && String(cut?.tag_number || "").trim().toLowerCase() === cleanTag) {
                pushPartItem(cut?.part, cut?.location, cut?.weight_kg || cut?.weight);
              }
            });
          }
          if (recordedParts.length === 0) {
            if (displayRecord?.part || currentPhoto?.part) {
              pushPartItem(currentPhoto?.part || displayRecord?.part, displayRecord?.location, displayRecord?.weight_kg);
            } else if (isWhole) {
              pushPartItem(
                stage === "Ante-Mortem" ? "Live Animal (Whole)" : "Whole Carcass",
                matchedCondemnedRows[0]?.location || displayRecord?.location || "",
                matchedCondemnedRows[0]?.weight_kg || matchedPost?.carcass_weight || matchedAnte?.live_weight
              );
            }
          }

          // 6. Findings (actual recorded notes / inspection findings / condemnation reason)
          const rawPhotoNotes = cleanEvidenceNotes(currentPhoto?.notes || (!displayRecord?.is_synthetic ? displayRecord?.notes : ""));
          const rawInspFindings = String(matchedInspection?.findings || matchedInspection?.remarks || "").trim();
          const rawCondReason = matchedCondemnedRows
            .map((c) => String(c?.reason || c?.notes || "").trim())
            .filter(Boolean)
            .join("; ");
          const fallbackRecordNotes = cleanEvidenceNotes(displayRecord?.notes);
          const findingsCandidates = [rawPhotoNotes, rawInspFindings, rawCondReason, fallbackRecordNotes]
            .map((s) => String(s || "").trim())
            .filter((s) => s && s !== "—" && s !== "-");
          const findingsDisplay = findingsCandidates[0] || "Not recorded";

          // 7. Condemnation Date & Time & Inspector
          const matchedCut = (postCuts || []).find(
            (c) => cleanTag && String(c.tag_number || "").trim().toLowerCase() === cleanTag
          );
          const condemnedInspector = resolveCondemningPersonnel({
            record: matchedCondemnedRows[0] || displayRecord,
            livestock: matchedAnimal,
            inspection: matchedInspection,
            cut: matchedCut,
            users,
          });

          // Priority for timestamp: specific inspection/cut timestamptz -> condemnation/evidence created_at -> date
          const rawTimestamp =
            (stage === "Post-Mortem"
              ? (matchedCut?.created_at || matchedAnimal?.post_inspected_at || matchedCondemnedRows[0]?.created_at)
              : (matchedAnimal?.ante_inspected_at || matchedCondemnedRows[0]?.created_at)) ||
            currentPhoto?.record?.created_at ||
            matchedInspection?.created_at ||
            displayRecord?.created_at ||
            matchedCondemnedRows[0]?.date ||
            displayRecord?.date ||
            matchedInspection?.date ||
            matchedAnimal?.date ||
            null;
          const condemnationDateTimeDisplay = formatManilaDateTime(rawTimestamp);

          const isCurrentFailed =
            currentViewerFileKind === "image" &&
            (imgLoadState === "error" || (currentPhoto?.url && isPhotoMissing(currentPhoto.url)));
          const isCurrentLoading =
            currentViewerFileKind === "image" && !isCurrentFailed && imgLoadState === "loading";

          const handleRetryPhoto = () => {
            if (!currentPhoto?.url) return;
            unmarkPhotoMissing(currentPhoto.url);
            setImgLoadState("loading");
            setRetryCount((c) => c + 1);
          };

          return (
            <div className="vet-evidence-viewer-root">
              <div className="vet-evidence-viewer-grid">
                {/* ── LEFT / TOP: PRIMARY PHOTO & FILE VIEWER ── */}
                <div className="vet-evidence-viewer-media-col">
                  {/* Viewer Top Bar: Photo Counter & Zoom/Action Controls */}
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
                        data-testid="evidence-photo-counter"
                      >
                        {tagPhotos.length > 0
                          ? `${currentPhotoIndex + 1} of ${tagPhotos.length}`
                          : "0 of 0"}
                      </span>
                      {currentPhoto?.part && (
                        <span style={{ color: "#94a3b8", fontSize: 11.5, fontWeight: 600 }}>
                          Part: <strong style={{ color: "#f1f5f9" }}>{currentPhoto.part}</strong>
                        </span>
                      )}
                      {tagPhotos.length > 1 && (
                        <span style={{ color: "#64748b", fontSize: 11 }} className="vet-ev-kbd-hint">
                          Use ← / → keys to navigate
                        </span>
                      )}
                    </div>

                    {/* Zoom & Open Controls */}
                    {currentViewerFileKind === "image" && currentPhoto?.url && !isCurrentFailed && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setZoomLevel((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                          disabled={zoomLevel <= 1}
                          title="Zoom out"
                          aria-label="Zoom out"
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
                          aria-label="Zoom in"
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
                          onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
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
                    {/* STATE 1: No evidence file exists */}
                    {currentViewerFileKind === "none" ? (
                      <div
                        data-testid="evidence-empty-state"
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
                    ) : currentViewerFileKind === "document" ? (
                      /* STATE 2: Non-image document (e.g., PDF / Lab Report) */
                      <div
                        data-testid="evidence-document-state"
                        style={{
                          padding: "36px 24px",
                          textAlign: "center",
                          color: "#e2e8f0",
                          maxWidth: 420,
                        }}
                      >
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 12,
                            background: "rgba(2, 132, 199, 0.16)",
                            border: "1px solid rgba(2, 132, 199, 0.35)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 12px",
                            color: "#38bdf8",
                          }}
                        >
                          <Icon.FileText size={28} />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc", wordBreak: "break-word" }}>
                          {currentPhoto.name || displayRecord.file_name || "Evidence Document"}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                          {displayRecord.type || "Document"} · Non-image evidence file
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
                          <Button
                            size="sm"
                            onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
                          >
                            <Icon.ExternalLink size={14} /> Open Document
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = currentPhoto.url;
                              a.target = "_blank";
                              a.rel = "noopener noreferrer";
                              a.download = currentPhoto.name || displayRecord.file_name || "evidence-document";
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            }}
                          >
                            <Icon.Download size={14} /> Download File
                          </Button>
                        </div>
                      </div>
                    ) : isCurrentFailed ? (
                      /* STATE 3: Image failed to load */
                      <div
                        data-testid="evidence-error-state"
                        style={{
                          padding: "32px 24px",
                          textAlign: "center",
                          color: "#cbd5e1",
                          maxWidth: 440,
                        }}
                      >
                        <div
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: "50%",
                            background: "rgba(245, 158, 11, 0.14)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 12px",
                            color: "#f59e0b",
                          }}
                        >
                          <Icon.AlertTriangle size={26} />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
                          Unable to load evidence photo
                        </div>
                        <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                          The image file could not be loaded from storage. The file may have been removed or the URL is temporarily unreachable.
                        </div>
                        {currentPhoto.name && (
                          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 8, wordBreak: "break-all" }}>
                            File: {currentPhoto.name}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
                          <Button size="sm" onClick={handleRetryPhoto}>
                            <Icon.RefreshCw size={13} /> Retry Load
                          </Button>
                          {currentPhoto.url && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(currentPhoto.url, "_blank", "noopener,noreferrer")}
                            >
                              <Icon.ExternalLink size={13} /> Open Link Directly
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* STATE 4 & 5: Loading Spinner + Image View */
                      <>
                        {isCurrentLoading && (
                          <div
                            data-testid="evidence-loading-state"
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "rgba(15, 23, 42, 0.82)",
                              color: "#e2e8f0",
                              zIndex: 3,
                              gap: 10,
                            }}
                          >
                            <span className="spinner" style={{ width: 28, height: 28 }} />
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#cbd5e1" }}>
                              Loading evidence photo...
                            </span>
                          </div>
                        )}
                        <img
                          ref={viewerImgRef}
                          key={`${viewingEv.id || viewingEv.tag_number}-${currentPhotoIndex}-${currentPhoto.url}-${retryCount}`}
                          src={currentPhoto.url}
                          alt={currentPhoto.name || `Evidence photo ${currentPhotoIndex + 1} for ${tagValue || "record"}`}
                          onClick={() => setIsEnlarged(true)}
                          onLoad={() => {
                            const activeSeq = loadSeqRef.current;
                            if (activeSeq === loadSeqRef.current) {
                              setImgLoadState("loaded");
                            }
                          }}
                          onError={() => {
                            markPhotoMissing(currentPhoto.url);
                            setImgLoadState("error");
                          }}
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
                            opacity: isCurrentLoading ? 0.25 : 1,
                          }}
                        />
                      </>
                    )}

                    {/* Previous / Next Controls when multiple photos exist */}
                    {tagPhotos.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : tagPhotos.length - 1))
                          }
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
                          onClick={() =>
                            setActivePhotoIndex((prev) => (prev < tagPhotos.length - 1 ? prev + 1 : 0))
                          }
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

                  {/* Multi-Photo Thumbnail Strip (only shown when > 1 photo belongs to this record) */}
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
                      {tagPhotos.map((photo, idx) => {
                        const isSelected = idx === currentPhotoIndex;
                        const thumbFailed = isPhotoMissing(photo.url);
                        return (
                          <button
                            key={photo.id || idx}
                            type="button"
                            onClick={() => setActivePhotoIndex(idx)}
                            title={photo.part ? `${photo.part} (${idx + 1} of ${tagPhotos.length})` : `Photo ${idx + 1} of ${tagPhotos.length}`}
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
                            {!thumbFailed && photo.url ? (
                              <img
                                src={photo.url}
                                alt={photo.name || `Thumbnail ${idx + 1}`}
                                onError={() => markPhotoMissing(photo.url)}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <span
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "100%",
                                  height: "100%",
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "#f59e0b",
                                }}
                              >
                                N/A
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── RIGHT / BOTTOM: COMPACT LABELED DETAILS LIST ── */}
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

                    {/* 2. Livestock / Carcass Tag Number (internal ID removed for clean presentation) */}
                    <div className="vet-evidence-viewer-row">
                      <dt>{stage === "Post-Mortem" ? "Carcass Tag #" : "Livestock Tag #"}</dt>
                      <dd>
                        {tagValue ? <TagBadge tag={tagValue} /> : <span>Not recorded</span>}
                      </dd>
                    </div>

                    {/* 3. Species */}
                    <div className="vet-evidence-viewer-row">
                      <dt>Species</dt>
                      <dd>{resolvedSpecies}</dd>
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
                        {recordedParts.length === 0 ? (
                          "Not recorded"
                        ) : recordedParts.length === 1 ? (
                          <div>
                            <span style={{ fontWeight: 700 }}>{recordedParts[0].part}</span>
                            {recordedParts[0].area ? (
                              <span style={{ color: "var(--color-text-muted)" }}> · {recordedParts[0].area}</span>
                            ) : null}
                            {recordedParts[0].weight ? (
                              <span style={{ color: "#b45309", fontWeight: 600 }}> ({recordedParts[0].weight})</span>
                            ) : null}
                          </div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                            {recordedParts.map((rp, i) => (
                              <li key={i} style={{ fontSize: 12.5 }}>
                                <span style={{ fontWeight: 700 }}>{rp.part}</span>
                                {rp.area ? <span style={{ color: "var(--color-text-muted)" }}> · {rp.area}</span> : null}
                                {rp.weight ? <span style={{ color: "#b45309", fontWeight: 600 }}> ({rp.weight})</span> : null}
                              </li>
                            ))}
                          </ul>
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
                      <dd>{condemnationDateTimeDisplay}</dd>
                    </div>

                    {/* 8. Condemned By */}
                    <div className="vet-evidence-viewer-row" style={{ borderBottom: "none" }}>
                      <dt>Condemned By</dt>
                      <dd style={{ fontWeight: 600 }}>{condemnedInspector}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Modal Actions Footer (Always reachable in every state) */}
              <div
                className="form-actions"
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const rec = {
                      id: viewingEv?.id,
                      file_path: viewingEv?.file_path,
                      tag_number: displayRecord?.tag_number || viewingEv?.tag_number,
                      photo_url: currentPhoto?.url || null,
                      stage: type,
                      photoUrls: tagPhotos.map((p) => p.url).filter(Boolean),
                    };
                    closeEvidenceViewer();
                    setConfirmDeleteEv(rec);
                  }}
                >
                  <Icon.Trash size={14} /> Delete Evidence
                </Button>
                <Button variant="outline" onClick={closeEvidenceViewer}>
                  Close
                </Button>
              </div>

              {/* Fullscreen Enlarge Lightbox when user clicks image or Enlarge */}
              {isEnlarged && currentPhoto?.url && !isCurrentFailed && (
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
                      src={currentPhoto.url}
                      alt={currentPhoto.name || "Enlarged evidence photo"}
                      style={{
                        maxWidth: "94vw",
                        maxHeight: "84vh",
                        objectFit: "contain",
                        borderRadius: 8,
                        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                      }}
                    />
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        color: "#f8fafc",
                        fontSize: 12.5,
                      }}
                    >
                      {tagPhotos.length > 1 && (
                        <span>
                          Photo {currentPhotoIndex + 1} of {tagPhotos.length}
                        </span>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setIsEnlarged(false)}>
                        Close Enlarged View
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Evidence Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmDeleteEv}
        onConfirm={async () => {
          if (!confirmDeleteEv || isDeletingEv) return;
          setIsDeletingEv(true);
          // Last-resort guard: the service already times out each Supabase call, but a
          // guard here guarantees the button can never stay in a loading state.
          const guard = setTimeout(() => {
            setIsDeletingEv(false);
            showToast("Delete is taking too long. Check your connection and try again.", "error");
          }, 45000);
          try {
            const tagNum = confirmDeleteEv.tag_number;
            const stage = confirmDeleteEv.stage || type || "Post-Mortem";
            await vetService.deleteEvidenceRecord(
              confirmDeleteEv.id,
              confirmDeleteEv.file_path,
              tagNum,
              confirmDeleteEv.photo_url,
              { stage, photoUrls: confirmDeleteEv.photoUrls }
            );
            await vetService.deleteInspectionByTag(stage, tagNum);
            clearTimeout(guard);
            showToast(
              stage === "Ante-Mortem"
                ? "Condemnation record deleted. Animal returned to Awaiting Livestock."
                : "Condemnation record deleted.",
              "success"
            );
            setConfirmDeleteEv(null);
            setFilterCondemnedStatus("needs_evidence");
            refreshAll();
          } catch (err) {
            clearTimeout(guard);
            // The service throws the real Supabase message - show it instead of a generic one.
            showToast(err?.message || "Failed to delete evidence", "error");
          } finally {
            clearTimeout(guard);
            setIsDeletingEv(false);
          }
        }}
        onCancel={() => {
          if (!isDeletingEv) setConfirmDeleteEv(null);
        }}
        title="Confirm Deletion"
        message="Are you sure you want to delete this evidence record?"
        confirmText="Confirm Delete"
        confirmVariant="danger"
        loading={isDeletingEv}
      />

      {/* Lightbox Preview Modal for selected draft photos */}
      {previewPhoto && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setPreviewPhoto(null)}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <img
              src={previewPhoto}
              alt="Preview"
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8, objectFit: "contain" }}
            />
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              style={{
                position: "absolute",
                top: -12,
                right: -12,
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
              }}
            >
              <Icon.X size={18} />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
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

export const MeatApprovalRecords = () => {
  const { data = [] } = useSupabase(TABLES.POST_MORTEM);
  return (
    <ModulePage
      title="Meat Approval Records" subtitle="Approved meat fit for consumption" icon={<Icon.Check />}
      stats={[{ label: "Approved", value: data.filter((i) => i.decision === "Approved").length, icon: <Icon.Check />, color: "emerald" }]}
      columns={inspCols()} rows={data.filter((i) => i.decision === "Approved")} searchKeys={["tag_number"]}
    />
  );
};

/* ---------- Livestock ---------- */
const SPECIES_CONFIG = {
  Hog: { label: "Hog", bg: "#fdf2f8", text: "#be185d", border: "#fbcfe8" },
  Cattle: { label: "Cattle", bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  Carabao: { label: "Carabao", bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
  Goat: { label: "Goat", bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" },
};

export const VetSlaughterHistory = () => {
  const { data: slaughterRecords = [], refresh: refreshSlaughter } = useSupabase(TABLES.SLAUGHTER_RECORDS);
  const { data: processingRecords = [], refresh: refreshProcessing } = useSupabase(TABLES.SLAUGHTER_PROCESSING);
  const { data: carcass = [], refresh: refreshCarcass } = useSupabase(TABLES.CARCASS);
  const { data: livestock = [], refresh: refreshLivestock } = useSupabase(TABLES.LIVESTOCK);
  const { data: owners = [], refresh: refreshOwners } = useSupabase(TABLES.OWNERS);
  const { data: postMortem = [], refresh: refreshPost } = useSupabase(TABLES.POST_MORTEM);

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [search, setSearch] = useState("");
  const [filterSpecies, setFilterSpecies] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [filterWeighed, setFilterWeighed] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { showToast } = useToast();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshSlaughter?.(),
        refreshProcessing?.(),
        refreshCarcass?.(),
        refreshLivestock?.(),
        refreshOwners?.(),
        refreshPost?.(),
      ]);
      showToast("Slaughter records refreshed", "info");
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const resolveOwnerName = (item, animal) => {
    if (item?.owner_name && item.owner_name !== "Unknown" && item.owner_name !== "—") return item.owner_name;
    if (animal?.owner_name && animal.owner_name !== "Unknown" && animal.owner_name !== "—") return animal.owner_name;
    const ownerId = item?.owner_id || animal?.owner_id;
    if (ownerId) {
      const o = (owners || []).find(
        (x) => x.id === ownerId || x.owner_id === ownerId || x.temp_reg_id === ownerId || x.owner_code === ownerId
      );
      if (o?.name) return o.name;
    }
    return item?.owner_name || animal?.owner_name || "—";
  };

  const resolveSpecies = (item, animal) => {
    if (item?.species && item.species !== "Unknown" && item.species !== "—") return item.species;
    if (animal?.species && animal.species !== "Unknown" && animal.species !== "—") return animal.species;
    const tag = (item?.tag_number || "").toUpperCase();
    if (tag.includes("HOG") || tag.includes("PIG") || tag.includes("SWINE")) return "Hog";
    if (tag.includes("CAT") || tag.includes("COW")) return "Cattle";
    if (tag.includes("CAR") || tag.includes("CARABAO")) return "Carabao";
    if (tag.includes("GOAT")) return "Goat";
    return "Hog";
  };

  // Merge and deduplicate records across slaughter_records, slaughter_processing, and carcass_records
  const unifiedRecords = useMemo(() => {
    const map = new Map();

    // 1. Ingest from slaughter_records
    (slaughterRecords || []).forEach((r) => {
      if (!r?.tag_number) return;
      const key = String(r.tag_number).trim().toLowerCase();
      map.set(key, { ...r, source: "slaughter_records" });
    });

    // 2. Merge from slaughter_processing
    (processingRecords || []).forEach((p) => {
      if (!p?.tag_number) return;
      const key = String(p.tag_number).trim().toLowerCase();
      const existing = map.get(key) || {};
      map.set(key, {
        ...existing,
        ...p,
        slaughter_date: p.slaughter_date || existing.slaughter_date || p.date || p.created_at || existing.created_at,
        operator: p.operator || existing.operator || "Slaughter Team",
        status: p.status || existing.status || "Completed",
        steps: p.steps || existing.steps,
      });
    });

    // 3. Merge from carcass_records (if carcass exists, the animal underwent slaughter)
    (carcass || []).forEach((c) => {
      if (!c?.tag_number) return;
      const key = String(c.tag_number).trim().toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          tag_number: c.tag_number,
          slaughter_date: c.date || c.created_at,
          operator: "Slaughter Team",
          status: "Completed",
          source: "carcass_records",
        });
      }
    });

    // Normalize and enrich every record
    return Array.from(map.values())
      .map((r) => {
        const tagKey = String(r.tag_number || "").trim().toLowerCase();
        const animal = (livestock || []).find((l) => String(l.tag_number || "").trim().toLowerCase() === tagKey);
        const carRec = (carcass || []).find((c) => String(c.tag_number || "").trim().toLowerCase() === tagKey);
        const postRec = (postMortem || []).find((p) => String(p.tag_number || "").trim().toLowerCase() === tagKey);

        const owner_name = resolveOwnerName(r, animal);
        const species = resolveSpecies(r, animal);
        const carcass_weight = carRec?.total_weight || carRec?.cold_weight || carRec?.hot_weight || r.carcass_weight || null;
        const slaughter_date = r.slaughter_date || r.date || carRec?.date || r.created_at || animal?.received_date;

        return {
          ...r,
          id: r.id || tagKey,
          tag_number: r.tag_number,
          species,
          owner_name,
          carcass_weight,
          carcassRecord: carRec,
          postMortemRecord: postRec,
          animalRecord: animal,
          slaughter_date,
          operator: r.operator || r.team || "Slaughter Team A",
          status: r.status || "Completed",
        };
      })
      .sort((a, b) => {
        const dateA = a.slaughter_date || "";
        const dateB = b.slaughter_date || "";
        return dateB.localeCompare(dateA);
      });
  }, [slaughterRecords, processingRecords, carcass, livestock, owners, postMortem]);

  const now = new Date();
  const inRange = (r) => {
    if (dateRange === "all") return true;
    const d = new Date(r.slaughter_date);
    if (isNaN(d)) return false;
    if (dateRange === "today") return d.toDateString() === now.toDateString();
    if (dateRange === "week") {
      const w = new Date(now);
      w.setDate(now.getDate() - 7);
      return d >= w;
    }
    if (dateRange === "month") {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    return true;
  };

  const filtered = useMemo(() => {
    return unifiedRecords.filter((r) => {
      const q = search.trim().toLowerCase();
      const matchQ =
        !q ||
        r.tag_number?.toLowerCase().includes(q) ||
        r.owner_name?.toLowerCase().includes(q) ||
        r.species?.toLowerCase().includes(q) ||
        r.operator?.toLowerCase().includes(q);
      const matchSp = filterSpecies === "all" || r.species?.toLowerCase() === filterSpecies.toLowerCase();
      const matchWeighed = !filterWeighed || Number(r.carcass_weight) > 0;
      return matchQ && matchSp && inRange(r) && matchWeighed;
    });
  }, [unifiedRecords, search, filterSpecies, dateRange, filterWeighed]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Statistics calculation
  const totalCarcassWeight = useMemo(() => {
    return unifiedRecords.reduce((sum, r) => sum + (Number(r.carcass_weight) || 0), 0);
  }, [unifiedRecords]);

  const weighedCount = useMemo(() => {
    return unifiedRecords.filter((r) => Number(r.carcass_weight) > 0).length;
  }, [unifiedRecords]);

  const avgCarcassWeight = weighedCount > 0 ? (totalCarcassWeight / weighedCount).toFixed(1) : "0";

  const todayCount = useMemo(() => {
    return unifiedRecords.filter((r) => {
      const d = new Date(r.slaughter_date);
      return !isNaN(d) && d.toDateString() === now.toDateString();
    }).length;
  }, [unifiedRecords]);

  const countSpecies = (sp) =>
    unifiedRecords.filter((r) => (r.species || "").toLowerCase() === sp.toLowerCase()).length;

  const hogsCount = countSpecies("Hog");
  const cattleCount = countSpecies("Cattle");
  const carabaoCount = countSpecies("Carabao");
  const goatsCount = countSpecies("Goat");

  const exportCSV = () => {
    if (filtered.length === 0) {
      showToast("No slaughter records to export", "warning");
      return;
    }
    const headers = "Tag #,Species,Owner,Slaughter Date,Operator,Carcass Weight (kg),Status";
    const rows = filtered.map((r) => {
      return `"${r.tag_number}","${r.species || "—"}","${(r.owner_name || "—").replace(/"/g, '""')}","${
        r.slaughter_date ? formatDate(r.slaughter_date) : "—"
      }","${r.operator || "—"}","${r.carcass_weight || "—"}","${r.status || "Completed"}"`;
    });
    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `slaughter_history_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Slaughter history exported successfully!", "success");
  };

  const hasActiveFilters = search.trim() !== "" || filterSpecies !== "all" || dateRange !== "all";

  return (
    <div className="vet-slaughter-history-page" style={{ padding: "4px 0" }}>
      <PageHeader
        title="Slaughter Processing History"
        subtitle="Operational abattoir log, dressing records, and carcass yield tracking"
        icon={<Icon.Layers size={24} />}
      />

      {/* Interactive KPI Stats Cards */}
      <div className="grid grid-4 mb-6" style={{ gap: 14 }}>
        <StatCard
          label="Total Operations"
          value={unifiedRecords.length}
          trend={filterSpecies === "all" && dateRange === "all" && !filterWeighed ? "All slaughter records" : "Click to view all records"}
          icon={<Icon.Layers size={22} />}
          color="violet"
          onClick={() => { setFilterSpecies("all"); setDateRange("all"); setFilterWeighed(false); setPage(1); }}
          style={{ cursor: "pointer" }}
        />

        <StatCard
          label="Total Carcass Yield"
          value={totalCarcassWeight > 0 ? `${Math.round(totalCarcassWeight).toLocaleString()} kg` : `${unifiedRecords.length} heads`}
          trend={`${weighedCount} weighed carcasses`}
          icon={<Icon.Scale size={22} />}
          color="emerald"
          onClick={() => { setFilterWeighed((prev) => !prev); setPage(1); }}
          style={{ cursor: "pointer" }}
        />

        <StatCard
          label="Avg Carcass Weight"
          value={Number(avgCarcassWeight) > 0 ? `${avgCarcassWeight} kg` : "—"}
          trend="Per slaughtered head"
          icon={<Icon.Activity size={22} />}
          color="amber"
          onClick={() => { setFilterWeighed((prev) => !prev); setPage(1); }}
          style={{ cursor: "pointer" }}
        />

        <StatCard
          label="Processed Today"
          value={todayCount}
          trend="Today's slaughter volume"
          icon={<Icon.Calendar size={22} />}
          color="sky"
          onClick={() => { setDateRange((prev) => (prev === "today" ? "all" : "today")); setPage(1); }}
          style={{ cursor: "pointer" }}
        />
      </div>

      {/* Main Records Container Card */}
      <Card>
        {/* Improved Search & Filter Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-border)",
            background: "#ffffff",
          }}
        >
          {/* Search Box */}
          <div style={{ display: "flex", alignItems: "center", flex: "1 1 300px", maxWidth: 420, position: "relative" }}>
            <input
              type="text"
              placeholder="Search by Tag #, Owner, or Operator..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{
                width: "100%",
                height: 40,
                paddingLeft: 38,
                paddingRight: search ? 34 : 12,
                border: "1.5px solid #cbd5e1",
                borderRadius: 10,
                fontSize: 13,
                outline: "none",
                background: "#f8fafc",
                transition: "all 0.18s ease",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#8b5cf6";
                e.target.style.background = "#ffffff";
                e.target.style.boxShadow = "0 0 0 3px rgba(139, 92, 246, 0.14)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#cbd5e1";
                e.target.style.background = "#f8fafc";
                e.target.style.boxShadow = "none";
              }}
            />
            <Icon.Search
              size={16}
              style={{
                position: "absolute",
                left: 13,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-text-muted, #94a3b8)",
                pointerEvents: "none",
                zIndex: 10
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPage(1); }}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  borderRadius: "50%",
                }}
                title="Clear search"
              >
                <Icon.X size={14} />
              </button>
            )}
          </div>

          {/* Filter Controls (Species Dropdown + Date Range Segment) */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Species Dropdown with Emojis */}
            <div style={{ position: "relative" }}>
              <select
                value={filterSpecies}
                onChange={(e) => { setFilterSpecies(e.target.value); setPage(1); }}
                style={{
                  height: 40,
                  minWidth: 165,
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: "1.5px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#334155",
                  padding: "0 32px 0 12px",
                  cursor: "pointer",
                  outline: "none",
                  appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 10px center",
                  backgroundSize: "14px",
                  transition: "all 0.15s ease",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#8b5cf6"; }}
                onBlur={(e) => { e.target.style.borderColor = "#cbd5e1"; }}
              >
                <option value="all">All Species ({unifiedRecords.length})</option>
                <option value="Hog">Hog ({hogsCount})</option>
                <option value="Cattle">Cattle ({cattleCount})</option>
                <option value="Carabao">Carabao ({carabaoCount})</option>
                <option value="Goat">Goat ({goatsCount})</option>
              </select>
            </div>

            {/* Segmented Date Range Buttons */}
            <div
              style={{
                display: "inline-flex",
                background: "#f1f5f9",
                padding: "3px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                gap: 2,
              }}
            >
              {[
                { value: "all", label: "All Time" },
                { value: "today", label: "Today" },
                { value: "week", label: "This Week" },
                { value: "month", label: "This Month" },
              ].map((pill) => {
                const isSel = dateRange === pill.value;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => { setDateRange(pill.value); setPage(1); }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: isSel ? 700 : 600,
                      border: "none",
                      background: isSel ? "#8b5cf6" : "transparent",
                      color: isSel ? "#ffffff" : "#475569",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      boxShadow: isSel ? "0 2px 5px rgba(139, 92, 246, 0.25)" : "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>

            {/* Quick Clear Filter Reset Button */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(""); setFilterSpecies("all"); setDateRange("all"); setPage(1); }}
                style={{ height: 40, color: "#64748b", fontWeight: 700, gap: 4 }}
              >
                <Icon.X size={14} /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Compact Pro Table (Fitted Layout, No Horizontal Swipe Needed) */}
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 20px" }}>
            <EmptyState
              title="No slaughter records found"
              message="No operations match your current search query or date filter selection."
              icon={<Icon.Layers size={44} />}
              action={
                hasActiveFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => { setSearch(""); setFilterSpecies("all"); setDateRange("all"); setPage(1); }}
                  >
                    Reset All Filters
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <div className="table-wrap" style={{ overflowX: "hidden" }}>
            <table className="table" style={{ tableLayout: "fixed", width: "100%", margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: "15%", padding: "11px 12px" }}>Tag #</th>
                  <th style={{ width: "15%", padding: "11px 12px" }}>Species</th>
                  <th style={{ width: "21%", padding: "11px 12px" }}>Owner Name</th>
                  <th style={{ width: "15%", padding: "11px 12px" }}>Slaughter Date</th>
                  <th style={{ width: "14%", padding: "11px 12px" }}>Operator Team</th>
                  <th style={{ width: "10%", padding: "11px 12px", textAlign: "center" }}>Carcass Yield</th>
                  <th style={{ width: "10%", padding: "11px 12px", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => {
                  const spTheme = SPECIES_CONFIG[r.species] || {
                    label: r.species || "Livestock",
                    bg: "#f1f5f9",
                    text: "#334155",
                    border: "#cbd5e1",
                  };

                  return (
                    <tr key={r.id || r.tag_number} style={{ height: 54 }}>
                      {/* Tag Number */}
                      <td style={{ padding: "8px 12px" }}>
                        <span
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontWeight: 800,
                            fontSize: 12.5,
                            color: "#7c3aed",
                            background: "#f5f3ff",
                            padding: "3px 8px",
                            borderRadius: 6,
                            border: "1px solid #ddd6fe",
                            display: "inline-block",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.tag_number || "—"}
                        </span>
                      </td>

                      {/* Species */}
                      <td style={{ padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)" }}>
                        {r.species || "—"}
                      </td>

                      {/* Owner Name */}
                      <td style={{ padding: "8px 12px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              background: "#f3e8ff",
                              color: "#7c3aed",
                              fontSize: 12,
                              fontWeight: 800,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {r.owner_name?.charAt(0) || "O"}
                          </span>
                          <span
                            title={r.owner_name}
                            style={{
                              fontWeight: 700,
                              color: "#0f172a",
                              fontSize: 13,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.owner_name}
                          </span>
                        </div>
                      </td>

                      {/* Slaughter Date */}
                      <td style={{ padding: "8px 12px", color: "#64748b", fontSize: 12.5, whiteSpace: "nowrap" }}>
                        {r.slaughter_date ? formatDate(r.slaughter_date) : "—"}
                      </td>

                      {/* Operator */}
                      <td style={{ padding: "8px 12px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background: "#f8fafc",
                            color: "#334155",
                            border: "1px solid #e2e8f0",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.operator || "Slaughter Team"}
                        </span>
                      </td>

                      {/* Carcass Weight */}
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        {r.carcass_weight ? (
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: 12.5,
                              color: "#047857",
                              background: "#ecfdf5",
                              padding: "2px 7px",
                              borderRadius: 6,
                              border: "1px solid #a7f3d0",
                              display: "inline-block",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.carcass_weight} kg
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>Pending</span>
                        )}
                      </td>

                      {/* Action Button */}
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedRecord(r)}
                          style={{
                            height: 32,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontWeight: 700,
                            padding: "5px 11px",
                            borderRadius: 8,
                            borderColor: "#cbd5e1",
                            color: "#0f172a",
                            background: "#ffffff",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                          }}
                        >
                          <Icon.Eye size={13} /> View Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Clean Pagination Footer */}
        {filtered.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 18px",
              borderTop: "1px solid var(--color-border)",
              fontSize: 13,
              color: "#64748b",
              background: "#ffffff",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              Showing <b>{Math.min((page - 1) * pageSize + 1, filtered.length)}</b> to{" "}
              <b>{Math.min(page * pageSize, filtered.length)}</b> of <b>{filtered.length}</b> operations
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{
                  height: 34,
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  padding: "0 22px 0 10px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#334155",
                  cursor: "pointer",
                  appearance: "none",
                  backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center",
                  backgroundSize: "12px",
                }}
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>

              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 10px",
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: page === 1 ? "#94a3b8" : "#334155",
                  cursor: page === 1 ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                <Icon.ChevronLeft size={13} /> Prev
              </button>

              <span style={{ fontSize: 12.5, fontWeight: 700, padding: "0 6px", whiteSpace: "nowrap" }}>
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 10px",
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: page === totalPages ? "#94a3b8" : "#334155",
                  cursor: page === totalPages ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                Next <Icon.ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Slaughter Operation & Carcass Dressing Detail Modal */}
      <Modal
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title="Slaughter Operation & Carcass Dressing Details"
        size="lg"
      >
        {selectedRecord && (() => {
          const r = selectedRecord;
          const car = r.carcassRecord;
          const post = r.postMortemRecord;
          const spTheme = SPECIES_CONFIG[r.species] || {
            label: r.species || "Livestock",
            bg: "#f1f5f9",
            text: "#334155",
            border: "#cbd5e1",
          };

          return (
            <div style={{ padding: "4px" }}>
              {/* Header Box */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 16,
                  padding: "14px 18px",
                  background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
                  borderRadius: 12,
                  border: "1px solid #ddd6fe",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(124, 58, 237, 0.15)",
                      color: "#7c3aed",
                    }}
                  >
                    <Icon.Activity size={24} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <h3
                        style={{
                          fontSize: 19,
                          fontWeight: 800,
                          margin: 0,
                          color: "#5b21b6",
                          fontFamily: "ui-monospace, monospace",
                        }}
                      >
                        {r.tag_number || "—"}
                      </h3>
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--color-text)",
                        }}
                      >
                        {r.species}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#6d28d9", marginTop: 3 }}>
                      Slaughter Date: <b>{r.slaughter_date ? formatDate(r.slaughter_date) : "—"}</b> · Operator:{" "}
                      <b>{r.operator}</b>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      background: "#ecfdf5",
                      color: "#047857",
                      border: "1px solid #a7f3d0",
                    }}
                  >
                    ● {r.status || "Completed"}
                  </span>
                </div>
              </div>

              {/* Carcass Dressing & Yield Analytics Grid */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon.Scale size={15} /> Carcass Yield &amp; Scale Metrics
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase" }}>Total Carcass Weight</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#166534", marginTop: 2 }}>
                      {r.carcass_weight ? `${r.carcass_weight} kg` : "—"}
                    </div>
                  </div>

                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Hot Dressed Weight</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {car?.hot_weight ? `${car.hot_weight} kg` : r.carcass_weight ? `${r.carcass_weight} kg` : "—"}
                    </div>
                  </div>

                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Cold Chilled Weight</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {car?.cold_weight ? `${car.cold_weight} kg` : r.carcass_weight ? `${r.carcass_weight} kg` : "—"}
                    </div>
                  </div>

                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Offal / Organ Weight</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {car?.organ_weight ? `${car.organ_weight} kg` : "—"}
                    </div>
                  </div>

                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Meat Quality Grade</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>
                      {car?.grade || "Grade A"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Consignment & Operational Specifications */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Consignment Owner</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>{r.owner_name}</div>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Species &amp; Classification</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>
                    {spTheme.emoji} {r.species}
                  </div>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Slaughter Operator Team</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>{r.operator}</div>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Slaughter Run Date</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>
                    {r.slaughter_date ? formatDate(r.slaughter_date) : "—"}
                  </div>
                </div>
              </div>

              {/* 8-Step Abattoir Process Pipeline Status */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon.CheckCircle size={15} /> 8-Step Abattoir Protocol Execution
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
                  {[
                    { key: "stunning", label: "1. Stunning" },
                    { key: "bleeding", label: "2. Bleeding" },
                    { key: "scalding", label: "3. Scalding / Flaying" },
                    { key: "evisceration", label: "4. Evisceration" },
                    { key: "splitting", label: "5. Carcass Splitting" },
                    { key: "washing", label: "6. Washing & Trim" },
                    { key: "inspection", label: "7. Post-Mortem Exam" },
                    { key: "weighing", label: "8. Carcass Weighing" },
                  ].map((st) => {
                    const isDone = r.steps ? r.steps[st.key] : true;
                    return (
                      <div
                        key={st.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: isDone ? "#f0fdf4" : "#f8fafc",
                          border: `1px solid ${isDone ? "#bbf7d0" : "#e2e8f0"}`,
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: isDone ? "#166534" : "#64748b",
                        }}
                      >
                        <span style={{ color: isDone ? "#16a34a" : "#94a3b8" }}>
                          {isDone ? <Icon.Check size={13} /> : "○"}
                        </span>
                        <span>{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Veterinary Post-Mortem Clearance Note */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.Stethoscope size={14} /> Post-Mortem Clinical Outcome
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 800,
                      background: post?.decision === "Approved" || post?.decision === "Passed" ? "#ecfdf5" : post?.decision === "Condemned" ? "#fef2f2" : "#f0fdf4",
                      color: post?.decision === "Approved" || post?.decision === "Passed" ? "#047857" : post?.decision === "Condemned" ? "#dc2626" : "#047857",
                      border: `1px solid ${post?.decision === "Condemned" ? "#fecaca" : "#a7f3d0"}`,
                    }}
                  >
                    {post?.decision || "Passed & Certified"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#475569" }}>
                  <b>Examining Inspector:</b> {post?.inspector_name || "Dr. Dave"} ·{" "}
                  <b>Findings:</b> {post?.findings || "Wholesome and passed for consumption"}
                </div>
              </div>

              {/* Modal Footer Close Button */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="outline" onClick={() => setSelectedRecord(null)}>
                  Close
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

/* ---------- Role-Based Vet Reports ---------- */
export const VetInspectionReport = () => (
  <RoleReportsModule role="vet" initialReportType="antemortem" />
);

export const VetDiseaseReport = () => (
  <RoleReportsModule role="vet" initialReportType="condemnation" />
);

export const VetCondemnationReport = () => (
  <RoleReportsModule role="vet" initialReportType="condemnation" />
);

const inspCols = () => [
  { key: "_seq", label: "ID", mono: true, render: (r, ri) => (ri !== undefined ? ri + 1 : "—") },
  { key: "tag_number", label: "Tag #", bold: true },
  { key: "species", label: "Species" },
  { key: "sex", label: "Sex", render: (r) => formatSex(r.sex) },
  { key: "inspector_name", label: "Inspector" },
  { key: "date", label: "Date", render: (r) => formatDate(r.date) },
  { key: "decision", label: "Decision", badge: true },
];
