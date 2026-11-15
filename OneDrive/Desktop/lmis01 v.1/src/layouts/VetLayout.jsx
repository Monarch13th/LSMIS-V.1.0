import { RoleLayout } from "../components/layout/RoleLayout";
import { NAV_ITEMS } from "../config/navigation.jsx";
import "../styles/admin_dash.css";

export const VetLayout = ({ theme, onToggleTheme }) => (
  <RoleLayout items={NAV_ITEMS.vet} role="vet" theme={theme} onToggleTheme={onToggleTheme} />
);
