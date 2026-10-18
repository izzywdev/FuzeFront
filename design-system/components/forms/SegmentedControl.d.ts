import * as React from "react";

export interface SegmentedOption<V extends string = string> {
  /** Unique value — passed to `onChange` and compared with `value`. */
  value: V;
  /** Visible label. */
  label: React.ReactNode;
  /** Optional decorative leading icon (rendered `aria-hidden`). */
  icon?: React.ReactNode;
  /** Inerts just this segment. */
  disabled?: boolean;
}

/**
 * Compact, controlled 2-3 option toggle. Each segment is a `<button>` with
 * `aria-pressed`; the selected one also carries `data-selected="true"` and an
 * accent fill so selection is not color-only.
 */
export interface SegmentedControlProps<V extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: SegmentedOption<V>[];
  /** The currently selected value. */
  value: V;
  /** Called with the new value when a different segment is activated. */
  onChange?: (value: V) => void;
  /** Accessible label for the group. */
  ariaLabel?: string;
  /** Inerts every segment (sets `aria-disabled` on the group). */
  disabled?: boolean;
  /** Stretch segments to fill the row (default true). */
  fullWidth?: boolean;
}

export function SegmentedControl<V extends string = string>(
  props: SegmentedControlProps<V>
): React.JSX.Element;
