import React from "react";

const TONE_VAR = {
  primary: "var(--accent-color)",
  accent: "var(--accent-2)",
};

/**
 * AmbientGlow — the soft, blurred background orb duplicated across the
 * marketing site's hero/section backdrops (ds-fp:2a3a14a7d524):
 * `absolute … w-80 h-80 bg-primary-600/20 rounded-full blur-3xl
 * pointer-events-none`, repeated (with only size/opacity/position varying)
 * across AboutPage, CareersPage, HomePage, PressPage, FuzeHubPage and
 * NotFoundPage. Paints the glow from the DS's brand tokens
 * (`--accent-color` / `--accent-2`) instead of a raw hex or a
 * site-local Tailwind color scale, so every page's ambient backdrop
 * tracks the active theme (dark/light) automatically.
 *
 * Purely decorative: `pointer-events: none` and `aria-hidden` by default,
 * so it never intercepts input or gets announced to assistive tech.
 * Position it with `style` (top/left/right/bottom/transform) — the
 * nearest positioned ancestor (`position: relative` or similar) is what
 * it anchors inside of; this component only owns the glow itself, not
 * page-specific placement.
 */
export function AmbientGlow({
  tone = "primary",
  size = 320,
  width,
  height,
  blur = 64,
  opacity = 0.2,
  className,
  style,
  "aria-hidden": ariaHidden = true,
  ...rest
}) {
  const color = TONE_VAR[tone] ?? TONE_VAR.primary;

  return (
    <div
      aria-hidden={ariaHidden}
      className={className}
      style={{
        position: "absolute",
        width: width ?? size,
        height: height ?? size,
        borderRadius: "var(--radius-pill, 9999px)",
        background: color,
        opacity,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
        ...style,
      }}
      {...rest}
    />
  );
}
