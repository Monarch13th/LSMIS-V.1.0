import { CentralSettingsPage } from "../../components/settings/CentralSettingsPage";

export const AdminSettings = ({ initialTab = "profile" }) => {
  return <CentralSettingsPage role="admin" initialTab={initialTab} />;
};

export default AdminSettings;
