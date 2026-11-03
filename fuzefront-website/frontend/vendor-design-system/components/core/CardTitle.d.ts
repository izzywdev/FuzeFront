import * as React from "react";
import { TextProps } from "./Text";

/**
 * The small semibold heading atop a content card — a feature card's title, a
 * value-prop card's heading, a press-release card's headline. Composes `Text`
 * (`size="lg"`, `tone="primary"`, `spacing="sm"`) and adds the DS
 * `--weight-semibold` weight.
 */
export interface CardTitleProps
  extends Omit<TextProps, "as" | "size" | "weight"> {
  /**
   * Heading element to render. @default "h3"
   */
  as?: "h1" | "h2" | "h3" | "h4";
  children?: React.ReactNode;
}

export function CardTitle(props: CardTitleProps): React.JSX.Element;
