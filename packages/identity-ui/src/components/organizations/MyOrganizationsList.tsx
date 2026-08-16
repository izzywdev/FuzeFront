import { EmptyState } from '../common/EmptyState'
import { OrgCard } from './OrgCard'
import { buildOrgForest } from './orgTree'
import type { OrgContextItem } from '../../types'

export interface MyOrganizationsListProps {
  organizations: OrgContextItem[]
  rootOrgId?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onOpenOrg: (id: string) => void
  onCreateOrg?: () => void
  canCreate?: boolean
}

/**
 * "My orgs & sub-orgs" — 04-my-orgs.html. Direct memberships only: access
 * held only through a parent/root org has no row here. Root always renders
 * (FF-EPIC-17-S4 AC3 — a user who belongs only to root sees just root with
 * MEMBER, never an empty/broken list); when there is nothing BEYOND root, an
 * inline "Just you and the platform, for now" prompt (05-states e2) invites
 * creating the first organization.
 */
export function MyOrganizationsList({
  organizations,
  rootOrgId,
  loading,
  error,
  onRetry,
  onOpenOrg,
  onCreateOrg,
  canCreate = true,
}: MyOrganizationsListProps) {
  if (loading) {
    return <EmptyState variant="loading" message="Fetching your organizations" />
  }

  if (error) {
    return (
      <EmptyState variant="error" title="Couldn't load your organizations" message={error} actionLabel={onRetry ? 'Retry' : undefined} onAction={onRetry} />
    )
  }

  const forest = buildOrgForest(organizations, rootOrgId)
  const beyondRoot = forest.filter(n => !n.item.isRoot)

  return (
    <div data-panel="my-orgs" data-list="my-orgs" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {forest
        .filter(n => n.item.isRoot)
        .map(node => (
          <OrgCard key={node.item.id} node={node} onOpen={onOpenOrg} />
        ))}

      {beyondRoot.length === 0 ? (
        <EmptyState
          variant="no-orgs"
          title="Just you and the platform, for now"
          message="A brand-new user has a Personal context and membership of root and nothing else. Create your first organization to get started."
          actionLabel={canCreate && onCreateOrg ? '+ Create organization' : undefined}
          onAction={canCreate ? onCreateOrg : undefined}
        />
      ) : (
        beyondRoot.map(node => <OrgCard key={node.item.id} node={node} onOpen={onOpenOrg} />)
      )}
    </div>
  )
}
