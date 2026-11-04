import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { SharedAuditLogs } from "../../components/audit/SharedAuditLogs";

export const StaffAuditLogs = () => {
  const { role, isInitialized, loading } = useAuth();
  const normalizedRole = (role || "").toLowerCase().trim();
  if (isInitialized && !loading && normalizedRole !== "staff" && normalizedRole !== "operator") {
    return <Navigate to="/staff" replace />;
  }
  return <SharedAuditLogs roleScope="staff" />;
};

export default StaffAuditLogs;
