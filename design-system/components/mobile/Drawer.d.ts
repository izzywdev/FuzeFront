import * as React from "react";

/**
 * Slide-in navigation drawer for mobile (<768px). Opens from the left at
 * `--drawer-width` (280px). The header slot carries the fuse-seam bottom
 * border matching the desktop SidePanel identity. Focus is trapped inside;
 * Escape and backdrop tap call `onClose`.
 */
export interface DrawerProps {
  /** When false the drawer is unmounted entirely. */
  open: boolean;
  /** Called when user taps the backdrop or presses Escape. */
  onClose?: () => void;
  /**
   * Content rendered in the drawer header (e.g. BrandMark + org name).
   * The fuse-seam gradient replaces the header's bottom border.
   */
  header?: React.ReactNode;
  /** Navigation items — typically a list of MenuItem components. */
  children?: React.ReactNode;
  /**
   * Content pinned to the bottom of the drawer (e.g. user avatar + email).
   * Receives `padding-bottom: env(safe-area-inset-bottom)` automatically.
   */
  footer?: React.ReactNode;
  /** Extra inline styles applied to the drawer panel. */
  style?: React.CSSProperties;
}

export function Drawer(props: DrawerProps): JSX.Element | null;
