import { useState, useEffect, useCallback, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { updatePresence } from "../../services/activityService";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../notifications/Toast";

const IDLE_THRESHOLD_MS = 2 * 60 * 1000;  // 2 minutes → becomes Idle
const HEARTBEAT_INTERVAL_MS = 25 * 1000;  // 25s online heartbeat

const getModuleAndActivity = (pathname, role) => {
  const p = pathname.toLowerCase();
  if (p.includes("/audit-logs")) return { module: "Security & Audit", activity: "Inspecting Security Logs & User Presence" };
  if (p.includes("/users")) return { module: "User Administration", activity: "Managing Portal User Accounts & Access" };
  if (p.includes("/slaughter")) return { module: "Slaughterhouse Operations", activity: "Monitoring Line Processing & Abattoir Flow" };
  if (p.includes("/antemortem") || p.includes("/ante-mortem")) return { module: "Ante-Mortem Inspection", activity: "Screening Live Animal Intake & Clearance" };
  if (p.includes("/postmortem") || p.includes("/post-mortem")) return { module: "Post-Mortem Inspection", activity: "Examining Carcass Pathology & Viscera" };
  if (p.includes("/condemnation") || p.includes("/condemned")) return { module: "Condemnation & Disposal", activity: "Reviewing Barred Carcasses & Denaturing" };
  if (p.includes("/fee") || p.includes("/payment") || p.includes("/receipt") || p.includes("/finance")) return { module: "Financials & Billing", activity: "Managing Fee Rates & Payment Collections" };
  if (p.includes("/receiving") || p.includes("/registration") || p.includes("/intake") || p.includes("/livestock")) return { module: "Livestock Intake & Tracking", activity: "Recording Animal Registration & Corral Receiving" };
  if (p.includes("/weighing") || p.includes("/scale")) return { module: "Carcass Scale Weighing", activity: "Weighing Clean Carcass Yields" };
  if (p.includes("/permit") || p.includes("/dispatch") || p.includes("/weight-slip")) return { module: "Meat Permits", activity: "Authorizing Meat Clearance & Transfer Slips" };
  if (p.includes("/report")) return { module: "Analytical Reports", activity: "Reviewing Executive Intelligence & Summaries" };
  if (p.includes("/setting")) return { module: "Settings", activity: "Configuring System Options" };
  if (p.includes("/backup")) return { module: "System Configuration", activity: "Configuring Portal Parameters & Backups" };
  return { module: `${role ? role.toUpperCase() : "Portal"} Dashboard`, activity: "Viewing Operations Overview" };
};

export const RoleLayout = ({ items, role, theme, onToggleTheme }) => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { showToast } = useToast();

  // Track whether user is currently idle
  const idleRef = useRef(false);
  const idleTimerRef = useRef(null);
  const lastActiveHandledRef = useRef(0);

  useEffect(() => {
    setOpen(false);
    document.body.style.overflow = "";
  }, [location.pathname]);
  useEffect(() => { document.body.setAttribute("data-role", role); }, [role]);

  // Send heartbeat with current module & idle status
  const sendHeartbeat = useCallback(() => {
    const { module, activity } = getModuleAndActivity(location.pathname, role);
    updatePresence({ module, activity, isIdle: idleRef.current });
  }, [location.pathname, role]);

  // Called on any user interaction — reset idle timer (throttled to avoid timer thrashing on mousemove)
  const onUserActive = useCallback(() => {
    const nowMs = Date.now();
    if (!idleRef.current && nowMs - lastActiveHandledRef.current < 2000) {
      return;
    }
    lastActiveHandledRef.current = nowMs;

    if (idleRef.current) {
      idleRef.current = false;
      sendHeartbeat(); // Immediately flip to Online
    }
    // Reset the idle countdown
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleRef.current = true;
      const { module, activity } = getModuleAndActivity(location.pathname, role);
      updatePresence({ module, activity, isIdle: true });
    }, IDLE_THRESHOLD_MS);
  }, [sendHeartbeat, location.pathname, role]);

  // Attach DOM idle detection listeners
  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, onUserActive, { passive: true }));

    // Start idle timer immediately on mount
    idleTimerRef.current = setTimeout(() => {
      idleRef.current = true;
      const { module, activity } = getModuleAndActivity(location.pathname, role);
      updatePresence({ module, activity, isIdle: true });
    }, IDLE_THRESHOLD_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, onUserActive));
      clearTimeout(idleTimerRef.current);
    };
  }, [onUserActive, location.pathname, role]);

  // Heartbeat interval — refreshes presence every 25s
  useEffect(() => {
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sendHeartbeat]);

  // Administrative Session Termination Listener (cross-tab via storage + BroadcastChannel)
  useEffect(() => {
    const handleTermination = (e) => {
      if (e?.type === "storage" && e?.key !== "lsmis_session_termination_signal") return;
      const signal =
        e?.detail ||
        (() => { try { return JSON.parse(localStorage.getItem("lsmis_session_termination_signal") || "null"); } catch { return null; } })();
      if (!signal || !session?.email) return;

      const myEmail = (session.email || "").toLowerCase().trim();
      const targetEmail = (signal.email || "").toLowerCase().trim();

      if (myEmail === targetEmail && session.role !== "admin") {
        showToast("Your active session was terminated by Administrator.", "error");
        signOut();
        navigate("/?login=true", { replace: true });
      }
    };

    // Listen on both custom event (same tab) and storage (cross-tab)
    window.addEventListener("lsmis_session_terminated", handleTermination);
    window.addEventListener("storage", handleTermination);

    // Also subscribe via BroadcastChannel for same-device cross-window
    let bc = null;
    try {
      bc = new BroadcastChannel("lsmis_presence_channel");
      bc.onmessage = (msg) => {
        if (msg?.data?.type === "TERMINATED") handleTermination({ detail: msg.data.signal });
      };
    } catch (e) {}

    return () => {
      window.removeEventListener("lsmis_session_terminated", handleTermination);
      window.removeEventListener("storage", handleTermination);
      try { if (bc) bc.close(); } catch (e) {}
    };
  }, [session, signOut, navigate, showToast]);

  return (
    <div className="app-layout">
      <Sidebar items={items} open={open} onClose={() => setOpen(false)} />
      <div className="app-main">
        <Navbar onMenuClick={() => setOpen(true)} theme={theme} onToggleTheme={onToggleTheme} />
        <main className="app-content"><Outlet /></main>
        <Footer />
      </div>
    </div>
  );
};