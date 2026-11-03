import React from "react";

// ds-fp:585366687b79 — extracted per issue #941. The marketing site's
// gradient-hero <h1> — `text-4xl sm:text-5xl font-heading font-extrabold
// text-white mb-{4,6}` — recurred verbatim (modulo bottom margin) across
// AboutPage, CareersPage, IndustriesPage, PressPage, PricingPage and
// ProductsPage. One primitive, tokens only: responsive size via
// --role-marketing-hero-size(-lg), weight via --weight-extrabold, color via
// --primary-foreground (the DS's fixed on-dark/on-accent white — these hero
// sections are a hard-coded dark gradient that doesn't invert with the
// light/dark theme toggle, so --text-primary would be wrong here).

// One injected <style> block per instance for the size breakpoint — same
// pattern Container uses for its responsive gutter, since a media query
// can't be expressed as an inline style. Browsers dedupe identical <style>
// content trivially.
const RESPONSIVE_CSS = `
  .ds-hero-heading {
    font-size: var(--role-marketing-hero-size);
  }
  @media (min-width: 640px) {
    .ds-hero-heading { font-size: var(--role-marketing-hero-size-lg); }
  }
`;

// `spacing` maps to the DS spacing scale for the heading's bottom margin —
// replaces the recurring ad-hoc `mb-4`/`mb-6` utility split across the call
// sites above. `lg` (default) covers the 3 sites that used `mb-6`; `md`
// covers the 3 that used `mb-4`.
const SPACING_BOTTOM = {
  none: 0,
  md: "var(--space-4)",
  lg: "var(--space-6)",
};

/**
 * HeroHeading — the big, bold page-title <h1> at the top of a marketing-site
 * hero section (dark gradient background). `as` defaults to `h1` since a
 * page has exactly one; pass `as="h2"` for a secondary hero-style title
 * lower on the same page. `spacing` picks the bottom margin from the DS
 * spacing scale (`lg` = 24px / `md` = 16px / `none` = 0). Any raw-value
 * emphasis span (e.g. the DS `GradientText` component) composes as a child,
 * same as before.
 */
export function HeroHeading({
  as: As = "h1",
  spacing = "lg",
  className,
  style,
  children,
  ...rest
}) {
  const classes = ["ds-hero-heading", className].filter(Boolean).join(" ");

  return (
    <>
      <style>{RESPONSIVE_CSS}</style>
      <As
        className={classes}
        style={{
          fontFamily: "var(--role-marketing-hero-font)",
          fontWeight: "var(--role-marketing-hero-weight)",
          lineHeight: "var(--role-marketing-hero-leading)",
          color: "var(--primary-foreground)",
          marginBlockEnd: SPACING_BOTTOM[spacing] ?? SPACING_BOTTOM.lg,
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
