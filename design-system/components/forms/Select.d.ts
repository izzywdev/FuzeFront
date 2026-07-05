import * as React from "react";

/** A single choice in a {@link SelectProps.options} list. */
export interface SelectOption {
  /** Value submitted / bound to the control. */
  value: string;
  /** Human-readable text shown in the dropdown. */
  label: string;
  /** Disable just this option. */
  disabled?: boolean;
}

/**
 * Labeled dropdown — surface, border, radius and focus mirror Input. Focus
 * lights the accent "fuse seam" ring; an `error` borders red and shows the
 * message. Accepts all native `<select>` attributes.
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Field label rendered above the control (wired to it via `id`/`htmlFor`). */
  label?: string;
  /** Options to render; alternatively pass `<option>` children directly. */
  options?: SelectOption[];
  /** `<option>` elements, rendered after `options`/`placeholder`. */
  children?: React.ReactNode;
  /** Disabled leading option shown when nothing is selected (e.g. "Choose a role"). */
  placeholder?: string;
  /** Validation message; when present, borders the control red and renders below it. */
  error?: string;
}

export function Select(props: SelectProps): JSX.Element;
