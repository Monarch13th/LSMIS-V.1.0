import { Bar, Doughnut, Line } from "react-chartjs-2";
import { baseOptions, noLegend, cartesian, doughnutOptions, ChartEmpty, hasData } from "./chartKit";
import { monthlySeries, isPaidPayment, num, PAYMENT_DATE_FIELDS } from "../../utils/dashboardMetrics";

const SPECIES_COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"];

/**
 * Graph 1: Livestock Intake & Registration by Species
 * Reflects incoming livestock intake managed by staff personnel.
 */
export const SpeciesBar = ({ livestock }) => {
  const tally = new Map();
  (livestock || []).forEach((l) => {
    const sp = String(l.species || "").trim() || "Other";
    tally.set(sp, (tally.get(sp) || 0) + Math.max(1, num(l.quantity) || 1));
  });
  const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (rows.length === 0) return <ChartEmpty message="No livestock registered yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: rows.map(([k]) => k),
          datasets: [
            {
              label: "Animals",
              data: rows.map(([, v]) => v),
              backgroundColor: rows.map((_, i) => SPECIES_COLORS[i % SPECIES_COLORS.length]),
              borderWidth: 0,
            },
          ],
        }}
        options={{
          ...doughnutOptions,
          plugins: {
            ...doughnutOptions.plugins,
            tooltip: {
              ...baseOptions.plugins.tooltip,
              callbacks: {
                label: (ctx) => ` ${ctx.parsed} animal${ctx.parsed === 1 ? "" : "s"}`,
              },
            },
          },
        }}
      />
    </div>
  );
};

export const SpeciesDoughnut = SpeciesBar;

/**
 * Graph 2: Slaughter Floor Team Operator Assignments
 * Distribution of livestock assigned across operator teams on the slaughter floor.
 */
export const TeamAssignmentBar = ({ processing = [] }) => {
  const tally = new Map();
  (processing || []).forEach((p) => {
    const op = String(p.operator || "").trim() || "Unassigned";
    tally.set(op, (tally.get(op) || 0) + 1);
  });
  const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <ChartEmpty message="No team assignments recorded yet" />;
  const colors = ["#0284c7", "#10b981", "#d97706", "#7c3aed"];
  return (
    <div className="chart-container chart-container-sm">
      <Bar
        data={{
          labels: rows.map(([k]) => k),
          datasets: [
            {
              label: "Assigned Batches",
              data: rows.map(([, v]) => v),
              backgroundColor: rows.map((_, i) => colors[i % colors.length]),
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
                label: (ctx) => ` ${ctx.parsed.y} processing batch${ctx.parsed.y === 1 ? "" : "es"}`,
              },
            },
          },
        }}
      />
    </div>
  );
};

export const SlaughterStatus = ({ data }) => {
  const s = (v) => String(v || "").toLowerCase();
  const completed = (data || []).filter((d) => s(d.status) === "completed" || s(d.status).includes("complete")).length;
  const inProgress = Math.max(0, (data || []).length - completed);
  const values = [completed, inProgress];
  if (!hasData(values)) return <ChartEmpty message="No slaughter records yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: ["Completed", "In Progress"],
          datasets: [{ data: values, backgroundColor: ["#10b981", "#f59e0b"], borderWidth: 0 }],
        }}
        options={doughnutOptions}
      />
    </div>
  );
};

export const RevenueTrend = ({ payments }) => {
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

export const PaymentStatus = ({ payments }) => {
  const completed = (payments || []).filter(isPaidPayment).length;
  const pending = Math.max(0, (payments || []).length - completed);
  if (completed + pending === 0) return <ChartEmpty message="No permit fees recorded yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: ["Completed", "Pending"],
          datasets: [{ data: [completed, pending], backgroundColor: ["#10b981", "#f59e0b"], borderWidth: 0 }],
        }}
        options={doughnutOptions}
      />
    </div>
  );
};

export const PermitFeeStatus = PaymentStatus;
