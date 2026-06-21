import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { IdentityI18nProvider, useIdentityI18n, type IdentityLocale } from '../../i18n/IdentityI18nProvider'
import { createIdentityClient } from '../../api/identityClient'
import { MembersTable } from '../members/MembersTable'
import { PendingInvitesList } from '../invites/PendingInvitesList'
import { InviteModal } from '../invites/InviteModal'
import { TokenList } from '../tokens/TokenList'
import { TokenCreateModal } from '../tokens/TokenCreateModal'
import type { ApiTokenSummary, IdentityApiClient, Invitation, Member, OrgRole } from '../../types'

export interface IdentityPageProps {
  organizationId: string
  userRole: OrgRole
  /** Current user id — owner of personal tokens. */
  userId?: string
  /** Override the API client (tests / custom transport). */
  apiClient?: IdentityApiClient
  /** Bearer-token accessor passed to the default client. */
  getToken?: () => string | null | undefined
  locale?: IdentityLocale
  /** Notifies the host after a membership change so it can re-sync. */
  onMembersChange?: () => void
}

type TabKey = 'members' | 'pending' | 'tokens'

/**
 * Top-level tabbed identity page (Members / Pending Invitations / API Tokens).
 * Owns its own data fetching via the identity client unless `apiClient` is
 * injected. Wraps itself in the i18n provider and applies `dir` for RTL.
 */
export function IdentityPage(props: IdentityPageProps) {
  return (
    <IdentityI18nProvider locale={props.locale ?? 'en'}>
      <IdentityPageInner {...props} />
    </IdentityI18nProvider>
  )
}

function IdentityPageInner({
  organizationId,
  userRole,
  userId,
  apiClient,
  getToken,
  onMembersChange,
}: IdentityPageProps) {
  const { messages, dir } = useIdentityI18n()
  const client = useMemo(() => apiClient ?? createIdentityClient({ getToken }), [apiClient, getToken])
  const canManageTokens = !!userId || userRole === 'owner' || userRole === 'admin'

  const [tab, setTab] = useState<TabKey>('members')
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [invites, setInvites] = useState<Invitation[]>([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)
  const [tokensError, setTokensError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [tokenModalOpen, setTokenModalOpen] = useState(false)

  const loadMembers = useCallback(async () => {
    setMembersLoading(true)
    setMembersError(null)
    try {
      setMembers(await client.listMembers(organizationId))
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Error')
    } finally {
      setMembersLoading(false)
    }
  }, [client, organizationId])

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true)
    setInvitesError(null)
    try {
      setInvites(await client.listInvitations(organizationId))
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Error')
    } finally {
      setInvitesLoading(false)
    }
  }, [client, organizationId])

  const loadTokens = useCallback(async () => {
    setTokensLoading(true)
    setTokensError(null)
    try {
      const list = userId ? await client.listTokens() : await client.listOrgTokens(organizationId)
      setTokens(list)
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Error')
    } finally {
      setTokensLoading(false)
    }
  }, [client, organizationId, userId])

  useEffect(() => {
    loadMembers()
    loadInvites()
    loadTokens()
  }, [loadMembers, loadInvites, loadTokens])

  const tabButton = (key: TabKey, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      style={{
        appearance: 'none',
        background: 'none',
        border: 'none',
        borderBottom: tab === key ? '2px solid var(--accent-color)' : '2px solid transparent',
        padding: 'var(--space-3) var(--space-4)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-medium)',
        color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      dir={dir}
      style={{
        maxWidth: 'var(--container-max)',
        padding: 'var(--space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border-color)', flex: 1 }}>
          {tabButton('members', messages.members.title)}
          {tabButton('pending', messages.invitations.title)}
          {tabButton('tokens', messages.tokens.title)}
        </div>
        {tab === 'members' && (userRole === 'owner' || userRole === 'admin') && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>{messages.members.invite}</Button>
        )}
        {tab === 'tokens' && canManageTokens && (
          <Button variant="primary" onClick={() => setTokenModalOpen(true)}>{messages.tokens.newToken}</Button>
        )}
      </div>

      {tab === 'members' && (
        <MembersTable
          organizationId={organizationId}
          members={members}
          loading={membersLoading}
          error={membersError}
          userRole={userRole}
          onInvite={() => setInviteOpen(true)}
          onRetry={loadMembers}
          onRoleChange={async (memberId, role) => {
            await client.updateMemberRole(organizationId, memberId, role)
            await loadMembers()
            onMembersChange?.()
          }}
          onRemove={async (memberId) => {
            await client.removeMember(organizationId, memberId)
            await loadMembers()
            onMembersChange?.()
          }}
        />
      )}

      {tab === 'pending' && (
        <PendingInvitesList
          invitations={invites}
          loading={invitesLoading}
          error={invitesError}
          userRole={userRole}
          onRetry={loadInvites}
          onResend={async (id) => {
            await client.resendInvitation(organizationId, id)
          }}
          onRevoke={async (id) => {
            await client.revokeInvitation(organizationId, id)
          }}
        />
      )}

      {tab === 'tokens' && (
        <TokenList
          tokens={tokens}
          loading={tokensLoading}
          error={tokensError}
          onRetry={loadTokens}
          onRevoke={async (id) => {
            await client.revokeToken(id)
            await loadTokens()
          }}
        />
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={(email, role) => client.invite(organizationId, email, role)}
        onBulkInvite={(invitations) => client.bulkInvite(organizationId, invitations)}
        onSuccess={() => {
          loadInvites()
          loadMembers()
        }}
      />

      <TokenCreateModal
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        ownerType={userId ? 'user' : 'org'}
        ownerId={userId ?? organizationId}
        orgId={organizationId}
        onCreate={(input) => client.createToken(input)}
        onCreated={() => loadTokens()}
      />
    </div>
  )
}
