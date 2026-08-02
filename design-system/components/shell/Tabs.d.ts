import * as React from "react";

/** A single tab in the strip. */
export interface TabItem {
  /** Unique value — passed to `onChange` and compared with `value`. */
  value: string;
  /** Visible label. */
  label: React.ReactNode;
  /** Optional id for the tab button (for `aria-labelledby` on the panel). */
  id?: string;
  /** id of the `role="tabpanel"` this tab controls (`aria-controls`). */
  controls?: string;
  /** When set, the tab renders as an `<a href={href}>` instead of a
   * `<button>` — for a tabbed console shell where each tab is its own route
   * (e.g. Portal Admin → Overview / Users / App catalog / Billing). */
  href?: string;
}

/**
 * Accessible, controlled tab strip (WAI-ARIA tabs pattern, automatic
 * activation). The active tab is highlighted with a seam-accent underline and
 * `aria-selected`.
 */
export interface TabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: TabItem[];
  /** Value of the currently active tab. */
  value: string;
  /** Called with the new tab value on click or arrow-key navigation. */
  onChange?: (value: string) => void;
  /** Accessible label for the tablist. */
  ariaLabel?: string;
}

export function Tabs(props: TabsProps): React.JSX.Element;
