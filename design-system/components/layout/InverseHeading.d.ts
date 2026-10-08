import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export type InverseHeadingSize = "md" | "lg";
export type InverseHeadingSpacing = "none" | "sm" | "md";

export interface InverseHeadingProps {
  /** Element to render as (h1/h2/h3 — pick the right heading level). Default "h2". */
  as?: ElementType;
  /** Step of the DS type scale for the mobile -> sm(640px) responsive jump. Default "lg". */
  size?: InverseHeadingSize;
  /** Bottom margin, from the DS spacing scale (mb-4 equivalent). Default "md". */
  spacing?: InverseHeadingSpacing;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function InverseHeading(props: InverseHeadingProps): JSX.Element;
