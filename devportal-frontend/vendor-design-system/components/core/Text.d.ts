import * as React from "react";

/**
 * Plain text with a semantic color tone from the DS text-color scale.
 */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: "p" | "span" | "div" | "label" | "dt" | "dd";
  /**
   * Semantic tone: `primary` = default reading text, `secondary` =
   * de-emphasized supporting copy, `muted` = lowest-emphasis placeholder /
   * empty-state copy, `danger` = inline error copy.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * A step of the DS type scale (tokens/typography.css). Omit to inherit
   * font-size from the surrounding layout (the original default behavior).
   */
  size?: "2xs" | "xs" | "sm" | "base" | "md" | "lg" | "xl" | "2xl" | "3xl";
  children?: React.ReactNode;
}

export function Text(props: TextProps): React.JSX.Element;
