import * as React from "react";
import { TextProps } from "./Text";

/**
 * A bold `--text-xl` heading that titles a card or opens a numbered
 * legal-document section. Composes `Text` and adds the DS `--text-xl` size,
 * `--weight-bold` weight, and a `space` prop for the bottom-margin gap.
 */
export interface SubheadingProps extends Omit<TextProps, "tone" | "size"> {
  /** Rendered element. @default "h2" */
  as?: "h2" | "h3" | "h4";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Bottom-margin gap, from the DS spacing scale.
   * @default "md"
   */
  space?: "xs" | "sm" | "md";
  children?: React.ReactNode;
}

export function Subheading(props: SubheadingProps): React.JSX.Element;
