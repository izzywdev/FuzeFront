import React from "react";

const GAP = {
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
};

/**
 * ListStack — replaces the recurring `<ul className="space-y-*">` /
 * `<ol className="space-y-*">` pattern used to lay out a vertical list of
 * `<li>` items with a consistent gap (nav-link columns, responsibility /
 * qualification bullet lists, plan-feature lists). Renders the semantic list
 * element itself (default `ul`) with browser list styling reset and a
 * token-driven flex-column gap between children — callers still supply their
 * own `<li>` items (with whatever marker/icon they need), ListStack only
 * owns the container + spacing.
 *
 * `list-style: none` strips the implicit ARIA `list`/`listitem` role in
 * Safari/VoiceOver, so `role="list"` is set explicitly to keep it announced
 * as a list for assistive tech.
 */
export function ListStack({
  as = "ul",
  gap = "sm",
  children,
  style,
  ...rest
}) {
  const Tag = as;
  return (
    <Tag
      role="list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: GAP[gap] || GAP.sm,
        listStyle: "none",
        margin: 0,
        paddingInlineStart: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
