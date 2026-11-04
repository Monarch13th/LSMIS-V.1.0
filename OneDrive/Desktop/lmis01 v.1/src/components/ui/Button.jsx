import { classNames } from "../../utils/helpers";

export const Button = ({ children, onClick, variant = "primary", size = "md", type = "button", disabled, className = "", block, style, ...props }) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={classNames("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg", block && "btn-block", className)}
      style={style}
      {...props}
    >
      {children}
    </button>
  );
};
