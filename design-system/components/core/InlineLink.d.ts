import * as React from "react";

/**
 * A quiet accent-colored link that sits INSIDE a sentence or paragraph (a
 * `mailto:` contact address, an in-text reference) — no forced new-tab
 * navigation and no external-arrow glyph. For a link to another host that
 * should open in a new tab, use `ExternalLink` instead.
 */
export interface InlineLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Bolds the link text (`font-weight: var(--weight-medium)`). Default false. */
  emphasis?: boolean;
}

export function InlineLink(props: InlineLinkProps): React.JSX.Element;
