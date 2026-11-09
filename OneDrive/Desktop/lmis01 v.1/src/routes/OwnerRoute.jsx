import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ROLES } from "../utils/constants";

export const OwnerRoute = ({ children }) => {
  const { role, loading, isInitialized, mfaRequired } = useAuth();

  if (mfaRequired) return <Navigate to="/login?mfa=required" replace />;

  if (loading || !isInitialized) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 600 }}>
          Verifying security authorization…
        </div>
      </div>
    );
  }

  if (!role) return <Navigate to="/login" replace />;
  if (role !== ROLES.OWNER && role !== "owner") return <Navigate to={`/${role}`} replace />;
  return children;
};
