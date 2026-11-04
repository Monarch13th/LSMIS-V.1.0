import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ROLES } from "../utils/constants";
import { adminService } from "../services/adminService";

export const StaffRoute = ({ children }) => {
  const { session, role, signOut, loading, isInitialized } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isTerminated, setIsTerminated] = useState(false);

  useEffect(() => {
    if (loading || !isInitialized) return;
    let isMounted = true;

    const verifyStatus = async () => {
      if (!session?.email) {
        if (isMounted) setChecking(false);
        return;
      }

      try {
        const res = await adminService.checkUserTerminationStatus(session.email);
        if (!isMounted) return;

        if (res.isTerminated) {
          setIsTerminated(true);
          sessionStorage.removeItem("lsmis_session");
          sessionStorage.removeItem("lsmis_concurrent_logout_notice");
          sessionStorage.setItem(
            "lsmis_termination_notice",
            JSON.stringify({
              reason: res.reason || "",
              terminatedUntil: res.terminatedUntil || null,
            })
          );
          try { await signOut(); } catch (_) {}
        }
      } catch (err) {
        console.warn("StaffRoute status check error:", err);
      } finally {
        if (isMounted) setChecking(false);
      }
    };

    verifyStatus();

    return () => {
      isMounted = false;
    };
  }, [loading, session?.email, signOut]);

  if (isTerminated || sessionStorage.getItem("lsmis_termination_notice")) {
    return <Navigate to="/login?terminated=true" replace />;
  }

  if (loading || checking || !isInitialized) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 600 }}>
          Verifying security authorization…
        </div>
      </div>
    );
  }

  if (!role) return <Navigate to="/login" replace />;
  if (role !== ROLES.STAFF) return <Navigate to={`/${role}`} replace />;

  return children;
};
