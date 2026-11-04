import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ROLES, STORAGE_KEYS } from "../utils/constants";
import { normalizeRole } from "../store/authStore";
import { logActivity } from "../services/activityService";
import { useEffect } from "react";

export const AdminRoute = ({ children }) => {
  const { session, role, userName, loading, isInitialized } = useAuth();
  const location = useLocation();

  const activeRole = normalizeRole(role || session?.role);

  // Check fallback session in sessionStorage if auth state is briefly synchronizing
  const getFallbackRole = () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.SESSION);
      if (raw) {
        const s = JSON.parse(raw);
        return normalizeRole(s?.role);
      }
    } catch (_) {}
    return null;
  };

  const effectiveRole = activeRole || getFallbackRole();

  useEffect(() => {
    if (!loading && isInitialized && effectiveRole && effectiveRole !== ROLES.ADMIN) {
      logActivity({
        action: `Unauthorized access blocked: User ${userName || "User"} (${effectiveRole}) attempted to access restricted admin path ${location.pathname}`,
        module: "Security",
        security_event: "Unauthorized Access",
        severity: "danger",
        user: userName || "Unknown User",
        role: effectiveRole,
        notify: {
          title: "Security Warning",
          message: `Unauthorized access attempt to ${location.pathname} was blocked`,
          type: "danger",
        },
      }).catch(() => {});
    }
  }, [loading, isInitialized, effectiveRole, userName, location.pathname]);

  // Wait until auth initialization and session resolution have fully completed
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
  if (effectiveRole !== ROLES.ADMIN) return <Navigate to={`/${effectiveRole}`} replace />;
  return children;
};
