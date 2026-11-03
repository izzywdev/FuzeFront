import * as React from "react";

/**
 * Plain text with a semantic color tone from the DS text-color scale.
 */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: "p" | "span" | "div" | "label" | "h1" | "h2" | "h3" | "h4";
  /**
   * Semantic tone: `primary` = default reading text, `secondary` =
   * de-emphasized supporting copy, `muted` = lowest-emphasis placeholder /
   * empty-state copy, `danger` = inline error copy.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Step of the DS type scale. `inherit` (default) reads the surrounding
   * layout's font size, unchanged from before `size` existed. `lg` is the
   * step `CardTitle` builds on; `2xl` the step `BlockHeading` builds on.
   * @default "inherit"
   */
  size?: "inherit" | "xs" | "sm" | "base" | "md" | "lg" | "2xl";
  /**
   * Step of the DS spacing scale applied as `margin-block-end` (a logical
   * property, so it mirrors under RTL). `none` (default) keeps the original
   * zero-margin behavior. `lg`/`xl` cover the wider `mb-6`/`mb-8` gap used
   * under a centered CTA/section heading.
   * @default "none"
   */
  spacing?: "none" | "sm" | "md" | "lg" | "xl";
  /**
   * Step of the DS line-height scale. `inherit` (default) reads the
   * surrounding layout's line-height, unchanged from before `leading`
   * existed. `relaxed` covers the recurring card/feature-description
   * paragraph pattern (pairs with `tone="secondary"` `size="sm"`).
   * @default "inherit"
   */
  leading?: "inherit" | "tight" | "snug" | "normal" | "relaxed";
  /**
   * Step of the DS font-weight scale. `inherit` (default) applies no inline
   * override, unchanged from before `weight` existed (the surrounding
   * stylesheet's weight, e.g. Tailwind preflight's heading reset, applies).
   * @default "inherit"
   */
  weight?: "inherit" | "regular" | "medium" | "semibold" | "bold";
  /**
   * Step of the DS spacing scale (same scale as `spacing`) applied as
   * `margin-block-start` — the logical-property counterpart to `spacing`, so
   * it also mirrors under RTL. `none` (default) applies no top margin.
   * @default "none"
   */
  spacingTop?: "none" | "sm" | "md" | "lg" | "xl";
  children?: React.ReactNode;
}

export function Text(props: TextProps): React.JSX.Element;
