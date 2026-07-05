import * as React from "react";

/**
 * Small round runtime-health indicator for launcher app icons —
 * green when the remote is reachable, coral when it's offline.
 */
export interface HealthDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `true` = green/healthy, `false` = coral/offline. Defaults to `true`. */
  healthy?: boolean;
  /** Dot diameter preset. */
  size?: "sm" | "md" | "lg";
  /** Accessible label / tooltip; sensible health-aware default is supplied. */
  label?: string;
  /** Absolutely position the dot at the bottom-right corner of a relative parent (e.g. overlapping an app icon). */
  overlay?: boolean;
}

export function HealthDot(props: HealthDotProps): JSX.Element;
