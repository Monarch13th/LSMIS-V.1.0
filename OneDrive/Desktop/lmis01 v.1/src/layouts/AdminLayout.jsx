import { RoleLayout } from "../components/layout/RoleLayout";
import { NAV_ITEMS } from "../config/navigation.jsx";
import "../styles/admin_dash.css";

export const AdminLayout = ({ theme, onToggleTheme }) => (
  <RoleLayout items={NAV_ITEMS.admin} role="admin" theme={theme} onToggleTheme={onToggleTheme} />
);
