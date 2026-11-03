import * as React from "react";

/**
 * The soft, blurred background "glow orb" used for marketing/hero
 * backdrops and empty-state decoration. Purely decorative — renders
 * `pointer-events: none` and `aria-hidden` by default.
 */
export interface AmbientGlowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which brand token paints the glow. `primary` -> `--accent-color` (indigo), `accent` -> `--accent-2` (cyan). */
  tone?: "primary" | "accent";
  /** Square side length in px, used when `width`/`height` are not given. */
  size?: number;
  /** Width in px — overrides `size` for a non-square glow. */
  width?: number;
  /** Height in px — overrides `size` for a non-square glow. */
  height?: number;
  /** Gaussian blur radius in px. */
  blur?: number;
  /** Fill opacity, 0–1. */
  opacity?: number;
}

export function AmbientGlow(props: AmbientGlowProps): React.JSX.Element;
