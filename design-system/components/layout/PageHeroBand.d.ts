import { CSSProperties, ElementType, JSX, ReactNode, Ref } from "react";

export type PageHeroBandSpacing = "default" | "compact";

export interface PageHeroBandGradient {
  from: string;
  to: string;
}

export interface PageHeroBandProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Bottom padding: "default" (--space-20, 80px) or "compact" (--space-16, 64px). Top padding is always --space-28 (112px). */
  spacing?: PageHeroBandSpacing;
  /** Override the two diagonal gradient stops. Defaults to the secondary-900 -> secondary-800 brand tone. */
  gradient?: PageHeroBandGradient;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function PageHeroBand(props: PageHeroBandProps): JSX.Element;
