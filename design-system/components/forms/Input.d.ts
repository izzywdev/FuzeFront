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
  /** Accessible name of the reveal toggle while the value is hidden (localizable). Default "Show password". */
  showPasswordLabel?: string;
  /** Accessible name of the reveal toggle while the value is shown (localizable). Default "Hide password". */
  hidePasswordLabel?: string;
  /**
   * Decorative node pinned to the logical END edge of the field (mirrors under
   * RTL). Ignored on a revealable password field, which owns that slot.
   */
  adornment?: React.ReactNode;
  /** Success ring (e.g. an availability check passed). */
  valid?: boolean;
  /** Error ring + `aria-invalid` without a message — the explanation is rendered elsewhere. */
  invalid?: boolean;
}

export function Input(props: InputProps): React.JSX.Element;
