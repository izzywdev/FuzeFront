import * as React from "react";

/**
 * Multi-line text field — mirrors Input exactly (label, error, focus seam,
 * disabled) but renders a `<textarea>` with vertical resize.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Field label rendered above the textarea (wired via `id`/`htmlFor`). */
  label?: string;
  /** Validation message; when present, borders red and renders below. */
  error?: string;
  /** Number of visible text rows. Default 4. */
  rows?: number;
}

export function Textarea(props: TextareaProps): JSX.Element;
