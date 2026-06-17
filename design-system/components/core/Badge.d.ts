import * as React from "react";

/**
 * Small pill label — the accent "fuse" tone or the cool status set, set as
 * a colored label on a faint wash of the same hue. Use `mono` for technical
 * values (app types, scopes, role keys).
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color intent. `accent` is the fuse indigo; status tones use their color on a faint surface. */
  tone?: "neutral" | "accent" | "success" | "warning" | "error";
  size?: "sm" | "md";
  /** Switch to JetBrains Mono (and drop uppercasing) for technical values like `react`, `read:apps`. */
  mono?: boolean;
  /** Prepend a small status dot in the tone color. */
  dot?: boolean;
}

export function Badge(props: BadgeProps): JSX.Element;
