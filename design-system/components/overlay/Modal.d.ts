import * as React from "react";

/**
 * Generic accessible modal shell — backdrop, centered dialog card with the
 * fuse-seam top bar, focus trap, Escape close, and backdrop close.
 */
export interface ModalProps {
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
}

export function Modal(props: ModalProps): JSX.Element | null;
