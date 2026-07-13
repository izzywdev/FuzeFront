import { CSSProperties, ReactNode } from "react";

export interface AlertProps {
  tone?: "error" | "warning" | "success" | "info";
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  role?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Alert(props: AlertProps): JSX.Element;
