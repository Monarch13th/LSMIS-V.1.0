import { Bar, Doughnut, Line } from "react-chartjs-2";
import { baseOptions, noLegend, cartesian, doughnutOptions, ChartEmpty, hasData } from "./chartKit";
import { num, countDecisions, dailySeries, INSPECTION_DATE_FIELDS } from "../../utils/dashboardMetrics";

/**
 * Graph 1: Clinical Inspection Decisions & Outcomes
 * Displays Ante-Mortem and Post-Mortem clearance vs condemnation outcomes.
 */
export const InspectionDecisions = ({ counts, data }) => {
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
  if (!hasData(values)) return <ChartEmpty message="No inspection records yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Doughnut
        data={{
          labels: ["Ante-Mortem Passed", "Post-Mortem Approved", "Total Condemned", "Partially Condemned"],
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

/**
 * Graph 2: Verified Carcass Scale Weights by Species
 * Official hot/cold carcass weights recorded by veterinary personnel on the scale floor.
 */
export const CarcassWeightSpeciesBar = ({ carcass = [], livestock = [] }) => {
  // Map tags to registered species
  const tagToSpecies = new Map();
  (livestock || []).forEach((l) => {
    if (l.tag_number) {
      tagToSpecies.set(String(l.tag_number).trim().toLowerCase(), l.species || "Hog");
    }
  });

  const speciesWeights = new Map();
  const speciesCounts = new Map();

  (carcass || []).forEach((c) => {
    const tag = String(c.tag_number || "").trim().toLowerCase();
    let sp = tagToSpecies.get(tag);
    if (!sp) {
      if (tag.includes("carabao")) sp = "Carabao";
      else if (tag.includes("goat")) sp = "Goat";
      else if (tag.includes("cattle")) sp = "Cattle";
      else sp = "Hog";
    }
    const w = num(c.total_weight || c.hot_weight || c.cold_weight);
    if (w > 0) {
      speciesWeights.set(sp, (speciesWeights.get(sp) || 0) + w);
      speciesCounts.set(sp, (speciesCounts.get(sp) || 0) + 1);
    }
  });

  const speciesList = ["Hog", "Carabao", "Goat", "Cattle"].filter(
    (sp) => (speciesCounts.get(sp) || 0) > 0
  );

  const values = speciesList.map((sp) => {
    const total = speciesWeights.get(sp) || 0;
    const count = speciesCounts.get(sp) || 1;
    return Math.round((total / count) * 10) / 10;
  });

  if (!hasData(values)) return <ChartEmpty message="No carcass weighing records yet" />;

  const colors = ["#0284c7", "#7c3aed", "#d97706", "#10b981"];

  return (
    <div className="chart-container chart-container-sm">
      <Bar
        data={{
          labels: speciesList.map((sp) => `${sp} (Avg kg)`),
          datasets: [
            {
              label: "Average Carcass Weight (kg)",
              data: values,
              backgroundColor: speciesList.map((_, i) => colors[i % colors.length]),
              borderRadius: 6,
              maxBarThickness: 44,
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
                label: (ctx) => ` ${ctx.parsed.y} kg average carcass scale weight`,
              },
            },
          },
        }}
      />
    </div>
  );
};

export const InspectionTypeBar = ({ ante, post }) => {
  const a = countDecisions(ante);
  const p = countDecisions(post);
  const keys = ["approved", "partial", "rejected", "condemned", "pending"];
  const all = [...keys.map((k) => a[k]), ...keys.map((k) => p[k])];
  if (!hasData(all)) return <ChartEmpty message="No ante/post-mortem records yet" />;
  return (
    <div className="chart-container chart-container-sm">
      <Bar
        data={{
          labels: ["Approved", "Partial", "Rejected", "Condemned", "Pending"],
          datasets: [
            { label: "Ante-Mortem", data: keys.map((k) => a[k]), backgroundColor: "#0ea5e9", borderRadius: 6, maxBarThickness: 28 },
            { label: "Post-Mortem", data: keys.map((k) => p[k]), backgroundColor: "#8b5cf6", borderRadius: 6, maxBarThickness: 28 },
          ],
        }}
        options={cartesian()}
      />
    </div>
  );
};

export const WeeklyTrend = ({ ante, post }) => {
  const a = dailySeries(ante, INSPECTION_DATE_FIELDS, () => 1, 7);
  const p = dailySeries(post, INSPECTION_DATE_FIELDS, () => 1, 7);
  if (!hasData([...a.values, ...p.values])) return <ChartEmpty message="No inspections in the last 7 days" />;
  return (
    <div className="chart-container chart-container-sm">
      <Line
        data={{
          labels: a.labels,
          datasets: [
            { label: "Ante-Mortem", data: a.values, borderColor: "#0ea5e9", backgroundColor: "rgba(14, 165, 233, 0.12)", fill: true, tension: 0.35, pointRadius: 3 },
            { label: "Post-Mortem", data: p.values, borderColor: "#8b5cf6", backgroundColor: "rgba(139, 92, 246, 0.10)", fill: true, tension: 0.35, pointRadius: 3 },
          ],
        }}
        options={{ ...cartesian(), plugins: baseOptions.plugins }}
      />
    </div>
  );
};
