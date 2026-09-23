import React from "react";
import { Text } from "./Text.jsx";

// Top-margin scale for the gap the call sites hard-coded as a Tailwind
// `mt-*` utility (`mt-1` / `mt-2` / `mt-6` were the three values actually
// seen at the extraction call sites) — DS spacing tokens only.
const SPACE = {
  none: "0",
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-6)",
};

/**
 * Caption — a small supporting text line that sits below other content: a
 * status line under a spinner/icon ("Checking permissions..."), a
 * notification's message line under its title, or a footnote under a CTA
 * row. Replaces the recurring ad-hoc `className="mt-{1,2,6} text-sm
 * text-gray-{500,600}"` pattern.
 *
 * Composes `Text` for color (never forks its tone scale — `secondary` /
 * `muted` map to the same `--text-secondary` / `--text-tertiary` tokens Text
 * already defines) and adds the two things Text deliberately leaves to the
 * caller: the DS type-scale `--text-sm` size, and a `space` prop for the
 * top-margin gap.
 */
export function Caption({
  as = "p",
  tone = "secondary",
  space = "sm",
  children,
  style,
  ...rest
}) {
  return (
    <Text
      as={as}
      tone={tone}
      style={{
        fontSize: "var(--text-sm)",
        lineHeight: "var(--leading-normal)",
        marginTop: SPACE[space] ?? SPACE.sm,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
