import React from "react";

const GAP_TOKENS = {
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-6)",
  xl: "var(--space-8)",
};

/**
 * ResponsiveGrid — replaces the recurring `grid grid-cols-1 md:grid-cols-2
 * gap-N` Tailwind pattern used for paired form fields (first/last name,
 * timezone/language) and side-by-side content panels.
 *
 * Stacks to a single column in narrow containers and reflows up to
 * `columns` once there's room for each to be at least `minColumnWidth`
 * wide. Driven purely by the grid's own container width via CSS
 * `auto-fit`/`clamp()` — not a viewport media query — so it collapses
 * correctly even inside a narrow host-shell panel, not just a narrow
 * browser window.
 */
export function ResponsiveGrid({
  columns = 2,
  minColumnWidth = "240px",
  gap = "lg",
  align,
  children,
  style,
  ...rest
}) {
  const gapValue = GAP_TOKENS[gap] || GAP_TOKENS.lg;
  const n = Math.max(1, columns);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          `repeat(auto-fit, minmax(clamp(${minColumnWidth}, ` +
          `(100% - ${gapValue} * ${n - 1}) / ${n}, 100%), 1fr))`,
        gap: gapValue,
        alignItems: align,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
