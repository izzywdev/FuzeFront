import * as React from "react";

/**
 * Bottom sheet — mobile equivalent of Modal. Slides up from the bottom of the
 * screen, capped at `--sheet-max-h` (80dvh). The fuse-seam gradient appears
 * below the drag handle. Focus is trapped; Escape and backdrop tap call `onClose`.
 *
 * Use on xs/sm screens (<768px). Prefer Modal on md+.
 */
export interface BottomSheetProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children" | "style" | "role"> {
  /** When false the sheet is unmounted entirely. */
  open: boolean;
  /** Called when user taps the backdrop or presses Escape. */
  onClose?: () => void;
  /** Sheet heading — wired to `aria-labelledby`. */
  title?: React.ReactNode;
  /** Sheet body content. */
  children?: React.ReactNode;
  /** Extra inline styles applied to the sheet panel. */
  style?: React.CSSProperties;
  /**
   * Any other attribute (`data-*`, `aria-describedby`, `aria-busy`, `aria-label`,
   * `id`…) is forwarded to the `role="dialog"` element.
   */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export function BottomSheet(props: BottomSheetProps): React.JSX.Element | null;
