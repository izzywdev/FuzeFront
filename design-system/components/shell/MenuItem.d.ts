import * as React from "react";

/**
 * Sidebar navigation row for the host shell — the active row carries the
 * "fuse seam" as a 3px rounded bar on its left edge.
 */
export interface MenuItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Leading glyph (an emoji or a small inline SVG with stroke="currentColor"). */
  icon?: React.ReactNode;
  /** The row's visible text. */
  label: React.ReactNode;
  /** When true: --accent-soft fill, primary text, semibold, and the seam bar. */
  active?: boolean;
  /** Fired on click and on Enter/Space when focused. */
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

export function MenuItem(props: MenuItemProps): JSX.Element;
