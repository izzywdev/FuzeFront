import React from "react";
import { Text } from "./Text.jsx";

/**
 * BlockHeading — a bold sub-heading that introduces a block of content: a
 * placeholder section's title ("Blog Coming Soon"), or a grid-card's title
 * (a solution card's name). Replaces the recurring ad-hoc `className="text-2xl
 * font-bold text-gray-900 mb-4"` pattern duplicated across the marketing
 * site (ds-fp:2eef9a6b4c23).
 *
 * Sits between `CardTitle` (`--text-lg` / semibold, a smaller feature-card
 * title) and `SectionTitle` (`--text-3xl`/`--text-4xl`, the bold heading
 * that opens a whole marketing-page section) in the type scale: this is the
 * `--text-2xl` / bold step used by a sub-section placeholder heading or a
 * larger content-card title.
 *
 * Composes `Text` (never forks its tone scale) and adds the DS `--text-2xl`
 * size, `--weight-bold` weight, and a `space` prop for the bottom-margin gap
 * — the three things the raw Tailwind pattern hard-coded. `as` picks the
 * heading level (`h2`, default, for a stand-alone sub-section heading; `h3`
 * for a heading nested inside a card alongside sibling card headings).
 */
export function BlockHeading({
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
      size="2xl"
      spacing={space}
      style={{
        fontWeight: "var(--weight-bold)",
        lineHeight: "var(--leading-tight)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
