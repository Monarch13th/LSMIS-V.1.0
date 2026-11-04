import { useMemo } from "react";
import { Icon } from "../icons";
import { validatePassword } from "../../utils/passwordValidation";

/**
 * PasswordRequirements
 * Clean, government-compliant checklist displaying the 5 security rules
 * with real-time feedback as the user types.
 */
export const PasswordRequirements = ({
  password = "",
  showOnlyWhenDirty = false,
  showHeading = true,
  className = "",
  compact = false
}) => {
  const result = useMemo(() => validatePassword(password), [password]);
  const isDirty = (password || "").length > 0;

  if (showOnlyWhenDirty && !isDirty) {
    return null;
  }

  const satisfiedCount = result.rules.filter((r) => r.satisfied).length;
  const percentMet = Math.round((satisfiedCount / result.rules.length) * 100);

  return (
    <div
      className={`password-requirements-box ${className}`}
      style={{
        marginTop: compact ? 2 : 8,
        marginBottom: compact ? 2 : 8,
        padding: compact ? "8px 12px" : "12px 14px",
        borderRadius: 10,
        background: "var(--color-surface, #f8fafc)",
        border: `1px solid ${result.isValid ? "rgba(16, 185, 129, 0.4)" : "var(--color-border, #e2e8f0)"}`,
        transition: "all 0.2s ease"
      }}
    >
      {showHeading && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: compact ? 6 : 8
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: result.isValid ? "#10b981" : "var(--color-text-muted, #475569)", display: "flex" }}>
              <Icon.Shield size={compact ? 14 : 16} />
            </span>
            <span style={{ fontSize: compact ? 12 : 13.5, fontWeight: 700, color: "var(--color-text, #1e293b)" }}>
              Password Requirements
            </span>
          </div>

          <span
            style={{
              fontSize: compact ? 11 : 12,
              fontWeight: 700,
              padding: compact ? "2px 8px" : "3px 10px",
              borderRadius: 999,
              background: result.isValid
                ? "rgba(16, 185, 129, 0.18)"
                : isDirty
                ? "rgba(245, 158, 11, 0.18)"
                : "var(--color-bg, #e2e8f0)",
              color: result.isValid
                ? "#10b981"
                : isDirty
                ? "#f59e0b"
                : "var(--color-text-muted, #475569)"
            }}
          >
            {satisfiedCount} of {result.rules.length} Met
          </span>
        </div>
      )}

      {/* Progress Bar */}
      <div
        style={{
          height: compact ? 4 : 5,
          width: "100%",
          background: "var(--color-border, #e2e8f0)",
          borderRadius: 999,
          overflow: "hidden",
          marginBottom: compact ? 8 : 12
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percentMet}%`,
            background: result.isValid ? "#10b981" : isDirty ? "#f59e0b" : "var(--color-text-muted, #94a3b8)",
            transition: "all 0.3s ease"
          }}
        />
      </div>

      {/* Checklist items */}
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: compact ? 5 : 8
        }}
      >
        {result.rules.map((rule) => {
          const ok = rule.satisfied;
          return (
            <li
              key={rule.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: compact ? 7 : 9,
                fontSize: compact ? 11.5 : 13.5,
                lineHeight: 1.3,
                fontWeight: ok ? 600 : 500,
                color: ok ? "#10b981" : "var(--color-text-muted, #475569)",
                transition: "color 0.15s ease"
              }}
            >
              <span
                style={{
                  width: compact ? 15 : 18,
                  height: compact ? 15 : 18,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: ok ? "rgba(16, 185, 129, 0.16)" : "var(--color-bg, #f1f5f9)",
                  color: ok ? "#10b981" : "var(--color-text-muted, #94a3b8)",
                  border: `1px solid ${ok ? "rgba(16, 185, 129, 0.4)" : "var(--color-border, #cbd5e1)"}`
                }}
              >
                {ok ? <Icon.Check size={compact ? 9 : 11} strokeWidth={3} /> : <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--color-text-muted, #94a3b8)" }} />}
              </span>
              <span>{rule.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
