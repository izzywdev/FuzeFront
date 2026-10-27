import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export type HeroBandPadding = "sm" | "md" | "lg";

export interface HeroBandProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Vertical padding, from the DS --space-* scale. Default "lg" (--space-24). */
  padding?: HeroBandPadding;
  /** Gradient start color (CSS color value). Overrides --hero-band-from. */
  from?: string;
  /** Gradient end color (CSS color value). Overrides --hero-band-to. */
  to?: string;
  /** Gradient direction (CSS `linear-gradient` direction/angle). Overrides --hero-band-angle. */
  angle?: string;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function HeroBand(props: HeroBandProps): JSX.Element;
