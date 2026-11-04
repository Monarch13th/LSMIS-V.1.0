import { RoleLayout } from "../components/layout/RoleLayout";
import { NAV_ITEMS } from "../config/navigation.jsx";

export const VetLayout = ({ theme, onToggleTheme }) => (
  <RoleLayout items={NAV_ITEMS.vet} role="vet" theme={theme} onToggleTheme={onToggleTheme} />
);
