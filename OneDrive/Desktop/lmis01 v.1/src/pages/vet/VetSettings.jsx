import { CentralSettingsPage } from "../../components/settings/CentralSettingsPage";

export const VetSettings = ({ initialTab = "profile" }) => {
  return <CentralSettingsPage role="vet" initialTab={initialTab} />;
};

export default VetSettings;
