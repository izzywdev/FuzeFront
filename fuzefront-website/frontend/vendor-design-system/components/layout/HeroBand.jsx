import React from "react";

const PADDING_VAR = {
  sm: "var(--space-12)",
  md: "var(--space-16)",
  lg: "var(--space-24)",
};

// One injected <style> block per instance, scoped to a stable class — same
// pattern Container uses for its responsive gutter. The gradient stops and
// angle are CSS custom properties with the current call sites' exact values
// as fallbacks, so every existing usage needs no props at all, and a future
// section with a different tint only has to override the three `--hero-*`
// vars (via `style` or `from`/`to`/`angle`) rather than repeat a raw
// gradient className.
const BAND_CSS = `
  .ds-hero-band {
    background-image: linear-gradient(
      var(--hero-band-angle, to bottom right),
      var(--hero-band-from, #eff6ff),
      var(--hero-band-to, #f8fafc)
    );
  }
`;

/**
 * HeroBand — replaces the `py-24 bg-gradient-to-br from-{x}-50 to-{y}-50`
 * hero `<section>` wrapper duplicated, byte-for-byte, across the marketing
 * site's page heroes (ds-fp:efc5c21b52ba): BlogPage, ContactPage and
 * SolutionsPage each opened their hero with the identical raw className.
 *
 * Polymorphic via `as` (defaults to "section") so it can carry a `ref`
 * (e.g. from `useInView`) straight through to the rendered element — React
 * 19 passes `ref` through like any other prop via the `...rest` spread, no
 * `forwardRef` needed, same as `Center`.
 *
 * `padding` picks the vertical rhythm from the DS `--space-*` scale
 * (`lg` = `--space-24`, the current call sites' value). `from`/`to`/`angle`
 * override the gradient's CSS custom properties inline; leave them unset to
 * get the current look with zero props.
 */
export function HeroBand({
  as: As = "section",
  padding = "lg",
  from,
  to,
  angle,
  className,
  style,
  children,
  ...rest
}) {
  const classes = ["ds-hero-band", className].filter(Boolean).join(" ");

  return (
    <>
      <style>{BAND_CSS}</style>
      <As
        className={classes}
        style={{
          paddingBlock: PADDING_VAR[padding] ?? PADDING_VAR.lg,
          ...(from ? { "--hero-band-from": from } : null),
          ...(to ? { "--hero-band-to": to } : null),
          ...(angle ? { "--hero-band-angle": angle } : null),
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
