import { classNames } from "../../utils/helpers";

export const Card = ({ title, action, icon, children, className = "", style }) => (
  <div className={classNames("card", className)} style={style}>
    {(title || action) && (
      <div className="card-header">
        <h3 className="card-title">
          {icon && <span className="card-title-icon">{icon}</span>}
          {title}
        </h3>
        {action && <div className="card-actions">{action}</div>}
      </div>
    )}
    <div className="card-body">{children}</div>
  </div>
);
