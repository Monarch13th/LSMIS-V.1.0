import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { TagBadge } from "../../components/ui/TagBadge";
import { useTheme } from "../../hooks/useTheme";
import "../../styles/inspection_dashboard.css";

// ==========================================================================
// REALISTIC MOCK DATASETS (Philippine Abattoir / Veterinary Operations)
// ==========================================================================

const MOCK_LIVESTOCK = [
  {
    id: "LS-101",
    tag_number: "SW-2026-0811",
    species: "Swine",
    breed: "Large White Cross",
    gender: "Female",
    weight: "108 kg",
    owner_name: "Juan Dela Cruz",
    origin: "San Ildefonso, Bulacan",
    holding_pen: "Pen A-2",
    arrival_date: "2026-09-14 06:15",
    health_status: "Healthy",
    workflow_stage: "Slaughter Scheduled",
  },
  {
    id: "LS-102",
    tag_number: "SW-2026-0812",
    species: "Swine",
    breed: "Landrace",
    gender: "Male",
    weight: "115 kg",
    owner_name: "Maria Theresa Santos",
    origin: "Santa Maria, Bulacan",
    holding_pen: "Pen A-2",
    arrival_date: "2026-09-14 06:20",
    health_status: "Healthy",
    workflow_stage: "Ante-Mortem Passed",
  },
  {
    id: "LS-103",
    tag_number: "SW-2026-0814",
    species: "Swine",
    breed: "Duroc Jersey",
    gender: "Male",
    weight: "98 kg",
    owner_name: "Eduardo Navarro",
    origin: "San Rafael, Bulacan",
    holding_pen: "Pen A-4 (Isolation)",
    arrival_date: "2026-09-14 06:45",
    health_status: "Quarantined",
    workflow_stage: "Suspect Holding",
  },
  {
    id: "LS-104",
    tag_number: "CT-2026-0419",
    species: "Cattle",
    breed: "Brahman Cross",
    gender: "Male",
    weight: "385 kg",
    owner_name: "Rodrigo Alcantara",
    origin: "Padre Garcia, Batangas",
    holding_pen: "Pen B-1",
    arrival_date: "2026-09-13 18:30",
    health_status: "Healthy",
    workflow_stage: "Ready for Slaughter",
  },
  {
    id: "LS-105",
    tag_number: "CT-2026-0420",
    species: "Cattle",
    breed: "Batangas Native",
    gender: "Female",
    weight: "340 kg",
    owner_name: "Lourdes Mendoza",
    origin: "Rosario, Batangas",
    holding_pen: "Pen B-1",
    arrival_date: "2026-09-13 18:40",
    health_status: "Healthy",
    workflow_stage: "Ante-Mortem Passed",
  },
  {
    id: "LS-106",
    tag_number: "CT-2026-0422",
    species: "Cattle",
    breed: "Simmental Cross",
    gender: "Male",
    weight: "420 kg",
    owner_name: "Antonio Valenzuela",
    origin: "Tiaong, Quezon",
    holding_pen: "Pen B-2",
    arrival_date: "2026-09-13 19:10",
    health_status: "Condemned",
    workflow_stage: "Post-Mortem Barred",
  },
  {
    id: "LS-107",
    tag_number: "CB-2026-0105",
    species: "Carabao",
    breed: "Philippine Carabao",
    gender: "Female",
    weight: "440 kg",
    owner_name: "Danilo Ramos",
    origin: "Echague, Isabela",
    holding_pen: "Pen C-1",
    arrival_date: "2026-09-13 17:00",
    health_status: "Healthy",
    workflow_stage: "Resting / Lairage",
  },
  {
    id: "LS-108",
    tag_number: "GT-2026-0092",
    species: "Goat",
    breed: "Anglo-Nubian Cross",
    gender: "Male",
    weight: "38 kg",
    owner_name: "Corazon Aquino-Lim",
    origin: "Capas, Tarlac",
    holding_pen: "Pen C-2",
    arrival_date: "2026-09-14 07:15",
    health_status: "Healthy",
    workflow_stage: "Ante-Mortem Inspection",
  },
  {
    id: "LS-109",
    tag_number: "SW-2026-0818",
    species: "Swine",
    breed: "Pietrain Cross",
    gender: "Female",
    weight: "102 kg",
    owner_name: "Vicente Morales",
    origin: "Magalang, Pampanga",
    holding_pen: "Pen A-3",
    arrival_date: "2026-09-14 07:30",
    health_status: "Healthy",
    workflow_stage: "Intake Verified",
  },
  {
    id: "LS-110",
    tag_number: "SW-2026-0820",
    species: "Swine",
    breed: "Large White",
    gender: "Male",
    weight: "112 kg",
    owner_name: "Felipe Gomez",
    origin: "San Jose Del Monte",
    holding_pen: "Pen A-3",
    arrival_date: "2026-09-14 07:45",
    health_status: "Healthy",
    workflow_stage: "Marking & Stamping",
  }
];

