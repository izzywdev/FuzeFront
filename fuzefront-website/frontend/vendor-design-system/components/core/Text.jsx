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
  lg: "var(--text-lg)", // the step CardTitle builds on
  "2xl": "var(--text-2xl)", // the step BlockHeading builds on
};

// `spacing` maps to the DS spacing scale for the block's bottom margin —
// replaces the recurring ad-hoc `mb-2`/`mb-4`/`mb-6`/`mb-8` utility. `none`
// (default) preserves the original zero-margin behavior. `lg`/`xl` cover the
// wider gaps used under a centered CTA/hero heading (`mb-6`/`mb-8`), beyond
// the original `sm`/`md` block-caption steps.
const SPACING_BOTTOM = {
  none: 0,
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-6)",
  xl: "var(--space-8)",
};

// `spacingTop` is the logical-property counterpart to `spacing`
// (`margin-block-start`) and reuses the SAME scale — a top and a bottom
// margin step mean the same gap. Replaces the recurring ad-hoc `mt-{4,6}`
// utility on a prose subsection heading that follows a preceding paragraph
// (ds-fp:41a64c22b8c8). `none` (default) applies no top margin.
const SPACING_TOP = SPACING_BOTTOM;

// `leading` maps to the DS line-height scale — replaces the recurring ad-hoc
// `leading-{snug,normal,relaxed}` Tailwind utility seen on card/feature
// description paragraphs (ds-fp:f3c504a21277: `text-gray-{500,600} text-sm
// leading-relaxed`). `inherit` (default) preserves the original behavior of
// reading the surrounding layout's line-height.
const LEADING = {
  inherit: "inherit",
  tight: "var(--leading-tight)",
  snug: "var(--leading-snug)",
  normal: "var(--leading-normal)",
  relaxed: "var(--leading-relaxed)",
};

// `weight` maps to the DS font-weight scale — replaces the recurring ad-hoc
// `font-medium`/`font-semibold`/`font-bold` utility. `inherit` (default)
// preserves the original pre-`weight` behavior (no inline override, so the
// surrounding stylesheet's — e.g. Tailwind preflight's `inherit` reset on
// headings — weight applies, exactly as it did before this prop existed).
const WEIGHTS = {
  inherit: "inherit",
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
 * (default `none`, unchanged from before). `spacing="lg"`/`"xl"` additionally
 * cover the recurring `text-gray-{500,600} mb-{6,8}` pattern — a centered
 * lead paragraph under a CTA/section `<h2>`/`<h3>`.
 *
 * `leading` covers the recurring `text-gray-{500,600} text-sm
 * leading-relaxed` card/feature-description pattern (a short paragraph of
 * supporting copy under a card title — feature description, product blurb,
 * press excerpt, team-member bio): pairs with `tone="secondary"` and
 * `size="sm"` and picks a step of the DS line-height scale (default
 * `inherit`, unchanged from before).
 *
 * `weight` covers the recurring `className="font-medium text-gray-900"`
 * pattern (a small bolded label/heading, e.g. a notification title or a
 * contact-info item's label) via the DS font-weight scale instead of a raw
 * Tailwind `font-*` utility: `inherit` (default) applies no inline
 * override — unchanged from before `weight` existed — and `medium` /
 * `semibold` / `bold` resolve to the matching DS weight token.
 *
 * `size="lg"` / `size="2xl"` map to `--text-lg` / `--text-2xl` (the steps
 * `CardTitle` / `BlockHeading` build on), and `spacingTop` (default `none`)
 * picks a step of the same spacing scale for `margin-block-start`. With
 * `as="h3"`, `size="base"`, `weight="semibold"`, `spacing="sm"` it covers the
 * recurring prose subsection-heading pattern (`text-base font-semibold mb-2
 * mt-{4,5}`, e.g. a legal page's numbered subsections).
 */
export function Text({
  as: As = "p",
  tone = "primary",
  size = "inherit",
  spacing = "none",
  leading = "inherit",
  weight = "inherit",
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
        fontWeight: WEIGHTS[weight] || WEIGHTS.inherit,
        lineHeight: LEADING[leading] || LEADING.inherit,
        color: TONES[tone] || TONES.primary,
        marginBlockStart: SPACING_TOP[spacingTop] ?? SPACING_TOP.none,
        marginBlockEnd: SPACING_BOTTOM[spacing] ?? SPACING_BOTTOM.none,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
