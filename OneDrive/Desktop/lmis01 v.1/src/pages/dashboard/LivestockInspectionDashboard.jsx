import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { TagBadge } from "../../components/ui/TagBadge";
import { useTheme } from "../../hooks/useTheme";
import { useSupabase } from "../../hooks/useSupabase";
import { TABLES } from "../../utils/constants";
import "../../styles/inspection_dashboard.css";


export const LivestockInspectionDashboard = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const { data: dbLivestock = [] } = useSupabase(TABLES.LIVESTOCK);
  const { data: dbAnteMortem = [] } = useSupabase(TABLES.ANTE_MORTEM);
  const { data: dbPostMortem = [] } = useSupabase(TABLES.POST_MORTEM);
  const { data: dbPermits = [] } = useSupabase(TABLES.PERMITS);
  const { data: dbPayments = [] } = useSupabase(TABLES.PAYMENTS);
  const { data: dbNotifications = [] } = useSupabase(TABLES.NOTIFICATIONS);

  const liveLivestock = useMemo(() => {
    return dbLivestock.map((l) => ({
      id: l.id,
      tag_number: l.tag_number || "N/A",
      species: l.species || "Swine",
      breed: l.breed || l.species || "N/A",
      gender: l.gender || l.sex || "N/A",
      weight: l.weight ? `${l.weight} kg` : "N/A",
      owner_name: l.owner_name || "N/A",
      origin: l.origin || l.address || "City of Naga",
      holding_pen: l.holding_pen || l.pen || "General Holding",
      arrival_date: l.registered_at || l.received_date || l.created_at || "N/A",
      health_status: l.health_status || (l.status === "Condemned" ? "Suspect" : "Healthy"),
      workflow_stage: l.status || "Intake Received",
    }));
  }, [dbLivestock]);

  const liveAnteCertifications = useMemo(() => {
    return dbAnteMortem.map((am) => ({
      id: am.id,
      cert_id: am.cert_number || `AM-${String(am.id).slice(0, 8)}`,
      tag_number: am.tag_number || "N/A",
      species: am.species || "Livestock",
      owner: am.owner_name || "N/A",
      decision: am.decision || "Passed for Slaughter",
      temperature: am.temperature ? `${am.temperature}°C` : "Normal",
      inspection_date: am.inspection_date || am.created_at || "N/A",
      inspector_name: am.inspector_name || am.veterinarian || "City Meat Inspector",
      clinical_notes: am.notes || am.findings || "No abnormal signs. Cleared.",
    }));
  }, [dbAnteMortem]);

  const livePostCertifications = useMemo(() => {
    return dbPostMortem.map((pm) => ({
      id: pm.id,
      cert_id: pm.cert_number || `PM-${String(pm.id).slice(0, 8)}`,
      tag_number: pm.tag_number || "N/A",
      species: pm.species || "Livestock",
      owner: pm.owner_name || "N/A",
      decision: pm.decision || "Fit for Human Consumption",
      stamp_code: pm.stamp_code || "NMIS-PASSED-NAGA",
      carcass_weight: pm.carcass_weight ? `${pm.carcass_weight} kg` : "N/A",
      viscera_findings: pm.viscera_findings || "Normal",
      carcass_condition: pm.carcass_condition || "Sound & wholesome",
      inspector_name: pm.inspector_name || pm.veterinarian || "Licensed Abattoir Vet",
    }));
  }, [dbPostMortem]);

  const livePermits = useMemo(() => {
    return dbPermits.map((p) => ({
      id: p.id,
      permit_no: p.permit_number || p.permit_no || `MIC-${String(p.id).slice(0, 8)}`,
      type: p.permit_type || "Meat Inspection Certificate (MIC)",
      entity: p.owner_name || p.consignee || "Registered Consignee",
      validity: p.status === "Approved" || p.status === "Active" ? "Valid" : p.status || "Pending",
      issued_by: p.issued_by || "City Veterinary Office",
      origin: p.origin || "City of Naga Slaughterhouse",
      destination: p.destination || "Local Meat Market",
      carrier_plate: p.carrier_plate || p.vehicle_plate || "N/A",
    }));
  }, [dbPermits]);

  const livePayments = useMemo(() => {
    return dbPayments.map((py) => ({
      id: py.id,
      txn_id: py.transaction_id || `TXN-${String(py.id).slice(0, 8)}`,
      tag_ref: py.tag_number || "N/A",
      owner: py.owner_name || "N/A",
      fee_type: py.fee_type || "Slaughterhouse Fee",
      or_number: py.or_number || py.official_receipt || "OR-PENDING",
      payment_method: py.payment_method || "Cash",
      status: py.status || "Paid",
      amount: typeof py.amount === "number" ? `₱${py.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : (py.amount || "₱0.00"),
    }));
  }, [dbPayments]);

  const liveAlerts = useMemo(() => {
    return dbNotifications.slice(0, 15).map((n) => ({
      id: n.id,
      severity: n.type === "danger" || n.severity === "critical" ? "critical" : n.type === "warning" ? "warning" : "info",
      title: n.title || "Abattoir Notification",
      message: n.message || n.content || "",
      timestamp: n.created_at ? new Date(n.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "Recent",
      tag_ref: n.tag_number || "LSMIS",
      tab_target: (n.module || "").toLowerCase().includes("permit") ? "permits" : (n.module || "").toLowerCase().includes("pay") ? "payments" : "tracker",
    }));
  }, [dbNotifications]);

  const [activeTab, setActiveTab] = useState("tracker");
  const [certSubTab, setCertSubTab] = useState("antemortem");
  const [searchQuery, setSearchQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [alerts, setAlerts] = useState([]);
  useEffect(() => { setAlerts(liveAlerts); }, [liveAlerts]);
  const [alertFilter, setAlertFilter] = useState("all");
  const [isAlertDrawerOpen, setIsAlertDrawerOpen] = useState(false);

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const criticalWarningCount = useMemo(() => {
    return alerts.filter((a) => a.severity === "critical" || a.severity === "warning").length;
  }, [alerts]);

  const handleDismissAlert = (e, alertId) => {
    e.stopPropagation();
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const handleAlertClick = (alert) => {
    setActiveTab(alert.tab_target);
    setSearchQuery(alert.tag_ref);
    if (window.innerWidth <= 1024) {
      setIsAlertDrawerOpen(false);
    }
  };

  const filteredAlerts = useMemo(() => {
    if (alertFilter === "all") return alerts;
    return alerts.filter((a) => a.severity === alertFilter);
  }, [alerts, alertFilter]);

  const handleOpenDetail = (record, type) => {
    setSelectedRecord({ ...record, _type: type });
    setIsModalOpen(true);
  };


  const query = searchQuery.trim().toLowerCase();

  const filteredLivestock = useMemo(() => {
    return liveLivestock.filter((item) => {
      const matchSpecies = speciesFilter === "All" || item.species === speciesFilter;
      const matchStatus = statusFilter === "All" || item.health_status.toLowerCase() === statusFilter.toLowerCase();
      const matchSearch =
        !query ||
        item.tag_number.toLowerCase().includes(query) ||
        item.owner_name.toLowerCase().includes(query) ||
        item.origin.toLowerCase().includes(query) ||
        item.holding_pen.toLowerCase().includes(query) ||
        item.species.toLowerCase().includes(query) ||
        item.workflow_stage.toLowerCase().includes(query);
      return matchSpecies && matchStatus && matchSearch;
    });
  }, [query, speciesFilter, statusFilter]);

  const filteredAnteCertifications = useMemo(() => {
    return liveAnteCertifications.filter((item) => {
      const matchSpecies = speciesFilter === "All" || item.species === speciesFilter;
      const matchStatus = statusFilter === "All" || item.decision.toLowerCase() === statusFilter.toLowerCase();
      const matchSearch =
        !query ||
        item.cert_id.toLowerCase().includes(query) ||
        item.tag_number.toLowerCase().includes(query) ||
        item.owner.toLowerCase().includes(query) ||
        item.inspector_name.toLowerCase().includes(query) ||
        item.clinical_notes.toLowerCase().includes(query) ||
        item.decision.toLowerCase().includes(query);
      return matchSpecies && matchStatus && matchSearch;
    });
  }, [query, speciesFilter, statusFilter]);

  const filteredPostCertifications = useMemo(() => {
    return livePostCertifications.filter((item) => {
      const matchSpecies = speciesFilter === "All" || item.species === speciesFilter;
      const matchStatus = statusFilter === "All" || item.decision.toLowerCase().includes(statusFilter.toLowerCase());
      const matchSearch =
        !query ||
        item.cert_id.toLowerCase().includes(query) ||
        item.tag_number.toLowerCase().includes(query) ||
        item.owner.toLowerCase().includes(query) ||
        item.inspector_name.toLowerCase().includes(query) ||
        item.viscera_findings.toLowerCase().includes(query) ||
        item.carcass_condition.toLowerCase().includes(query) ||
        item.stamp_code.toLowerCase().includes(query);
      return matchSpecies && matchStatus && matchSearch;
    });
  }, [query, speciesFilter, statusFilter]);

  const filteredPermits = useMemo(() => {
    return livePermits.filter((item) => {
      const matchStatus = statusFilter === "All" || item.validity.toLowerCase() === statusFilter.toLowerCase();
      const matchSearch =
        !query ||
        item.permit_no.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query) ||
        item.entity.toLowerCase().includes(query) ||
        item.issued_by.toLowerCase().includes(query) ||
        item.origin.toLowerCase().includes(query) ||
        item.destination.toLowerCase().includes(query) ||
        item.carrier_plate.toLowerCase().includes(query);
      return matchStatus && matchSearch;
    });
  }, [query, statusFilter]);

  const filteredPayments = useMemo(() => {
    return livePayments.filter((item) => {
      const matchStatus = statusFilter === "All" || item.status.toLowerCase() === statusFilter.toLowerCase();
      const matchSearch =
        !query ||
        item.txn_id.toLowerCase().includes(query) ||
        item.tag_ref.toLowerCase().includes(query) ||
        item.owner.toLowerCase().includes(query) ||
        item.fee_type.toLowerCase().includes(query) ||
        item.or_number.toLowerCase().includes(query) ||
        item.payment_method.toLowerCase().includes(query) ||
        item.status.toLowerCase().includes(query);
      return matchStatus && matchSearch;
    });
  }, [query, statusFilter]);

  const renderStatusBadge = (status) => {
    const s = String(status || "").toLowerCase();
    if (s.includes("pass") || s.includes("valid") || s.includes("paid") || s.includes("healthy")) {
      return <span className="lid-badge passed"><Icon.Check size={12} /> {status}</span>;
    }
    if (s.includes("warn") || s.includes("pending") || s.includes("suspect")) {
      return <span className="lid-badge warning"><Icon.AlertTriangle size={12} /> {status}</span>;
    }
    if (s.includes("condemn") || s.includes("reject") || s.includes("expired") || s.includes("unpaid") || s.includes("quarantine")) {
      return <span className="lid-badge danger"><Icon.X size={12} /> {status}</span>;
    }
    return <span className="lid-badge info"><Icon.Info size={12} /> {status}</span>;
  };

  return (
    <div className="lid-container" data-theme={theme}>
      <header className="lid-header">
        <div className="lid-brand-group">
          <div className="lid-brand-badge">
            <Icon.Shield size={22} />
          </div>
          <div className="lid-brand-info">
            <h1>LSMIS Operations Command</h1>
            <div className="lid-brand-sub">
              <span className="lid-live-pulse">
                <span className="lid-pulse-dot" />
                SYSTEM ONLINE
              </span>
              <span>•</span>
              <span title="Philippine Standard Time">
                {currentTime.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} PST
              </span>
            </div>
          </div>
        </div>

        <div className="lid-search-container">
          <div className="lid-search-wrapper">
            <input
              type="text"
              className="lid-search-input"
              placeholder="Search livestock, certificates, permits, tags, owners..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Global search input"
            />
            <span className="lid-search-icon" style={{ zIndex: 10, pointerEvents: "none" }}>
              <Icon.Search size={18} />
            </span>
            {searchQuery && (
              <button
                className="lid-search-clear"
                onClick={() => setSearchQuery("")}
                title="Clear search"
              >
                <Icon.X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="lid-header-actions">
          <button
            className="lid-alert-trigger"
            onClick={() => setIsAlertDrawerOpen((prev) => !prev)}
            title="Toggle Operation Alerts"
            aria-label="Alerts"
          >
            <Icon.Bell size={19} />
            {criticalWarningCount > 0 && (
              <span className="lid-alert-badge">{criticalWarningCount}</span>
            )}
          </button>

          <button
            className="lid-action-btn"
            onClick={() => {
              setSearchQuery("");
              setSpeciesFilter("All");
              setStatusFilter("All");
            }}
            title="Reset Filters"
          >
            <Icon.RefreshCw size={15} />
            <span>Reset</span>
          </button>

          <button
            className="lid-action-btn"
            onClick={() => window.print()}
            title="Print or Export Dashboard"
          >
            <Icon.Printer size={15} />
            <span>Print View</span>
          </button>

          <button
            className="lid-action-btn"
            onClick={toggleTheme}
            title="Toggle Light / Dark Mode"
          >
            {theme === "dark" ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
          </button>

          <button
            className="lid-action-btn"
            style={{ borderColor: "#059669", color: "#059669" }}
            onClick={() => navigate("/")}
            title="Return to Portal Landing"
          >
            <Icon.Home size={15} />
            <span>Portal Home</span>
          </button>
        </div>
      </header>

      <section className="lid-top-kpi-bar">
        <div className="lid-kpi-grid">
          <div className="lid-kpi-card">
            <div className="lid-kpi-icon emerald">
              <Icon.Cow size={22} />
            </div>
            <div>
              <div className="lid-kpi-label">Active Headcount</div>
              <div className="lid-kpi-value">142 Head</div>
              <div className="lid-kpi-sub">Registered in Facility</div>
            </div>
          </div>

          <div className="lid-kpi-card">
            <div className="lid-kpi-icon blue">
              <Icon.Layers size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Swine (Hogs)</div>
              <div className="lid-kpi-value">84 Head</div>
              <div className="lid-kpi-sub">59.2% • Pens A1°A6</div>
            </div>
          </div>

          <div className="lid-kpi-card">
            <div className="lid-kpi-icon amber">
              <Icon.Box size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Cattle (Bovine)</div>
              <div className="lid-kpi-value">38 Head</div>
              <div className="lid-kpi-sub">26.8% • Pens B1°B3</div>
            </div>
          </div>

          <div className="lid-kpi-card">
            <div className="lid-kpi-icon violet">
              <Icon.Award size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Carabao & Goats</div>
              <div className="lid-kpi-value">20 Head</div>
              <div className="lid-kpi-sub">14.0% • Pens C1°C2</div>
            </div>
          </div>

          <div className="lid-kpi-card">
            <div className="lid-kpi-icon rose">
              <Icon.AlertTriangle size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Quarantine Bay</div>
              <div className="lid-kpi-value">3 Head</div>
              <div className="lid-kpi-sub">Active Observation</div>
            </div>
          </div>

          <div className="lid-kpi-card">
            <div className="lid-kpi-icon emerald">
              <Icon.ClipboardCheck size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Inspection Pass Rate</div>
              <div className="lid-kpi-value">97.2%</div>
              <div className="lid-kpi-sub">NMIS Standard Compliant</div>
            </div>
          </div>
        </div>
      </section>

      <nav className="lid-nav-bar">
        <div className="lid-tab-group">
          <button
            className={`lid-tab-btn ${activeTab === "tracker" ? "active" : ""}`}
            onClick={() => { setActiveTab("tracker"); setStatusFilter("All"); }}
          >
            <Icon.Cow size={16} />
            <span>Livestock Tracker</span>
            <span className="lid-tab-count">{filteredLivestock.length}</span>
          </button>

          <button
            className={`lid-tab-btn ${activeTab === "certifications" ? "active" : ""}`}
            onClick={() => { setActiveTab("certifications"); setStatusFilter("All"); }}
          >
            <Icon.Stethoscope size={16} />
            <span>Certifications (Ante & Post)</span>
            <span className="lid-tab-count">
              {filteredAnteCertifications.length + filteredPostCertifications.length}
            </span>
          </button>

          <button
            className={`lid-tab-btn ${activeTab === "permits" ? "active" : ""}`}
            onClick={() => { setActiveTab("permits"); setStatusFilter("All"); }}
          >
            <Icon.FileText size={16} />
            <span>Permit Records</span>
            <span className="lid-tab-count">{filteredPermits.length}</span>
          </button>

          <button
            className={`lid-tab-btn ${activeTab === "payments" ? "active" : ""}`}
            onClick={() => { setActiveTab("payments"); setStatusFilter("All"); }}
          >
            <Icon.CreditCard size={16} />
            <span>Permit Fee Records</span>
            <span className="lid-tab-count">{filteredPayments.length}</span>
          </button>
        </div>

        <div className="lid-filter-group">
          {(activeTab === "tracker" || activeTab === "certifications") && (
            <select
              className="lid-select"
              value={speciesFilter}
              onChange={(e) => setSpeciesFilter(e.target.value)}
              title="Filter by Species"
            >
              <option value="All">All Species</option>
              <option value="Swine">Swine</option>
              <option value="Cattle">Cattle</option>
              <option value="Carabao">Carabao</option>
              <option value="Goat">Goat</option>
            </select>
          )}

          <select
            className="lid-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="Filter by Status"
          >
            <option value="All">All Statuses</option>
            {activeTab === "tracker" && (
              <>
                <option value="Healthy">Healthy</option>
                <option value="Quarantined">Quarantined</option>
                <option value="Condemned">Condemned</option>
              </>
            )}
            {activeTab === "certifications" && (
              <>
                <option value="Passed">Passed / Approved</option>
                <option value="Suspect">Suspect / Quarantine</option>
                <option value="Condemned">Condemned</option>
              </>
            )}
            {activeTab === "permits" && (
              <>
                <option value="Valid">Valid</option>
                <option value="Expired">Expired</option>
                <option value="Pending">Pending</option>
              </>
            )}
            {activeTab === "payments" && (
              <>
                <option value="Paid">Paid</option>
                <option value="Unpaid">Unpaid</option>
                <option value="Refunded">Refunded</option>
              </>
            )}
          </select>

          <button
            className={`lid-action-btn ${isAlertDrawerOpen ? "active" : ""}`}
            onClick={() => setIsAlertDrawerOpen((prev) => !prev)}
            style={{
              borderColor: isAlertDrawerOpen ? "#ef4444" : undefined,
              color: isAlertDrawerOpen ? "#ef4444" : undefined,
            }}
          >
            <Icon.Bell size={14} />
            <span>Alerts ({alerts.length})</span>
          </button>
        </div>
      </nav>

      <div className="lid-workspace">
        <main className="lid-main-scroll">
          {activeTab === "tracker" && (
            <div className="lid-table-card">
              <div className="lid-card-header">
                <div className="lid-card-title-group">
                  <h2>Livestock Inventory Ledger</h2>
                  <div className="lid-card-subtitle">
                    Live breakdown of livestock on facility grounds, origin verification, and holding pen assignments.
                  </div>
                </div>
                <div className="lid-filter-group">
                  <span className="lid-badge info">
                    {filteredLivestock.length} Matching Records
                  </span>
                </div>
              </div>

              <div className="lid-table-scroll-wrapper">
                <table className="lid-table">
                  <thead>
                    <tr>
                      <th>Ear Tag / ID</th>
                      <th>Species & Breed</th>
                      <th>Weight</th>
                      <th>Owner / Consignee</th>
                      <th>Origin Source</th>
                      <th>Holding Pen</th>
                      <th>Arrival Time</th>
                      <th>Health Status</th>
                      <th>Operational Stage</th>
                      <th className="table-action-th">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLivestock.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#9BA49E", marginBottom: "0.5rem" }} />
                          <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>
                            No livestock records matching "{searchQuery}"
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredLivestock.map((animal) => (
                        <tr
                          key={animal.id}
                          onClick={() => handleOpenDetail(animal, "Livestock Record")}
                        >
                          <td className="lid-tag-cell"><TagBadge tag={animal.tag_number} /></td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{animal.species}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              {animal.breed} • {animal.gender}
                            </div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{animal.weight}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{animal.owner_name}</div>
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Icon.MapPin size={13} style={{ color: "#059669" }} />
                              <span>{animal.origin}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, color: "#187A56" }}>
                              {animal.holding_pen}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                            {animal.arrival_date}
                          </td>
                          <td>{renderStatusBadge(animal.health_status)}</td>
                          <td>
                            <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                              {animal.workflow_stage}
                            </span>
                          </td>
                          <td className="table-action-td">
                            <div className="table-action-group">
                              <button
                                type="button"
                                className="action-btn action-btn-outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDetail(animal, "Livestock Record");
                                }}
                                title="View Livestock Record"
                              >
                                <Icon.Eye size={13} />
                                <span>Details</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "certifications" && (
            <div>
              <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
                <button
                  className={`lid-action-btn ${certSubTab === "antemortem" ? "active" : ""}`}
                  style={{
                    backgroundColor: certSubTab === "antemortem" ? "#059669" : undefined,
                    color: certSubTab === "antemortem" ? "#ffffff" : undefined,
                    fontWeight: 600,
                  }}
                  onClick={() => setCertSubTab("antemortem")}
                >
                  <Icon.Stethoscope size={16} />
                  <span>Ante-Mortem Certifications (Pre-Slaughter)</span>
                  <span className="lid-tab-count" style={{ marginLeft: 4 }}>
                    {filteredAnteCertifications.length}
                  </span>
                </button>

                <button
                  className={`lid-action-btn ${certSubTab === "postmortem" ? "active" : ""}`}
                  style={{
                    backgroundColor: certSubTab === "postmortem" ? "#187A56" : undefined,
                    color: certSubTab === "postmortem" ? "#ffffff" : undefined,
                    fontWeight: 600,
                  }}
                  onClick={() => setCertSubTab("postmortem")}
                >
                  <Icon.Award size={16} />
                  <span>Post-Mortem Certifications (Carcass Checks)</span>
                  <span className="lid-tab-count" style={{ marginLeft: 4 }}>
                    {filteredPostCertifications.length}
                  </span>
                </button>
              </div>

              {certSubTab === "antemortem" && (
                <div className="lid-table-card">
                  <div className="lid-card-header">
                    <div className="lid-card-title-group">
                      <h2>Ante-Mortem Veterinary Inspection Ledger</h2>
                      <div className="lid-card-subtitle">
                        Pre-slaughter clinical examination records, rectal body temperatures, and veterinary fitness clearances.
                      </div>
                    </div>
                    <span className="lid-badge info">
                      {filteredAnteCertifications.length} Certificates
                    </span>
                  </div>

                  <div className="lid-table-scroll-wrapper">
                    <table className="lid-table">
                      <thead>
                        <tr>
                          <th>Cert No.</th>
                          <th>Ear Tag</th>
                          <th>Species</th>
                          <th>Owner</th>
                          <th>Inspection Date</th>
                          <th>Attending Veterinarian</th>
                          <th>PRC License</th>
                          <th>Temp</th>
                          <th>Clinical Findings</th>
                          <th>Decision</th>
                          <th className="table-action-th">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAnteCertifications.length === 0 ? (
                          <tr>
                            <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                              <Icon.Search size={32} style={{ color: "#9BA49E", marginBottom: "0.5rem" }} />
                              <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>
                                No ante-mortem records match "{searchQuery}"
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredAnteCertifications.map((item) => (
                            <tr
                              key={item.cert_id}
                              onClick={() => handleOpenDetail(item, "Ante-Mortem Inspection Certificate")}
                            >
                              <td style={{ fontWeight: 700, color: "#187A56" }}>{item.cert_id}</td>
                              <td className="lid-tag-cell"><TagBadge tag={item.tag_number} /></td>
                              <td style={{ fontWeight: 600 }}>{item.species}</td>
                              <td>{item.owner}</td>
                              <td style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                                {item.inspection_date}
                              </td>
                              <td style={{ fontWeight: 600 }}>{item.inspector_name}</td>
                              <td style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
                                {item.inspector_license}
                              </td>
                              <td>
                                <span
                                  style={{
                                    fontWeight: 700,
                                    color: parseFloat(item.temperature) >= 40 ? "#dc2626" : "#059669",
                                  }}
                                >
                                  {item.temperature}
                                </span>
                              </td>
                              <td style={{ maxWidth: 260, whiteSpace: "normal" }}>
                                <span style={{ fontSize: "0.8rem", color: "var(--color-text)" }}>
                                  {item.clinical_notes}
                                </span>
                              </td>
                              <td>{renderStatusBadge(item.decision)}</td>
                              <td className="table-action-td">
                                <div className="table-action-group">
                                  <button
                                    type="button"
                                    className="action-btn action-btn-outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenDetail(item, "Ante-Mortem Inspection Certificate");
                                    }}
                                    title="View Ante-Mortem Certificate"
                                  >
                                    <Icon.Eye size={13} />
                                    <span>Details</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {certSubTab === "postmortem" && (
                <div className="lid-table-card">
                  <div className="lid-card-header">
                    <div className="lid-card-title-group">
                      <h2>Post-Mortem Carcass & Viscera Examination Ledger</h2>
                      <div className="lid-card-subtitle">
                        Post-evisceration pathology verification, viscera inspection, carcass grading, and stamp approvals.
                      </div>
                    </div>
                    <span className="lid-badge info">
                      {filteredPostCertifications.length} Certificates
                    </span>
                  </div>

                  <div className="lid-table-scroll-wrapper">
                    <table className="lid-table">
                      <thead>
                        <tr>
                          <th>Cert No.</th>
                          <th>Ear Tag</th>
                          <th>Carcass Wt.</th>
                          <th>Species</th>
                          <th>Owner</th>
                          <th>Inspection Date</th>
                          <th>Supervising Vet</th>
                          <th>Meat Inspector</th>
                          <th>Viscera & Pathology</th>
                          <th>Disposition</th>
                          <th className="table-action-th">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPostCertifications.length === 0 ? (
                          <tr>
                            <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                              <Icon.Search size={32} style={{ color: "#9BA49E", marginBottom: "0.5rem" }} />
                              <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>
                                No post-mortem records match "{searchQuery}"
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredPostCertifications.map((item) => (
                            <tr
                              key={item.cert_id}
                              onClick={() => handleOpenDetail(item, "Post-Mortem Carcass Certificate")}
                            >
                              <td style={{ fontWeight: 700, color: "#187A56" }}>{item.cert_id}</td>
                              <td className="lid-tag-cell"><TagBadge tag={item.tag_number} /></td>
                              <td style={{ fontWeight: 700 }}>{item.carcass_weight}</td>
                              <td style={{ fontWeight: 600 }}>{item.species}</td>
                              <td>{item.owner}</td>
                              <td style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                                {item.inspection_date}
                              </td>
                              <td style={{ fontWeight: 600 }}>{item.inspector_name}</td>
                              <td style={{ fontSize: "0.8rem" }}>{item.meat_inspector}</td>
                              <td style={{ maxWidth: 260, whiteSpace: "normal" }}>
                                <span style={{ fontSize: "0.8rem", color: "var(--color-text)" }}>
                                  {item.viscera_findings}
                                </span>
                              </td>
                              <td>{renderStatusBadge(item.decision)}</td>
                              <td className="table-action-td">
                                <div className="table-action-group">
                                  <button
                                    type="button"
                                    className="action-btn action-btn-outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenDetail(item, "Post-Mortem Carcass Certificate");
                                    }}
                                    title="View Post-Mortem Certificate"
                                  >
                                    <Icon.Eye size={13} />
                                    <span>View Cert</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "permits" && (
            <div className="lid-table-card">
              <div className="lid-card-header">
                <div className="lid-card-title-group">
                  <h2>Official Livestock & Meat Transit Permits</h2>
                  <div className="lid-card-subtitle">
                    Regulatory tracking for transit permits, veterinary health certificates, facility clearances, and shipping logs.
                  </div>
                </div>
                <span className="lid-badge info">{filteredPermits.length} Permits</span>
              </div>

              <div className="lid-table-scroll-wrapper">
                <table className="lid-table">
                  <thead>
                    <tr>
                      <th>Permit Number</th>
                      <th>Permit Classification</th>
                      <th>Consignment / Entity Reference</th>
                      <th>Issuing Authority</th>
                      <th>Issue Date</th>
                      <th>Expiration Date</th>
                      <th>Origin Point</th>
                      <th>Destination</th>
                      <th>Carrier Plate</th>
                      <th>Validity Status</th>
                      <th className="table-action-th">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPermits.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#9BA49E", marginBottom: "0.5rem" }} />
                          <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>
                            No permit records match "{searchQuery}"
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredPermits.map((permit) => (
                        <tr
                          key={permit.permit_no}
                          onClick={() => handleOpenDetail(permit, "Regulatory Permit")}
                        >
                          <td style={{ fontWeight: 700, fontFamily: "monospace", color: "#059669" }}>
                            {permit.permit_no}
                          </td>
                          <td style={{ fontWeight: 600 }}>{permit.type}</td>
                          <td>
                            <span style={{ fontSize: "0.82rem" }}>{permit.entity}</span>
                          </td>
                          <td>{permit.issued_by}</td>
                          <td style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                            {permit.issue_date}
                          </td>
                          <td style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                            {permit.expiry_date}
                          </td>
                          <td>{permit.origin}</td>
                          <td>{permit.destination}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                            {permit.carrier_plate}
                          </td>
                          <td>{renderStatusBadge(permit.validity)}</td>
                          <td className="table-action-td">
                            <div className="table-action-group">
                              <button
                                type="button"
                                className="action-btn action-btn-outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDetail(permit, "Regulatory Permit");
                                }}
                                title="Verify Regulatory Permit"
                              >
                                <Icon.CheckCircle size={13} />
                                <span>Verify</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "payments" && (
            <div className="lid-table-card">
              <div className="lid-card-header">
                <div className="lid-card-title-group">
                  <h2>Financial Transaction & Fee Collection Ledger</h2>
                  <div className="lid-card-subtitle">
                    Slaughterhouse service fees, ante/post-mortem inspection assessments, lairage charges, and official receipts.
                  </div>
                </div>
                <span className="lid-badge info">{filteredPayments.length} Transactions</span>
              </div>

              <div className="lid-table-scroll-wrapper">
                <table className="lid-table">
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      <th>Livestock Ref</th>
                      <th>Owner / Payer</th>
                      <th>Fee Assessment Category</th>
                      <th>Amount (₱)</th>
                      <th>Payment Method</th>
                      <th>Official Receipt (OR)</th>
                      <th>Date / Time</th>
                      <th>Cashier Staff</th>
                      <th>Payment Status</th>
                      <th className="table-action-th">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#9BA49E", marginBottom: "0.5rem" }} />
                          <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>
                            No permit fee records match "{searchQuery}"
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((p) => (
                        <tr
                          key={p.txn_id}
                          onClick={() => handleOpenDetail(p, "Permit Fee Record")}
                        >
                          <td style={{ fontWeight: 700, fontFamily: "monospace", color: "#b45309" }}>
                            {p.txn_id}
                          </td>
                          <td className="lid-tag-cell">{p.tag_ref}</td>
                          <td style={{ fontWeight: 600 }}>{p.owner}</td>
                          <td>{p.fee_type}</td>
                          <td style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                            ?{p.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                          </td>
                          <td>
                            <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>
                              {p.payment_method}
                            </span>
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                            {p.or_number}
                          </td>
                          <td style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                            {p.payment_date}
                          </td>
                          <td>{p.cashier}</td>
                          <td>{renderStatusBadge(p.status)}</td>
                          <td className="table-action-td">
                            <div className="table-action-group">
                              <button
                                type="button"
                                className="action-btn action-btn-outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDetail(p, "Permit Fee Record");
                                }}
                                title="View Official Receipt"
                              >
                                <Icon.FileText size={13} />
                                <span>Receipt</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>

        <aside className={`lid-alert-panel ${isAlertDrawerOpen ? "" : "collapsed"}`}>
          <div className="lid-alert-header">
            <div className="lid-alert-title-wrap">
              <Icon.Bell size={18} style={{ color: "#ef4444" }} />
              <h3>Operations Alert Center</h3>
              <span className="lid-badge danger">{alerts.length}</span>
            </div>
            <button
              className="lid-alert-dismiss"
              onClick={() => setIsAlertDrawerOpen(false)}
              title="Close alert panel"
            >
              <Icon.X size={16} />
            </button>
          </div>

          <div className="lid-alert-tabs">
            <button
              className={`lid-alert-tab ${alertFilter === "all" ? "active" : ""}`}
              onClick={() => setAlertFilter("all")}
            >
              All ({alerts.length})
            </button>
            <button
              className={`lid-alert-tab ${alertFilter === "critical" ? "active" : ""}`}
              onClick={() => setAlertFilter("critical")}
              style={{ color: alertFilter === "critical" ? "#dc2626" : undefined }}
            >
              Critical ({alerts.filter((a) => a.severity === "critical").length})
            </button>
            <button
              className={`lid-alert-tab ${alertFilter === "warning" ? "active" : ""}`}
              onClick={() => setAlertFilter("warning")}
              style={{ color: alertFilter === "warning" ? "#d97706" : undefined }}
            >
              Warning ({alerts.filter((a) => a.severity === "warning").length})
            </button>
            <button
              className={`lid-alert-tab ${alertFilter === "info" ? "active" : ""}`}
              onClick={() => setAlertFilter("info")}
              style={{ color: alertFilter === "info" ? "#187A56" : undefined }}
            >
              Info ({alerts.filter((a) => a.severity === "info").length})
            </button>
          </div>

          <div className="lid-alert-scroll">
            {filteredAlerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--color-text-muted)" }}>
                <Icon.CheckCircle size={32} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                <div style={{ fontWeight: 600 }}>No Active Alerts in this Tier</div>
                <div style={{ fontSize: "0.75rem", marginTop: 4 }}>All livestock operations operating within normal parameters.</div>
              </div>
            ) : (
              filteredAlerts.map((alt) => (
                <div
                  key={alt.id}
                  className={`lid-alert-item ${alt.severity}`}
                  onClick={() => handleAlertClick(alt)}
                  title="Click to jump to affected record"
                >
                  <div className="lid-alert-header-row">
                    <div className="lid-alert-title">
                      {alt.severity === "critical" && <Icon.AlertTriangle size={14} />}
                      {alt.severity === "warning" && <Icon.Clock size={14} />}
                      {alt.severity === "info" && <Icon.Info size={14} />}
                      <span>{alt.title}</span>
                    </div>
                    <button
                      className="lid-alert-dismiss"
                      onClick={(e) => handleDismissAlert(e, alt.id)}
                      title="Dismiss alert"
                    >
                      <Icon.X size={13} />
                    </button>
                  </div>
                  <div className="lid-alert-msg">{alt.message}</div>
                  <div className="lid-alert-meta">
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>Ref: {alt.tag_ref}</span>
                    <span>{alt.timestamp}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {isModalOpen && selectedRecord && (
        <div className="lid-modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div
            className="lid-modal-container"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lid-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div className="lid-brand-badge" style={{ width: 36, height: 36 }}>
                  <Icon.FileText size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
                    {selectedRecord._type || "Record Details"}
                  </h3>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    Republic of the Philippines • Department of Agriculture • NMIS Accredited
                  </div>
                </div>
              </div>
              <button
                className="lid-alert-dismiss"
                onClick={() => setIsModalOpen(false)}
                title="Close"
              >
                <Icon.X size={18} />
              </button>
            </div>

            <div className="lid-modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                    Primary Identifier
                  </div>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, fontFamily: "monospace", color: "#059669" }}>
                    {selectedRecord.tag_number ? (
                      <TagBadge tag={selectedRecord.tag_number} />
                    ) : (
                      selectedRecord.permit_no || selectedRecord.txn_id || selectedRecord.cert_id
                    )}
                  </div>
                </div>
                <div>
                  {renderStatusBadge(selectedRecord.health_status || selectedRecord.decision || selectedRecord.validity || selectedRecord.status)}
                </div>
              </div>

              <div className="lid-detail-grid">
                {Object.entries(selectedRecord)
                  .filter(([k]) => !k.startsWith("_") && k !== "id")
                  .map(([key, val]) => (
                    <div key={key} className="lid-detail-item">
                      <div className="lid-detail-label">{key.replace(/_/g, " ")}</div>
                      <div className="lid-detail-val">{String(val)}</div>
                    </div>
                  ))}
              </div>

              <div style={{ marginTop: "1.5rem", padding: "1rem", background: "var(--color-bg)", borderRadius: "8px", border: "1px dashed var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.82rem", color: "#059669" }}>
                  <Icon.ShieldCheck size={16} />
                  <span>Official Abattoir Validation Stamp</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "4px" }}>
                  This record is electronically certified under Republic Act No. 9296 (Meat Inspection Code of the Philippines) and RA 10536. Digital verification hash verified.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", padding: "1rem 1.5rem", borderTop: "1px solid var(--color-border)" }}>
              <button
                className="lid-action-btn"
                onClick={() => window.print()}
              >
                <Icon.Printer size={15} />
                <span>Print Official Slip</span>
              </button>
              <button
                className="lid-action-btn"
                style={{ backgroundColor: "#059669", color: "#ffffff", borderColor: "#059669" }}
                onClick={() => setIsModalOpen(false)}
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LivestockInspectionDashboard;
