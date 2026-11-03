import React from "react";

// `size` maps to two steps of the DS type scale for the mobile -> `sm`
// (640px) responsive jump — same injected-<style> approach as Container's
// GUTTER_CSS (cheap to re-inject; browsers dedupe identical <style> content).
const SIZE_CSS = `
  .ds-inverse-heading--lg { font-size: var(--text-2xl); }
  @media (min-width: 640px) {
    .ds-inverse-heading--lg { font-size: var(--text-3xl); }
  }
  .ds-inverse-heading--md { font-size: var(--text-xl); }
  @media (min-width: 640px) {
    .ds-inverse-heading--md { font-size: var(--text-2xl); }
  }
`;

// Mirrors Text.jsx's SPACING_BOTTOM vocabulary (none/sm/md) for the block's
// bottom margin, replacing the recurring ad-hoc `mb-4` utility.
const SPACING_BOTTOM = {
  none: 0,
  sm: "var(--space-2)",
  md: "var(--space-4)",
};

/**
 * Bold display heading rendered in white — replaces the recurring
 * `text-{2,3}xl sm:text-{3,4}xl font-heading font-bold text-white mb-4`
 * pattern duplicated across the marketing site's dark-gradient hero/CTA
 * bands (ds-fp:31778e520b8d): the homepage's Pricing-teaser heading, the
 * Pricing page's Enterprise-CTA heading, and the 404 page's "This page
 * doesn't exist" title. Those sections are ALWAYS a dark gradient fill,
 * independent of the site's light/dark theme, so the color is the literal
 * white primitive (`--paper`) rather than the theme-aware `--text-primary`
 * swap a normal-surface heading would use.
 *
 * `size` picks a step of the DS type scale for the mobile -> `sm`(640px)
 * jump: `lg` (default) is the scale's "page hero" ceiling (--text-2xl ->
 * --text-3xl — see typography.css), for a section's primary CTA heading;
 * `md` is one step down (--text-xl -> --text-2xl), for a heading paired
 * with other large display content (e.g. under the 404 page's giant "404").
 * `as` picks the rendered element (h1/h2/h3) so each call site keeps the
 * right heading level.
 */
export function InverseHeading({
  as: As = "h2",
  size = "lg",
  spacing = "md",
  className,
  style,
  children,
  ...rest
}) {
  const sizeClass = size === "md" ? "ds-inverse-heading--md" : "ds-inverse-heading--lg";
  const classes = ["ds-inverse-heading", sizeClass, className].filter(Boolean).join(" ");

  return (
    <>
      <style>{SIZE_CSS}</style>
      <As
        className={classes}
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          lineHeight: "var(--leading-tight)",
          color: "var(--paper)",
          marginBlockEnd: SPACING_BOTTOM[spacing] ?? SPACING_BOTTOM.md,
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
