import { CSSProperties, ElementType, JSX, ReactNode } from "react";

export interface PageShellProps {
  /** Element/component to render as. Default "div". */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function PageShell(props: PageShellProps): JSX.Element;
