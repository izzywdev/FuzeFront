import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

export interface ListStackProps extends HTMLAttributes<HTMLElement> {
  /** Element to render as. Defaults to `ul`. */
  as?: "ul" | "ol";
  /** Gap between items, mapped to the DS spacing scale. Defaults to `sm`. */
  gap?: "xs" | "sm" | "md" | "lg";
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function ListStack(props: ListStackProps): JSX.Element;
