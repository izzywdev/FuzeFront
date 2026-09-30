import * as React from "react";
import { TextProps } from "./Text";

/**
 * A small supporting text line below other content (status line, notification
 * message, CTA footnote). Composes `Text` and adds the DS `--text-sm` size
 * plus a `space` prop for the top-margin gap.
 */
export interface CaptionProps extends Omit<TextProps, "tone"> {
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "secondary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Top-margin gap, from the DS spacing scale.
   * @default "sm"
   */
  space?: "none" | "xs" | "sm" | "md" | "lg";
  children?: React.ReactNode;
}

export function Caption(props: CaptionProps): React.JSX.Element;
