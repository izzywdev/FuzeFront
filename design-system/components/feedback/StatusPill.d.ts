import * as React from "react";

/** Status keys grouped by semantic tone:
 * success: online | active | verified | enabled
 * warning: degraded | pending | in-progress | invited
 * error:   offline | suspended | restricted | expired
 * neutral: disabled | not-started */
export type StatusPillStatus =
  | "online" | "active" | "verified" | "enabled"
  | "degraded" | "pending" | "in-progress" | "invited"
  | "offline" | "suspended" | "restricted" | "expired"
  | "disabled" | "not-started";

/**
 * Semantic lifecycle status pill — a colored dot + label on a soft tint of
 * the status color. Covers service health (online/degraded/offline), portal
 * lifecycle (active/suspended), domain verification (verified/pending),
 * catalog enablement (enabled/disabled), and Connect onboarding
 * (not-started/in-progress/restricted) / invite state (invited/expired).
 */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusPillStatus;
  /** Override the default label text; falls back to a capitalized status name. */
  label?: React.ReactNode;
}

export function StatusPill(props: StatusPillProps): JSX.Element;
