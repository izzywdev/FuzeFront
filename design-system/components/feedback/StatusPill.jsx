import React from "react";

// Status -> color token map. Mirrors StatusPage.tsx, where "operational"
// surfaces use --success-color and failures use --error-color.
const STATUSES = {
  online: { color: "var(--success-color)", label: "Online" },
  degraded: { color: "var(--warning-color)", label: "Degraded" },
  offline: { color: "var(--error-color)", label: "Offline" },
};

/**
 * Inline service-status indicator — a colored dot + label keyed to the
 * health of a remote/service in the runtime fabric. online=success,
 * degraded=warning, offline=error.
 */
export function StatusPill({
  status = "online",
  label,
  style,
  ...rest
}) {
  const s = STATUSES[status] || STATUSES.online;
  const text = label != null ? label : s.label;
  return (
    <span
      role="status"
      aria-label={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-1) var(--space-3)",
        background: "var(--bg-quaternary)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: "8px",
          height: "8px",
          borderRadius: "var(--radius-pill)",
          background: s.color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${s.color} 22%, transparent)`,
        }}
      />
      {text}
    </span>
  );
}
