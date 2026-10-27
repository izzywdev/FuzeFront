import * as React from "react";

export type RadioCardValue = string | number;

export interface RadioCardOption extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** Unique, stable value of the option. */
  value: RadioCardValue;
  /** Card title — the option's accessible name. May contain inline badges/pills. */
  label: React.ReactNode;
  /** Supporting sentence shown under the title; exposed as the accessible description. */
  description?: React.ReactNode;
  /** Not selectable, skipped by arrow-key navigation, dimmed. */
  disabled?: boolean;
  /**
   * The option has been chosen but not yet applied (e.g. awaiting a confirm
   * step). Rendered with a dashed accent border; it is NOT `aria-checked`.
   */
  pending?: boolean;
  /** Extra attributes (data-*, aria-describedby…) are forwarded to the card element. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export interface RadioCardGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
  options: RadioCardOption[];
  /** Controlled selected value. */
  value?: RadioCardValue;
  /** Initial value when uncontrolled. */
  defaultValue?: RadioCardValue;
  /** Called with the new value on click, Space, or arrow-key navigation. Not called when re-selecting the current value. */
  onChange?: (value: RadioCardValue) => void;
  /** Disables every card (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** When set, a hidden input carries the selected value for native form posts. */
  name?: string;
  /** Accessible name for the group — provide this or `ariaLabelledBy`. */
  ariaLabel?: string;
  /** Id of the element that labels the group. */
  ariaLabelledBy?: string;
  /** Native ref to the `role="radiogroup"` element. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A radio group rendered as selectable cards with a title and a per-card
 * description. WAI-ARIA radiogroup semantics, roving focus, arrow keys that
 * skip disabled cards and flip under `dir="rtl"`, 44px touch targets.
 */
export function RadioCardGroup(props: RadioCardGroupProps): React.JSX.Element;
