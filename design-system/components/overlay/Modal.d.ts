import * as React from "react";

/**
 * Generic accessible modal shell — backdrop, centered dialog card with the
 * fuse-seam top bar, focus trap, Escape close, and backdrop close.
 */
export interface ModalProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children" | "style" | "role"> {
  /** When false the modal is unmounted entirely (render null). */
  open: boolean;
  /** Called when the user presses Escape or clicks the backdrop. */
  onClose?: () => void;
  /** Dialog heading — wired to `aria-labelledby`. */
  title?: React.ReactNode;
  /** Dialog body content. */
  children?: React.ReactNode;
  /**
   * Controls `max-width`: `'md'` → `--modal-max-w` (560px),
   * `'lg'` → `--modal-max-w-lg` (720px). Default `'md'`.
   */
  size?: "md" | "lg";
  /** Extra inline styles applied to the dialog card. */
  style?: React.CSSProperties;
  /**
   * Any other attribute (`data-*`, `aria-describedby`, `aria-busy`, `aria-label`,
   * `id`…) is forwarded to the `role="dialog"` element.
   */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export function Modal(props: ModalProps): React.JSX.Element | null;
