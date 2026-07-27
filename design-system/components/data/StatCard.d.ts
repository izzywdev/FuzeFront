import * as React from "react";

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  /** Mono uppercase key label (e.g. "Users"). */
  label: React.ReactNode;
  /** The headline metric value. */
  value: React.ReactNode;
  /** Optional unit/suffix rendered smaller after `value` (e.g. "GB"). */
  unit?: React.ReactNode;
  /** Optional caption below the value (e.g. "3 admins, 2 invites pending"). */
  meta?: React.ReactNode;
  /** Renders as an `<a href>` navigating to the metric's detail view. */
  href?: string;
  onClick?: React.MouseEventHandler;
  style?: React.CSSProperties;
}

/**
 * A single summary-metric tile — seam top accent, mono key label, display-font
 * value, optional meta caption. The standalone/grid companion to `StatGroup`.
 */
export function StatCard(props: StatCardProps): JSX.Element;