const MOCK_CERTIFICATIONS_ANTE = [
  {
    cert_id: "AM-2026-0941",
    tag_number: "SW-2026-0811",
    species: "Swine",
    owner: "Juan Dela Cruz",
    inspection_date: "2026-09-14 07:10",
    inspector_name: "Dr. Aris Santos",
    inspector_license: "PRC-VET-004419",
    temperature: "39.1°C",
    clinical_notes: "Alert, active, normal respiration. No gait anomalies or skin erythema.",
    decision: "Passed",
    facility: "Line 1 - Swine Lairage Bay",
  },
  {
    cert_id: "AM-2026-0942",
    tag_number: "SW-2026-0812",
    species: "Swine",
    owner: "Maria Theresa Santos",
    inspection_date: "2026-09-14 07:15",
    inspector_name: "Dr. Aris Santos",
    inspector_license: "PRC-VET-004419",
    temperature: "39.2°C",
    clinical_notes: "Clear eyes, normal posture, good hydration. Sound condition.",
    decision: "Passed",
    facility: "Line 1 - Swine Lairage Bay",
  },
  {
    cert_id: "AM-2026-0943",
    tag_number: "SW-2026-0814",
    species: "Swine",
    owner: "Eduardo Navarro",
    inspection_date: "2026-09-14 07:35",
    inspector_name: "Dr. Ma. Elena Cruz",
    inspector_license: "PRC-VET-005128",
    temperature: "40.8°C",
    clinical_notes: "Elevated rectal temp, lethargic, rapid respiration, suspected heat prostration.",
    decision: "Suspect",
    facility: "Bay 4 - Quarantine Holding",
  },
  {
    cert_id: "AM-2026-0944",
    tag_number: "CT-2026-0419",
    species: "Cattle",
    owner: "Rodrigo Alcantara",
    inspection_date: "2026-09-14 06:30",
    inspector_name: "Dr. Ma. Elena Cruz",
    inspector_license: "PRC-VET-005128",
    temperature: "38.6°C",
    clinical_notes: "Bright demeanor, rhythmic breathing, rumen motility normal. Clean hide.",
    decision: "Passed",
    facility: "Line 2 - Large Animal Chute",
  },
  {
    cert_id: "AM-2026-0945",
    tag_number: "CT-2026-0420",
    species: "Cattle",
    owner: "Lourdes Mendoza",
    inspection_date: "2026-09-14 06:45",
    inspector_name: "Dr. Ma. Elena Cruz",
    inspector_license: "PRC-VET-005128",
    temperature: "38.7°C",
    clinical_notes: "Symmetrical gait, clear nasal discharge, normal lymph nodes.",
    decision: "Passed",
    facility: "Line 2 - Large Animal Chute",
  },
  {
    cert_id: "AM-2026-0946",
    tag_number: "CB-2026-0105",
    species: "Carabao",
    owner: "Danilo Ramos",
    inspection_date: "2026-09-14 07:50",
    inspector_name: "Dr. Aris Santos",
    inspector_license: "PRC-VET-004419",
    temperature: "38.4°C",
    clinical_notes: "Sturdy condition, resting peacefully. 12-hour resting period completed.",
    decision: "Passed",
    facility: "Line 2 - Large Animal Chute",
  },
  {
    cert_id: "AM-2026-0947",
    tag_number: "GT-2026-0092",
    species: "Goat",
    owner: "Corazon Aquino-Lim",
    inspection_date: "2026-09-14 08:05",
    inspector_name: "Dr. Aris Santos",
    inspector_license: "PRC-VET-004419",
    temperature: "39.4°C",
    clinical_notes: "Active, responsive, no oronasal discharge. Fleece dry and clean.",
    decision: "Passed",
    facility: "Small Stock Inspection Gate",
  }
];

