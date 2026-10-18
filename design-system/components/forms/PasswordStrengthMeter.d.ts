import * as React from "react";
import type { PasswordRule } from "./PasswordChecklist";

export type PasswordStrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

/** 0 (empty) .. 4 (strong): share of policy rules the value meets. */
export declare function passwordStrength(value: string, rules?: PasswordRule[]): 0 | 1 | 2 | 3 | 4;

export interface PasswordStrengthMeterProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The password being measured. */
  value?: string;
  /** Policy rules; defaults to the same rules as `PasswordChecklist`. */
  rules?: PasswordRule[];
  /** Visible text per level (pass translated strings). */
  labels?: Record<PasswordStrengthLevel, string>;
  /** Accessible name of the meter. */
  label?: string;
}

/** Segmented strength bar; exposes `data-meter="<level>"` and `role="meter"`. */
export function PasswordStrengthMeter(props: PasswordStrengthMeterProps): React.JSX.Element;

export namespace PasswordStrengthMeter {
  /** 0 (empty) .. 4 (strong). */
  function strength(value: string, rules?: PasswordRule[]): 0 | 1 | 2 | 3 | 4;
}
