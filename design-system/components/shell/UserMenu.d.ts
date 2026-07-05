import * as React from "react";

/** The signed-in user the menu renders. */
export interface UserMenuUser {
  /** Given name; combined with `lastName` for the display name and initials. */
  firstName?: string;
  /** Family name; combined with `firstName` for the display name and initials. */
  lastName?: string;
  /** Always shown in the header (mono); the fallback display name + initial. */
  email: string;
  /** Role scopes. Containing `"admin"` reveals the Admin row + role tag. */
  roles?: string[];
}

/**
 * Top-bar account control for the host shell — an Avatar button that
 * opens a dropdown with a user header and account actions.
 */
export interface UserMenuProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The signed-in user; the menu renders nothing when this is null. */
  user: UserMenuUser | null;
  /** Called with the target route when Profile / Settings / Admin is chosen. */
  onNavigate?: (path: string) => void;
  /** Called when the (coral-toned) Sign out row is chosen. */
  onSignOut?: () => void;
}

export function UserMenu(props: UserMenuProps): JSX.Element | null;
