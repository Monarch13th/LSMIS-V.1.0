import React from "react";
import { formatPhDateTime, initials, formatSex } from "../../utils/helpers";
import { parseHistory, formatAttribution, getAttributionName } from "../../utils/processHistory";
import { Badge } from "../ui/Badge";
import { Icon } from "../icons";

export const ProcessHistoryTimeline = ({ record, className = "" }) => {
  if (!record) return null;

  const rawHistory = parseHistory(record.process_history || record.history);

  // If no explicit process_history array exists yet, construct stage cards from existing columns
  const syntheticEvents = [];
  if (rawHistory.length === 0) {
    if (record.created_by || record.registered_by || record.registered_at || record.received_date) {
      syntheticEvents.push({
        id: "syn-reg",
        stage: "Registration",
        action: "Livestock Registered",
        user_name: record.registered_by || record.created_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.registered_at || record.received_date,
        details: { species: record.species, tag_number: record.tag_number },
      });
    }
    if (record.received_by || record.received_at) {
      syntheticEvents.push({
        id: "syn-rec",
        stage: "Receiving",
        action: "Animal Received at Facility",
        user_name: record.received_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.received_at || record.received_date,
      });
    }
    if (record.marked || record.marked_by || record.marked_at || record.mark_date) {
      syntheticEvents.push({
        id: "syn-mark",
        stage: "Marking",
        action: `Animal Marked (${record.mark_type || "Ear Tag"})`,
        user_name: record.marked_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.marked_at || record.mark_date,
      });
    }
    if (record.ante_inspected_by || record.ante_inspected_at) {
      syntheticEvents.push({
        id: "syn-ante",
        stage: "Ante-Mortem Inspection",
        action: "Ante-Mortem Inspection Completed",
        user_name: record.ante_inspected_by || "Dr. Dave",
        role: "vet",
        timestamp: record.ante_inspected_at,
      });
    }
    if (record.slaughtered_by || record.slaughtered_at) {
      syntheticEvents.push({
        id: "syn-slaughter",
        stage: "Slaughter",
        action: "Slaughter Processing Completed",
        user_name: record.slaughtered_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.slaughtered_at,
      });
    }
    if (record.post_inspected_by || record.post_inspected_at) {
      syntheticEvents.push({
        id: "syn-post",
        stage: "Post-Mortem Inspection",
        action: "Post-Mortem Carcass Inspection Completed",
        user_name: record.post_inspected_by || "Dr. Dave",
        role: "vet",
        timestamp: record.post_inspected_at,
      });
    }
    if (record.weighed_by || record.weighed_at) {
      syntheticEvents.push({
        id: "syn-weigh",
        stage: "Carcass Weighing & Branding",
        action: "Carcass Weighed & Branded",
        user_name: record.weighed_by || "Dr. Dave",
        role: "vet",
        timestamp: record.weighed_at,
      });
    }
    if (record.paid_by_staff || record.paid_at) {
      syntheticEvents.push({
        id: "syn-pay",
        stage: "Payments",
        action: "Slaughter Fees Collected",
        user_name: record.paid_by_staff || "Jenel Selgas",
        role: "staff",
        timestamp: record.paid_at,
      });
    }
    if (record.permit_issued_by || record.permit_issued_at) {
      syntheticEvents.push({
        id: "syn-permit",
        stage: "Permit",
        action: "Meat Inspection & Transfer Permit Issued",
        user_name: record.permit_issued_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.permit_issued_at,
      });
    }
    if (record.dispatched_by || record.dispatched_at || record.released_at) {
      syntheticEvents.push({
        id: "syn-dispatch",
        stage: "Dispatch",
        action: "Meat Dispatched",
        user_name: record.dispatched_by || "Jenel Selgas",
        role: "staff",
        timestamp: record.dispatched_at || record.released_at,
      });
    }
  }

  const events = rawHistory.length > 0 ? rawHistory : syntheticEvents;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header Attribution Overview */}
      <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200 dark:border-slate-700/60">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Livestock Details
            </div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {record.tag_number || "—"} · <span className="font-medium text-slate-600 dark:text-slate-300">{record.species || "—"} ({formatSex(record.sex)})</span>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Original Creator & Registration
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold">
                {initials(getAttributionName(record.registered_by || record.created_by))}
              </span>
              <span>
                {getAttributionName(record.registered_by || record.created_by)}
              </span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Registration Date & Time
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
              {record.registered_at || record.created_at || record.received_date
                ? formatPhDateTime(record.registered_at || record.created_at || record.received_date)
                : "Not recorded"}
            </div>
          </div>
        </div>
      </div>

      {/* Chronological Step History */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Process History & Stage Attribution ({events.length} {events.length === 1 ? "Event" : "Events"})
        </h4>

        {events.length === 0 ? (
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500">
            No process events recorded for this livestock tag yet.
          </div>
        ) : (
          <div className="relative border-l-2 border-emerald-500/40 ml-4 pl-4 space-y-4">
            {events.map((evt, idx) => {
              const isVet = evt.role === "vet" || evt.stage?.toLowerCase().includes("mortem") || evt.stage?.toLowerCase().includes("condemn");
              return (
                <div key={evt.id || idx} className="relative group">
                  {/* Timeline Node Bullet */}
                  <div
                    className={`absolute -left-[25px] top-1.5 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 ${
                      isVet ? "bg-cyan-500" : "bg-emerald-500"
                    }`}
                  />
                  
                  <div className="bg-white dark:bg-slate-800 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition-all">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {evt.stage}
                        </span>
                        <Badge
                          variant={isVet ? "info" : "success"}
                          size="sm"
                          className="text-[10px] uppercase font-bold tracking-wider"
                        >
                          {isVet ? "Veterinarian" : "Staff Personnel"}
                        </Badge>
                      </div>
                      <span className="text-xs text-slate-400">
                        {evt.timestamp ? formatPhDateTime(evt.timestamp) : "Not recorded"}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300 font-medium mt-1">
                      {evt.action}
                    </p>

                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <span className="text-slate-400">Handled By:</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {getAttributionName(evt.user_name, isVet ? "Dr. Dave" : "Jenel Selgas")}
                        </span>
                      </div>
                      {evt.user_id && (
                        <span className="text-[10px] text-slate-400 font-mono" title={evt.user_id}>
                          ID: {evt.user_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>

                    {/* Additional Details if available */}
                    {evt.details && Object.keys(evt.details).length > 0 && (
                      <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 rounded p-2 text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                        {Object.entries(evt.details).map(([k, v]) => {
                          if (v === null || v === undefined || v === "") return null;
                          return (
                            <span key={k}>
                              <strong className="capitalize text-slate-700 dark:text-slate-300">{k.replace(/_/g, " ")}:</strong>{" "}
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
