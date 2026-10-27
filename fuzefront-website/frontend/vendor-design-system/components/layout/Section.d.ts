import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export type SectionTone = "surface" | "muted" | "transparent";
export type SectionPadding = "sm" | "md" | "lg";

export interface SectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Background tone, from the DS surface tokens. Default "surface" (white in light theme). */
  tone?: SectionTone;
  /** Vertical rhythm, mapped to the spacing scale: sm=--space-16 (64px), md=--space-20 (80px), lg=--space-24 (96px). Default "lg". */
  padding?: SectionPadding;
  /** Adds a top divider (border-block-start) in --border-color. Default false. */
  divider?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Section(props: SectionProps): JSX.Element;
