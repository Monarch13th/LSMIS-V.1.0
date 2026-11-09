import React, { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

/**
 * FinScopeLineChart
 * High-aesthetic smooth area line chart inspired by FinScope "Portfolio" graph.
 */
export const FinScopeLineChart = ({
  labels = ["1 Mar", "8 Mar", "15 Mar", "22 Mar", "29 Mar"],
  dataPoints = [28, 42, 36, 68, 54],
  label = "Volume",
  unit = "Head",
  color = "#0284c7", // default cyan/blue
  secondaryPoints = null,
  secondaryLabel = "Target",
  height = 160,
}) => {
  const chartData = useMemo(() => {
    return {
      labels,
      datasets: [
        {
          label,
          data: dataPoints,
          borderColor: color,
          borderWidth: 2.5,
          tension: 0.38,
          fill: true,
          backgroundColor: (context) => {
            const ctx = context.chart.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, 180);
            gradient.addColorStop(0, `${color}28`);
            gradient.addColorStop(1, `${color}00`);
            return gradient;
          },
          pointBackgroundColor: "#ffffff",
          pointBorderColor: color,
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2.5,
        },
        ...(secondaryPoints
          ? [
              {
                label: secondaryLabel,
                data: secondaryPoints,
                borderColor: "#94a3b8",
                borderWidth: 1.5,
                borderDash: [5, 4],
                tension: 0.38,
                fill: false,
                pointRadius: 0,
              },
            ]
          : []),
      ],
    };
  }, [labels, dataPoints, secondaryPoints, color, label, secondaryLabel]);

  const options = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: "#ffffff",
          titleColor: "#0f172a",
          bodyColor: "#475569",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
          cornerRadius: 10,
          shadowOffsetX: 0,
          shadowOffsetY: 4,
          shadowBlur: 12,
          shadowColor: "rgba(0, 0, 0, 0.08)",
          callbacks: {
            title: (items) => `${items[0]?.label || ""}`,
            label: (item) => ` ${item.dataset.label}: ${item.parsed.y} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#94a3b8",
            font: { size: 10.5, weight: 600 },
            padding: 4,
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(226, 232, 240, 0.6)",
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            color: "#94a3b8",
            font: { size: 10, weight: 600 },
            padding: 8,
            maxTicksLimit: 4,
            callback: (val) => `${val}`,
          },
        },
      },
    };
  }, [unit]);

  return (
    <div style={{ width: "100%", height, minHeight: 0 }}>
      <Line data={chartData} options={options} />
    </div>
  );
};

