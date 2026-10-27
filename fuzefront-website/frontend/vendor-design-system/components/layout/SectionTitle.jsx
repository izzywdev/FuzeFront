import React from "react";

// One injected <style> block per instance, scoped to a stable class — same
// pattern Container uses for its responsive gutter. The two-step size (base
// below 640px, --role-section-title-size-sm at/above it) mirrors the
// Tailwind `text-3xl sm:text-4xl` breakpoint pair this component replaces,
// using DS type-scale tokens instead of raw Tailwind size utilities.
const SIZE_CSS = `
  .ds-section-title {
    font-size: var(--role-section-title-size);
  }
  @media (min-width: 640px) {
    .ds-section-title { font-size: var(--role-section-title-size-sm); }
  }
`;

// `space` maps to the DS spacing scale for the bottom margin — replaces the
// recurring ad-hoc `mb-3` / `mb-4` utility seen at the call sites.
const SPACE_BOTTOM = {
  sm: "var(--space-3)",
  md: "var(--space-4)",
};

/**
 * SectionTitle — the bold, centered heading that opens a marketing-page
 * section ("Leadership", "What we offer", "Ready to build on FuzeOne?").
 * Replaces the recurring ad-hoc
 * `className="text-3xl sm:text-4xl font-heading font-bold text-gray-900
 * mb-{3,4}"` duplicated across AboutPage, CareersPage, HomePage,
 * PrivacyPolicyPage and TermsPage (ds-fp:ec2a9976a21d).
 *
 * `as` picks the heading level (`h2`, default, for an in-page section;
 * `h1` for a page's own title, e.g. a legal page). `align` defaults to
 * `center` — every call site renders this heading centered — with `left`
 * available for a non-centered page title. `space` picks the bottom-margin
 * step (`md` = `mb-4`, default; `sm` = `mb-3`, the legal-page variant).
 */
export function SectionTitle({
  as: As = "h2",
  align = "center",
  space = "md",
  className,
  style,
  children,
  ...rest
}) {
  const classes = ["ds-section-title", className].filter(Boolean).join(" ");

  return (
    <>
      <style>{SIZE_CSS}</style>
      <As
        className={classes}
        style={{
          margin: 0,
          fontFamily: "var(--role-section-title-font)",
          fontWeight: "var(--role-section-title-weight)",
          lineHeight: "var(--role-section-title-leading)",
          letterSpacing: "var(--tracking-display)",
          color: "var(--text-primary)",
          textAlign: align,
          marginBlockEnd: SPACE_BOTTOM[space] ?? SPACE_BOTTOM.md,
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
