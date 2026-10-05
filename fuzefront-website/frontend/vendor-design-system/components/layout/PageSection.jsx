import React from "react";

const SPACING_VAR = {
  sm: "var(--space-16)", // 64px — py-16
  md: "var(--space-20)", // 80px — py-20
  lg: "var(--space-24)", // 96px — py-24
};

const BACKGROUND_VAR = {
  white: "var(--paper)",
  muted: "var(--paper-tint)",
  transparent: "transparent",
};

/**
 * PageSection — replaces the `py-{16,20,24} bg-white` block-level section
 * wrapper duplicated across the marketing site's page components
 * (ds-fp:aa5da004089e). A plain, full-bleed content section: vertical
 * rhythm from the DS spacing scale, background from the DS surface tokens
 * — never a raw Tailwind `py-*`/`bg-white` pair in feature code.
 *
 * `spacing` picks the block padding (top + bottom) from the --space-16/20/24
 * tokens — the three magnitudes seen across call sites (tokens only, never a
 * raw px/rem value). `background` picks a DS surface token; `white`
 * (var(--paper)) matches every call site this component replaces today.
 * Applied via the logical `paddingBlock` property so it mirrors automatically
 * under RTL, matching Container's convention.
 */
export function PageSection({
  as: Component = "section",
  spacing = "lg",
  background = "white",
  className,
  style,
  children,
  ...rest
}) {
  const paddingBlock = SPACING_VAR[spacing] ?? SPACING_VAR.lg;
  const backgroundColor = BACKGROUND_VAR[background] ?? BACKGROUND_VAR.white;

  return (
    <Component
      className={className}
      style={{
        paddingBlock,
        backgroundColor,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}
