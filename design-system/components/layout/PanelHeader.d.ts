import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

export interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** id placed on the rendered <h3> — target it from the panel's aria-labelledby. */
  id?: string;
  /** Heading text/content. */
  title: ReactNode;
  /** Optional trailing content (status pill, badge, action) rendered flush-end. */
  children?: ReactNode;
  style?: CSSProperties;
  /** Style overrides applied to the <h3> title element. */
  titleStyle?: CSSProperties;
}

export declare function PanelHeader(props: PanelHeaderProps): JSX.Element;
