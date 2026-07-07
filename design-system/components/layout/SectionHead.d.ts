import { CSSProperties, HTMLAttributes, MouseEventHandler } from "react";

export interface SectionHeadProps extends HTMLAttributes<HTMLDivElement> {
  /** Eyebrow pill label above the heading. */
  kicker?: string;
  /** Section heading text. */
  title: string;
  /** Optional descriptive paragraph below the heading. */
  description?: string;
  /** Label for the "view all" link. If omitted, no link is rendered. */
  viewAllLabel?: string;
  /** URL for the "view all" link. Defaults to "#". */
  viewAllHref?: string;
  onViewAll?: MouseEventHandler<HTMLAnchorElement>;
  style?: CSSProperties;
}

export declare function SectionHead(props: SectionHeadProps): JSX.Element;
