import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Panel heading, rendered as an `<h3>` and wired via `aria-labelledby`. */
  title?: ReactNode;
  /** Reuse an id you already control instead of the generated one. */
  titleId?: string;
  /** Trailing element in the header row, next to the title (e.g. a status pill). */
  headerAction?: ReactNode;
  /**
   * Token-styled single-line message shown in place of `children` — for the
   * panel's empty/no-data state. Mutually exclusive with `children`.
   */
  empty?: ReactNode;
  /** Footer row of action buttons. */
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function Panel(props: PanelProps): JSX.Element;
