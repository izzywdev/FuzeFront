import { CSSProperties, ElementType, JSX, ReactNode, Ref } from "react";

export type SectionIntroHeadingTag = "h1" | "h2";
export type SectionIntroSpacing = 12 | 14 | 16;
export type SectionIntroTitleGap = 0 | 3 | 4;
export type SectionIntroDescriptionMaxWidth = "xl" | "2xl";

export interface SectionIntroProps {
  /** Element/component to render as. Default "div" — pass `motion.div` to animate it. */
  as?: ElementType;
  /** Heading tag for `title`. Default "h2"; use "h1" for a page's own header. */
  heading?: SectionIntroHeadingTag;
  /** Optional node rendered above the heading (e.g. an `IconTile`). */
  icon?: ReactNode;
  /** Heading content. */
  title: ReactNode;
  /** Bottom margin under the heading, on the DS spacing scale. Default 4. */
  titleGap?: SectionIntroTitleGap;
  /** Optional lead paragraph rendered below the heading. */
  description?: ReactNode;
  /** Max prose width of `description`. Default "2xl" (42rem). */
  descriptionMaxWidth?: SectionIntroDescriptionMaxWidth;
  /** Bottom margin of the whole block, on the DS spacing scale. Default 12. */
  spacing?: SectionIntroSpacing;
  /** Extra content rendered after `description` (e.g. meta lines). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function SectionIntro(props: SectionIntroProps): JSX.Element;
