import { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { OwnerBottomNav } from "./OwnerBottomNav";
import { OwnerDesktopGate } from "../owner/OwnerDesktopGate";
import { supabase } from "../../services/supabaseClient";
import { TABLES } from "../../utils/constants";
import logoImg from "../../assets/logo.jpg";

export const OwnerMobileLayout = ({ theme: propTheme, onToggleTheme: propToggleTheme }) => {
  const { ownerId } = useAuth();
  const { theme: ctxTheme, toggleTheme: ctxToggleTheme } = useTheme();
  const theme = propTheme || ctxTheme;
  const onToggleTheme = propToggleTheme || ctxToggleTheme;
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

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

  return (
    <div className="min-h-screen min-h-[100dvh] w-full overflow-x-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col items-center">
      <div className="w-full max-w-5xl min-h-screen min-h-[100dvh] bg-white dark:bg-slate-900 shadow-sm flex flex-col relative sm:border-x border-slate-200 dark:border-slate-800">
        {/* Top Header (Fixed at top) */}
        <header className="owner-mobile-header shrink-0">
          <div className="w-full flex items-center justify-between px-3 sm:px-6">
            <div className="owner-header-left">
              <div className="owner-header-logo-wrap">
                <img src={logoImg} alt="LSMIS Official Seal" />
              </div>
              <div className="owner-header-text">
                <span className="owner-header-title">LSMIS</span>
                <span className="owner-header-subtitle">Livestock Owner Portal</span>
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
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main className="owner-mobile-main flex-1 overflow-y-auto">
          <div className="w-full max-w-5xl mx-auto">
            <Outlet />
          </div>
        </main>

        {/* Fixed Bottom Navigation Bar */}
        <OwnerBottomNav />
      </div>
    </div>
  );
};
