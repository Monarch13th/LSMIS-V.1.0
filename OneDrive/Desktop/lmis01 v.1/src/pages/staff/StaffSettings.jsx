import { CentralSettingsPage } from "../../components/settings/CentralSettingsPage";

export const StaffSettings = ({ initialTab = "profile" }) => {
  return <CentralSettingsPage role="staff" initialTab={initialTab} />;
};

export default StaffSettings;
