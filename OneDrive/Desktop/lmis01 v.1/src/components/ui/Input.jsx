import { classNames } from "../../utils/helpers";

export const Input = ({ label, error, ...props }) => (
  <div className="form-group">
    {label && <label className="form-label">{label}{props.required && <span className="req">*</span>}</label>}
    <input {...props} className={classNames("form-control", props.className)} />
    {error && <small className="text-danger">{error}</small>}
  </div>
);

export const Select = ({ label, children, ...props }) => (
  <div className="form-group">
    {label && <label className="form-label">{label}{props.required && <span className="req">*</span>}</label>}
    <select {...props} className={classNames("form-control", props.className)}>
      {children}
    </select>
  </div>
);

export const Textarea = ({ label, rows = 3, ...props }) => (
  <div className="form-group">
    {label && <label className="form-label">{label}{props.required && <span className="req">*</span>}</label>}
    <textarea rows={rows} {...props} className={classNames("form-control", props.className)} />
  </div>
);
