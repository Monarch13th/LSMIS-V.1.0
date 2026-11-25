import { RoleReportsModule } from "../../components/reports/RoleReportsModule";

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
