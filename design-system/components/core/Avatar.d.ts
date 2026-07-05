import * as React from "react";

/**
 * Circular user avatar showing derived initials on the indigo "fuse" gradient.
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name; the first letters of its first two words become the initials. */
  name?: string;
  /** Fallback identity — its first character is used when `name` is absent. */
  email?: string;
  /** Diameter preset. */
  size?: "sm" | "md" | "lg";
  /** Add the top-bar hover lift + accent glow (use when the avatar is a button trigger). */
  interactive?: boolean;
}

export function Avatar(props: AvatarProps): JSX.Element;
