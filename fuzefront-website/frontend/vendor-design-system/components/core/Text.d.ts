import * as React from "react";

/**
 * Plain text with a semantic color tone from the DS text-color scale.
 */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: "p" | "span" | "div" | "label";
  /**
   * Semantic tone: `primary` = default reading text, `secondary` =
   * de-emphasized supporting copy, `muted` = lowest-emphasis placeholder /
   * empty-state copy, `danger` = inline error copy.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Step of the DS type scale. `inherit` (default) reads the surrounding
   * layout's font size, unchanged from before `size` existed.
   * @default "inherit"
   */
  size?: "inherit" | "xs" | "sm" | "base" | "md";
  /**
   * Step of the DS spacing scale applied as `margin-block-end` (a logical
   * property, so it mirrors under RTL). `none` (default) keeps the original
   * zero-margin behavior.
   * @default "none"
   */
  spacing?: "none" | "sm" | "md";
  children?: React.ReactNode;
}

export function Text(props: TextProps): React.JSX.Element;
