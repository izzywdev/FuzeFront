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

// `size` maps to the DS type scale (tokens/typography.css) — never a raw px
// value or a Tailwind text-{xs,sm,...} utility. Omitting `size` keeps the
// original inherit-from-context behavior, so this is additive and does not
// change any existing caller that only passes `tone`.
const SIZES = {
  "2xs": "var(--text-2xs)",
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  base: "var(--text-base)",
  md: "var(--text-md)",
  lg: "var(--text-lg)",
  xl: "var(--text-xl)",
  "2xl": "var(--text-2xl)",
  "3xl": "var(--text-3xl)",
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
 * for a `<p>`, inline `<span>`, `<div>`, form `<label>`, or a definition-list
 * `<dt>`/`<dd>` term/description.
 *
 * `size` (optional) picks a step of the DS type scale — replaces the
 * recurring ad-hoc `className="text-sm ..."` (etc.) size utility that was
 * otherwise stacked on top of a raw gray-shade color class. Omit it to keep
 * inheriting font-size from the surrounding layout (the original, default
 * behavior); pass it (e.g. `size="sm"`) when the caption/meta text needs to
 * read smaller than body copy regardless of context, e.g. a "Member since"
 * meta line or a fact-sheet label.
 */
export function Text({
  as: As = "p",
  tone = "primary",
  size,
  children,
  style,
  ...rest
}) {
  return (
    <As
      style={{
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: size ? SIZES[size] || "inherit" : "inherit",
        lineHeight: "inherit",
        color: TONES[tone] || TONES.primary,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
