import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ROLES, STORAGE_KEYS } from "../utils/constants";
import { normalizeRole, getSessionStorageItem } from "../store/authStore";

export const OwnerRoute = ({ children }) => {
  const { session, role, loading, isInitialized } = useAuth();
  const location = useLocation();

  const activeRole = normalizeRole(role || session?.role);

  // Check fallback session in storage if auth state is briefly synchronizing
  const getFallbackRole = () => {
    try {
      const raw = getSessionStorageItem(STORAGE_KEYS.SESSION);
      if (raw) {
        const s = JSON.parse(raw);
        return normalizeRole(s?.role);
      }
    } catch (_) {}
    return null;
  };

  const effectiveRole = activeRole || getFallbackRole();

  if (loading || !isInitialized) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 600 }}>
          Verifying security authorization…
        </div>
      </div>
    );
  }

  if (!effectiveRole) return <Navigate to="/login" state={{ from: location }} replace />;
  if (effectiveRole !== ROLES.OWNER && effectiveRole !== "owner") return <Navigate to={`/${effectiveRole}`} replace />;
  return children;
};
