import * as React from "react";

/**
 * Industry-standard pricing/plan card. The `recommended` tier is highlighted
 * (accent border + glow) AND labelled; the `current` state is conveyed
 * textually and disables the CTA so the signal is not color-only (a11y).
 */
export interface PricingCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Tier/plan display name, e.g. "Pro". */
  tierName: string;
  /** Pre-formatted price string, e.g. "$9" or "Free". */
  price: string;
  /** Billing interval rendered as "/{interval}", e.g. "month". */
  interval?: string;
  /** Optional one-line tier description. */
  description?: string;
  /** Feature bullets, each shown with a check. */
  features?: string[];
  /** Highlight + "Recommended" badge + accent CTA. */
  recommended?: boolean;
  /** Mark as the caller's current plan: badge + disabled "Current plan" CTA. */
  current?: boolean;
  /** CTA label override. Defaults to "Choose plan" / "Current plan". */
  ctaLabel?: string;
  /** Invoked when the CTA is pressed (ignored while disabled/busy/current). */
  onSelect?: () => void;
  /** Show a working/in-flight CTA and disable it. */
  busy?: boolean;
  /** Disable the CTA. */
  disabled?: boolean;
}

export function PricingCard(props: PricingCardProps): JSX.Element;
