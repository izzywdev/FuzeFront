import type { ReactNode } from 'react'
import { useFlagState } from '../../platform/featureFlags'

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
  if (!ready) return null
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }
  return <div style={{ padding: 'var(--space-8)' }}>{children}</div>
}
