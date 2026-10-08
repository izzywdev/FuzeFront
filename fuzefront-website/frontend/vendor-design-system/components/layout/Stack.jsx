import React from "react";

const GAP = {
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-6)",
  xl: "var(--space-8)",
};

const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
};

/**
 * Flex layout primitive — replaces the recurring `flex items-center space-x-*`
 * className pattern used to lay out a row (or column) of inline items with a
 * consistent gap. Direction defaults to `row`, cross-axis alignment to
 * `center` (the `items-center` half of the pattern the gate flagged).
 *
 * `mb` (ds-fp:06452dbba585) — optional trailing margin on the same spacing
 * scale as `gap`. Covers the recurring `flex items-center gap-{N} mb-{N}`
 * block used for an icon + heading row sitting above following body copy
 * (card headers, use-case tiles, hero icon + title) — the exact shape of
 * `gap` differed per call site (8/12/16px) and so did the trailing margin
 * (8/16/24px), which is precisely what a shared token scale normalizes.
 */
export function Stack({
  children,
  direction = "row",
  align = "center",
  justify = "start",
  gap = "sm",
  mb,
  wrap = false,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "column" ? "column" : "row",
        alignItems: ALIGN[align] || ALIGN.center,
        justifyContent: JUSTIFY[justify] || JUSTIFY.start,
        gap: GAP[gap] || GAP.sm,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...(mb ? { marginBottom: GAP[mb] || GAP.sm } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
