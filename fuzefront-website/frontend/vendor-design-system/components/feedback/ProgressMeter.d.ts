import * as React from "react";

export type ProgressMeterTone = "seam" | "warning" | "danger";

/**
 * Horizontal progress / usage meter — labelled track + fill keyed to a
 * fraction of a limit. Used for usage-based billing (seats, metered units)
 * and quota displays.
 */
export interface ProgressMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  tone?: ProgressMeterTone;
  /**
   * ARIA role of the track. `progressbar` (default) for task progress; `meter`
   * for a scalar gauge within a known range (quota used / limit).
   */
  role?: "progressbar" | "meter";
}

export function ProgressMeter(props: ProgressMeterProps): React.JSX.Element;
