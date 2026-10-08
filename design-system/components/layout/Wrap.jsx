import React from "react";

const GAP_TOKENS = {
  0: "var(--space-0)",
  1: "var(--space-1)",
  2: "var(--space-2)",
  3: "var(--space-3)",
  4: "var(--space-4)",
  5: "var(--space-5)",
  6: "var(--space-6)",
  7: "var(--space-7)",
  8: "var(--space-8)",
  10: "var(--space-10)",
  12: "var(--space-12)",
  16: "var(--space-16)",
};

/**
 * Wrap — replaces the recurring `flex flex-wrap gap-*` pattern used to lay
 * out badge groups, tag/chip lists, and rows of buttons that should wrap
 * onto multiple lines on narrow viewports instead of overflowing or
 * squeezing. `gap` takes a spacing-scale step (matches `--space-*`); the
 * container itself carries no directionality, so it mirrors automatically
 * under `dir="rtl"` the same way native `flex-wrap` does.
 */
export function Wrap({
  gap = 2,
  align = "center",
  justify = "flex-start",
  as: Tag = "div",
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: align,
        justifyContent: justify,
        gap: GAP_TOKENS[gap] ?? GAP_TOKENS[2],
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
