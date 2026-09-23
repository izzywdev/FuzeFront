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
  children?: React.ReactNode;
}

export function Text(props: TextProps): React.JSX.Element;
