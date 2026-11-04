import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import { ToastProvider } from "./components/notifications/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import { useSessionTimeout } from "./hooks/useSessionTimeout";
import { useAutoScrollAlerts } from "./hooks/useAutoScrollAlerts";

// Routes
import { AdminRoute } from "./routes/AdminRoute";
import { VetRoute } from "./routes/VetRoute";
import { StaffRoute } from "./routes/StaffRoute";
import { OwnerRoute } from "./routes/OwnerRoute";

// Layouts
import { AdminLayout } from "./layouts/AdminLayout";
import { VetLayout } from "./layouts/VetLayout";
import { StaffLayout } from "./layouts/StaffLayout";
import { OwnerLayout } from "./layouts/OwnerLayout";
import { LandingPage } from "./pages/LandingPage";

// Auth
import { Login } from "./pages/auth/Login";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { ResetPassword } from "./pages/auth/ResetPassword";

// Admin core
import { AdminDashboard } from "./pages/admin/Dashboard";
import { Users } from "./pages/admin/Users";
import { AuditLogs } from "./pages/admin/AuditLogs";
import { OwnerManagement } from "./pages/admin/OwnerManagement";
import { SpeciesManagement } from "./pages/admin/SpeciesManagement";
import { AdminPermits } from "./pages/admin/AdminPermits";

import { RoleReportsModule } from "./components/reports/RoleReportsModule";
import { AdminSettings } from "./pages/admin/AdminSettings";

// Vet core
import { VetDashboard } from "./pages/vet/Dashboard";
import { AnteMortem } from "./pages/vet/AnteMortem";
import { PostMortem } from "./pages/vet/PostMortem";
import { InspectionHistory } from "./pages/vet/InspectionHistory";
import { VetSettings } from "./pages/vet/VetSettings";
import { VetAuditLogs } from "./pages/vet/VetAuditLogs";
// Vet extra
import {
  OrganInspection,
  CondemnedMeatRecords,
  EvidenceUpload,
  MeatApprovalRecords,
  VetSlaughterHistory,
  VetInspectionReport,
  VetCondemnationReport,
} from "./pages/vet/VetExtra";

// Staff core
import { StaffDashboard } from "./pages/staff/Dashboard";
import { Owners } from "./pages/staff/Owners";
import { CarcassWeighing } from "./pages/vet/CarcassWeighing";
import { StaffSettings } from "./pages/staff/StaffSettings";
import { StaffAuditLogs } from "./pages/staff/StaffAuditLogs";
import { Permits } from "./pages/staff/Permits";
// Staff inspection views (read-only)
import { AntemortemStatus, PostmortemStatus, PostmortemResult, InspectionResults } from "./pages/staff/InspectionResults";
// Staff unified slaughter processing
import { SlaughterProcessing } from "./pages/staff/SlaughterProcessing";

// Owner core (mobile-first livestock owner portal)
import { OwnerDashboard } from "./pages/owner/Dashboard";
import { OwnerAnimals } from "./pages/owner/Animals";
import { OwnerRecords } from "./pages/owner/Records";
import { OwnerProfile } from "./pages/owner/Profile";
import { OwnerNotifications } from "./pages/owner/Notifications";
import { LivestockInspectionDashboard } from "./pages/dashboard/LivestockInspectionDashboard";
import { WaitingApproval } from "./pages/owner/WaitingApproval";

import { repairCorruptedMockData } from "./utils/repairStorage";
import { STORAGE_KEYS } from "./utils/constants";
import { initialOAuthCallback } from "./services/supabaseClient";
import { isInstalledApp } from "./utils/capacitor";

/**
 * "/" entry point. Browser tabs get the public Landing Page. The installed APK / installed PWA
 * never renders it: a neutral splash is shown until Supabase confirms the session, then the user
 * is sent to their role dashboard or the Login page (no Landing Page flash).
 */
