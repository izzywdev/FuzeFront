import { CSSProperties } from "react";

export interface SpinnerProps {
  size?: number;
  color?: string;
  label?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Spinner(props: SpinnerProps): JSX.Element;
