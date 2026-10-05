import React from "react";

// `tone` picks the paragraph color from the site's Tailwind token scale —
// never a raw hex. `onDark` (default) is the light-on-dark reading color
// used under a white heading on a dark/gradient hero (`bg-secondary-900`,
// `bg-gradient-to-br from-secondary-900 ...`); `onLight` is the equivalent
// de-emphasized color for a section intro on a white/light band. These are
// genuinely different tokens (not a shared CSS-variable tone): the DS
// package's own `Text`/`Caption` read `var(--text-secondary)`, which this
// site overrides to its LIGHT-theme value via `data-theme="light"` on
// `<main>` (see `fuzefront-website/frontend/src/App.tsx`) — reusing that
// token here would render low-contrast dark ink text on a dark hero
// background. The marketing site's own `secondary-{N}` Tailwind scale
// (`tailwind.config.js`) is the real, already-consistent token source for
// this component, matching the precedent set by `Container`/`Section`.
const TONE_CLASS = {
  onDark: "text-secondary-300",
  onLight: "text-gray-600",
};

// `size` picks the DS marketing-site type scale: `base` (text-lg, the
// flagged call sites) or `responsive` (text-lg sm:text-xl, the slightly
// larger variant used on a few hero paragraphs without a trailing margin).
const SIZE_CLASS = {
  base: "text-lg",
  responsive: "text-lg sm:text-xl",
};

// `maxWidth` picks the paragraph's own width cap — independent of (and
// usually narrower than) the ancestor `Container`'s width, which is why
// this isn't just `Container` with `as="p"`.
const MAX_WIDTH_CLASS = {
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

// `spacing` maps to the recurring `mb-{6,8,10}` bottom gap before the next
// element (a CTA row, a nav pill list, …). `none` is for the sibling
// `leading-relaxed` call sites that sit at the end of their hero block with
// no trailing margin of their own.
const SPACING_CLASS = {
  none: "",
  sm: "mb-6",
  md: "mb-8",
  lg: "mb-10",
};

/**
 * Lede — the centered intro/subtitle paragraph under a page or section
 * heading. Replaces the recurring ad-hoc
 * `className="text-lg text-secondary-300 max-w-2xl mx-auto mb-{8,10}"`
 * pattern duplicated across `FuzeHubPage`, `IndustriesPage`, and
 * `ProductsPage` (`ds-fp:0ea2123209f8`).
 *
 * Deliberately independent of `Container`: a `Container` centers an entire
 * section's *content width*, while `Lede` narrows just the paragraph
 * beneath a (usually wider) heading — the two compose, they don't overlap.
 */
export function Lede({
  as: Component = "p",
  tone = "onDark",
  size = "base",
  maxWidth = "2xl",
  spacing = "md",
  leading = false,
  className,
  children,
  ...rest
}) {
  const classes = [
    SIZE_CLASS[size] || SIZE_CLASS.base,
    TONE_CLASS[tone] || TONE_CLASS.onDark,
    MAX_WIDTH_CLASS[maxWidth] || MAX_WIDTH_CLASS["2xl"],
    "mx-auto",
    SPACING_CLASS[spacing] ?? SPACING_CLASS.md,
    leading && "leading-relaxed",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
