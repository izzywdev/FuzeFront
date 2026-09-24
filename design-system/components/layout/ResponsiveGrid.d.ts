import { CSSProperties, JSX, ReactNode } from "react";

export interface ResponsiveGridProps {
  /** Maximum number of columns once the container is wide enough. Default `2`. */
  columns?: number;
  /** Minimum width a column may shrink to before the grid drops a column. Default `"240px"`. */
  minColumnWidth?: string;
  /** Row/column gap, from the DS spacing scale. Default `"lg"` (`var(--space-6)`). */
  gap?: "sm" | "md" | "lg" | "xl";
  /** CSS `align-items` for the grid's rows (e.g. `"start"` when rows have uneven height). */
  align?: CSSProperties["alignItems"];
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function ResponsiveGrid(props: ResponsiveGridProps): JSX.Element;
