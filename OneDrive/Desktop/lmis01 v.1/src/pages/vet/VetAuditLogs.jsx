import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { SharedAuditLogs } from "../../components/audit/SharedAuditLogs";

export const VetAuditLogs = () => {
  const { role, isInitialized, loading } = useAuth();
  const normalizedRole = (role || "").toLowerCase().trim();
  if (isInitialized && !loading && normalizedRole !== "vet" && normalizedRole !== "veterinarian") {
    return <Navigate to="/vet" replace />;
  }
  return <SharedAuditLogs roleScope="vet" />;
};

export default VetAuditLogs;
