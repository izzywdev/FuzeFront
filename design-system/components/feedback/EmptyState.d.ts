import { CSSProperties, ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function EmptyState(props: EmptyStateProps): JSX.Element;
