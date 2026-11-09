import React, { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/**
 * FinScopeBarChart
 * Multi-colored vertical bar chart inspired by FinScope "Account Activity".
 */
export const FinScopeBarChart = ({
  labels = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
  data = [12, 19, 28, 34, 45, 22, 18],
  colors = ["#cbd5e1", "#cbd5e1", "#f97316", "#10b981", "#0284c7", "#cbd5e1", "#cbd5e1"],
  unit = "Head",
  height = 130,
  peakLabel = "Peak Intake",
}) => {
  const chartData = useMemo(() => {
    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: (ctx) => {
            const idx = ctx.dataIndex;
            return colors[idx % colors.length] || "#0284c7";
          },
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 22,
        },
      ],
    };
  }, [labels, data, colors]);

  const options = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: "#0f172a",
          bodyColor: "#475569",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 8,
          cornerRadius: 8,
          shadowColor: "rgba(0,0,0,0.06)",
          callbacks: {
            title: (items) => `${items[0]?.label || ""}`,
            label: (item) => ` ${item.parsed.y} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#94a3b8",
            font: { size: 10, weight: 600 },
            padding: 4,
          },
        },
        y: {
          display: false,
          beginAtZero: true,
        },
      },
    };
  }, [unit]);

  return (
    <div style={{ width: "100%", height, minHeight: 0 }}>
      <Bar data={chartData} options={options} />
    </div>
  );
};

