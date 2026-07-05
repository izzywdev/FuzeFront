import * as React from "react";

/**
 * The signature glowing "fuse seam" — a thin gradient bar (indigo -> cyan)
 * that marks where remote modules fuse into the shell at runtime.
 */
export interface SeamDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Axis the seam runs along. `horizontal` spans full width; `vertical` spans full height. */
  orientation?: "horizontal" | "vertical";
  /** Bar thickness in px (the cross-axis dimension). */
  thickness?: number;
  /** Overall opacity, 0–1 — dial the seam down to a quiet hairline. */
  opacity?: number;
  /** Add a soft tinted halo so the seam reads as a glowing light source. */
  glow?: boolean;
}

export function SeamDivider(props: SeamDividerProps): JSX.Element;
