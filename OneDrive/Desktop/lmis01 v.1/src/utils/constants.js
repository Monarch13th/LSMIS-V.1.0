// Application constants
export const ROLES = {
  ADMIN: "admin",
  VET: "vet",
  STAFF: "staff",
  OWNER: "owner",
};

export const ROLE_LABELS = {
  admin: "Administrator",
  vet: "Veterinary Inspector",
  veterinarian: "Veterinary Inspector",
  staff: "Slaughterhouse Staff",
  owner: "Livestock Owner",
};

export const ROLE_COLORS = {
  admin: { from: "#7c3aed", to: "#4f46e5", accent: "#8b5cf6" },
  vet: { from: "#0284c7", to: "#0891b2", accent: "#0ea5e9" },
  staff: { from: "#059669", to: "#0d9488", accent: "#10b981" },
  owner: { from: "#0284c7", to: "#0369a1", accent: "#38bdf8" },
};

export const STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Paid",
  RELEASED: "Released",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export const SPECIES = ["Hog", "Cattle", "Carabao", "Goat"];

export const OPERATOR_TEAMS = ["Team A", "Team B", "Team C"];

export const FEE_METHODS = ["Per Head", "Per Kilo"];

export const TABLES = {
  USERS: "users",
  ROLES: "roles",
  LIVESTOCK: "livestock",
  OWNERS: "owners",
  ANTE_MORTEM: "ante_mortem_inspections",
  POST_MORTEM: "post_mortem_inspections",
  INSPECTION_ASSIGN: "inspection_assignments",
  SLAUGHTER_RECORDS: "slaughter_records",
  SLAUGHTER_SCHEDULES: "slaughter_schedules",
  SLAUGHTER_PROCESSING: "slaughter_processing",
  CARCASS: "carcass_records",
  CARCASS_BRANDING: "carcass_branding_records",
  FEES: "fees",
  PAYMENTS: "payments",
  DISPATCH: "dispatch",
  NOTIFICATIONS: "notifications",
  AUDIT_LOGS: "audit_logs",
  SETTINGS: "system_settings",
  BACKUPS: "backups_metadata",
  DISPOSAL_RECORDS: "disposal_records",
  EVIDENCE_RECORDS: "evidence_records",
  CONDEMNATION_RECORDS: "condemnation_records",
  POST_MORTEM_CONDEMNED_CUTS: "post_mortem_condemned_cuts",
  ORGAN_INSPECTIONS: "organ_inspections",
  PERMITS: "permits",
  PERMIT_CONFIG: "permit_config",
  USER_PREFERENCES: "user_preferences",
  SPECIES: "species",
};

export const STORAGE_KEYS = {
  SESSION: "lsmis_session",
  THEME: "lsmis_theme",
  DB_PREFIX: "lsmis_db_",
};

export const OFFICIAL_OFFICE_INFO = {
  LOCATION: "Tinaan, City of Naga, Cebu, Philippines",
  SYSTEM_NAME: "Livestock Slaughter and Meat Inspection Management System (LSMIS)",
  HEADER_LINE1: "Republic of the Philippines",
  HEADER_LINE2: "Tinaan, City of Naga, Cebu, Philippines",
  SLAUGHTERHOUSE: "Naga Slaughterhouse",
};
