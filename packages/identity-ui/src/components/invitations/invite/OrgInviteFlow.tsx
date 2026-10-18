import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import { HttpError, type HttpClientOptions } from '../../../api/http'
import {
  createInvitationsClient,
  type InvitationsApiClient,
  type OrgInvitation,
} from '../../../api/invitationsClient'
import type { OrgRole } from '../../../types'
import { PendingInvitationsPanel } from '../pending/PendingInvitationsPanel'
import { InviteModalV2 } from './InviteModalV2'
import type { AccountOption } from './InviteFields'

const PAGE_SIZE = 25

export interface OrgInviteFlowProps {
  organizationId: string
  orgName?: string
  userRole: OrgRole
  /** The signed-in user's id, to render "invited by you". */
  userId?: string
  /** Override the invitations client (tests / custom transport). */
  client?: InvitationsApiClient
  /** Bearer-token accessor for the default client. */
  getToken?: HttpClientOptions['getToken']
  /** The invite dialog is controlled so the Members-tab button can open it. */
  inviteOpen: boolean
  onInviteOpenChange: (open: boolean) => void
  /** Render the pending-invitations panel (the Pending tab). The dialog is always available. */
  showPending?: boolean
  /** Server-side account search for the "existing account-holder" kind. */
  searchAccounts?: (query: string) => Promise<AccountOption[]>
  /** Called after an invitation is created or revoked, so the host can re-sync. */
  onChanged?: () => void
  /** Items per page (cursor envelope `limit`). */
  pageSize?: number
}

/**
 * OrgInviteFlow — the invite flow orchestrator
 * (design/frames/org-invitations-v2, flow `invite`, route `/settings/access`).
 * Owns the data: a cursor-paginated pending list (follows `page.nextCursor`
 * until `hasMore` is false, via "Load more"), create / resend / revoke against
 * the frozen contract's `InvitationsApiClient`, and composes the pending panel
 * + the invite dialog. A 403 from the list renders in place (forbidden), never a
 * sign-in redirect.
 */
export function OrgInviteFlow({
  organizationId,
  orgName,
  userRole,
  userId,
  client: injected,
  getToken,
  inviteOpen,
  onInviteOpenChange,
  showPending = true,
  searchAccounts,
  onChanged,
  pageSize = PAGE_SIZE,
}: OrgInviteFlowProps) {
  const { messages } = useIdentityI18n()
  const client = useMemo(() => injected ?? createInvitationsClient({ getToken }), [injected, getToken])
  const canManage = userRole === 'owner' || userRole === 'admin'

  const [items, setItems] = useState<OrgInvitation[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const seq = useRef(0)

  const loadFirst = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    setForbidden(false)
    try {
      const res = await client.list(organizationId, { limit: pageSize, status: 'pending' })
      if (id !== seq.current) return
      setItems(res.items)
      setNextCursor(res.page.nextCursor)
      setHasMore(res.page.hasMore)
      setTotal(res.page.total)
    } catch (err) {
      if (id !== seq.current) return
      if (err instanceof HttpError && err.status === 403) setForbidden(true)
      else setError(err instanceof Error ? err.message : messages.invitationsV2.pending.errorBody)
      setItems([])
      setHasMore(false)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [client, organizationId, pageSize, messages.invitationsV2.pending.errorBody])

  useEffect(() => {
    if (showPending) void loadFirst()
  }, [showPending, loadFirst])

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return
    const id = seq.current
    setLoadingMore(true)
    try {
      const res = await client.list(organizationId, { limit: pageSize, status: 'pending', cursor: nextCursor })
      if (id !== seq.current) return
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        return [...prev, ...res.items.filter((i) => !seen.has(i.id))]
      })
      setNextCursor(res.page.nextCursor)
      setHasMore(res.page.hasMore)
      setTotal(res.page.total)
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : messages.invitationsV2.pending.errorBody)
    } finally {
      setLoadingMore(false)
    }
  }, [client, organizationId, pageSize, hasMore, nextCursor, loadingMore, messages.invitationsV2.pending.errorBody])

  return (
    <>
      {showPending && (
        <PendingInvitationsPanel
          invitations={items}
          loading={loading}
          error={error}
          forbidden={forbidden}
          hasMore={hasMore}
          loadingMore={loadingMore}
          total={total}
          canManage={canManage}
          currentUserId={userId}
          onLoadMore={() => void loadMore()}
          onRetry={() => void loadFirst()}
          onInvite={canManage ? () => onInviteOpenChange(true) : undefined}
          onResend={async (id) => {
            const refreshed = await client.resend(organizationId, id)
            setItems((prev) => prev.map((i) => (i.id === refreshed.id ? refreshed : i)))
          }}
          onRevoke={async (id) => {
            await client.revoke(organizationId, id)
            setItems((prev) => prev.filter((i) => i.id !== id))
            onChanged?.()
          }}
        />
      )}
      <InviteModalV2
        open={inviteOpen}
        orgName={orgName}
        onClose={() => onInviteOpenChange(false)}
        onSubmit={(body) => client.create(organizationId, body)}
        onSent={() => {
          onInviteOpenChange(false)
          if (showPending) void loadFirst()
          onChanged?.()
        }}
        onDraftSaved={() => {
          if (showPending) void loadFirst()
        }}
        searchAccounts={searchAccounts}
      />
    </>
  )
}
