import { CSSProperties, JSX, ReactNode } from "react";

export interface AlertProps {
  tone?: "error" | "warning" | "success" | "info";
  title?: string;
  /** Decorative glyph on the logical start edge; inherits the tone colour. */
  icon?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  role?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Alert(props: AlertProps): JSX.Element;
