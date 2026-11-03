import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export interface HeroLeadProps {
  /** Element/component to render as. Default "p". */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

/**
 * Centered, responsive-size lead paragraph for a page hero on a dark
 * gradient surface — pins `data-theme="dark"` so its color token resolves
 * correctly independent of the ambient page theme. See HeroLead.jsx for the
 * full rationale (ds-fp:d4affa5c8b4a).
 */
export declare function HeroLead(props: HeroLeadProps): JSX.Element;
