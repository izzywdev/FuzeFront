import * as React from "react";

/**
 * Labeled text field — accepts all native input attributes. Focus lights the
 * accent "fuse seam" ring; an `error` borders red and shows the message.
 */
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the input (wired to it via `id`/`htmlFor`). */
  label?: string;
  /** Validation message; when present, borders the input red and renders below it. */
  error?: string;
}

export function Input(props: InputProps): JSX.Element;
