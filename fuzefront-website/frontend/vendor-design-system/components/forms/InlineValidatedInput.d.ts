import * as React from "react";
import type { InputProps } from "./Input";

export type InlineValidatedInputState = "idle" | "checking" | "valid" | "invalid";

/**
 * Text field with a live validation state — END-edge check adornment, success /
 * error ring, a label row that carries an inline status `accessory`, and
 * optional help / error lines. Composes `Input` + `FieldLabel`.
 */
export interface InlineValidatedInputProps
  extends Omit<InputProps, "label" | "valid" | "invalid" | "adornment"> {
  label?: React.ReactNode;
  /** Inline status shown on the logical end of the label row (announced politely). */
  accessory?: React.ReactNode;
  /** Validation state; drives the ring, the adornment and `aria-busy`. Default `idle`. */
  state?: InlineValidatedInputState;
  /** Help line below the field; wired to the input via `aria-describedby`. */
  help?: React.ReactNode;
  /** Appends a required marker to the label. */
  required?: boolean;
}

export function InlineValidatedInput(props: InlineValidatedInputProps): React.JSX.Element;
