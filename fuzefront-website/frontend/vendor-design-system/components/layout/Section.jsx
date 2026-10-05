import React, { forwardRef } from "react";

const SPACING_CLASS = {
  xs: "py-12",
  sm: "py-16",
  md: "py-20",
  lg: "py-24",
};

const TONE_CLASS = {
  base: "bg-white",
  muted: "bg-secondary-50",
  inverse: "bg-secondary-900",
  inverseMuted: "bg-secondary-800",
};

// Border color pairs with tone: a light band borders with the next step up
// its own scale, a dark band borders with secondary-800 either way, mirroring
// the two border colors actually used across the marketing site's bands.
const BORDER_TONE_CLASS = {
  base: "border-secondary-100",
  muted: "border-secondary-100",
  inverse: "border-secondary-800",
  inverseMuted: "border-secondary-800",
};

const BORDER_SIDE_CLASS = {
  none: "",
  top: "border-t",
  y: "border-y",
};

/**
 * Section — replaces the recurring `<section className="py-{N} bg-secondary-{N2} ...">`
 * band wrapper duplicated across the marketing-site pages (ds-fp:dd6f4ff29f37):
 * a full-bleed content band with a flat tone background and a vertical-rhythm
 * padding, used to zebra-stripe long scrolling pages (About, Careers, Home,
 * Industries, Press, Pricing, Products, ProductDetail, FuzeHub).
 *
 * `tone` picks the flat background from the site's token scale (never a raw
 * hex) — `base` (white), `muted` (secondary-50, the light alternate band),
 * `inverse` (secondary-900, the dark-shell band), `inverseMuted`
 * (secondary-800, the lighter dark band next to an `inverse` one).
 * `spacing` picks vertical padding from the same xs/sm/md/lg scale the other
 * DS layout primitives (Stack, Wrap) use. `border` adds the tone-paired rule
 * seen at some of these call sites — `top` for a band that follows another,
 * `y` for a band sandwiched between two others (e.g. a stats strip).
 *
 * Deliberately NOT for hero/gradient sections (`overflow-hidden`, an
 * in-view-animation `ref`, `bg-gradient-to-br`) — those are a different,
 * asymmetric shape (`pt-*`/`pb-*` independently, a gradient fill) and out of
 * this fingerprint's scope. Accepts and forwards a `ref` itself, since one
 * flat band (FuzeHub's closing CTA) is still observed for in-view animation.
 */
export const Section = forwardRef(function Section(
  { as: Component = "section", tone = "muted", spacing = "lg", border = "none", className, children, ...rest },
  ref
) {
  const classes = [
    SPACING_CLASS[spacing] || SPACING_CLASS.lg,
    TONE_CLASS[tone] || TONE_CLASS.muted,
    border !== "none" && BORDER_SIDE_CLASS[border],
    border !== "none" && (BORDER_TONE_CLASS[tone] || BORDER_TONE_CLASS.muted),
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component ref={ref} className={classes} {...rest}>
      {children}
    </Component>
  );
});
