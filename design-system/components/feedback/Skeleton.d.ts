import * as React from "react";

/**
 * Loading-placeholder block with the shared skeleton shimmer. Decorative
 * (`aria-hidden`); label the surrounding region as busy/loading instead.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** CSS width. Default `"100%"`. */
  width?: string | number;
  /** CSS height. Default a token (`var(--space-4)`). */
  height?: string | number;
  /** Border radius. Default `var(--radius-sm)`. */
  radius?: string | number;
}

export function Skeleton(props: SkeletonProps): JSX.Element;