const MOCK_CERTIFICATIONS_POST = [
  {
    cert_id: "PM-2026-0511",
    tag_number: "SW-2026-0811",
    carcass_weight: "82.4 kg",
    species: "Swine",
    owner: "Juan Dela Cruz",
    inspection_date: "2026-09-14 09:15",
    inspector_name: "Dr. Aris Santos",
    meat_inspector: "Insp. Bernardo Dizon",
    viscera_findings: "Liver, heart, spleen normal. Mesenteric lymph nodes clear.",
    carcass_condition: "Well-bled, clean dressing, good fat firmness. Zero contamination.",
    decision: "Passed",
    stamp_code: "NMIS-INSP-PASS-01",
  },
  {
    cert_id: "PM-2026-0512",
    tag_number: "SW-2026-0808",
    carcass_weight: "79.8 kg",
    species: "Swine",
    owner: "Vicente Morales",
    inspection_date: "2026-09-14 09:25",
    inspector_name: "Dr. Aris Santos",
    meat_inspector: "Insp. Bernardo Dizon",
    viscera_findings: "Localized liver milk spots (Ascaris suum migration). Liver excised.",
    carcass_condition: "Carcass muscular and skeletal integrity sound. Passed with partial trim.",
    decision: "Passed (Partial)",
    stamp_code: "NMIS-INSP-PART-04",
  },
  {
    cert_id: "PM-2026-0513",
    tag_number: "CT-2026-0422",
    carcass_weight: "264.0 kg",
    species: "Cattle",
    owner: "Antonio Valenzuela",
    inspection_date: "2026-09-14 08:50",
    inspector_name: "Dr. Ma. Elena Cruz",
    meat_inspector: "Insp. Teresa Ocampo",
    viscera_findings: "Extensive hepatic fibrosis, diffuse bile duct calcification (Fascioliasis).",
    carcass_condition: "Generalized icterus detected in adipose tissue and serous membranes. Severe.",
    decision: "Condemned",
    stamp_code: "NMIS-CONDEMNED-09",
  },
  {
    cert_id: "PM-2026-0514",
    tag_number: "CT-2026-0417",
    carcass_weight: "248.5 kg",
    species: "Cattle",
    owner: "Rodrigo Alcantara",
    inspection_date: "2026-09-14 09:40",
    inspector_name: "Dr. Ma. Elena Cruz",
    meat_inspector: "Insp. Teresa Ocampo",
    viscera_findings: "Lungs, heart, kidneys, reticulorumen clean. No parasitic cysts.",
    carcass_condition: "Grade A carcass conformation, clean spinal split, good chill temp (4°C).",
    decision: "Passed",
    stamp_code: "NMIS-INSP-PASS-01",
  },
  {
    cert_id: "PM-2026-0515",
    tag_number: "CB-2026-0102",
    carcass_weight: "278.2 kg",
    species: "Carabao",
    owner: "Danilo Ramos",
    inspection_date: "2026-09-14 10:05",
    inspector_name: "Dr. Aris Santos",
    meat_inspector: "Insp. Bernardo Dizon",
    viscera_findings: "Normal gastrointestinal viscera, heart and pericardium clean.",
    carcass_condition: "Healthy lean color, adequately bled, stamp affixed at quarters.",
    decision: "Passed",
    stamp_code: "NMIS-INSP-PASS-01",
  }
];

