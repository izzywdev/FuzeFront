import { CSSProperties, HTMLAttributes } from "react";

export interface RatingProps extends HTMLAttributes<HTMLDivElement> {
  /** Numeric score, e.g. 4.5. Used to fill stars proportionally. */
  value?: number;
  /** Review count label (e.g. 128). Omit to suppress the count. */
  count?: number;
  /** "row" = inline stars + score; "pill" = compact rounded badge. */
  variant?: "row" | "pill";
  /** Number of stars to render. Defaults to 5. */
  starCount?: number;
  style?: CSSProperties;
}

export declare function Rating(props: RatingProps): JSX.Element;
