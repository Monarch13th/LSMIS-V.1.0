import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { SharedAuditLogs } from "../../components/audit/SharedAuditLogs";

export const AuditLogs = () => {
  const { role, isInitialized, loading } = useAuth();
  const normalizedRole = (role || "").toLowerCase().trim();
  if (isInitialized && !loading && normalizedRole !== "admin" && normalizedRole !== "administrator") {
    return <Navigate to="/admin" replace />;
  }
  return <SharedAuditLogs roleScope="admin" />;
};

export default AuditLogs;
