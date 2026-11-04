// Friendly empty state — shown when a list has no data
import { Icon } from "../icons";

export const EmptyState = ({ title, message, icon, action }) => (
  <div className="empty-state">
    <div className="empty-icon">{icon || <Icon.Search />}</div>
    <h3>{title}</h3>
    <p>{message}</p>
    {action}
  </div>
);
