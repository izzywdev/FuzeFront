import React from "react";

// `space` maps to the DS spacing scale for the bottom margin — replaces the
// recurring ad-hoc `mb-4` utility seen at the call sites. Mirrors the step
// names `SectionTitle` uses for the same purpose.
const SPACE_BOTTOM = {
  none: "0",
  sm: "var(--space-2)",
  md: "var(--space-4)",
};

/**
 * CtaHeading — the bold, centered heading inside a page's closing
 * call-to-action band ("Don't see your industry?", "Not sure where to
 * start?"). Replaces the recurring ad-hoc `className="text-3xl
 * font-heading font-bold text-gray-900 mb-4"` duplicated across
 * `IndustriesPage` and `ProductsPage` (ds-fp:b97c04930c08).
 *
 * Same bold/centered `--font-display` heading family as `SectionTitle`,
 * but fixed at a single size — a CTA-band heading does not step up at the
 * `sm` breakpoint the way a full section opener does, so it reads from its
 * own `--role-cta-heading-*` tokens rather than `SectionTitle`'s responsive
 * pair. `as` picks the heading level (`h2`, default — every known call
 * site uses `h2`).
 */
export function CtaHeading({
  as: As = "h2",
  align = "center",
  space = "md",
  className,
  style,
  children,
  ...rest
}) {
  return (
    <As
      className={className}
      style={{
        margin: 0,
        fontFamily: "var(--role-cta-heading-font)",
        fontSize: "var(--role-cta-heading-size)",
        fontWeight: "var(--role-cta-heading-weight)",
        lineHeight: "var(--role-cta-heading-leading)",
        color: "var(--text-primary)",
        textAlign: align,
        marginBlockEnd: SPACE_BOTTOM[space] ?? SPACE_BOTTOM.md,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
