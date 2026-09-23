import React from "react";

const GAP = {
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-4)",
  lg: "var(--space-6)",
  xl: "var(--space-8)",
};

/**
 * Stack — the vertical-rhythm layout primitive. Replaces the recurring
 * Tailwind `space-y-*` wrapper div used across tab panels, settings sections
 * and demo blocks to lay out a run of children with consistent spacing.
 * A `flex-direction: column` + `gap` layout mirrors automatically under RTL
 * (no directional margin hacks), unlike `space-y-*`'s child-margin approach.
 */
export function Stack({ children, gap = "md", as: As = "div", style, ...rest }) {
  return (
    <As
      style={{
        display: "flex",
        flexDirection: "column",
        gap: GAP[gap] || GAP.md,
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
