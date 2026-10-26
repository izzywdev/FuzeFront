import * as React from "react";
import type { TextareaProps } from "./Textarea";

export interface TextareaCounterState {
  /** Current length in Unicode code points. */
  count: number;
  /** The configured limit. */
  max: number;
  /** `max - count`; negative when over the limit. */
  remaining: number;
  /** `count > max`. */
  over: boolean;
}

export interface TextareaWithCounterProps
  extends Omit<TextareaProps, "maxLength" | "value" | "defaultValue" | "onChange" | "labelAccessory"> {
  /** The character limit. Counted in Unicode code points (what OpenAPI `maxLength` counts). */
  maxLength: number;
  /**
   * Also set the native `maxlength` so the browser truncates typing/pasting.
   * Default `false`: a soft limit — the user can exceed it and sees the overflow flagged.
   */
  strict?: boolean;
  /** Controlled value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  /**
   * Validation message. Always wins over the built-in over-limit message. Note
   * it renders in a `role="alert"` region: a message that changes on every
   * keystroke (e.g. "127 over") re-announces each time — prefer a stable string.
   */
  error?: string;
  /** BCP 47 locale for number formatting (`1,234` vs `1.234`). Defaults to the runtime locale. */
  locale?: string;
  /**
   * Builds the screen-reader message ("N of M characters remaining" /
   * "N characters over the limit"). Supply it to localise; the default is English.
   */
  formatMessage?: (state: TextareaCounterState) => string;
  /** Visible error shown while over the limit (when no `error` is given). Default is English. */
  overLimitMessage?: string;
  /**
   * Milliseconds of typing pause before the live region announces the new
   * count. `0` announces immediately. @default 1000
   */
  announceDelay?: number;
  /** Extra attributes for the visible counter element (e.g. `data-counter="brief"`). */
  counterProps?: React.HTMLAttributes<HTMLSpanElement> & {
    [dataAttribute: `data-${string}`]: string | undefined;
  };
}

/**
 * A `Textarea` with a live character counter on the label row. Soft limit by
 * default; accessible (described by remaining count, debounced live
 * announcements, `aria-invalid` + stable error when over).
 */
export function TextareaWithCounter(props: TextareaWithCounterProps): React.JSX.Element;
