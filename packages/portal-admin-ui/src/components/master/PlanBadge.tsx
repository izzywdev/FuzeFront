import { Badge } from '@fuzefront/design-system'
import type { BillingMode } from '../../types'

const LABELS: Record<BillingMode, string> = {
  free: 'Free',
  platform: 'Platform-billed',
  reseller: 'Reseller · Connect',
}

const TONES: Record<BillingMode, 'neutral' | 'accent' | 'info'> = {
  free: 'neutral',
  platform: 'accent',
  reseller: 'info',
}

export interface PlanBadgeProps {
  billingMode: BillingMode
}

/**
 * Renders the portal's real `billingMode` (free | platform | reseller) as a
 * badge. The approved frame mocked a tiered "plan" vocabulary (Free/Pro/Scale)
 * that has no counterpart in the frozen `Portal` contract — `billingMode` is
 * the real, wire-level field, so this renders that honestly rather than
 * inventing plan tiers the API does not have. `data-plan` carries the real
 * enum value so the states this drives (frame 01/03's plan badge) stay
 * inspectable in tests.
 */
export function PlanBadge({ billingMode }: PlanBadgeProps) {
  return (
    <Badge tone={TONES[billingMode] ?? 'neutral'} data-plan={billingMode}>
      {LABELS[billingMode] ?? billingMode}
    </Badge>
  )
}
