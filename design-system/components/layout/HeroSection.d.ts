import { CSSProperties, ElementType, JSX, ReactNode, Ref } from "react";
import { ContainerSize } from "./Container";

export type HeroBlobCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type HeroBlobTone = "primary" | "accent";
export type HeroBlobSize = "md" | "lg";

export interface HeroBlobSpec {
  /** Which corner the blurred blob is pinned to. Default "top-left". */
  corner?: HeroBlobCorner;
  /** Tint. Default "primary". */
  tone?: HeroBlobTone;
  /** Diameter. Default "lg" (320px); "md" is 288px. */
  size?: HeroBlobSize;
}

export interface HeroGradientStops {
  from: string;
  via: string;
  to: string;
}

export interface HeroSectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  children?: ReactNode;
  /** `Container` width for the hero content. Default "4xl". */
  containerSize?: ContainerSize;
  /** Text alignment of the inner Container. Default "center". */
  align?: CSSProperties["textAlign"];
  /** 0–2 blurred decorative blobs, pinned to a corner. Default none. */
  decor?: HeroBlobSpec[];
  /** Render the dot-grid overlay. Default true. */
  pattern?: boolean;
  /** Override the three diagonal gradient stops. Defaults to the brand slate→indigo hero gradient. */
  gradient?: HeroGradientStops;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function HeroSection(props: HeroSectionProps): JSX.Element;
