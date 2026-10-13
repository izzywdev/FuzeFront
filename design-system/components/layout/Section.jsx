import React from "react";

const PADDING = {
  sm: "var(--space-16)", /* 64px — replaces py-16 */
  md: "var(--space-20)", /* 80px — replaces py-20 */
  lg: "var(--space-24)", /* 96px — replaces py-24 */
};

const BACKGROUND = {
  surface: "var(--bg-tertiary)",   /* white in light theme */
  muted: "var(--bg-primary)",      /* tinted canvas in light theme */
  transparent: undefined,
};

/**
 * Full-bleed page section — replaces the recurring
 * `py-{16,20,24} bg-white border-t border-secondary-100` className block
 * duplicated across marketing pages (ds-fp:1b68ad502744). Renders a plain
 * `<section>` (or another element via `as`) with a token-driven vertical
 * rhythm, background tone, and optional top divider; a `Container` (or any
 * other wrapper) goes inside for horizontal centering/width.
 */
export function Section({
  as: Component = "section",
  tone = "surface",
  padding = "lg",
  divider = false,
  className,
  style,
  children,
  ...rest
}) {
  return (
    <Component
      className={className}
      style={{
        paddingBlock: PADDING[padding] || PADDING.lg,
        background: BACKGROUND[tone],
        borderBlockStart: divider ? "var(--border-width) solid var(--border-color)" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}
