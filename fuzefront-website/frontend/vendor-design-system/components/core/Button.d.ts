import * as React from "react";

/**
 * Pill-ish action button — `primary` is the host shell's accent-glow CTA.
 *
 * Polymorphic: passing `href` (or an explicit `as`) renders a real `<a>`
 * with proper anchor semantics (href/target/rel, middle-click/ctrl-click
 * open-in-new-tab, keyboard link semantics) instead of a `<button>`.
 */
type ButtonSharedProps = {
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
  /**
   * Render tag/component override. Defaults to `"a"` when `href` is set,
   * `"button"` otherwise. Pass a component (e.g. react-router-dom's `Link`)
   * for in-app routing with the same visual treatment.
   */
  as?: React.ElementType;
};

/** Rendered as `<button>` — no `href`, no `as` override. */
export type ButtonAsButtonProps = ButtonSharedProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonSharedProps> & {
    href?: undefined;
  };

/** Rendered as a real `<a>` (or the component passed via `as`). */
export type ButtonAsAnchorProps = ButtonSharedProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonSharedProps> & {
    href: string;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;

export function Button(props: ButtonProps): React.JSX.Element;
