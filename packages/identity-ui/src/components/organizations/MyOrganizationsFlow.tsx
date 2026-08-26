import { useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { MyOrganizationsList } from './MyOrganizationsList'
import {
  CreateOrganizationDialog,
  type CreateOrganizationInput,
  type CreatedOrganization,
} from './CreateOrganizationDialog'
import type { OrgContextItem } from '../../types'

export interface MyOrganizationsFlowProps {
  organizations: OrgContextItem[]
  rootOrgId?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onOpenOrg: (id: string) => void
  onCreate: (input: CreateOrganizationInput) => Promise<CreatedOrganization>
  onCreated?: (org: CreatedOrganization) => void
  canCreate?: boolean
}

/**
 * "My orgs & sub-orgs" — 04-my-orgs.html, flow `my-orgs`, route
 * `/organizations`. Supersedes OrganizationPage.tsx's local `<select>`:
 * this is the canonical place to browse and switch among the orgs/sub-orgs
 * the caller directly belongs to.
 */
export function MyOrganizationsFlow({
  organizations,
  rootOrgId,
  loading,
  error,
  onRetry,
  onOpenOrg,
  onCreate,
  onCreated,
  canCreate = true,
}: MyOrganizationsFlowProps) {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          marginBlockEnd: 'var(--space-2)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
          }}
        >
          Your organizations
        </h1>
        <span style={{ flex: 1 }} />
        {canCreate && (
          <Button variant="primary" data-action="create-org" onClick={() => setCreateOpen(true)}>
            ＋ Create organization
          </Button>
        )}
      </div>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>
        The orgs you own or belong to, each with your role and its sub-org tree. This list shows your{' '}
        <strong>direct memberships</strong> only — access you hold through a parent/root org has no row here.
      </p>

      <MyOrganizationsList
        organizations={organizations}
        rootOrgId={rootOrgId}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onOpenOrg={onOpenOrg}
        onCreateOrg={() => setCreateOpen(true)}
        canCreate={canCreate}
      />

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreate}
        onCreated={org => {
          onCreated?.(org)
          onOpenOrg(org.id)
        }}
      />
    </div>
  )
}
