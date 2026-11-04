import * as React from "react";

/**
 * Segmented one-time-code input (one cell per digit). Paste-aware, auto-advance,
 * arrow/backspace navigation, `autocomplete="one-time-code"`. Digits always
 * render left-to-right, even in an RTL page.
 */
export interface OtpInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  /** Number of cells. Default 6. */
  length?: number;
  /** Controlled value (the digits entered so far). */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /**
   * Fires with the current code on every edit. `complete` is true only when every cell is
   * filled — a cleared middle cell leaves a blank inside the value (`"12 456"`), so
   * `value.length` alone is NOT a completeness test.
   */
  onChange?: (value: string, complete: boolean) => void;
  /** Fires once every cell is filled. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  /** Error state — red cells and `aria-invalid`. */
  error?: boolean;
  /** `touch` gives each cell a >= 44px tap target (mobile / TWA). Default `md`. */
  size?: "md" | "touch";
  /** Digits only (default). Set false for alphanumeric codes. */
  numeric?: boolean;
  /** Focus the first cell on mount. */
  autoFocus?: boolean;
  /** Accessible name of the group. Default "One-time code". */
  "aria-label"?: string;
  /** Accessible name of cell `n` (1-based). Default "digit n". */
  cellLabel?: (n: number) => string;
}

export function OtpInput(props: OtpInputProps): React.JSX.Element;

export namespace OtpInput {
  /** True only when every cell is filled (no blanks). Gate submit on this, not on length. */
  function isComplete(value: string, length?: number): boolean;
}
