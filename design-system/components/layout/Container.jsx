import React from "react";

const WIDTH_VAR = {
  "2xl": "var(--container-2xl)",
  "3xl": "var(--container-3xl)",
  "4xl": "var(--container-4xl)",
  "5xl": "var(--container-5xl)",
  "6xl": "var(--container-6xl)",
  "7xl": "var(--container-7xl)",
  full: "none",
};

// One injected <style> block for every instance, scoped to a stable class —
// same pattern as Spinner's keyframes. Cheap to re-inject; browsers dedupe
// identical <style> content trivially and this file has no CSS bundle of
// its own to append rules to.
const GUTTER_CSS = `
  .ds-container--gutter {
    padding-inline: var(--space-4);
  }
  @media (min-width: 640px) {
    .ds-container--gutter { padding-inline: var(--space-6); }
  }
  @media (min-width: 1024px) {
    .ds-container--gutter { padding-inline: var(--space-8); }
  }
`;

/**
 * Container — replaces the `max-w-{N} mx-auto px-4 sm:px-6 lg:px-8` block
 * duplicated across every marketing-site page and the site Header
 * (ds-fp:4cb066daa4ea). Centers content at one of the standard
 * page-content widths and applies the responsive horizontal gutter
 * (16px / 24px / 32px via --space-4/6/8) via CSS logical properties, so it
 * mirrors automatically under RTL.
 *
 * `size` picks the max-width from the DS's --container-* scale (tokens
 * only — never pass a raw px/rem maxWidth). `full` removes the width cap
 * but keeps the responsive gutter and centering, for edge-to-edge sections
 * that still want the shared padding rhythm.
 */
export function Container({
  as: Component = "div",
  size = "7xl",
  gutter = true,
  className,
  style,
  children,
  ...rest
}) {
  const maxWidth = WIDTH_VAR[size] ?? WIDTH_VAR["7xl"];
  const classes = ["ds-container", gutter && "ds-container--gutter", className]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {gutter && <style>{GUTTER_CSS}</style>}
      <Component
        className={classes}
        style={{
          maxWidth,
          marginInline: "auto",
          width: "100%",
          boxSizing: "border-box",
          ...style,
        }}
        {...rest}
      >
        {children}
      </Component>
    </>
  );
}
