import * as React from "react";

export interface LogoProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  /** Logo image URL (`branding.logo`), or `null`/omitted for no image. */
  src?: string | null;
  /** Portal/tenant display name — source of the initials fallback and the
   * default accessible name. */
  name?: string | null;
  /** Explicit accessible name / alt text override. */
  alt?: string;
  size?: "sm" | "md" | "lg";
  /** Tile (rounded square, default) or circle. */
  shape?: "tile" | "circle";
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Image slot with an initials/default fallback — never renders a broken-image
 * icon. Falls back automatically on a failed image load (`onError`).
 */
export function Logo(props: LogoProps): React.JSX.Element;
