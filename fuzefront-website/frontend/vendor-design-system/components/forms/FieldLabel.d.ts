import * as React from "react";

/**
 * Standalone form-field label — the label treatment `Input`/`Select` render
 * internally, for fields that don't go through those primitives directly.
 * Wire it to its control via `htmlFor`/`id`, like a native `<label>`.
 */
export interface FieldLabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Id of the control this label describes. */
  htmlFor?: string;
  /**
   * Appends a tokenized asterisk plus a visually-hidden " (required)" so
   * the requirement reaches screen readers too. Defaults to `false`.
   */
  required?: boolean;
}

export function FieldLabel(props: FieldLabelProps): React.JSX.Element;
