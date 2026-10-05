import * as React from "react";

/**
 * Inline (or block) text painted with a brand gradient via
 * `background-clip: text`.
 */
export interface GradientTextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "span" */
  as?: "span" | "div" | "h1" | "h2" | "h3" | "p";
  /**
   * CSS `<gradient>` value (or `var(--custom-gradient)` reference) painted
   * across the text. Defaults to the DS "fuse seam" token.
   * @default "var(--seam)"
   */
  gradient?: string;
  children?: React.ReactNode;
}

export function GradientText(props: GradientTextProps): React.JSX.Element;
