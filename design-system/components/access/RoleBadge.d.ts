import * as React from "react";

/**
 * Role pill for org membership — its tone encodes authority:
 * owner=amber, admin=indigo (the fuse), member=cyan, viewer=neutral.
 */
export interface RoleBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The member's role within the organization. Drives color, label, and icon. */
  role?: "owner" | "admin" | "member" | "viewer";
  /** Render the leading role icon (crown / shield / user / eye). Defaults to true. */
  showIcon?: boolean;
}

export function RoleBadge(props: RoleBadgeProps): JSX.Element;
