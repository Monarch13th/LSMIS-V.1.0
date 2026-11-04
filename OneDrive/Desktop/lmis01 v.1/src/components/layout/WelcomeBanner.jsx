import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { greeting } from "../../utils/helpers";
import { formatLongDate } from "../../utils/formatters";
import { Icon } from "../icons";

export const WelcomeBanner = ({ icon }) => {
  const { session } = useAuth();
  const { roleLabel } = useRole();
  const name = session?.name?.split(" ")[0] || "there";

  const style = session?.cover_gradient ? {
    background: `linear-gradient(135deg, ${session.cover_gradient.from} 0%, ${session.cover_gradient.to} 100%)`,
    boxShadow: `0 10px 30px ${session.cover_gradient.to}33`
  } : undefined;

  return (
    <div className="welcome-banner" style={style}>
      <div className="welcome-icon">{icon}</div>
      <div className="welcome-text">
        <h2>{greeting()}, {name}!</h2>
        <p>Here's what's happening in your {roleLabel || "user"} portal today.</p>
      </div>
      <div className="welcome-meta">
        <span className="welcome-pill"><span className="pulse" />System Online</span>
        <span className="welcome-date">{formatLongDate()}</span>
        <span className="welcome-location" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.78rem", opacity: 0.95, color: "inherit", fontWeight: 600 }}>
          <Icon.MapPin size={12} /> Tinaan, City of Naga, Cebu, Philippines
        </span>
      </div>
    </div>
  );
};
