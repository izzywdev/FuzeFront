import { CSSProperties, HTMLAttributes } from "react";

export interface StatItem {
  /** Primary metric value (number or formatted string). */
  value: string | number;
  /** Optional unit label appended after the value (e.g. "ms", "%", "k"). */
  unit?: string;
  /** Short uppercase descriptor beneath the value. */
  label: string;
  /** Change string shown below the label (e.g. "12 today", "0.3%"). */
  delta?: string;
  /** Direction of the delta indicator. Defaults to "up". */
  deltaDir?: "up" | "down";
}

export interface StatGroupProps extends HTMLAttributes<HTMLDivElement> {
  items: StatItem[];
  style?: CSSProperties;
}

export declare function StatGroup(props: StatGroupProps): JSX.Element;
