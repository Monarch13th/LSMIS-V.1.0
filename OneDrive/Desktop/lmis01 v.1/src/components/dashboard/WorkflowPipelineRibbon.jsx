import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * WorkflowPipelineRibbon
 * Compact horizontal workflow tracker enabling direct monitoring and navigation
 * across the complete livestock slaughterhouse lifecycle.
 */
export const WorkflowPipelineRibbon = ({ stages = [] }) => {
  const navigate = useNavigate();

  return (
    <div className="finscope-pipeline-ribbon">
      <div className="finscope-pipeline-header">
        <span className="finscope-pipeline-title">LIVESTOCK PROCESS MONITORING</span>
        <span className="finscope-pipeline-sub">Click any stage to open operational module</span>
      </div>

      <div className="finscope-pipeline-track">
        {stages.map((stage, idx) => {
          const isLast = idx === stages.length - 1;
          const count = stage.count ?? 0;
          const color = stage.color || "#10b981";

          return (
            <React.Fragment key={stage.key || idx}>
              <button
                type="button"
                className={`finscope-pipeline-step ${stage.active ? "active" : ""}`}
                onClick={() => stage.path && navigate(stage.path)}
                title={`${stage.label}: ${count} record(s). Click to view.`}
              >
                <div className="finscope-step-top">
                  <span className="finscope-step-dot" style={{ backgroundColor: color }} />
                  <span className="finscope-step-count" style={{ color: count > 0 ? "#0f172a" : "#94a3b8" }}>
                    {count}
                  </span>
                </div>
                <div className="finscope-step-label">{stage.label}</div>
              </button>

              {!isLast && <div className="finscope-pipeline-arrow">›</div>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

