import * as React from "react";

/**
 * A tone-colored icon, optionally on a rounded chip. `children` is the icon
 * element itself (e.g. `<Mail size={24} />`) — IconTile only styles the
 * surrounding box/color, never the icon glyph.
 */
export interface IconTileProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  tone?: "accent" | "info" | "success" | "warning" | "error" | "neutral";
  size?: "sm" | "md" | "lg";
  /**
   * `soft` (default): fixed box, tone-tinted background, solid-tone icon.
   * `surface`: fixed box, neutral card-surface background, solid-tone icon —
   * for a tile that sits on an already-colored/dark section.
   * `plain`: no box — just tints the icon in the solid tone color, inline.
   */
  variant?: "soft" | "surface" | "plain";
  /** Accessible name, if the icon is not purely decorative (default: `aria-hidden`). */
  label?: string;
}

export function IconTile(props: IconTileProps): React.JSX.Element;
