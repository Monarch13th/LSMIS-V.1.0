// Shared Chart.js setup for the dashboard charts (Admin / Vet / Staff).
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

export const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        usePointStyle: true,
        font: { size: 11.5, weight: 600 },
        color: "#94a3b8",
      },
    },
    tooltip: { padding: 10, cornerRadius: 8 },
  },
};

export const noLegend = { ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: false } } };

export const cartesian = (extra = {}) => ({
  ...baseOptions,
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: "#94a3b8", font: { size: 11, weight: 600 } },
    },
    y: {
      beginAtZero: true,
      ticks: { precision: 0, color: "#94a3b8", font: { size: 11, weight: 600 } },
      grid: { color: "rgba(148, 163, 184, 0.15)" },
    },
    ...extra,
  },
});

export const doughnutOptions = {
  ...baseOptions,
  cutout: "66%",
  layout: {
    padding: {
      left: 10,
      right: 15,
      top: 5,
      bottom: 5,
    },
  },
  plugins: {
    ...baseOptions.plugins,
    legend: {
      position: "right",
      align: "center",
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        usePointStyle: true,
        font: { size: 12, weight: 600 },
        color: "#64748b",
        padding: 14,
        textAlign: "left",
      },
    },
  },
};

export const ChartEmpty = ({ message = "No data recorded yet" }) => (
  <div className="dash-chart-empty">{message}</div>
);

export const hasData = (values) => (values || []).some((v) => v > 0);
