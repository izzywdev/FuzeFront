import * as React from "react";

/**
 * The centered intro paragraph directly under a section heading on a
 * marketing page. Tokens only: `--text-lg` size, `--text-secondary` tone,
 * `--container-2xl` (672px, matches `max-w-2xl`) width cap, centered via
 * `margin-inline: auto`.
 */
export interface SectionLedeProps
  extends React.HTMLAttributes<HTMLElement> {
  /**
   * The element to render as.
   * @default "p"
   */
  as?: React.ElementType;
  children?: React.ReactNode;
}

export function SectionLede(props: SectionLedeProps): React.JSX.Element;
