import * as React from "react";

/**
 * Filter/search input for scannable lists — a leading search glyph inside a
 * bordered field, matching Input's surface/focus treatment.
 */
export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Accessible label. Visually hidden by default — see `hideLabel`. */
  label?: string;
  /** Hide the label visually (still in the accessibility tree). Default `true`. */
  hideLabel?: boolean;
  /** Extra style applied to the outer wrapper. */
  style?: React.CSSProperties;
  /** Extra style applied to the native `<input>`. */
  inputStyle?: React.CSSProperties;
}

export function SearchField(props: SearchFieldProps): React.JSX.Element;