const MOCK_PERMITS = [
  {
    permit_no: "TP-2026-0419",
    type: "Livestock Transit Permit",
    entity: "Batangas Cattle Consignment (8 Head)",
    issued_by: "Provincial Vet Office - Batangas",
    issue_date: "2026-09-13",
    expiry_date: "2026-09-15",
    validity: "Valid",
    origin: "Padre Garcia, Batangas",
    destination: "City Central Abattoir",
    carrier_plate: "NBF-8921",
  },
  {
    permit_no: "VHC-2026-1102",
    type: "Veterinary Health Certificate",
    entity: "Bulacan Swine Batch 2026-A (25 Head)",
    issued_by: "BAI Veterinary Quarantine Office",
    issue_date: "2026-09-12",
    expiry_date: "2026-09-15",
    validity: "Valid",
    origin: "San Ildefonso, Bulacan",
    destination: "City Central Abattoir",
    carrier_plate: "CAP-4432",
  },
  {
    permit_no: "TP-2026-0399",
    type: "Livestock Transit Permit",
    entity: "Swine Consignment - San Rafael",
    issued_by: "Municipal Agricultural Office",
    issue_date: "2026-09-10",
    expiry_date: "2026-09-12",
    validity: "Expired",
    origin: "San Rafael, Bulacan",
    destination: "City Central Abattoir",
    carrier_plate: "WXY-9021",
  },
  {
    permit_no: "FAC-2026-0084",
    type: "Facility Sanitation Clearance",
    entity: "Abattoir Main Slaughter Floor & Hanging Rails",
    issued_by: "City Health & Sanitation Dept",
    issue_date: "2026-09-01",
    expiry_date: "2026-09-30",
    validity: "Valid",
    origin: "On-Site Facility",
    destination: "Slaughterhouse Complex",
    carrier_plate: "N/A - Facility",
  },
  {
    permit_no: "MIC-2026-0914",
    type: "Meat Inspection Certificate",
    entity: "Carcass Batch SW-2026-0811 / 0812 (162.2 kg)",
    issued_by: "City Abattoir Administration",
    issue_date: "2026-09-14",
    expiry_date: "2026-09-15",
    validity: "Valid",
    origin: "Tinaan, City of Naga, Cebu, Philippines",
    destination: "City Public Wet Market",
    carrier_plate: "REFRIG-VAN-04",
  },
  {
    permit_no: "TP-2026-0428",
    type: "Livestock Transit Permit",
    entity: "Carabao Transport - Cagayan Valley",
    issued_by: "BAI Region II Quarantine Station",
    issue_date: "2026-09-13",
    expiry_date: "2026-09-16",
    validity: "Valid",
    origin: "Echague, Isabela",
    destination: "Tinaan, City of Naga, Cebu, Philippines",
    carrier_plate: "ABC-1945",
  },
  {
    permit_no: "DSP-2026-0312",
    type: "Meat Transfer & Dispatch Clearance",
    entity: "Consigned Beef Quarters (512 kg)",
    issued_by: "City Meat Inspection Service",
    issue_date: "2026-09-14",
    expiry_date: "2026-09-14",
    validity: "Pending",
    origin: "Tinaan, City of Naga, Cebu, Philippines",
    destination: "Metro Cold Storage Facility",
    carrier_plate: "TRK-6712",
  }
];

const MOCK_PAYMENTS = [
  {
    txn_id: "TXN-2026-8812",
    tag_ref: "SW-2026-0811",
    owner: "Juan Dela Cruz",
    fee_type: "Slaughter & Meat Inspection Fee",
    amount: 520.00,
    payment_method: "Cash",
    or_number: "OR-2026-4418",
    payment_date: "2026-09-14 08:30",
    status: "Paid",
    cashier: "Staff M. Bautista",
  },
  {
    txn_id: "TXN-2026-8813",
    tag_ref: "SW-2026-0812",
    owner: "Maria Theresa Santos",
    fee_type: "Slaughter & Meat Inspection Fee",
    amount: 540.00,
    payment_method: "GCash",
    or_number: "OR-2026-4419",
    payment_date: "2026-09-14 08:45",
    status: "Paid",
    cashier: "Staff M. Bautista",
  },
  {
    txn_id: "TXN-2026-8814",
    tag_ref: "CT-2026-0419",
    owner: "Rodrigo Alcantara",
    fee_type: "Bovine Slaughter & Lairage Fee",
    amount: 1450.00,
    payment_method: "Bank Transfer (LandBank)",
    or_number: "OR-2026-4420",
    payment_date: "2026-09-14 09:00",
    status: "Paid",
    cashier: "Staff J. Perez",
  },
  {
    txn_id: "TXN-2026-8809",
    tag_ref: "SW-2026-0809",
    owner: "Eduardo Navarro",
    fee_type: "Ante-Mortem & Holding Fee",
    amount: 1850.00,
    payment_method: "Awaiting Payment",
    or_number: "PENDING-OR",
    payment_date: "2026-09-14 07:00",
    status: "Unpaid",
    cashier: "Unassigned",
  },
  {
    txn_id: "TXN-2026-8815",
    tag_ref: "CT-2026-0422",
    owner: "Antonio Valenzuela",
    fee_type: "Condemned Carcass Disposal Fee",
    amount: 650.00,
    payment_method: "GCash",
    or_number: "OR-2026-4423",
    payment_date: "2026-09-14 09:30",
    status: "Paid",
    cashier: "Staff J. Perez",
  },
  {
    txn_id: "TXN-2026-8801",
    tag_ref: "CB-2026-0098",
    owner: "Danilo Ramos",
    fee_type: "Overnight Corral Lairage",
    amount: 300.00,
    payment_method: "Cash Refunded",
    or_number: "RF-2026-0012",
    payment_date: "2026-09-13 16:00",
    status: "Refunded",
    cashier: "Staff M. Bautista",
  },
  {
    txn_id: "TXN-2026-8816",
    tag_ref: "GT-2026-0092",
    owner: "Corazon Aquino-Lim",
    fee_type: "Caprine Inspection & Slaughter",
    amount: 220.00,
    payment_method: "Cash",
    or_number: "OR-2026-4424",
    payment_date: "2026-09-14 09:45",
    status: "Paid",
    cashier: "Staff M. Bautista",
  }
];

