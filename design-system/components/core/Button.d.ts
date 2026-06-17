import * as React from "react";

/**
 * Pill-ish action button — `primary` is the host shell's accent-glow CTA.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = accent fill with the fuse glow; `danger` = error fill. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Append a trailing arrow glyph (used on "Launch app", "Continue"). */
  withArrow?: boolean;
  /** A small inline icon node rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Stretch to the full width of the container. */
  fullWidth?: boolean;
  disabled?: boolean;
}

export function Button(props: ButtonProps): JSX.Element;
