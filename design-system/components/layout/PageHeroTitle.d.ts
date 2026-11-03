import * as React from "react";

/**
 * The big, bold <h1> page title in a marketing-site hero section that sits
 * on a light gradient background. Tokens-only: responsive size, bold
 * weight, and the DS's standard on-light primary text color.
 */
export interface PageHeroTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Rendered element. @default "h1" */
  as?: "h1" | "h2";
  children?: React.ReactNode;
}

export function PageHeroTitle(props: PageHeroTitleProps): React.JSX.Element;
