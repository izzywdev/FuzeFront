import * as React from "react";

export type SegmentValue = string | number;

export interface SegmentedControlOption
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "children" | "type"> {
  /** Unique, stable value of the segment. */
  value: SegmentValue;
  /** Segment content (usually a short text label). */
  label: React.ReactNode;
  /** Not selectable; rendered as a disabled native button. */
  disabled?: boolean;
  /** Extra attributes (data-*, aria-*…) are forwarded to the segment's button. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export interface SegmentedControlProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
  options: SegmentedControlOption[];
  /** Controlled pressed value. */
  value?: SegmentValue;
  /** Initial value when uncontrolled. */
  defaultValue?: SegmentValue;
  /** Called with the new value. Not called when the pressed segment is pressed again. */
  onChange?: (value: SegmentValue) => void;
  /** Disables every segment. */
  disabled?: boolean;
  /** Accessible name for the group — provide this or `ariaLabelledBy`. */
  ariaLabel?: string;
  /** Id of the element that labels the group. */
  ariaLabelledBy?: string;
  /** Native ref to the `role="group"` element. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A compact single-select button group (`aria-pressed` buttons in a
 * `role="group"`). Keyboard accessible, RTL-safe, 44px tap targets on touch
 * devices and below the xs breakpoint.
 */
export function SegmentedControl(props: SegmentedControlProps): React.JSX.Element;
