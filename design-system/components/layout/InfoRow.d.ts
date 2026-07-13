import { CSSProperties, ReactNode } from "react";

export interface InfoRowProps {
  label?: string;
  description?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function InfoRow(props: InfoRowProps): JSX.Element;
