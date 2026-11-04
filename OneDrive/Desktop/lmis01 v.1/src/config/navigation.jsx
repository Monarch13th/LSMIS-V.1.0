// Central navigation config — grouped, single source of truth for all roles
import { Icon } from "../components/icons";

/* ============ ADMIN ============ */
const admin = [
  { header: "GENERAL" },
  { path: "/admin", label: "Dashboard", icon: <Icon.Dashboard /> },

  { header: "MANAGEMENT" },
  { path: "/admin/users", label: "Personnel Management", icon: <Icon.Users /> },
  { path: "/admin/owners", label: "Owner Management", icon: <Icon.User /> },
  { path: "/admin/species", label: "Species Management", icon: <Icon.Cow /> },

  { header: "OPERATIONS MONITORING" },
  { path: "/admin/livestock", label: "Livestock Records", icon: <Icon.Cow /> },
  { path: "/admin/slaughter/records", label: "Slaughter Records", icon: <Icon.Scissors /> },
  { path: "/admin/inspection/records", label: "Inspection Records", icon: <Icon.Stethoscope /> },
  { path: "/admin/permits", label: "Permit Records", icon: <Icon.FileText /> },
  { path: "/admin/audit-logs", label: "Audit Logs", icon: <Icon.Clock /> },

  { header: "REPORTS" },
  { path: "/admin/reports", label: "Reports", icon: <Icon.PieChart /> },

  { header: "ACCOUNT & SETTINGS" },
  { path: "/admin/settings", label: "Settings", icon: <Icon.Settings /> },
];

/* ============ VET ============ */
const vet = [
  { header: "GENERAL" },
  { path: "/vet", label: "Dashboard", icon: <Icon.Dashboard /> },

  { header: "CLINICAL & INSPECTIONS" },
  { path: "/vet/ante-mortem", label: "Ante-Mortem", icon: <Icon.Stethoscope /> },
  { path: "/vet/post-mortem", label: "Post-Mortem", icon: <Icon.Activity /> },
  { path: "/vet/carcass-weighing", label: "Carcass Weighing & Branding", icon: <Icon.Scale /> },
  { path: "/vet/inspection-history", label: "Inspection History", icon: <Icon.ClipboardCheck /> },

  { header: "AUDIT & REPORTS" },
  { path: "/vet/audit-logs", label: "Audit Logs", icon: <Icon.Clock /> },
  { path: "/vet/reports", label: "Reports", icon: <Icon.PieChart /> },

  { header: "ACCOUNT & SETTINGS" },
  { path: "/vet/settings", label: "Settings", icon: <Icon.Settings /> },
];

/* ============ STAFF — follows manual operation flow ============
   Receiving → Scheduling → Slaughter Process → Inspection →
   Payment → Permit → Release
 */
const staff = [
  { header: "GENERAL" },
  { path: "/staff", label: "Dashboard", icon: <Icon.Dashboard /> },

  { header: "LIVESTOCK RECEIVING" },
  { path: "/staff/owners", label: "Registered Owners", icon: <Icon.User /> },

  { header: "OPERATIONS" },
  { path: "/staff/slaughter-processing", label: "Slaughter Processing", icon: <Icon.Scissors /> },
  { path: "/staff/permits", label: "Meat Permit", icon: <Icon.FileText /> },

  { header: "SYSTEM MONITORING" },
  { path: "/staff/inspection-results", label: "Inspection Results", icon: <Icon.Stethoscope /> },
  { path: "/staff/audit-logs", label: "Audit Logs", icon: <Icon.Clock /> },

  { header: "REPORTS" },
  { path: "/staff/reports", label: "Reports", icon: <Icon.PieChart /> },

  { header: "ACCOUNT & SETTINGS" },
  { path: "/staff/settings", label: "Settings", icon: <Icon.Settings /> },
];

export const NAV_ITEMS = { admin, vet, staff };
