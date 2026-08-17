import * as React from "react";

export interface BreadcrumbItem {
  /** Stable key for the step; also set as `data-breadcrumb-step`. Falls back to index. */
  key?: string;
  /** The step's visible label. */
  label: React.ReactNode;
  /** Optional tier/kind label rendered before `label` in mono caps (e.g. "org"). */
  kind?: string;
  /** Marks this step as the active one — accent treatment + `aria-current="true"`. */
  current?: boolean;
  /** Renders the step as an `<a href>`. */
  href?: string;
  /** Renders the step as a `<button>`. Ignored if `href` is set. */
  onClick?: () => void;
}

/**
 * A trail of steps in a hierarchy — a breadcrumb, or (with `kind` set per
 * item) a labeled resolution/scope chain. The active step carries
 * `aria-current="true"`.
 */
export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items?: BreadcrumbItem[];
}

export function Breadcrumb(props: BreadcrumbProps): React.JSX.Element;
