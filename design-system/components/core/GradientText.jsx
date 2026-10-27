import React from "react";

/**
 * Inline (or block) text painted with a brand gradient via
 * `background-clip: text` — replaces the recurring ad-hoc
 * `className="gradient-text"` pattern duplicated across marketing/landing
 * copy for the one emphasized word or phrase in a heading
 * (ds-fp:22df75e86c00).
 *
 * Defaults to the DS "fuse seam" gradient token (`--seam`, indigo -> cyan).
 * A consumer with its own brand gradient (e.g. a marketing site using a
 * different accent) overrides it with the `gradient` prop — a CSS
 * `<gradient>` value or `var(--custom-gradient)` reference — rather than
 * forking the component or reaching for a raw utility class.
 *
 * `as` picks the rendered element (`span` default, for inline use inside a
 * heading; `div` for a standalone display number/heading).
 */
export function GradientText({
  as: As = "span",
  gradient = "var(--seam)",
  className,
  style,
  children,
  ...rest
}) {
  return (
    <As
      className={className}
      style={{
        backgroundImage: gradient,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
