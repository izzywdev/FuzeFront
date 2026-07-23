import { CSSProperties, ReactNode } from "react";

export type StatusCalloutTone = "error" | "warning" | "success" | "info";

export interface StatusCalloutProps {
  /** Severity tone. Drives the tint, border, icon color, and default a11y role. */
  tone?: StatusCalloutTone;
  /** Decorative leading glyph/icon rendered in a soft chip (aria-hidden). */
  icon?: ReactNode;
  /** Emphasized title line. */
  title?: ReactNode;
  /** Body copy. */
  children?: ReactNode;
  /** Action row (buttons/links) rendered under the body. */
  actions?: ReactNode;
  /** Override the ARIA role (defaults: `alert` for error, `status` otherwise). */
  role?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function StatusCallout(props: StatusCalloutProps): JSX.Element;
