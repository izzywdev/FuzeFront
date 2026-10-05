import * as React from "react";

type TextLinkSharedProps = {
  /**
   * Render tag/component override. Defaults to `"a"`. Pass a component
   * (e.g. react-router-dom's `Link`) for in-app routing with the same
   * visual treatment — the link stays same-tab either way.
   */
  as?: React.ElementType;
};

export type TextLinkProps = TextLinkSharedProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof TextLinkSharedProps> &
  Record<string, unknown>;

/**
 * A quiet, same-tab inline navigation link (footer nav, "back to X"). Color
 * reads from the DS accent pair (`--accent-color` / `--accent-hover`) —
 * never a raw Tailwind color shade. For a link that opens another host in
 * a new tab, use `ExternalLink` instead.
 */
export function TextLink(props: TextLinkProps): React.JSX.Element;
