import { Bar, Doughnut, Line } from "react-chartjs-2";
import { baseOptions, noLegend, cartesian, doughnutOptions, ChartEmpty, hasData } from "./chartKit";
import {
  countDecisions, monthlySeries, isPaidPayment, num, PAYMENT_DATE_FIELDS,
} from "../../utils/dashboardMetrics";

/**
 * Graph 1: System-Wide Operations Throughput
 * Displays verified record volumes across the 4 core system operational stages.
 */
export const OperationsThroughputBar = ({ stats }) => {
  const labels = ["Livestock Intake", "Slaughter Floor", "Inspections", "Meat Permits"];
  const values = [
    num(stats?.livestockCount),
    num(stats?.slaughterCount),
    num(stats?.inspectionCount ?? stats?.inspectionsCount),
    num(stats?.permitCount),
  ];

  if (!hasData(values)) return <ChartEmpty message="No operational records recorded yet" />;

  return (
    <div className="chart-container chart-container-sm">
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: "Total Records",
              data: values,
              backgroundColor: ["#0284c7", "#d97706", "#7c3aed", "#10b981"],
              borderRadius: 6,
              maxBarThickness: 48,
            },
          ],
        }}
        options={{
          ...cartesian(),
          plugins: {
            ...noLegend.plugins,
            tooltip: {
              ...baseOptions.plugins.tooltip,
              callbacks: {
                label: (ctx) => ` ${ctx.parsed.y} record${ctx.parsed.y === 1 ? "" : "s"}`,
              },
            },
          },
        }}
      />
    </div>
  );
};

/**
 * Graph 2: Personnel & Registered User Distribution by Role
 * System-wide user account distribution under Administrative management.
 */
export const UserRolesDoughnut = ({ users = [] }) => {
  const roles = [
    { key: "vet", label: "Veterinarians", color: "#0ea5e9" },
    { key: "staff", label: "Staff", color: "#10b981" },
    { key: "owner", label: "Livestock Owners", color: "#f59e0b" },
  ];

  const counts = roles.map((r) =>
    (users || []).filter((u) => {
      const roleStr = String(u.role || "").toLowerCase().trim();
      return roleStr === r.key || (r.key === "vet" && roleStr === "veterinarian") || (r.key === "staff" && roleStr === "operator");
    }).length
  );

  if (!hasData(counts)) return <ChartEmpty message="No user accounts found" />;

  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: roles.map((r) => r.label),
          datasets: [
            {
              data: counts,
              backgroundColor: roles.map((r) => r.color),
              borderWidth: 0,
            },
          ],
        }}
        options={doughnutOptions}
      />
    </div>
  );
};

// Backwards compatibility aliases
export const UserActivityBar = UserRolesDoughnut;

export const InspectionDoughnut = ({ counts, data }) => {
  let values;
  if (counts && typeof counts === "object") {
    values = [
      num(counts.antemortem),
      num(counts.postmortem),
      num(counts.condemnation),
      num(counts.partial),
    ];
  } else {
    const c = countDecisions(data);
    values = [c.approved, c.partial, c.rejected, c.condemned];
  }

  if (!hasData(values)) return <ChartEmpty message="No inspections recorded yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: ["Ante-Mortem", "Post-Mortem", "Condemnation", "Partially Condemned"],
          datasets: [
            {
              data: values,
              backgroundColor: ["#10b981", "#0284c7", "#ef4444", "#f59e0b"],
              borderWidth: 0,
            },
          ],
        }}
        options={doughnutOptions}
      />
    </div>
  );
};

export const RevenueLine = ({ payments }) => {
  const { labels, values } = monthlySeries(
    (payments || []).filter(isPaidPayment), PAYMENT_DATE_FIELDS, (p) => num(p.amount), 6
  );
  if (!hasData(values)) return <ChartEmpty message="No fees collected in the last 6 months" />;
  return (
    <div className="chart-container chart-container-sm">
      <Line
        data={{
          labels,
          datasets: [{ label: "Revenue (₱)", data: values, borderColor: "#059669", backgroundColor: "rgba(5, 150, 105, 0.12)", fill: true, tension: 0.35, pointRadius: 3 }],
        }}
        options={{
          ...cartesian(),
          plugins: {
            ...baseOptions.plugins,
            legend: { display: false },
            tooltip: { ...baseOptions.plugins.tooltip, callbacks: { label: (ctx) => ` ₱${Number(ctx.parsed.y).toLocaleString()}` } },
          },
        }}
      />
    </div>
  );
};
