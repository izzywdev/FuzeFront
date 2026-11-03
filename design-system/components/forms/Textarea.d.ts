import * as React from "react";

/**
 * Multi-line text field — mirrors Input exactly (label, error, focus seam,
 * disabled) but renders a `<textarea>` with vertical resize.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Field label rendered above the textarea (wired via `id`/`htmlFor`).
   * Accepts any node (see {@link InputProps.label}).
   */
  label?: React.ReactNode;
  /**
   * Node shown on the label row at the inline-end edge (e.g. a character
   * counter). Rendered outside the `<label>`, so it is not part of the
   * field's accessible name.
   */
  labelAccessory?: React.ReactNode;
  /** Validation message; when present, borders red and renders below. */
  error?: string;
  /** Number of visible text rows. Default 4. */
  rows?: number;
}

export function Textarea(props: TextareaProps): React.JSX.Element;
