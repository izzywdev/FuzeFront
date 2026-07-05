import React from "react";

const VARIANTS = {
  "module-federation": { background: "var(--accent-soft)", color: "var(--accent-color)" },
  "iframe": { background: "var(--accent-soft)", color: "var(--accent-color)" },
  "web-component": { background: "var(--accent-soft)", color: "var(--accent-color)" },
};

/**
 * Mono pill labeling a module's integration type — the technical "how it fuses"
 * tag shown on launcher cards (module-federation, iframe, web-component, …).
 */
export function IntegrationBadge({
  type = "module-federation",
  style,
  ...rest
}) {
  const v = VARIANTS[type] || VARIANTS["module-federation"];
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        padding: "var(--space-1) var(--space-2)",
        borderRadius: "var(--radius-sm)",
        textTransform: "lowercase",
        whiteSpace: "nowrap",
        background: v.background,
        color: v.color,
        ...style,
      }}
      {...rest}
    >
      {type}
    </span>
  );
}
