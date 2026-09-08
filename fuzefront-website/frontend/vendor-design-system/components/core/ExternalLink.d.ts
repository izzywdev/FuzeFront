import * as React from "react";

/**
 * A link to a resource on ANOTHER host, always opened in a new tab. Renders
 * a real `<a target="_blank" rel="noopener noreferrer">` — `target`/`rel`
 * cannot be overridden by props.
 */
export interface ExternalLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The external URL. Server-authoritative — never composed client-side. */
  href: string;
  /** `button` = filled accent CTA (a primary launch action); `link` = quiet inline text link. */
  variant?: "link" | "button";
}

export function ExternalLink(props: ExternalLinkProps): React.JSX.Element;
