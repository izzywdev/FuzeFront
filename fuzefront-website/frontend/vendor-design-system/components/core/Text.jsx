import React from "react";

// Tone maps to the DS text-color scale — never a raw gray shade. `muted` uses
// --text-tertiary (the lowest-emphasis rung), matching the shade Badge's
// `neutral` tone and InfoRow's description slot already read from.
const TONES = {
  primary: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
  danger: "var(--error-color)",
};

// `size` maps to the DS type scale — never a raw px/Tailwind size utility.
// `inherit` (default) preserves the original behavior of reading the
// surrounding layout's font size.
const SIZES = {
  inherit: "inherit",
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  base: "var(--text-base)",
  md: "var(--text-md)",
};

// `spacing` / `spacingTop` both map to the DS spacing scale (the same
// scale, since a top and bottom margin step mean the same physical gap) —
// replaces the recurring ad-hoc `mb-2`/`mb-4`/`mt-4`/`mt-5` utilities.
// `none` (default for both) preserves the original zero-margin behavior.
const SPACING_SCALE = {
  none: 0,
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-5)",
};

// `weight` maps to the DS font-weight scale — replaces the recurring ad-hoc
// `font-semibold` utility. `inherit` (default) preserves the original
// behavior of not setting a font-weight at all.
const WEIGHTS = {
  inherit: undefined,
  regular: "var(--weight-regular)",
  medium: "var(--weight-medium)",
  semibold: "var(--weight-semibold)",
  bold: "var(--weight-bold)",
};

/**
 * Plain text with a semantic color tone — replaces the recurring ad-hoc
 * `className="text-gray-{500,600,900}"` (and `text-red-500`) pattern used
 * across feature code for placeholder copy, read-only field-value display,
 * and de-emphasized captions/subtitles. `tone` picks from the DS text-color
 * scale instead of a raw Tailwind gray shade: `primary` (default reading
 * text, e.g. a displayed field value), `secondary` (de-emphasized supporting
 * copy, e.g. an email caption under a name), `muted` (lowest emphasis —
 * empty-state / placeholder copy, e.g. "Select organization"), `danger`
 * (inline error copy). `as` picks the rendered element so it can stand in
 * for a `<p>`, inline `<span>`, `<div>`, or form `<label>`.
 *
 * `size` and `spacing` cover the recurring `text-sm text-gray-{500,600}
 * mb-{2,4}` block-caption pattern (de-emphasized supporting copy under a
 * heading, e.g. an empty-state description or a dialog's helper paragraph)
 * without reaching for a raw Tailwind size/margin utility: `size` picks a
 * step of the DS type scale (default `inherit`, unchanged from before), and
 * `spacing` picks a step of the DS spacing scale for `margin-block-end`
 * (default `none`, unchanged from before).
 *
 * `weight` + `size="base"` + `spacing="sm"` + `spacingTop` cover the
 * recurring `text-base font-semibold text-gray-800 mb-2 mt-{4,5}` prose
 * subsection-heading pattern (an `<h3>`-level heading inside long-form
 * copy, e.g. a legal/policy page's numbered subsections) — rendered via
 * `as="h3"` instead of a raw Tailwind weight/color/margin utility.
 * `weight` (default `inherit`, unchanged from before `weight` existed)
 * picks a step of the DS font-weight scale, and `spacingTop` (default
 * `none`) picks a step of the DS spacing scale for `margin-block-start`
 * (the logical-property counterpart to `spacing`'s `margin-block-end`, so
 * both mirror under RTL).
 */
export function Text({
  as: As = "p",
  tone = "primary",
  size = "inherit",
  weight = "inherit",
  spacing = "none",
  spacingTop = "none",
  children,
  style,
  ...rest
}) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: SIZES[size] || SIZES.inherit,
        fontWeight: WEIGHTS[weight],
        lineHeight: "inherit",
        color: TONES[tone] || TONES.primary,
        marginBlockStart: SPACING_SCALE[spacingTop] ?? SPACING_SCALE.none,
        marginBlockEnd: SPACING_SCALE[spacing] ?? SPACING_SCALE.none,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
