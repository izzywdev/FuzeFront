import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export type ContainerSize = "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";

export interface ContainerProps {
  /** Element/component to render as. Default "div". */
  as?: ElementType;
  /** Max-width, from the DS --container-* scale. Default "7xl". */
  size?: ContainerSize;
  /** Apply the responsive horizontal gutter (px-4/6/8 equivalent). Default true. */
  gutter?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Container(props: ContainerProps): JSX.Element;
