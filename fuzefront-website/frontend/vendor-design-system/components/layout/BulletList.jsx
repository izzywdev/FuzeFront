import React from "react";

// Gap between items. Mirrors ListStack's own scale so the two stay
// interchangeable mentally — pick BulletList when the native marker should
// stay, ListStack when it should be replaced by a custom icon/marker.
const GAP = {
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
};

// Top margin separating the list from the paragraph above it.
const SPACE = {
  none: "0",
  sm: "var(--space-3)",
  md: "var(--space-4)",
};

/**
 * BulletList — replaces the recurring `<ul className="list-disc pl-6
 * space-y-* [mt-*]">` pattern used for prose bullet/numbered lists in
 * long-form copy (Privacy Policy, Terms of Service, and similar legal/
 * marketing content) (ds-fp:081c93881e5d).
 *
 * Unlike `ListStack` — which strips native list styling to lay items out as
 * a flex column with a custom marker/icon per `<li>` — `BulletList` keeps
 * the browser's native disc/decimal marker and indent, so it deliberately
 * stays `display: block` rather than flex/grid: turning a `<ul>` into a flex
 * or grid container recomputes its `<li>` children's box type and can
 * silently drop the native `::marker` in some browsers. Item spacing is
 * applied the same way Tailwind's `space-y-*` does it — `marginBlockStart`
 * on every item but the first — which has no effect on marker rendering.
 *
 * Tokens only: `pl-6` -> `--space-6` (the DS scale's one exact match for
 * Tailwind's 24px), `space-y-1.5`/`space-y-2` -> `gap="sm"` (`--space-2`,
 * 8px — the same rounding ListStack already uses for `space-y-1.5`),
 * `mt-3` -> `space="sm"` (`--space-3`, 12px).
 */
export function BulletList({
  as = "ul",
  gap = "sm",
  space = "none",
  children,
  style,
  ...rest
}) {
  const Tag = as;
  const items = React.Children.toArray(children).filter(Boolean);
  const gapToken = GAP[gap] || GAP.sm;

  return (
    <Tag
      style={{
        listStyleType: Tag === "ol" ? "decimal" : "disc",
        paddingInlineStart: "var(--space-6)",
        marginBlockStart: SPACE[space] ?? SPACE.none,
        marginBlockEnd: 0,
        ...style,
      }}
      {...rest}
    >
      {items.map((child, index) => {
        if (index === 0 || !React.isValidElement(child)) return child;
        return React.cloneElement(child, {
          style: { marginBlockStart: gapToken, ...(child.props.style || {}) },
        });
      })}
    </Tag>
  );
}
