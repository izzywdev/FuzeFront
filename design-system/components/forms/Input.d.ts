import * as React from "react";

/**
 * Labeled text field — accepts all native input attributes. Focus lights the
 * accent "fuse seam" ring; an `error` borders red and shows the message.
 */
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Field label rendered above the input (wired to it via `id`/`htmlFor`). A
   * plain string in the common case; accepts any node so a label can carry
   * inline annotations (e.g. an "(auto-derived)" hint span).
   */
  label?: React.ReactNode;
  /** Validation message; when present, borders the input red and renders below it. */
  error?: string;
  /**
   * For `type="password"` fields, render an in-field show/hide (eye) toggle.
   * Defaults to `true`; set `false` to opt out. No effect on non-password inputs.
   */
  revealToggle?: boolean;
}

export function Input(props: InputProps): React.JSX.Element;
