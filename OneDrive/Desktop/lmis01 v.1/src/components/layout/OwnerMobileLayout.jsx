import { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { OwnerBottomNav } from "./OwnerBottomNav";
import { OwnerDesktopGate } from "../owner/OwnerDesktopGate";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import logoImg from "../../assets/logo.jpg";

export const OwnerMobileLayout = ({ theme, onToggleTheme }) => {
  const { ownerId } = useAuth();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  const isNativeAndroidApp =
    typeof window !== "undefined" &&
    Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      window.Capacitor?.getPlatform?.() === "android" ||
      window.location?.origin === "https://localhost"
    );

  // Viewport detection: block desktop screens (>=768px) unless preview mode or native Android app is active
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || isNativeAndroidApp) return false;
    return window.innerWidth >= 768;
  });
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    if (isNativeAndroidApp) {
      setIsDesktop(false);
      return;
    }
    const checkViewport = () => {
      const desktop = window.innerWidth >= 768;
      setIsDesktop(desktop);
      if (!desktop) {
        setPreviewMode(false);
      }
    };
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, [isNativeAndroidApp]);

  // Fetch unread notifications for this owner
  const fetchUnread = async () => {
    let targetId = ownerId;
    if (!targetId) {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const email = authUser?.user?.email;
        if (email) {
          const { data: oData } = await supabase.from(TABLES.OWNERS).select("id").ilike("email", email.trim()).maybeSingle();
          if (oData?.id) targetId = oData.id;
          else {
            const { data: uData } = await supabase.from(TABLES.USERS).select("owner_id").ilike("email", email.trim()).maybeSingle();
            if (uData?.owner_id) targetId = uData.owner_id;
          }
        }
      } catch (e) {}
    }

    if (!targetId) {
      setUnreadCount(0);
      return;
    }
    try {
      const { count, error } = await supabase
        .from(TABLES.NOTIFICATIONS)
        .select("id", { count: "exact", head: true })
        .eq("owner_id", targetId)
        .eq("read", false);

      if (!error && typeof count === "number") {
        setUnreadCount(count);
      } else {
        setUnreadCount(0);
      }
    } catch (err) {
      console.warn("Error checking unread notifications:", err);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    fetchUnread();
    const onRefresh = () => fetchUnread();
    window.addEventListener("storage", onRefresh);
    window.addEventListener("lmis-db-change", onRefresh);
    window.addEventListener("lmis-notif-read", onRefresh);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("lmis-db-change", onRefresh);
      window.removeEventListener("lmis-notif-read", onRefresh);
    };
  }, [ownerId]);

  // If on desktop and preview mode is NOT active: Show Desktop Blocker Gate
  if (isDesktop && !previewMode) {
    return <OwnerDesktopGate onSimulateMobile={() => setPreviewMode(true)} />;
  }

  // Inner Mobile Application Content
  const mobileAppContent = (
    <div className="w-full max-w-md h-full h-[100dvh] max-h-[100dvh] bg-white dark:bg-slate-900 shadow-2xl flex flex-col relative border-x border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Top Mobile App Header (Fixed at top) */}
      <header className="owner-mobile-header shrink-0">
        <div className="owner-header-left">
          <div className="owner-header-logo-wrap">
            <img src={logoImg} alt="LSMIS Official Seal" />
          </div>
          <div className="owner-header-text">
            <span className="owner-header-title">LSMIS</span>
          </div>
        </div>

        <div className="owner-header-right">
          {/* Theme Toggle Button */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="owner-header-btn"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Icon.Sun size={17} /> : <Icon.Moon size={17} />}
            </button>
          )}
        </div>
      </header>

      {/* Top Navigation Bar (Fixed above like Facebook) */}
      <div className="shrink-0 z-30">
        <OwnerBottomNav />
      </div>

      {/* Scrollable Viewport Content */}
      <main className="owner-mobile-main flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );

  // If in Simulation Mode on Desktop: render inside realistic smartphone frame
  if (isDesktop && previewMode) {
    return (
      <div className="owner-sim-wrapper">
        <div className="owner-sim-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.Smartphone size={16} style={{ color: "#38bdf8" }} />
            <span>
              <strong>Mobile Simulation Frame</strong> (Testing Mode)
            </span>
          </div>
          <button
            type="button"
            className="owner-sim-exit-btn"
            onClick={() => setPreviewMode(false)}
            title="Exit simulation and return to desktop restricted gate"
          >
            <Icon.Lock size={12} />
            <span>Exit Preview</span>
          </button>
        </div>

        <div className="owner-sim-phone">
          {/* Realistic Smartphone Status Bar */}
          <div className="owner-sim-status-bar">
            <span className="owner-sim-time">9:41</span>
            <div className="owner-sim-notch">
              <div className="owner-sim-speaker" />
              <div className="owner-sim-camera" />
            </div>
            <div className="owner-sim-indicators">
              <span>5G</span>
              <div className="owner-sim-battery-icon">
                <div className="owner-sim-battery-level" />
              </div>
            </div>
          </div>
          <div style={{ flex: 1, height: "calc(100% - 36px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {mobileAppContent}
          </div>
        </div>
      </div>
    );
  }

  // Native Mobile Device View (<768px)
  return (
    <div className="h-screen h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col items-center">
      {mobileAppContent}
    </div>
  );
};
