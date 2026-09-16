import React from "react";

/**
 * A single summary-metric tile: a seam top accent, a mono uppercase key
 * label, a large display-font value (with optional unit), and an optional
 * meta caption below. Companion to `StatGroup` (a fused band of tiles) —
 * `StatCard` is the standalone/grid form used by dashboards that lay their
 * own grid (e.g. a 4-up admin-console overview). Renders as an `<a>` when
 * `href` is given (navigates to the detail view for that metric), else a
 * plain `<div>`.
 */
export function StatCard({
  label,
  value,
  unit,
  meta,
  href,
  onClick,
  style,
  ...rest
}) {
  const As = href ? "a" : "div";
  const interactive = Boolean(href || onClick);
  return (
    <As
      href={href}
      onClick={onClick}
      data-stat-card=""
      style={{
        position: "relative",
        overflow: "hidden",
        display: "block",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-5)",
        color: "inherit",
        textDecoration: "none",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: "var(--seam)",
          opacity: 0.6,
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-wide)",
          color: "var(--text-tertiary)",
          marginBottom: "var(--space-2)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-primary)",
        }}
      >
        {value}
        {unit && (
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: "var(--text-tertiary)",
              marginInlineStart: "4px",
            }}
          >
            {unit}
          </span>
        )}
      </div>
      {meta && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            marginTop: "var(--space-1)",
          }}
        >
          {meta}
        </div>
      )}
    </As>
  );
}
