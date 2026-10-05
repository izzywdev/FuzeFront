import React from "react";

// `maxWidth` reuses Container's --container-* content-width scale so a hero
// subtitle lines up with the same rhythm as the Container it sits inside
// (ds-fp:4cb066daa4ea) — never a raw px/rem maxWidth.
const MAX_WIDTH_VAR = {
  "2xl": "var(--container-2xl)",
  "3xl": "var(--container-3xl)",
  "4xl": "var(--container-4xl)",
  none: "none",
};

/**
 * Lead — the hero/section introductory paragraph that follows a heading.
 * Replaces the recurring ad-hoc
 * `className="text-xl text-gray-600 max-w-{2xl,3xl} mx-auto"` duplicated
 * across the marketing site's hero sections (ds-fp:665d3e18af17).
 *
 * `maxWidth` picks a step of the DS's --container-* content-width scale
 * (default `"2xl"`, matching the most common call site) to line-wrap long
 * copy; `centered` (default `true`) applies `margin-inline: auto` via the
 * logical property, so it mirrors automatically under RTL. Pass
 * `centered={false}` for a lead paragraph that is already inside a
 * `<Center>` or otherwise doesn't need its own auto margins.
 *
 * Renders a `<p>` by default; `as` picks a different element when needed
 * (e.g. a `<div>` wrapping richer children).
 */
export function Lead({
  as: As = "p",
  maxWidth = "2xl",
  centered = true,
  style,
  children,
  ...rest
}) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xl)",
        lineHeight: "var(--leading-relaxed)",
        color: "var(--text-secondary)",
        maxWidth: MAX_WIDTH_VAR[maxWidth] ?? MAX_WIDTH_VAR["2xl"],
        marginInline: centered ? "auto" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
