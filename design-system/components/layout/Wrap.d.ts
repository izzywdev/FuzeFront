import * as React from "react";

export type WrapGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16;

/**
 * Wrap — a flex row that wraps onto multiple lines, spaced by a
 * `--space-*` token. Use for badge/tag groups and button rows that should
 * reflow on narrow viewports rather than overflow.
 */
export interface WrapProps extends React.HTMLAttributes<HTMLElement> {
  /** Spacing-scale step, mapped to `var(--space-<gap>)`. Defaults to `2`. */
  gap?: WrapGap;
  align?: "flex-start" | "center" | "flex-end" | "baseline" | "stretch";
  justify?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
  /** Element/component to render as. Defaults to `"div"`. */
  as?: React.ElementType;
}

export function Wrap(props: WrapProps): React.JSX.Element;
