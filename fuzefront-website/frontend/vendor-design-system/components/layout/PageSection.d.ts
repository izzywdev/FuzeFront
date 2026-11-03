import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export type PageSectionSpacing = "sm" | "md" | "lg";
export type PageSectionBackground = "white" | "muted" | "transparent";

export interface PageSectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Block (top+bottom) padding, from the DS --space-16/20/24 scale. Default "lg". */
  spacing?: PageSectionSpacing;
  /** Background surface token. Default "white" (var(--paper)). */
  background?: PageSectionBackground;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function PageSection(props: PageSectionProps): JSX.Element;
