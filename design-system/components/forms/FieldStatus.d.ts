import * as React from "react";

/** Async/validation state for an inline field-status line. */
export type FieldStatusState = "idle" | "checking" | "success" | "error";

export interface FieldStatusProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Which state to render. `idle` shows nothing (but reserves height). */
  state?: FieldStatusState;
  /** Message shown next to the state icon/spinner. */
  message?: string;
  /** Optional trailing node (e.g. a "sign in instead" link). */
  action?: React.ReactNode;
}

export function FieldStatus(props: FieldStatusProps): JSX.Element;
