import { ElementType, HTMLAttributes, JSX, ReactNode } from "react";

export type LedeTone = "onDark" | "onLight";
export type LedeSize = "base" | "responsive";
export type LedeMaxWidth = "xl" | "2xl" | "3xl";
export type LedeSpacing = "none" | "sm" | "md" | "lg";

export interface LedeProps extends HTMLAttributes<HTMLElement> {
  /** Element/component to render as. Default "p". */
  as?: ElementType;
  /**
   * Text color, from the marketing site's Tailwind token scale. `onDark`
   * (default) = secondary-300, for a hero/gradient dark background.
   * `onLight` = gray-600, for a white/light section intro.
   */
  tone?: LedeTone;
  /** Type size. `base` (default) = text-lg. `responsive` = text-lg sm:text-xl. */
  size?: LedeSize;
  /** Paragraph width cap. Default "2xl" (max-w-2xl). */
  maxWidth?: LedeMaxWidth;
  /** Bottom margin before the next element. Default "md" (mb-8). */
  spacing?: LedeSpacing;
  /** Adds leading-relaxed line-height. Default false. */
  leading?: boolean;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export declare function Lede(props: LedeProps): JSX.Element;
