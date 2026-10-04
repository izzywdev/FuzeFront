import * as React from "react";

/** A single row in a `NavLink`'s submenu flyout. */
export interface NavLinkSubmenuItem {
  /** Stable key for the row. Falls back to `href`, then `to`, then index. */
  key?: string;
  /** The row's visible label. */
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  /** Destination when the row renders as a plain anchor. */
  href?: string;
  /** Fired on click (in addition to the row element's default navigation). */
  onClick?: (e: React.MouseEvent) => void;
  /** Any other prop (e.g. `to` for a router `Link` passed via `submenuAs`) is
   * forwarded verbatim to the row's rendered element. */
  [prop: string]: unknown;
}

/**
 * A single horizontal top-nav entry — `MenuItem`'s counterpart for a
 * horizontal bar. Renders a real anchor (or a router `Link` via `as`), marks
 * the current page with `active`, and — with `submenu` — discloses a
 * hover/focus flyout panel per the WAI-ARIA disclosure-navigation pattern.
 */
export interface NavLinkProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onFocus" | "onBlur" | "onMouseEnter" | "onMouseLeave"> {
  /** The element/component to render the trigger as. Defaults to `"a"`; pass a
   * router `Link` component to get `to`-based navigation (still accepts `href`
   * via passthrough props for a plain anchor). */
  as?: React.ElementType;
  /** The link's visible text. */
  label: React.ReactNode;
  /** When true: seam-accent underline, primary text, semibold, `aria-current="page"`. */
  active?: boolean;
  /** Rows shown in the hover/focus flyout panel. Omit/empty for a plain link. */
  submenu?: NavLinkSubmenuItem[];
  /** The element/component to render each submenu row as. Defaults to `"a"`;
   * pass a router `Link` component to make a row's `to` field navigate. */
  submenuAs?: React.ElementType;
  /** Controlled open state for the submenu panel. */
  open?: boolean;
  /** Initial open state when uncontrolled. Defaults to `false`. */
  defaultOpen?: boolean;
  /** Fired whenever the submenu's open state changes (hover, focus, Escape). */
  onOpenChange?: (open: boolean) => void;
  /** Destination when `as` is left as the default anchor. */
  href?: string;
  /** Fired on click. */
  onClick?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
}

export function NavLink(props: NavLinkProps): React.JSX.Element;
