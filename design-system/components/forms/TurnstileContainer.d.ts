import * as React from "react";

export type TurnstileContainerState = "loading" | "ready" | "verified" | "failed";

export interface TurnstileContainerLabels {
  loading: string;
  ready: string;
  verified: string;
  failed: string;
  /** Shown as an alert in the `failed` state. */
  error: string;
  /** The challenge vendor's name (approved exception to the vendor-name rule). */
  brand: string;
}

/**
 * Shell for a managed anti-abuse challenge widget: the chrome + the
 * loading / ready / verified / failed states. The widget itself is `children`
 * and stays mounted in every state.
 */
export interface TurnstileContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Default `loading`. Exposed as `data-state`. */
  state?: TurnstileContainerState;
  /** Localizable copy; any omitted key falls back to the English default. */
  labels?: Partial<TurnstileContainerLabels>;
  /** The vendor widget (mounted in a slot that persists across states). */
  children?: React.ReactNode;
}

export function TurnstileContainer(props: TurnstileContainerProps): React.JSX.Element;
