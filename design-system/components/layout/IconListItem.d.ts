import * as React from "react";

/**
 * A row with a tone-colored leading icon, top-aligned (not centered) beside
 * its text — the icon itself is passed as `icon` (a component, e.g. `CheckCircle2`
 * from `lucide-react`), `children` is whatever text/content follows it. Only
 * the row layout and the icon's tone/size/alignment are owned by this
 * component; callers keep full control of the icon glyph and their own text
 * styling.
 */
export interface IconListItemProps
  extends React.HTMLAttributes<HTMLElement> {
  /** Element to render the row as. `li` (default, for a ListStack/`<ul>`) or `div`. */
  as?: "li" | "div";
  /** Icon component to render leading the row, e.g. `CheckCircle2`. Omit for no icon. */
  icon?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  /** Tone applied to the icon color. Defaults to `success`. */
  tone?: "success" | "warning" | "error" | "accent" | "neutral" | "muted";
  /** Icon pixel size, passed straight to `icon`. Defaults to `14`. */
  size?: number;
  /** Gap between the icon and the content, mapped to the DS spacing scale. Defaults to `sm`. */
  gap?: "xs" | "sm" | "md" | "lg";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function IconListItem(props: IconListItemProps): React.JSX.Element;
