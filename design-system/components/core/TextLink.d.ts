import * as React from "react";

/**
 * An inline accent-colored link/action — the recurring
 * `text-{shade}-600 hover:text-{shade}-700` pattern as a DS primitive.
 * Color (default / hover / focus) is the only concern this component owns;
 * `as` picks the rendered element (`"a"` default, a router `Link`, or
 * `"button"`) and every other prop is forwarded unchanged.
 */
export interface TextLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The element (or component) to render. Defaults to a plain `<a>`. */
  as?: React.ElementType;
}

export function TextLink(props: TextLinkProps): React.JSX.Element;
