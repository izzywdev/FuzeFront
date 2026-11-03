import { CSSProperties, ElementType, JSX, ReactNode } from "react";
import { ContainerSize } from "./Container";

export interface HeroContentProps {
  /** Element/component to render as. Passed straight through to Container. Default "div". */
  as?: ElementType;
  /** Max-width, from the DS --container-* scale. Passed straight through to Container. Default "7xl". */
  size?: ContainerSize;
  /** Apply the responsive horizontal gutter. Passed straight through to Container. Default true. */
  gutter?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

/**
 * Hero content wrapper — Container + `position: relative` (to stack above
 * absolutely-positioned hero decoration) + `text-align: center`.
 */
export declare function HeroContent(props: HeroContentProps): JSX.Element;
