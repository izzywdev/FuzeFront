import * as React from "react";

/**
 * Monospace code/technical-value field — mirrors Textarea's label/error/focus
 * contract, rendered in `--font-mono`. Single-line (`<input>`) by default;
 * `multiline` renders a `<textarea>` for JSON/code blocks.
 */
export interface CodeFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement> &
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "rows"
  > {
  /** Field label rendered above the control (wired via `id`/`htmlFor`). */
  label?: string;
  /** Validation message; when present, borders red and renders below. */
  error?: string;
  /** Render a `<textarea>` (JSON/code block) instead of a single-line `<input>`. */
  multiline?: boolean;
  /** Visible rows when `multiline`. Default 6. */
  rows?: number;
}

export function CodeField(props: CodeFieldProps): React.JSX.Element;
