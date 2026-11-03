import * as React from "react";

/**
 * A small uppercase heading that introduces a labelled group of content
 * inside a card or section (e.g. "Responsibilities", "Recommended
 * products"). Not `Eyebrow` — no pill, no accent dot, no accent color.
 */
export interface GroupLabelProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "h4" */
  as?: "h4" | "h5" | "h6" | "p" | "span" | "div";
  /**
   * Semantic tone, delegated to `Text`'s tone scale: `primary` (gray-900
   * equivalent), `secondary` (gray-600 equivalent), `muted` (lowest
   * emphasis).
   * @default "secondary"
   */
  tone?: "primary" | "secondary" | "muted";
  /**
   * Bottom-margin gap, from the DS spacing scale: `sm` (`--space-2`) or
   * `md` (`--space-3`).
   * @default "sm"
   */
  spacing?: "sm" | "md";
  children?: React.ReactNode;
}

export function GroupLabel(props: GroupLabelProps): React.JSX.Element;
