import * as React from "react";

/**
 * The host shell header — fixed-height bar on the deepest surface, carrying the
 * signature "fuse seam" gradient underline.
 */
export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Left slot — typically the Logo / brand mark and shell title. */
  brand?: React.ReactNode;
  /** Right slot — header controls (ThemeToggle, user menu, etc.). Aliased by `children`. */
  actions?: React.ReactNode;
  /** Right slot fallback when `actions` is not provided. */
  children?: React.ReactNode;
}

export function TopBar(props: TopBarProps): JSX.Element;
