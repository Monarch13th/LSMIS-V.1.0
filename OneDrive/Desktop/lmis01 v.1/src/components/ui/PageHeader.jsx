// Reusable page header — title + subtitle + optional action buttons
import { classNames } from "../../utils/helpers";

export const PageHeader = ({ title, subtitle, icon, actions, className }) => (
  <div className={classNames("page-head", className)}>
    <div className="page-head-text">
      <h1 className="page-title">
        {icon && <span className="page-title-icon">{icon}</span>}
        {title}
      </h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-head-actions">{actions}</div>}
  </div>
);
