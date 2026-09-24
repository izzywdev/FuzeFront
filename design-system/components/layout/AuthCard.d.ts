import { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";

/**
 * The elevated, seam-topped card chrome shared by standalone auth-style
 * forms (sign in / sign up, create-organization, provisioning). Sits
 * inside a page's own content area — see `CenteredCard` for a full-viewport
 * centering wrapper instead.
 */
export interface AuthCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Text alignment inside the card. Use `center` for a confirmation/success state. */
  align?: "left" | "center";
  /** Card max-width (CSS length). Defaults to the auth-form width. */
  maxWidth?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function AuthCard(props: AuthCardProps): JSX.Element;
