import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export interface StackProps {
  children?: ReactNode;
  /** Vertical gap between children, from the spacing token scale. Default `md` (16px). */
  gap?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Rendered element/tag (e.g. `section`, `ul`, `nav`). Default `div`. */
  as?: ElementType;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Stack(props: StackProps): JSX.Element;
