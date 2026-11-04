import { useState } from "react";
import { Icon } from "../icons";

export const TagBadge = ({ tag, style = {} }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!tag) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(String(tag).trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  if (!tag || tag === "—") return <span style={{ color: "var(--color-text-muted)" }}>—</span>;

  return (
    <span
      onClick={handleCopy}
      title="Click to copy Tag Number"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.02em",
        padding: "3px 8px",
        borderRadius: 6,
        background: copied ? "var(--color-success-bg)" : "var(--color-bg)",
        color: copied ? "var(--color-success)" : "var(--color-text)",
        border: `1px solid ${copied ? "var(--color-success)" : "var(--color-border)"}`,
        cursor: "pointer",
        transition: "all 150ms ease",
        ...style,
      }}
    >
      <span>{tag}</span>
    </span>
  );
};

export default TagBadge;
