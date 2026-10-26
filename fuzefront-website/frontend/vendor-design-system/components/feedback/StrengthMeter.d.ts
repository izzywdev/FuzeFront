import * as React from "react";

export type StrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

/**
 * Segmented strength meter — bars lit to a level, tone-tinted, with a caption
 * row and an optional child slot (a requirements checklist).
 */
export interface StrengthMeterProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Level to render; `empty` lights no bars. Default `empty`. */
  strength?: StrengthLevel;
  /** Caption on the logical start of the caption row (e.g. "Password strength"). */
  label?: React.ReactNode;
  /** The level word on the logical end, tinted with the tone (e.g. "Strong"). */
  valueLabel?: React.ReactNode;
  /** Number of bars (default 4). */
  bars?: number;
  /** Rendered below the bars + caption (e.g. a `PasswordChecklist`). */
  children?: React.ReactNode;
}

export function StrengthMeter(props: StrengthMeterProps): React.JSX.Element;
