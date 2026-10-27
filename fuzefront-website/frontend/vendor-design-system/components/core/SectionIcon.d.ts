import * as React from "react";

/**
 * A tone-colored decorative icon, centered on its own line above a heading,
 * with a token-driven bottom gap. `children` is the icon element itself
 * (e.g. `<Crown size={40} />`) — SectionIcon only centers, colors, and
 * spaces it, never the icon glyph.
 */
export interface SectionIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  tone?: "accent" | "info" | "success" | "warning" | "error" | "neutral";
  /**
   * Bottom gap to whatever follows (the heading). `md` (`--space-4`, 16px)
   * or `lg` (default, `--space-6`, 24px).
   */
  gap?: "md" | "lg";
  /** Accessible name, if the icon is not purely decorative (default: `aria-hidden`). */
  label?: string;
}

export function SectionIcon(props: SectionIconProps): React.JSX.Element;
