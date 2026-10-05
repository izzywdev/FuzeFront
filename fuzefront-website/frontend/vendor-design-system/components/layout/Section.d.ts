import { ElementType, JSX, ReactNode, Ref } from "react";

export type SectionTone = "base" | "muted" | "inverse" | "inverseMuted";
export type SectionSpacing = "xs" | "sm" | "md" | "lg";
export type SectionBorder = "none" | "top" | "y";

export interface SectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /**
   * Flat background tone, from the site's token scale. `base` = white,
   * `muted` = secondary-50 (default, the light alternate band), `inverse` =
   * secondary-900 (dark-shell band), `inverseMuted` = secondary-800.
   */
  tone?: SectionTone;
  /** Vertical padding, mapped to py-12/16/20/24. Default "lg" (py-24). */
  spacing?: SectionSpacing;
  /** Tone-paired border rule. Default "none". */
  border?: SectionBorder;
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function Section(props: SectionProps): JSX.Element;