const INITIAL_ALERTS = [
  {
    id: "ALT-01",
    severity: "critical",
    title: "Febrile Live Animal in Holding Pen",
    message: "Tag SW-2026-0814 registered 40.8°C rectal temp. Quarantined in Bay 4. Barred from slaughter line pending lab screen.",
    timestamp: "18m ago",
    tag_ref: "SW-2026-0814",
    tab_target: "certifications",
  },
  {
    id: "ALT-02",
    severity: "critical",
    title: "Expired Transit Permit Detected",
    message: "Permit TP-2026-0399 expired on 2026-09-12. Livestock transport carrier held at intake checkpoint.",
    timestamp: "32m ago",
    tag_ref: "TP-2026-0399",
    tab_target: "permits",
  },
  {
    id: "ALT-03",
    severity: "critical",
    title: "Total Carcass Condemnation Issued",
    message: "Carcass CT-2026-0422 condemned due to generalized icterus and hepatic fascioliasis. Denaturing scheduled at digester.",
    timestamp: "1h ago",
    tag_ref: "CT-2026-0422",
    tab_target: "certifications",
  },
  {
    id: "ALT-04",
    severity: "warning",
    title: "Unpaid Slaughter Processing Fee",
    message: "Consignment TXN-2026-8809 (₱1,850.00) pending payment past 24h SLA. Meat release lock applied.",
    timestamp: "45m ago",
    tag_ref: "TXN-2026-8809",
    tab_target: "payments",
  },
  {
    id: "ALT-05",
    severity: "warning",
    title: "Transit Clearance Expiring in < 36h",
    message: "Veterinary Health Certificate VHC-2026-1102 for Bulacan Swine consignment expires tomorrow afternoon.",
    timestamp: "2h ago",
    tag_ref: "VHC-2026-1102",
    tab_target: "permits",
  },
  {
    id: "ALT-06",
    severity: "warning",
    title: "Pen B-2 High Capacity Alert",
    message: "Bovine holding pen B-2 reaches 92% capacity (11/12 head). Divert incoming cattle transports to Corral B-3.",
    timestamp: "3h ago",
    tag_ref: "Pen B-2",
    tab_target: "tracker",
  },
  {
    id: "ALT-07",
    severity: "info",
    title: "Intake Batch Check-in Completed",
    message: "15 Head Swine checked in from San Jose Del Monte. Health certificates verified and ear tags logged.",
    timestamp: "3h ago",
    tag_ref: "SW-2026-0811",
    tab_target: "tracker",
  },
  {
    id: "ALT-08",
    severity: "info",
    title: "Official Meat Inspection Certificate Issued",
    message: "Certificate #MIC-2026-0914 signed by Dr. Aris Santos for 162.2 kg inspected pork quarters.",
    timestamp: "4h ago",
    tag_ref: "MIC-2026-0914",
    tab_target: "permits",
  }
];

