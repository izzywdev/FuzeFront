import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Main axis. `row` (default) lays items out horizontally; `column` stacks them. */
  direction?: "row" | "column";
  /** Cross-axis alignment. Defaults to `center` — the `items-center` half of the pattern. */
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  /** Main-axis alignment. Defaults to `start`. */
  justify?: "start" | "center" | "end" | "between" | "around";
  /** Gap between children, mapped to the spacing scale. Defaults to `sm` (--space-2, 8px). */
  gap?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Allow children to wrap onto multiple lines. */
  wrap?: boolean;
  style?: CSSProperties;
}

export declare function Stack(props: StackProps): JSX.Element;
