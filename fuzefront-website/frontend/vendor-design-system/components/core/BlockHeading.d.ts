import * as React from "react";
import { TextProps } from "./Text";

/**
 * A bold sub-heading that introduces a block of content — a placeholder
 * section's title or a grid-card's title. Composes `Text` and adds the DS
 * `--text-2xl` size, `--weight-bold` weight, and a `space` prop for the
 * bottom-margin gap.
 */
export interface BlockHeadingProps
  extends Omit<TextProps, "as" | "tone" | "size" | "spacing"> {
  /**
   * Heading element to render. @default "h2"
   */
  as?: "h1" | "h2" | "h3" | "h4";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Bottom-margin step, from the DS spacing scale (`margin-block-end`).
   * `md` (default) is `--space-4`, matching the extracted `mb-4`; `sm` is
   * `--space-2`.
   * @default "md"
   */
  space?: "none" | "sm" | "md";
  children?: React.ReactNode;
}

export function BlockHeading(props: BlockHeadingProps): React.JSX.Element;
