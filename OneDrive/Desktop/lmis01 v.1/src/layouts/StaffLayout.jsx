import { RoleLayout } from "../components/layout/RoleLayout";
import { NAV_ITEMS } from "../config/navigation.jsx";
import "../styles/admin_dash.css";

export const StaffLayout = ({ theme, onToggleTheme }) => (
  <RoleLayout items={NAV_ITEMS.staff} role="staff" theme={theme} onToggleTheme={onToggleTheme} />
);
