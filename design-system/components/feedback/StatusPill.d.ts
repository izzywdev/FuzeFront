import * as React from "react";

/**
 * Inline service-status indicator — a colored dot + label keyed to the
 * health of a service in the runtime fabric.
 */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Service health: `online` = success (green), `degraded` = warning (amber), `offline` = error (red). */
  status?: "online" | "offline" | "degraded";
  /** Override the default label text; falls back to a capitalized status name. */
  label?: React.ReactNode;
}

export function StatusPill(props: StatusPillProps): JSX.Element;
