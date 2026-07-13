import { CSSProperties, ReactNode } from "react";

export interface CenteredCardProps {
  maxWidth?: string;
  align?: "center" | "left";
  children?: ReactNode;
  style?: CSSProperties;
  containerStyle?: CSSProperties;
  [key: string]: unknown;
}

export declare function CenteredCard(props: CenteredCardProps): JSX.Element;
