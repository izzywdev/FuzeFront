import type React from 'react'
import { Skeleton } from '@fuzefront/design-system'

export interface ProvisioningGateProps {
  /** True while the root membership row is being written / user_role hasn't resolved yet. */
  provisioning: boolean
  children: React.ReactNode
}

/**
 * 05-states.html e3 — holds the switcher until `user_role` resolves so it
 * never flashes a GUEST/empty state mid-provision. Distinct from the
 * existing `WorkspaceProvisioningGate` (which gates the whole shell on the
 * legacy `type='personal'` org existing): this gate is scoped to the
 * identity-context-switcher's own data, for the fail-closed "membership
 * pending" case in FF-EPIC-17-S4 AC4 (a legacy account the S2 backfill
 * hasn't reached yet) — never a raw GUEST/error page while self-heal (S1)
 * catches it up.
 */
export function ProvisioningGate({ provisioning, children }: ProvisioningGateProps) {
  if (!provisioning) return <>{children}</>

  return (
    <div
      data-state="provisioning"
      aria-busy="true"
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-5)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Setting up your account…
      </span>
      <Skeleton width="60%" />
    </div>
  )
}
