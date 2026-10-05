import * as React from "react";
import { TextProps } from "./Text";

/**
 * A small bold subsection heading inside a block of body copy (e.g. a
 * numbered legal-document subsection). Composes `Text` and adds the DS
 * `--weight-semibold` font weight plus a `space` prop for the top-margin
 * gap before a subheading that follows a preceding paragraph.
 */
export interface SubHeadingProps extends Omit<TextProps, "size"> {
  /** Rendered element. @default "h3" */
  as?: "h3" | "h4" | "p" | "div";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Top-margin gap before the subheading, from the DS spacing scale — used
   * when it follows a preceding paragraph within the same section.
   * @default "none"
   */
  space?: "none" | "md" | "lg";
  /**
   * Bottom-margin gap before the subheading's own body copy, from the DS
   * spacing scale.
   * @default "sm"
   */
  spacing?: "none" | "sm";
  children?: React.ReactNode;
}

export function SubHeading(props: SubHeadingProps): React.JSX.Element;
