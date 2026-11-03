import React from "react";

// ds-fp:ab500c7cd0b5 — extracted per issue #958. The marketing site's
// light-gradient-hero <h1> — `text-4xl sm:text-5xl font-bold text-gray-900
// mb-6` — recurred verbatim across BlogPage, ContactPage and SolutionsPage.
// One primitive, tokens only: responsive size via
// --role-page-hero-title-size(-lg), weight via --weight-bold, color via
// --text-primary (the DS's standard on-light reading-text color — these
// hero sections sit on a light gradient, unlike the dark-gradient hero
// sections that use the separate on-dark-white HeroHeading primitive).

// One injected <style> block per instance for the size breakpoint — same
// pattern Container uses for its responsive gutter, since a media query
// can't be expressed as an inline style. Browsers dedupe identical <style>
// content trivially.
const RESPONSIVE_CSS = `
  .ds-page-hero-title {
    font-size: var(--role-page-hero-title-size);
  }
  @media (min-width: 640px) {
    .ds-page-hero-title { font-size: var(--role-page-hero-title-size-lg); }
  }
`;

/**
 * PageHeroTitle — the big, bold page-title <h1> at the top of a
 * marketing-site hero section that sits on a light gradient background
 * (e.g. Blog, Contact, Solutions). Tokens-only: DS sans font, bold weight,
 * standard primary text color, and the responsive text-4xl/5xl size step.
 * Any raw-value emphasis span (e.g. a gradient-highlighted word) composes
 * as a child, same as before.
 */
export function PageHeroTitle({ as: As = "h1", className, style, children, ...rest }) {
  const classes = ["ds-page-hero-title", className].filter(Boolean).join(" ");

  return (
    <>
      <style>{RESPONSIVE_CSS}</style>
      <As
        className={classes}
        style={{
          fontFamily: "var(--role-page-hero-title-font)",
          fontWeight: "var(--role-page-hero-title-weight)",
          lineHeight: "var(--role-page-hero-title-leading)",
          color: "var(--text-primary)",
          marginBlockEnd: "var(--space-6)",
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
