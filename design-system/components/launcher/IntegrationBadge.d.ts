import * as React from "react";

/**
 * Mono pill labeling a module's integration type — the technical "how it fuses"
 * tag shown on launcher cards.
 */
export interface IntegrationBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The integration mechanism this module loads through. Rendered verbatim
   * (lowercased) in --font-mono. Known values get the accent treatment; any
   * other string is accepted and styled the same way.
   */
  type?: "module-federation" | "iframe" | "web-component" | (string & {});
}

export function IntegrationBadge(props: IntegrationBadgeProps): JSX.Element;