const LandingGate = () => {
  const { role, isAuthenticated, loading, isInitialized } = useAuth();
  if (!isInstalledApp()) return <LandingPage />;
  if (loading || !isInitialized) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg, #ffffff)" }}>
        <img src="/logo.jpg" alt="LSMIS" width={72} height={72} style={{ borderRadius: "50%", opacity: 0.9 }} />
      </div>
    );
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

      // In the installed Capacitor Android application:
      // Direct startup: If user launches the app, go directly to their module if authenticated, otherwise to Login.
      // The public Landing Page remains accessible on the web, but is bypassed on mobile app launch.
      const isNativeApp = isInstalledApp(); // installed APK or installed PWA (never a plain browser tab)
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
    <Routes>
      <Route path="/" element={<LandingGate />} />
      <Route path="/dashboard" element={<LivestockInspectionDashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login initialView="register" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ============ ADMIN ============ */}
      <Route path="/admin" element={<AdminRoute><AdminLayout {...themeProps} /></AdminRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        {/* Personnel Management (single page) */}
        <Route path="users" element={<Users />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        {/* Owner Account Management & Verification */}
        <Route path="owners" element={<OwnerManagement />} />
        {/* Livestock Species Catalog Management */}
        <Route path="species" element={<SpeciesManagement />} />
        {/* Livestock */}
        <Route path="livestock" element={<RoleReportsModule key="mon-livestock" role="admin" monitoringModule="livestock" />} />
        <Route path="livestock/tracking" element={<Navigate to="/admin/livestock" replace />} />
        <Route path="livestock/history" element={<Navigate to="/admin/livestock" replace />} />
        {/* Permits */}
        <Route path="permits" element={<AdminPermits />} />
        {/* Slaughter monitoring */}
        <Route path="slaughter/records" element={<RoleReportsModule key="mon-slaughter" role="admin" monitoringModule="slaughter" />} />
        <Route path="slaughter/monitoring" element={<RoleReportsModule key="mon-slaughter-m" role="admin" monitoringModule="slaughter" />} />
        {/* Inspection monitoring */}
        <Route path="inspection/records" element={<RoleReportsModule key="mon-inspection" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection-records" element={<RoleReportsModule key="mon-inspection-rec-alt" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/history" element={<RoleReportsModule key="mon-inspection-hist" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection-history" element={<RoleReportsModule key="mon-inspection-hist-alt" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/antemortem" element={<RoleReportsModule key="mon-ante" role="admin" monitoringModule="inspection" initialReportType="antemortem" />} />
        <Route path="inspection/postmortem" element={<RoleReportsModule key="mon-post" role="admin" monitoringModule="inspection" initialReportType="postmortem" />} />
        <Route path="inspection/partial" element={<RoleReportsModule key="mon-partial" role="admin" monitoringModule="inspection" initialReportType="condemnation" initialStatusFilter="partially_condemned" />} />
        <Route path="inspection/condemnation" element={<RoleReportsModule key="mon-condemn" role="admin" monitoringModule="inspection" initialReportType="condemnation" />} />
        {/* Financial (Redirected since Fee Management was removed from Admin) */}
        <Route path="finance/records" element={<Navigate to="/admin/reports" replace />} />
        <Route path="finance/fees" element={<Navigate to="/admin/reports" replace />} />
        {/* Reports */}
        <Route path="reports" element={<RoleReportsModule key="admin-reports" role="admin" />} />
        <Route path="reports/collection" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/animal-revenue" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/payment-history" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/slaughter" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/inspection" element={<Navigate to="/admin/reports" replace />} />
        <Route path="reports/livestock" element={<Navigate to="/admin/reports" replace />} />

        {/* Settings (Integrated Profile, Notifications, Security & Permit Configuration) */}
        <Route path="settings" element={<AdminSettings initialTab="profile" />} />
        <Route path="profile" element={<AdminSettings initialTab="profile" />} />
        <Route path="notifications" element={<AdminSettings initialTab="notifications" />} />
        <Route path="security" element={<AdminSettings initialTab="security" />} />
        <Route path="permit-config" element={<AdminSettings initialTab="permit-config" />} />
      </Route>

      {/* ============ VET ============ */}
      <Route path="/vet" element={<VetRoute><VetLayout {...themeProps} /></VetRoute>}>
        <Route index element={<VetDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        {/* Antemortem */}
        <Route path="ante-mortem" element={<AnteMortem initialTab="queue" />} />
        <Route path="ante-mortem/records" element={<AnteMortem initialTab="log" />} />
        <Route path="ante-mortem/inspection-history" element={<InspectionHistory />} />
        <Route path="ante-mortem/health-history" element={<Navigate to="/vet/inspection-history" replace />} />
        {/* Postmortem */}
        <Route path="post-mortem" element={<PostMortem initialTab="queue" />} />
        <Route path="post-mortem/carcass" element={<PostMortem initialTab="queue" />} />
        <Route path="post-mortem/organ" element={<OrganInspection />} />
        <Route path="post-mortem/records" element={<PostMortem initialTab="log" />} />
        {/* Carcass Weighing & Branding (Transferred to Veterinary Personnel) */}
        <Route path="carcass-weighing" element={<CarcassWeighing />} />
        {/* Antemortem Condemnation */}
        <Route path="ante-mortem/condemned" element={<CondemnedMeatRecords type="Ante-Mortem" />} />
        <Route path="ante-mortem/evidence" element={<EvidenceUpload type="Ante-Mortem" />} />
        {/* Postmortem Condemnation */}
        <Route path="post-mortem/condemned" element={<CondemnedMeatRecords type="Post-Mortem" />} />
        <Route path="post-mortem/evidence" element={<EvidenceUpload type="Post-Mortem" />} />
        <Route path="certification/certificate" element={<Navigate to="/vet/ante-mortem" replace />} />
        <Route path="livestock/history" element={<VetSlaughterHistory />} />
        {/* Reports */}
        <Route path="reports" element={<RoleReportsModule role="vet" />} />
        <Route path="reports/inspection" element={<VetInspectionReport />} />
        <Route path="reports/condemnation" element={<VetCondemnationReport />} />
        {/* Inspection History & Approvals */}
        <Route path="history" element={<InspectionHistory />} />
        <Route path="inspection-history" element={<InspectionHistory />} />
        <Route path="inspection/history" element={<InspectionHistory />} />
        <Route path="inspection/records" element={<InspectionHistory />} />
        <Route path="inspection-records" element={<InspectionHistory />} />
        <Route path="approval" element={<MeatApprovalRecords />} />
        {/* Audit Logs (Role-scoped for Veterinarians) */}
        <Route path="audit-logs" element={<VetAuditLogs />} />
        {/* Settings (Integrated Profile, Notifications & Security) */}
        <Route path="settings" element={<VetSettings initialTab="profile" />} />
        <Route path="profile" element={<VetSettings initialTab="profile" />} />
        <Route path="notifications" element={<VetSettings initialTab="notifications" />} />
        <Route path="security" element={<VetSettings initialTab="security" />} />
      </Route>

      {/* ============ STAFF — manual operation flow ============ */}
      <Route path="/staff" element={<StaffRoute><StaffLayout {...themeProps} /></StaffRoute>}>
        <Route index element={<StaffDashboard />} />
        <Route path="inspection-dashboard" element={<LivestockInspectionDashboard />} />
        {/* 1. Receiving */}
        <Route path="owners" element={<Owners initialTab="owners" />} />
        <Route path="livestock-registration" element={<Navigate to="/staff/owners" replace />} />
        <Route path="animal-marking" element={<Owners initialTab="marking" />} />
        <Route path="receiving-records" element={<Navigate to="/staff/animal-marking" replace />} />
        <Route path="animal-receiving" element={<Navigate to="/staff/animal-marking" replace />} />
        {/* 2. Slaughter Processing */}
        <Route path="slaughter-scheduling" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="schedule-calendar" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="slaughter-processing" element={<SlaughterProcessing />} />
        {/* 4. Inspection Results (read-only for staff) */}
        <Route path="inspection/antemortem" element={<AntemortemStatus />} />
        <Route path="inspection/postmortem" element={<PostmortemStatus />} />
        <Route path="inspection/result" element={<PostmortemResult />} />
        <Route path="inspection-results" element={<InspectionResults />} />
        <Route path="inspection-findings" element={<InspectionResults initialTab="result" />} />
        <Route path="inspection/records" element={<InspectionResults />} />
        <Route path="inspection-records" element={<InspectionResults />} />
        <Route path="inspection/history" element={<InspectionResults />} />
        <Route path="inspection-history" element={<InspectionResults />} />
        {/* 5. Weighing (Transferred to Veterinary Personnel - redirect staff) */}
        <Route path="carcass-weighing" element={<Navigate to="/staff/slaughter-processing" replace />} />
        <Route path="weight-slip" element={<Navigate to="/staff/permits" replace />} />
        <Route path="fee-slip" element={<Navigate to="/staff/permits" replace />} />
        {/* 6. Payment & Permits */}
        <Route path="payments" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment-processing" element={<Navigate to="/staff/permits" replace />} />
        <Route path="payment-records" element={<Navigate to="/staff/permits" replace />} />
        {/* 7. Meat Permit */}
        <Route path="permit-dispatch" element={<Navigate to="/staff/permits" replace />} />
        <Route path="permits" element={<Permits />} />
        <Route path="permit-config" element={<Navigate to="/staff/permits" replace />} />
        <Route path="dispatch" element={<Navigate to="/staff/permits" replace />} />
        <Route path="release-records" element={<Navigate to="/staff/permits" replace />} />
        {/* Livestock records */}
        <Route path="livestock" element={<Navigate to="/staff/owners" replace />} />
        <Route path="livestock-records" element={<Navigate to="/staff/owners" replace />} />
        <Route path="processing-history" element={<Navigate to="/staff/slaughter-processing" replace />} />
        {/* Reports */}
        <Route path="reports" element={<RoleReportsModule role="staff" />} />
        <Route path="reports/receiving" element={<Navigate to="/staff/reports" replace />} />
        <Route path="reports/slaughter" element={<Navigate to="/staff/reports" replace />} />
        <Route path="reports/payment" element={<Navigate to="/staff/reports" replace />} />
        {/* Audit Logs (Role-scoped for Slaughterhouse Staff) */}
        <Route path="audit-logs" element={<StaffAuditLogs />} />
        {/* Settings (Integrated Profile, Notifications & Security) */}
        <Route path="settings" element={<StaffSettings initialTab="profile" />} />
        <Route path="profile" element={<StaffSettings initialTab="profile" />} />
        <Route path="notifications" element={<StaffSettings initialTab="notifications" />} />
        <Route path="security" element={<StaffSettings initialTab="security" />} />
      </Route>

      {/* ============ OWNER — mobile-first livestock owner portal ============ */}
      <Route path="/owner" element={<OwnerRoute><OwnerLayout {...themeProps} /></OwnerRoute>}>
        <Route index element={<OwnerDashboard />} />
        <Route path="animals" element={<OwnerAnimals />} />
        <Route path="records" element={<OwnerRecords />} />
        <Route path="payments" element={<Navigate to="/owner/records" replace />} />
        <Route path="permits" element={<Navigate to="/owner/records" replace />} />
        {/* Five Navigation Sections: Dashboard, Animals, Records, Notifications, Profile */}
        <Route path="notifications" element={<OwnerNotifications />} />
        <Route path="profile" element={<OwnerProfile />} />
        <Route path="settings" element={<Navigate to="/owner/profile" replace />} />
        {/* Strictly View-Only: redirect any legacy register URLs */}
        <Route path="register" element={<Navigate to="/owner/animals" replace />} />
      </Route>

      {/* Dedicated Owner Waiting for Approval View */}
      <Route path="/owner/waiting-approval" element={<WaitingApproval />} />
      <Route path="/waiting-approval" element={<Navigate to="/owner/waiting-approval" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
