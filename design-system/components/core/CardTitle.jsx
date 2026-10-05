import React from "react";
import { Text } from "./Text.jsx";

/**
 * CardTitle — the small semibold heading atop a content card: a feature
 * card's title, a value-prop card's heading, a press-release card's
 * headline. Replaces the recurring ad-hoc `className="text-lg
 * font-semibold text-gray-900 mb-2"` pattern (an `<h3>` at DS `--text-lg`
 * / `--weight-semibold` / `--text-primary`, with a `--space-2` bottom
 * gap) seen duplicated across marketing-site card grids.
 *
 * Composes `Text` (`size="lg"`, `tone="primary"`, `spacing="sm"` — the
 * exact `--text-lg` / `--text-primary` / `--space-2` steps the pattern
 * used) and adds the `font-semibold` weight Text deliberately leaves to
 * the caller. `as` lets a caller render a different heading level when the
 * card title isn't the page's only `<h3>`; `spacing` picks a different
 * bottom-gap step (default `sm`, matching the extracted `mb-2`). Any
 * extra `className` (e.g. a `group-hover:*` color transition tied to a
 * parent `.group`) passes through untouched — it's an interaction state,
 * not a token value.
 */
export function CardTitle({
  as = "h3",
  tone = "primary",
  spacing = "sm",
  children,
  style,
  ...rest
}) {
  return (
    <Text
      as={as}
      tone={tone}
      size="lg"
      spacing={spacing}
      style={{
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--leading-snug)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
