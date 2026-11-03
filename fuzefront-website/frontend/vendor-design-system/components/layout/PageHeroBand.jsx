import React, { forwardRef } from "react";

// ds-fp:513605701058 — extracted per issue #976. The dark two-stop diagonal
// gradient hero wrapper (secondary-900 -> secondary-800, fixed pt-28 rhythm,
// `relative overflow-hidden` so the hero-pattern overlay + decorative
// content inside it can be absolutely positioned) was hand-duplicated,
// byte-for-byte apart from the bottom padding, across IndustriesPage,
// PricingPage and ProductsPage.
//
// Deliberately narrow: this owns only the flagged outer-wrapper className,
// not the inner <Container>/hero-pattern overlay/heading markup each call
// site still renders as children — those are separate, already-tracked
// extractions (ds-fp:4cb066daa4ea / Container, the hero-pattern overlay)
// and folding them in here would blur this fix's scope and collide with
// that in-flight work.
//
// Hex constants (not yet in design-system/tokens/colors.css) mirror the
// Tailwind `secondary` scale fuzefront-website's tailwind.config.js
// defines (900/800) — the DS package is the one place these "tokens only"
// raw values are allowed to live (design-system-conformance skill).
const GRADIENT_FROM = "#0f172a"; // secondary-900
const GRADIENT_TO = "#1e293b"; // secondary-800

const PADDING_BOTTOM = {
  default: "var(--space-20)", // pb-20 (80px) — Industries, Products
  compact: "var(--space-16)", // pb-16 (64px) — Pricing
};

/**
 * PageHeroBand — the dark secondary-900 -> secondary-800 diagonal-gradient
 * hero wrapper used at the top of marketing sub-pages (as opposed to
 * HomePage's full-bleed three-stop hero). Fixed `pt-28` top padding;
 * `spacing` picks the bottom padding that varied across call sites.
 * `relative overflow-hidden` so children (the hero-pattern dot overlay,
 * blurred decor, the heading `Container`) can be absolutely positioned
 * against it exactly as before.
 *
 * Forwards `ref` so callers can still wire it into `useInView`/`useRef`
 * for their own enter-animation, as every call site already did with a
 * plain `<section ref={...}>`.
 *
 * Polymorphic via `as` (default `"section"`). `gradient` overrides the two
 * gradient stops for a page that wants the same shape with a different
 * tone. No start/end direction in the diagonal gradient keyword itself
 * (`to bottom right`) needs flipping under RTL; background-image is not a
 * directional box property.
 */
export const PageHeroBand = forwardRef(function PageHeroBand(
  {
    as: As = "section",
    spacing = "default",
    gradient,
    className,
    style,
    children,
    ...rest
  },
  ref
) {
  const from = gradient?.from ?? GRADIENT_FROM;
  const to = gradient?.to ?? GRADIENT_TO;

  return (
    <As
      ref={ref}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        paddingTop: "var(--space-28)",
        paddingBottom: PADDING_BOTTOM[spacing] || PADDING_BOTTOM.default,
        backgroundImage: `linear-gradient(to bottom right, ${from}, ${to})`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
});

PageHeroBand.displayName = "PageHeroBand";
