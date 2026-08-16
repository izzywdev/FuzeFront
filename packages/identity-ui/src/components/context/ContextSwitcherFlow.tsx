import { useState } from 'react'
import { ContextPill } from './ContextPill'
import { ContextSwitcher } from './ContextSwitcher'
import { ProvisioningGate } from './ProvisioningGate'
import { ContextSwitchErrorNotice } from './ContextSwitchErrorNotice'
import { AccessLostNotice } from './AccessLostNotice'
import {
  CreateOrganizationDialog,
  type CreateOrganizationInput,
  type CreatedOrganization,
} from '../organizations/CreateOrganizationDialog'
import type { ContextTarget, OrgContextItem } from '../../types'

export interface ContextSwitcherFlowProps {
  /** The currently active context — 'personal' or an org id. */
  activeTarget: ContextTarget
  userName: string
  /** Every org the caller directly belongs to (root included), with real `user_role`. */
  organizations: OrgContextItem[]
  rootOrgId?: string
  /** True while `user_role` for the active context hasn't resolved yet (05-states e3). */
  provisioning?: boolean
  /** The org list / target org failed to load (05-states e4). */
  error?: string | null
  /** The active org membership was revoked mid-session — fail-closed 403 (05-states e5). */
  accessLost?: boolean
  onSelect: (target: ContextTarget) => void
  onRetry?: () => void
  onGoPersonal?: () => void
  onCreateOrg: (input: CreateOrganizationInput) => Promise<CreatedOrganization>
  onCreated?: (org: CreatedOrganization) => void
  canCreate?: boolean
}

function activeLabel(activeTarget: ContextTarget, organizations: OrgContextItem[]): string {
  if (activeTarget === 'personal') return 'Personal'
  return organizations.find(o => o.id === activeTarget)?.name ?? 'Select context'
}

/**
 * ContextSwitcherFlow — the mounted header widget reconciling
 * OrganizationPage.tsx's local `<select>` and UserMenu.tsx's canonical
 * `setActiveOrganization` into ONE switcher (design/frames/
 * identity-context-switcher, flow `context-switch`, route `/`).
 *
 * Fully controlled: the host (frontend/src/components/UserMenu.tsx) owns
 * data fetching (`useOrganizations()`) and persistence (`setActiveOrganization`)
 * — this component only renders the pill + popover + every 05-states.html
 * state and calls back on selection / create / retry.
 */
export function ContextSwitcherFlow({
  activeTarget,
  userName,
  organizations,
  rootOrgId,
  provisioning = false,
  error = null,
  accessLost = false,
  onSelect,
  onRetry,
  onGoPersonal,
  onCreateOrg,
  onCreated,
  canCreate = true,
}: ContextSwitcherFlowProps) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  function handleSelect(target: ContextTarget) {
    onSelect(target)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <ContextPill
        label={activeLabel(activeTarget, organizations)}
        context={activeTarget === 'personal' ? 'personal' : 'org'}
        open={open}
        onClick={() => setOpen(v => !v)}
      />

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 999 }}
          />
          <div
            style={{
              position: 'absolute',
              insetBlockStart: '100%',
              insetInlineStart: 0,
              marginBlockStart: 'var(--space-2)',
              zIndex: 1000,
            }}
          >
            {accessLost ? (
              <AccessLostNotice
                onGoPersonal={() => {
                  onGoPersonal?.()
                  setOpen(false)
                }}
              />
            ) : error ? (
              <ContextSwitchErrorNotice onRetry={() => onRetry?.()} />
            ) : (
              <ProvisioningGate provisioning={provisioning}>
                <ContextSwitcher
                  activeTarget={activeTarget}
                  userName={userName}
                  organizations={organizations}
                  rootOrgId={rootOrgId}
                  onSelect={handleSelect}
                  onCreateOrg={() => {
                    setOpen(false)
                    setCreateOpen(true)
                  }}
                  canCreate={canCreate}
                />
              </ProvisioningGate>
            )}
          </div>
        </>
      )}

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateOrg}
        onCreated={org => {
          onCreated?.(org)
          onSelect(org.id)
        }}
      />
    </div>
  )
}
