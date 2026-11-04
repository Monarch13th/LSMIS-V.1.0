import React from "react";
import { RoleReportsModule } from "../../components/reports/RoleReportsModule";

/**
 * Standardized Veterinarian Inspection History & Records View.
 * Matches the exact UI/UX reference design of Admin Inspection Records,
 * displaying Ante-Mortem, Post-Mortem, Condemnations, and Carcass Weighing
 * in a consistent, read-only monitoring layout.
 */
export const InspectionHistory = ({
  role = "vet",
  monitoringModule = "inspection",
  initialReportType = "antemortem",
  initialStatusFilter = "all",
}) => {
  return (
    <RoleReportsModule
      key="standardized-inspection-history"
      role={role}
      monitoringModule={monitoringModule}
      initialReportType={initialReportType}
      initialStatusFilter={initialStatusFilter}
    />
  );
};

export default InspectionHistory;
