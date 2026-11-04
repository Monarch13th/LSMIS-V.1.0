import { RoleLayout } from "../components/layout/RoleLayout";
import { NAV_ITEMS } from "../config/navigation.jsx";

export const StaffLayout = ({ theme, onToggleTheme }) => (
  <RoleLayout items={NAV_ITEMS.staff} role="staff" theme={theme} onToggleTheme={onToggleTheme} />
);
