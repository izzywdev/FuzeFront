import React from "react";
import { Text } from "./Text.jsx";

// Bottom-margin scale for the gap the call sites hard-coded as a Tailwind
// `mb-*` utility (`mb-1` / `mb-3` / `mb-4` were the three values actually
// seen at the extraction call sites) — DS spacing tokens only, kept local to
// this component (not folded into `Text`'s own `spacing` scale) the same way
// `Caption` keeps its `mt-*` scale local.
const SPACE = {
  xs: "var(--space-1)",
  sm: "var(--space-3)",
  md: "var(--space-4)",
};

/**
 * Subheading — a bold `--text-xl` heading that titles a card or opens a
 * numbered legal-document section: an industry/product card's name, or a
 * Terms/Privacy page's "1. Introduction" section heading. Replaces the
 * recurring ad-hoc `className="text-xl font-bold text-gray-900 mb-{1,3,4}"`
 * pattern duplicated across the marketing site (ds-fp:3f3b125aaf3d).
 *
 * Sits one step below `BlockHeading` (`--text-2xl`, a larger sub-section
 * placeholder heading) and one step above `CardTitle` (`--text-lg`/semibold,
 * a smaller feature-card title) in the type scale.
 *
 * Composes `Text` (never forks its tone scale) and adds the DS `--text-xl`
 * size, `--weight-bold` weight, and a `space` prop for the bottom-margin gap
 * — the three things the raw Tailwind pattern hard-coded. `as` picks the
 * heading level (`h2`, default, for a stand-alone legal-section heading;
 * `h3` for a heading nested inside a card alongside sibling card headings).
 */
export function Subheading({
  as = "h2",
  tone = "primary",
  space = "md",
  children,
  style,
  ...rest
}) {
  return (
    <Text
      as={as}
      tone={tone}
      style={{
        fontSize: "var(--text-xl)",
        fontWeight: "var(--weight-bold)",
        lineHeight: "var(--leading-snug)",
        marginBlockEnd: SPACE[space] ?? SPACE.md,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
