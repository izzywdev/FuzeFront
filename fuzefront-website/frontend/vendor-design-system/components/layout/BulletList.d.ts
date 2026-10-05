import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

export interface BulletListProps extends HTMLAttributes<HTMLElement> {
  /** Element to render as. Defaults to `ul` (disc marker); `ol` renders a decimal marker. */
  as?: "ul" | "ol";
  /** Gap between items, mapped to the DS spacing scale. Defaults to `sm` (--space-2, 8px). */
  gap?: "xs" | "sm" | "md" | "lg";
  /** Top margin separating the list from preceding content. Defaults to `none`. */
  space?: "none" | "sm" | "md";
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function BulletList(props: BulletListProps): JSX.Element;
