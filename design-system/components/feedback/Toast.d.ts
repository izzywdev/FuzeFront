import * as React from "react";

/**
 * A single toast notification — bg-tertiary card with a level-colored left bar.
 * `info` uses the cyan accent (--accent-2); other levels use their status color.
 */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Severity, drives the colored left bar. `info` = cyan accent. */
  level?: "success" | "warning" | "error" | "info";
  /** Optional bold heading rendered in the display font. */
  title?: React.ReactNode;
  /** The toast body copy. */
  message?: React.ReactNode;
  /** Show a dismiss (x) IconButton and handle the click. Omit to hide it. */
  onDismiss?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function Toast(props: ToastProps): JSX.Element;
