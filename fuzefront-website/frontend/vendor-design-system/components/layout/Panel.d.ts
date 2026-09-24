import { CSSProperties, HTMLAttributes, ReactNode, JSX } from "react";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Panel heading text, rendered in the header. */
  title: ReactNode;
  /**
   * Id applied to the heading and referenced by the section's
   * `aria-labelledby`. Auto-generated via `useId()` when omitted — pass one
   * explicitly only if another element also needs to reference it.
   */
  titleId?: string;
  /** Optional content beside the title (e.g. a status pill). */
  trailing?: ReactNode;
  /**
   * When provided, renders a muted empty-state paragraph in place of
   * `children`. Omit to render `children`.
   */
  empty?: ReactNode;
  /** Optional action row rendered below the body (e.g. buttons). */
  actions?: ReactNode;
  style?: CSSProperties;
}

export declare function Panel(props: PanelProps): JSX.Element;
