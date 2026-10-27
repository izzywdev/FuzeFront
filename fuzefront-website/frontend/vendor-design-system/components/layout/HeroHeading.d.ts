import * as React from "react";

/**
 * The big, bold <h1> page title in a marketing-site hero section (dark
 * gradient background). Tokens-only: responsive size, extrabold weight, and
 * the DS's fixed on-dark white text color.
 */
export interface HeroHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Rendered element. @default "h1" */
  as?: "h1" | "h2";
  /**
   * Step of the DS spacing scale applied as `margin-block-end` (a logical
   * property, so it mirrors under RTL). `lg` = 24px (`--space-6`), `md` =
   * 16px (`--space-4`), `none` = 0.
   * @default "lg"
   */
  spacing?: "none" | "md" | "lg";
  children?: React.ReactNode;
}

export function HeroHeading(props: HeroHeadingProps): React.JSX.Element;
