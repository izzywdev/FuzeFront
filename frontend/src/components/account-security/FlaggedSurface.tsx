import type { ReactNode } from 'react'
import { useFlagState } from '../../platform/featureFlags'
import { useCompactViewport } from '../../lib/compactViewport'

/**
 * Release flags for the account-security password / MFA surfaces (all default OFF).
 * Keys mirror `packages/feature-flags` (`flag-registry.yaml` + `FLAG_KEYS`).
 */
export const ACCOUNT_SECURITY_FLAGS = {
  passwordReset: 'fuzefront.account-security.password-reset',
  mfaManagement: 'fuzefront.security.mfa-management',
  mfaStepUpMobile: 'fuzefront.security.mfa-stepup-mobile',
} as const

/**
 * Release-flag gate for an authenticated account-security surface.
 *
 *  - flags not yet fetched → renders nothing (no flash of "unavailable" for a flag
 *    that is ON, and nothing is exposed before the answer is known);
 *  - flag OFF (default, and any failed read) → the same dark placeholder the hub
 *    uses, i.e. unchanged behaviour;
 *  - flag ON → the surface.
 */
export function FlaggedSurface({ flag, children }: { flag: string; children: ReactNode }) {
  const { enabled, ready } = useFlagState(flag, false)
  // Small screens: tighter gutter so 44px touch controls (six OTP cells) fit at 375px.
  const compact = useCompactViewport()
  const padding = compact ? 'var(--space-4)' : 'var(--space-8)'
  if (!ready) return null
  if (!enabled) {
    return (
      <div style={{ padding, color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }
  return <div style={{ padding }}>{children}</div>
}
