import { CSSProperties, HTMLAttributes, JSX } from "react";

/**
 * Absolutely-positioned dot-grid texture overlay for hero/band sections.
 * Decorative only — renders `aria-hidden` and `pointer-events: none`.
 * Place it as the first child of a `position: relative` section.
 */
export interface HeroPatternOverlayProps extends HTMLAttributes<HTMLDivElement> {
  /** Overall opacity, 0–1 — dial the texture up/down per section. Defaults to 0.1. */
  opacity?: number;
  style?: CSSProperties;
}

export declare function HeroPatternOverlay(props: HeroPatternOverlayProps): JSX.Element;
