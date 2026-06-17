import * as React from "react";

/**
 * Icon-only ghost button — the host shell's quiet square control
 * (notification bell, theme toggle). Transparent until hovered.
 */
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** The icon glyph to render (typically a small inline SVG). */
  children?: React.ReactNode;
  /** Required. Used as both the `title` tooltip and the accessible name. */
  label: string;
  size?: "sm" | "md" | "lg";
  /** Toggled/selected state — holds the quaternary fill and accent color. */
  active?: boolean;
  disabled?: boolean;
}

export function IconButton(props: IconButtonProps): JSX.Element;