// ==========================================================================
// COMPONENT
// ==========================================================================
export const LivestockInspectionDashboard = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // Navigation & View State
  const [activeTab, setActiveTab] = useState("tracker"); // tracker | certifications | permits | payments
  const [certSubTab, setCertSubTab] = useState("antemortem"); // antemortem | postmortem
  const [searchQuery, setSearchQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Alert System State
  const [alerts, setAlerts] = useState(INITIAL_ALERTS);
  const [alertFilter, setAlertFilter] = useState("all"); // all | critical | warning | info
  const [isAlertDrawerOpen, setIsAlertDrawerOpen] = useState(false);

  // Detail Modal State
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Live System Clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Alert Counter (Critical + Warning)
  const criticalWarningCount = useMemo(() => {
    return alerts.filter((a) => a.severity === "critical" || a.severity === "warning").length;
  }, [alerts]);

  // Dismiss an Alert
  const handleDismissAlert = (e, alertId) => {
    e.stopPropagation();
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  // Click an Alert to Jump / Filter
  const handleAlertClick = (alert) => {
    setActiveTab(alert.tab_target);
    setSearchQuery(alert.tag_ref);
    if (window.innerWidth <= 1024) {
      setIsAlertDrawerOpen(false);
    }
  };

  // Filtered Alerts
  const filteredAlerts = useMemo(() => {
    if (alertFilter === "all") return alerts;
    return alerts.filter((a) => a.severity === alertFilter);
  }, [alerts, alertFilter]);

  // Open Record Details
  const handleOpenDetail = (record, type) => {
    setSelectedRecord({ ...record, _type: type });
    setIsModalOpen(true);
  };

  // ==========================================================================
  // DATA FILTERING (Real-time centered search across active view)
  // ==========================================================================

  const query = searchQuery.trim().toLowerCase();

  // 1. Livestock Tracker Data
  const filteredLivestock = useMemo(() => {
    return MOCK_LIVESTOCK.filter((item) => {
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

  // 2. Certifications Data
  const filteredAnteCertifications = useMemo(() => {
    return MOCK_CERTIFICATIONS_ANTE.filter((item) => {
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
    return MOCK_CERTIFICATIONS_POST.filter((item) => {
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

  // 3. Permit Records Data
  const filteredPermits = useMemo(() => {
    return MOCK_PERMITS.filter((item) => {
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

  // 4. Payment Records Data
  const filteredPayments = useMemo(() => {
    return MOCK_PAYMENTS.filter((item) => {
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

  // Helper Badge Renderers
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
      {/* ====================================================================
          1. STICKY TOP HEADER WITH CENTERED SEARCH BAR
          ==================================================================== */}
      <header className="lid-header">
        {/* Brand & Live Pulse */}
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

        {/* Centered Prominent Search Bar with Active Glow */}
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

        {/* Header Right Actions */}
        <div className="lid-header-actions">
          {/* Toggle Alert Drawer */}
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

          {/* Quick Refresh */}
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

          {/* Export / Print */}
          <button
            className="lid-action-btn"
            onClick={() => window.print()}
            title="Print or Export Dashboard"
          >
            <Icon.Printer size={15} />
            <span>Print View</span>
          </button>

          {/* Theme Toggle */}
          <button
            className="lid-action-btn"
            onClick={toggleTheme}
            title="Toggle Light / Dark Mode"
          >
            {theme === "dark" ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
          </button>

          {/* Return to Portal */}
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

      {/* ====================================================================
          2. TOP SUMMARY / LIVE LEDGER KPI STRIP (LOCKED)
          ==================================================================== */}
      <section className="lid-top-kpi-bar">
        <div className="lid-kpi-grid">
          {/* Total Livestock */}
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

          {/* Swine Ledger */}
          <div className="lid-kpi-card">
            <div className="lid-kpi-icon blue">
              <Icon.Layers size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Swine (Hogs)</div>
              <div className="lid-kpi-value">84 Head</div>
              <div className="lid-kpi-sub">59.2% • Pens A1–A6</div>
            </div>
          </div>

          {/* Cattle Ledger */}
          <div className="lid-kpi-card">
            <div className="lid-kpi-icon amber">
              <Icon.Box size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Cattle (Bovine)</div>
              <div className="lid-kpi-value">38 Head</div>
              <div className="lid-kpi-sub">26.8% • Pens B1–B3</div>
            </div>
          </div>

          {/* Carabao & Goats */}
          <div className="lid-kpi-card">
            <div className="lid-kpi-icon violet">
              <Icon.Award size={20} />
            </div>
            <div>
              <div className="lid-kpi-label">Carabao & Goats</div>
              <div className="lid-kpi-value">20 Head</div>
              <div className="lid-kpi-sub">14.0% • Pens C1–C2</div>
            </div>
          </div>

          {/* Quarantined / Suspect */}
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

          {/* Inspection Clearance Rate */}
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

      {/* ====================================================================
          3. NAVIGATION BAR (MODULE TABS & VIEW FILTERS)
          ==================================================================== */}
      <nav className="lid-nav-bar">
        {/* Primary Module Tabs */}
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

        {/* Secondary Filter Dropdowns */}
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

          {/* Alert panel toggle for quick visual on the right */}
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

      {/* ====================================================================
          4. MAIN WORKSPACE WITH INDEPENDENT VERTICAL SCROLLING
          ==================================================================== */}
      <div className="lid-workspace">
        <main className="lid-main-scroll">
          {/* ================================================================
              VIEW 1: LIVESTOCK TRACKER (LIVE LEDGER)
              ================================================================ */}
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
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLivestock.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#94a3b8", marginBottom: "0.5rem" }} />
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
                            <span style={{ fontWeight: 600, color: "#0284c7" }}>
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
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="lid-action-btn"
                              style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDetail(animal, "Livestock Record");
                              }}
                            >
                              Details →
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 2: CERTIFICATIONS (ANTE-MORTEM & POST-MORTEM SEPARATED)
              ================================================================ */}
          {activeTab === "certifications" && (
            <div>
              {/* Subtabs for Ante-Mortem vs Post-Mortem */}
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
                    backgroundColor: certSubTab === "postmortem" ? "#0284c7" : undefined,
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

              {/* ANTE-MORTEM TABLE */}
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
                          <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAnteCertifications.length === 0 ? (
                          <tr>
                            <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                              <Icon.Search size={32} style={{ color: "#94a3b8", marginBottom: "0.5rem" }} />
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
                              <td style={{ fontWeight: 700, color: "#0284c7" }}>{item.cert_id}</td>
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
                              <td style={{ textAlign: "right" }}>
                                <button
                                  className="lid-action-btn"
                                  style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDetail(item, "Ante-Mortem Inspection Certificate");
                                  }}
                                >
                                  View Cert →
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* POST-MORTEM TABLE */}
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
                          <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPostCertifications.length === 0 ? (
                          <tr>
                            <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                              <Icon.Search size={32} style={{ color: "#94a3b8", marginBottom: "0.5rem" }} />
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
                              <td style={{ fontWeight: 700, color: "#7c3aed" }}>{item.cert_id}</td>
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
                              <td style={{ textAlign: "right" }}>
                                <button
                                  className="lid-action-btn"
                                  style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDetail(item, "Post-Mortem Carcass Certificate");
                                  }}
                                >
                                  View Cert →
                                </button>
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

          {/* ================================================================
              VIEW 3: PERMIT RECORDS
              ================================================================ */}
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
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPermits.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#94a3b8", marginBottom: "0.5rem" }} />
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
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="lid-action-btn"
                              style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDetail(permit, "Regulatory Permit");
                              }}
                            >
                              Verify →
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 4: PERMIT FEE RECORDS
              ================================================================ */}
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
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "3rem" }}>
                          <Icon.Search size={32} style={{ color: "#94a3b8", marginBottom: "0.5rem" }} />
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
                            ₱{p.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
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
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="lid-action-btn"
                              style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDetail(p, "Permit Fee Record");
                              }}
                            >
                              Receipt →
                            </button>
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

        {/* ====================================================================
            5. DEDICATED 3-TIER COLOR-CODED ALERT SYSTEM PANEL (SIDEBAR/DRAWER)
            ==================================================================== */}
        <aside className={`lid-alert-panel ${isAlertDrawerOpen ? "" : "collapsed"}`}>
          {/* Alert Header */}
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

          {/* Severity Filter Tabs */}
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
              style={{ color: alertFilter === "info" ? "#0284c7" : undefined }}
            >
              Info ({alerts.filter((a) => a.severity === "info").length})
            </button>
          </div>

          {/* Scrollable Alert List */}
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

      {/* ====================================================================
          6. RECORD DETAIL MODAL (INSPECTOR DRAWER)
          ==================================================================== */}
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
