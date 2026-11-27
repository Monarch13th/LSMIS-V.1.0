import { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import { ToastProvider } from "./components/notifications/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import { useSessionTimeout } from "./hooks/useSessionTimeout";
import { useAutoScrollAlerts } from "./hooks/useAutoScrollAlerts";

import { AdminRoute } from "./routes/AdminRoute";
import { VetRoute } from "./routes/VetRoute";
import { StaffRoute } from "./routes/StaffRoute";
import { OwnerRoute } from "./routes/OwnerRoute";

import { LandingPage } from "./pages/LandingPage";
import { Login } from "./pages/auth/Login";
import logoImg from "./assets/logo.png";

const lazyNamed = (loader, exportName) =>
  lazy(() => loader().then((mod) => ({ default: mod[exportName] })));

const AdminLayout = lazyNamed(() => import("./layouts/AdminLayout"), "AdminLayout");
const VetLayout = lazyNamed(() => import("./layouts/VetLayout"), "VetLayout");
const StaffLayout = lazyNamed(() => import("./layouts/StaffLayout"), "StaffLayout");
const OwnerLayout = lazyNamed(() => import("./layouts/OwnerLayout"), "OwnerLayout");

const ForgotPassword = lazyNamed(() => import("./pages/auth/ForgotPassword"), "ForgotPassword");
const ResetPassword = lazyNamed(() => import("./pages/auth/ResetPassword"), "ResetPassword");

const AdminDashboard = lazyNamed(() => import("./pages/admin/Dashboard"), "AdminDashboard");
const Users = lazyNamed(() => import("./pages/admin/Users"), "Users");
const AuditLogs = lazyNamed(() => import("./pages/admin/AuditLogs"), "AuditLogs");
const OwnerManagement = lazyNamed(() => import("./pages/admin/OwnerManagement"), "OwnerManagement");
const SpeciesManagement = lazyNamed(() => import("./pages/admin/SpeciesManagement"), "SpeciesManagement");
const AdminPermits = lazyNamed(() => import("./pages/admin/AdminPermits"), "AdminPermits");

const RoleReportsModule = lazyNamed(() => import("./components/reports/RoleReportsModule"), "RoleReportsModule");
const AdminSettings = lazyNamed(() => import("./pages/admin/AdminSettings"), "AdminSettings");

const VetDashboard = lazyNamed(() => import("./pages/vet/Dashboard"), "VetDashboard");
const AnteMortem = lazyNamed(() => import("./pages/vet/AnteMortem"), "AnteMortem");
const PostMortem = lazyNamed(() => import("./pages/vet/PostMortem"), "PostMortem");
const InspectionHistory = lazyNamed(() => import("./pages/vet/InspectionHistory"), "InspectionHistory");
const VetSettings = lazyNamed(() => import("./pages/vet/VetSettings"), "VetSettings");
const VetAuditLogs = lazyNamed(() => import("./pages/vet/VetAuditLogs"), "VetAuditLogs");
const OrganInspection = lazyNamed(() => import("./pages/vet/VetExtra"), "OrganInspection");
const CondemnedMeatRecords = lazyNamed(() => import("./pages/vet/VetExtra"), "CondemnedMeatRecords");
const EvidenceUpload = lazyNamed(() => import("./pages/vet/VetExtra"), "EvidenceUpload");
const MeatApprovalRecords = lazyNamed(() => import("./pages/vet/VetExtra"), "MeatApprovalRecords");
const VetSlaughterHistory = lazyNamed(() => import("./pages/vet/VetExtra"), "VetSlaughterHistory");
const VetInspectionReport = lazyNamed(() => import("./pages/vet/VetExtra"), "VetInspectionReport");
const VetCondemnationReport = lazyNamed(() => import("./pages/vet/VetExtra"), "VetCondemnationReport");

const StaffDashboard = lazyNamed(() => import("./pages/staff/Dashboard"), "StaffDashboard");
const Owners = lazyNamed(() => import("./pages/staff/Owners"), "Owners");
const CarcassWeighing = lazyNamed(() => import("./pages/vet/CarcassWeighing"), "CarcassWeighing");
const StaffSettings = lazyNamed(() => import("./pages/staff/StaffSettings"), "StaffSettings");
const StaffAuditLogs = lazyNamed(() => import("./pages/staff/StaffAuditLogs"), "StaffAuditLogs");
const Permits = lazyNamed(() => import("./pages/staff/Permits"), "Permits");
const AntemortemStatus = lazyNamed(() => import("./pages/staff/InspectionResults"), "AntemortemStatus");
const PostmortemStatus = lazyNamed(() => import("./pages/staff/InspectionResults"), "PostmortemStatus");
const PostmortemResult = lazyNamed(() => import("./pages/staff/InspectionResults"), "PostmortemResult");
const InspectionResults = lazyNamed(() => import("./pages/staff/InspectionResults"), "InspectionResults");
const SlaughterProcessing = lazyNamed(() => import("./pages/staff/SlaughterProcessing"), "SlaughterProcessing");

const OwnerDashboard = lazyNamed(() => import("./pages/owner/Dashboard"), "OwnerDashboard");
const OwnerAnimals = lazyNamed(() => import("./pages/owner/Animals"), "OwnerAnimals");
const OwnerRecords = lazyNamed(() => import("./pages/owner/Records"), "OwnerRecords");
const OwnerProfile = lazyNamed(() => import("./pages/owner/Profile"), "OwnerProfile");
const OwnerNotifications = lazyNamed(() => import("./pages/owner/Notifications"), "OwnerNotifications");
const LivestockInspectionDashboard = lazyNamed(() => import("./pages/dashboard/LivestockInspectionDashboard"), "LivestockInspectionDashboard");
const WaitingApproval = lazyNamed(() => import("./pages/owner/WaitingApproval"), "WaitingApproval");

const RouteFallback = () => (
  <div
    style={{
      minHeight: "100dvh",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-bg, #FFFFFF)",
      color: "#187A56",
      fontSize: 14,
      fontWeight: 600,
    }}
  >
    Loading LSMIS...
  </div>
);

import { repairCorruptedMockData } from "./utils/repairStorage";
import { STORAGE_KEYS } from "./utils/constants";
import { initialOAuthCallback } from "./services/supabaseClient";
import { isInstalledApp } from "./utils/capacitor";

const STARTUP_LOGO_SRC = "/logo.png?v=lsmis20261116e";
const SPLASH_DURATION_MS = 3000;
let hasShownLaunchSplashInMemory = false;

const hasActiveOAuthCallback = () => {
  if (typeof window === "undefined") return false;
  try {
    const search = window.location.search || "";
    const hash = window.location.hash || "";
    return (
      Boolean(initialOAuthCallback?.hasOAuthTokens) ||
      hash.includes("access_token=") ||
      search.includes("code=") ||
      search.includes("oauth_intent=") ||
      search.includes("error=") ||
      hash.includes("error=")
    );
  } catch (_) {
    return false;
  }
};

const shouldShowSingleLaunchSplash = () => {
  if (typeof window === "undefined" || hasShownLaunchSplashInMemory) return false;
  try {
    if (!isInstalledApp()) return false;
    if (sessionStorage.getItem("lsmis_launch_splash_seen") === "true") return false;
    if (hasActiveOAuthCallback()) return false;
    return true;
  } catch (_) {
    return false;
  }
};

const StartupSplash = () => {
  const [stage, setStage] = useState(() => (shouldShowSingleLaunchSplash() ? "visible" : "done"));

  useEffect(() => {
    if (stage !== "visible") return;
    hasShownLaunchSplashInMemory = true;
    try {
      sessionStorage.setItem("lsmis_launch_splash_seen", "true");
    } catch (_) {}

    const durationTimer = setTimeout(() => {
      setStage("fading");
    }, SPLASH_DURATION_MS);

    return () => {
      clearTimeout(durationTimer);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "fading") return;
    const doneTimer = setTimeout(() => {
      setStage("done");
    }, 180);
    return () => clearTimeout(doneTimer);
  }, [stage]);

  if (stage === "done") return null;

  return (
    <div
      className={`lsmis-launch-splash ${stage === "fading" ? "fade-out" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="launch-splash-content">
        <div className="launch-splash-logo-wrap">
          <img
            src={STARTUP_LOGO_SRC}
            onError={(e) => {
              if (e.currentTarget.src !== logoImg) e.currentTarget.src = logoImg;
            }}
            alt="LSMIS Official Seal"
            className="launch-splash-logo"
            width="96"
            height="96"
            decoding="sync"
          />
        </div>
        <div className="launch-splash-text">
          <h1 className="launch-splash-title">LSMIS</h1>
          <p className="launch-splash-sub">Livestock Slaughter &amp; Meat Inspection System</p>
          <span className="launch-splash-loc">City Government of Naga, Cebu</span>
        </div>
        <div className="launch-splash-loader" aria-label="Loading application">
          <div className="launch-splash-loader-bar" />
        </div>
      </div>
    </div>
  );
};

const LandingGate = () => {
  const { role, isAuthenticated, loading, isInitialized } = useAuth();
  const [gateTimeout, setGateTimeout] = useState(false);

  useEffect(() => {
    if (!isInstalledApp()) return;
    if (!loading && isInitialized) return;
    const t = setTimeout(() => setGateTimeout(true), 900);
    return () => clearTimeout(t);
  }, [loading, isInitialized]);

  if (hasActiveOAuthCallback()) {
    const search = window.location.search || "";
    const hash = window.location.hash || initialOAuthCallback?.hash || "";
    const nextSearch = search.includes("oauth_intent=")
      ? search
      : search
        ? `${search}&oauth_intent=login`
        : "?oauth_intent=login";
    return <Navigate to={`/login${nextSearch}${hash}`} replace />;
  }

  if (!isInstalledApp()) return <LandingPage />;

  if ((loading || !isInitialized) && !gateTimeout) {
    return null;
  }
  return <Navigate to={isAuthenticated && role ? `/${role}` : "/login"} replace />;
};

const Shell = () => {
  const { theme, toggleTheme } = useTheme();
  const { role, isAuthenticated, loading: authLoading, isInitialized: authInitialized } = useAuth();
  const themeProps = { theme, onToggleTheme: toggleTheme };
  const navigate = useNavigate();

  useSessionTimeout();

  useEffect(() => {
    repairCorruptedMockData();
  }, []);

  useEffect(() => {
    try {
      const pathname = window.location.pathname || "/";
      const search = window.location.search || "";
      const hash = window.location.hash || "";

      const inFlightTs = sessionStorage.getItem("lsmis_google_oauth_in_flight");
      const isFreshInFlight =
        inFlightTs && Date.now() - Number(inFlightTs) < 5 * 60 * 1000;

      const storedIntent = isFreshInFlight
        ? sessionStorage.getItem("lsmis_google_oauth_intent")
        : null;

      const hasOAuthCallbackParams =
        Boolean(initialOAuthCallback?.hasOAuthTokens) ||
        hash.includes("access_token=") ||
        search.includes("code=") ||
        search.includes("error=") ||
        hash.includes("error=") ||
        search.includes("error_description=") ||
        hash.includes("error_description=");

      if (pathname !== "/login" && (hasOAuthCallbackParams || (isFreshInFlight && storedIntent))) {
        const existingSession = sessionStorage.getItem(STORAGE_KEYS.SESSION);
        if (!existingSession) {
          const effectiveIntent = storedIntent || "login";
          const nextSearch = search.includes("oauth_intent=")
            ? search
            : search
              ? `${search}&oauth_intent=${encodeURIComponent(effectiveIntent)}`
              : `?oauth_intent=${encodeURIComponent(effectiveIntent)}`;
          const nextHash = hash || initialOAuthCallback?.hash || "";
          navigate(`/login${nextSearch}${nextHash}`, { replace: true });
          return;
        }
      }

      const isNativeApp = isInstalledApp();
      if (isNativeApp && pathname === "/" && !hasOAuthCallbackParams) {
        if (!authInitialized || authLoading) {
          return;
        }
        if (isAuthenticated && role) {
          navigate(`/${role}`, { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
      }
    } catch (_) { }
  }, [navigate, isAuthenticated, role, authLoading, authInitialized]);

  return (
    <>
      <StartupSplash authLoading={authLoading} authInitialized={authInitialized} />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingGate />} />
      <Route path="/dashboard" element={<LivestockInspectionDashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login initialView="register" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/admin" element={<AdminRoute><AdminLayout {...themeProps} /></AdminRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="owners" element={<OwnerManagement />} />
        <Route path="species" element={<SpeciesManagement />} />
        <Route path="livestock" element={<RoleReportsModule key="mon-livestock" role="admin" monitoringModule="livestock" />} />
        <Route path="livestock/tracking" element={<Navigate to="/admin/livestock" replace />} />
        <Route path="livestock/history" element={<Navigate to="/admin/livestock" replace />} />
        <Route path="permits" element={<AdminPermits />} />
        <Route path="slaughter/records" element={<RoleReportsModule key="mon-slaughter" role="admin" monitoringModule="slaughter" />} />
        <Route path="slaughter/monitoring" element={<RoleReportsModule key="mon-slaughter-m" role="admin" monitoringModule="slaughter" />} />
        <Route path="inspection/records" element={<RoleReportsModule key="mon-inspection" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection-records" element={<RoleReportsModule key="mon-inspection-rec-alt" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/history" element={<RoleReportsModule key="mon-inspection-hist" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection-history" element={<RoleReportsModule key="mon-inspection-hist-alt" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/antemortem" element={<RoleReportsModule key="mon-ante" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/postmortem" element={<RoleReportsModule key="mon-post" role="admin" monitoringModule="inspection" initialReportType="postmortem" />} />
        <Route path="inspection/partial" element={<RoleReportsModule key="mon-partial" role="admin" monitoringModule="inspection" initialReportType="condemnation" initialStatusFilter="partially_condemned" />} />
        <Route path="inspection/condemnation" element={<RoleReportsModule key="mon-condemn" role="admin" monitoringModule="inspection" initialReportType="condemnation" />} />
        <Route path="finance/records" element={<Navigate to="/admin/reports" replace />} />
        <Route path="finance/fees" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports" element={<RoleReportsModule key="admin-reports" role="admin" />} />
        <Route path="reports/collection" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/animal-revenue" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/payment-history" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/slaughter" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/inspection" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/livestock" element={<Navigate to="/admin/reports" replace />} />

        <Route path="settings" element={<AdminSettings initialTab="profile" />} />
        <Route path="profile" element={<AdminSettings initialTab="profile" />} />
        <Route path="notifications" element={<AdminSettings initialTab="notifications" />} />
        <Route path="security" element={<AdminSettings initialTab="security" />} />
        <Route path="permit-config" element={<AdminSettings initialTab="permit-config" />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>

      <Route path="/vet" element={<VetRoute><VetLayout {...themeProps} /></VetRoute>}>
        <Route index element={<VetDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        <Route path="ante-mortem" element={<AnteMortem initialTab="queue" />} />
        <Route path="ante-mortem/records" element={<AnteMortem initialTab="log" />} />
        <Route path="ante-mortem/inspection-history" element={<InspectionHistory />} />
        <Route path="ante-mortem/health-history" element={<Navigate to="/vet/inspection-history" replace />} />
        <Route path="post-mortem" element={<PostMortem initialTab="queue" />} />
        <Route path="post-mortem/carcass" element={<PostMortem initialTab="queue" />} />
        <Route path="post-mortem/organ" element={<OrganInspection />} />
        <Route path="post-mortem/records" element={<PostMortem initialTab="log" />} />
        <Route path="carcass-weighing" element={<CarcassWeighing />} />
        <Route path="ante-mortem/condemned" element={<CondemnedMeatRecords type="Ante-Mortem" />} />
        <Route path="ante-mortem/evidence" element={<EvidenceUpload type="Ante-Mortem" />} />
        <Route path="post-mortem/condemned" element={<CondemnedMeatRecords type="Post-Mortem" />} />
        <Route path="post-mortem/evidence" element={<EvidenceUpload type="Post-Mortem" />} />
        <Route path="certification/certificate" element={<Navigate to="/vet/ante-mortem" replace />} />
        <Route path="livestock/history" element={<VetSlaughterHistory />} />
        <Route path="reports" element={<RoleReportsModule role="vet" />} />
        <Route path="reports/inspection" element={<VetInspectionReport />} />
        <Route path="reports/condemnation" element={<VetCondemnationReport />} />
        <Route path="history" element={<InspectionHistory />} />
        <Route path="inspection-history" element={<InspectionHistory />} />
        <Route path="inspection/history" element={<InspectionHistory />} />
        <Route path="inspection/records" element={<InspectionHistory />} />
        <Route path="inspection-records" element={<InspectionHistory />} />
        <Route path="approval" element={<MeatApprovalRecords />} />
        <Route path="audit-logs" element={<VetAuditLogs />} />
        <Route path="settings" element={<VetSettings initialTab="profile" />} />
        <Route path="profile" element={<VetSettings initialTab="profile" />} />
        <Route path="notifications" element={<VetSettings initialTab="notifications" />} />
        <Route path="security" element={<VetSettings initialTab="security" />} />
      </Route>

      <Route path="/staff" element={<StaffRoute><StaffLayout {...themeProps} /></StaffRoute>}>
        <Route index element={<StaffDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        <Route path="owners" element={<Owners initialTab="owners" />} />
        <Route path="livestock-registration" element={<Navigate to="/staff/owners" replace />} />
        <Route path="animal-marking" element={<Owners initialTab="marking" />} />
        <Route path="receiving-records" element={<Navigate to="/staff/animal-marking" replace />} />
        <Route path="animal-receiving" element={<Navigate to="/staff/animal-marking" replace />} />
        <Route path="slaughter-scheduling" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="schedule-calendar" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="slaughter-processing" element={<SlaughterProcessing />} />
        <Route path="inspection/antemortem" element={<AntemortemStatus />} />
        <Route path="inspection/postmortem" element={<PostmortemStatus />} />
        <Route path="inspection/result" element={<PostmortemResult />} />
        <Route path="inspection-results" element={<InspectionResults />} />
        <Route path="inspection-findings" element={<InspectionResults initialTab="result" />} />
        <Route path="inspection/records" element={<InspectionResults />} />
        <Route path="inspection-records" element={<InspectionResults />} />
        <Route path="inspection/history" element={<InspectionResults />} />
        <Route path="inspection-history" element={<InspectionResults />} />
        <Route path="carcass-weighing" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="weight-slip" element={<Navigate to="/staff/permits" replace />} />
        <Route path="fee-slip" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payments" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment-processing" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment-records" element={<Navigate to="/staff/permits" replace />} />
        <Route path="permit-dispatch" element={<Navigate to="/staff/permits" replace />} />
        <Route path="permits" element={<Permits />} />
        <Route path="permit-config" element={<Navigate to="/staff/permits" replace />} />
        <Route path="dispatch" element={<Navigate to="/staff/permits" replace />} />
        <Route path="release-records" element={<Navigate to="/staff/permits" replace />} />
        <Route path="livestock" element={<Navigate to="/staff/owners" replace />} />
        <Route path="livestock-records" element={<Navigate to="/staff/owners" replace />} />
        <Route path="processing-history" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="reports" element={<RoleReportsModule role="staff" />} />
        <Route path="reports/receiving" element={<Navigate to="/staff/reports" replace />} />
        <Route path="reports/slaughter" element={<Navigate to="/staff/reports" replace />} />
        <Route path="reports/payment" element={<Navigate to="/staff/reports" replace />} />
        <Route path="audit-logs" element={<StaffAuditLogs />} />
        <Route path="settings" element={<StaffSettings initialTab="profile" />} />
        <Route path="profile" element={<StaffSettings initialTab="profile" />} />
        <Route path="notifications" element={<StaffSettings initialTab="notifications" />} />
        <Route path="security" element={<StaffSettings initialTab="security" />} />
      </Route>

      <Route path="/owner" element={<OwnerRoute><OwnerLayout {...themeProps} /></OwnerRoute>}>
        <Route index element={<OwnerDashboard />} />
        <Route path="animals" element={<OwnerAnimals />} />
        <Route path="records" element={<OwnerRecords />} />
        <Route path="payments" element={<Navigate to="/owner/records" replace />} />
        <Route path="permits" element={<Navigate to="/owner/records" replace />} />
        <Route path="notifications" element={<OwnerNotifications />} />
        <Route path="profile" element={<OwnerProfile />} />
        <Route path="settings" element={<Navigate to="/owner/profile" replace />} />
        <Route path="register" element={<Navigate to="/owner/animals" replace />} />
      </Route>

      <Route path="/owner/waiting-approval" element={<WaitingApproval />} />
      <Route path="/waiting-approval" element={<Navigate to="/owner/waiting-approval" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
};

const App = () => {
  useAutoScrollAlerts();
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
