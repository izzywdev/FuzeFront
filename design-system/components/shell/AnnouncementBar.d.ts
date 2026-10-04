import { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface AnnouncementBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Short uppercase badge label rendered before the message (e.g. "New", "Beta"). */
  badge?: string;
  /** Text content of the announcement. Ignored when `children` are provided. */
  message?: string;
  /** Label for the optional inline CTA link. Requires `href`. */
  linkLabel?: string;
  /** URL the CTA link navigates to. */
  href?: string;
  children?: ReactNode;
  /** Called when the user dismisses the bar. */
  onClose?: () => void;
  style?: CSSProperties;
}

export declare function AnnouncementBar(props: AnnouncementBarProps): JSX.Element | null;
