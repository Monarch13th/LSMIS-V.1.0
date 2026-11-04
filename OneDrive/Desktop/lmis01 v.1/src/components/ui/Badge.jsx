const VARIANTS = {
  Pending: "badge-pending",
  Suspect: "badge-pending",
  "Awaiting Inspection": "badge-pending",
  "Awaiting / In Process": "badge-pending",
  Approved: "badge-approved",
  Passed: "badge-approved",
  Partial: "badge-scheduled",
  "Passed with Partial Condemnation": "badge-scheduled",
  "Partially Condemned": "badge-scheduled",
  "Whole Carcass Condemned": "badge-rejected",
  Rejected: "badge-rejected",
  Condemned: "badge-rejected",
  Paid: "badge-paid",
  Released: "badge-released",
  Scheduled: "badge-scheduled",
  Completed: "badge-completed",
  Active: "badge-active",
  Inactive: "badge-inactive",
  Failed: "badge-failed",
  "In Progress": "badge-in-progress",
  "Ready for Slaughter": "badge-approved",
  "For Slaughter": "badge-approved",
  "Pending Marking": "badge-pending",
  "For Marking": "badge-pending",
  "Returned to Animal Marking": "badge-pending",
  Marked: "badge-scheduled",
  "Permit Issued": "badge-approved",
  "Ready for Dispatch": "badge-approved",
};

export const Badge = ({ status, children }) => {
  const resolvedStatus =
    typeof status === "object" && status !== null
      ? status.label ?? status.value ?? ""
      : status ?? "";
  const norm = String(resolvedStatus).trim().toLowerCase();
  const rawLabel =
    children !== undefined && children !== null
      ? typeof children === "object" && children !== null && !children.$$typeof && (children.label || children.value)
        ? children.label || children.value
        : children
      : resolvedStatus;

  const displayLabel =
    rawLabel === "Partial"
      ? "Passed (Partial)"
      : norm === "ready for dispatch" || norm === "ready_for_dispatch"
      ? "Permit Issued"
      : rawLabel;

  return (
    <span className={`badge ${VARIANTS[displayLabel] || VARIANTS[resolvedStatus] || "badge-pending"}`}>{displayLabel}</span>
  );
};
