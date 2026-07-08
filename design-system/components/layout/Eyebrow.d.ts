import { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Show the accent pulse dot on the left. Defaults to true. */
  pulse?: boolean;
  style?: CSSProperties;
}

export declare function Eyebrow(props: EyebrowProps): JSX.Element;
