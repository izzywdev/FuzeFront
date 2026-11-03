import { useState } from 'react'
import { Button, Skeleton } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import { classifyInviteError, type InviteFailure, type OrgInvitation } from '../../../api/invitationsClient'
import { InvitationErrorState } from '../shared/InvitationErrorState'
import { inviteeAddress } from '../shared/InviteTags'
import { PendingInvitationRow } from './PendingInvitationRow'
import { RevokeInviteDialog } from './RevokeInviteDialog'

export interface PendingInvitationsPanelProps {
  invitations: OrgInvitation[]
  /** Initial load in flight → aria-busy skeleton rows. */
  loading?: boolean
  /** A non-2xx (other than 403) from the list endpoint → error + retry. */
  error?: string | null
  /** 403 from the list endpoint → rendered in place, zero data, never a sign-in redirect. */
  forbidden?: boolean
  /** Cursor envelope: `page.hasMore`. Drives "Load more" (the full set never arrives in one response). */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onRetry?: () => void
  /** Empty-state CTA; omit to hide it (callers without invite rights). */
  onInvite?: () => void
  /** Resend one invitation (`POST …/resend`). Reject to surface the failure on the row. */
  onResend: (id: string) => Promise<void>
  /** Revoke one invitation (`DELETE …/{id}`). */
  onRevoke: (id: string) => Promise<void>
  canManage: boolean
  currentUserId?: string
  /** Seconds a row's Resend stays disabled after a successful resend. Default 600 (10 min). */
  resendCooldownSeconds?: number
  /** The true count when the server provides one (`page.total`); otherwise the loaded count. */
  total?: number
}

/**
 * The per-org pending-invitations panel (design/frames/org-invitations-v2/
 * 02-pending-invitations.html + 06-states.html). Renders every state:
 * loading (aria-busy skeleton) · empty (real state, invite CTA) · error (retry) ·
 * forbidden (in place) · populated, with a cursor "Load more" pager.
 * `[data-panel="pending-invitations"]` + `[data-state]`, list `[data-list="pending"]`.
 */
export function PendingInvitationsPanel({
  invitations,
  loading = false,
  error = null,
  forbidden = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRetry,
  onInvite,
  onResend,
  onRevoke,
  canManage,
  currentUserId,
  resendCooldownSeconds = 600,
  total,
}: PendingInvitationsPanelProps) {
  const { messages, t } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  const [busy, setBusy] = useState<Record<string, 'resend' | 'revoke'>>({})
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
  const [rowFailure, setRowFailure] = useState<Record<string, InviteFailure>>({})
  const [confirm, setConfirm] = useState<OrgInvitation | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const state = forbidden
    ? 'forbidden'
    : error
      ? 'error'
      : loading
        ? 'loading'
        : invitations.length === 0
          ? 'empty'
          : 'populated'

  function clearBusy(id: string) {
    setBusy((b) => {
      const next = { ...b }
      delete next[id]
      return next
    })
  }

  async function resend(inv: OrgInvitation) {
    setBusy((b) => ({ ...b, [inv.id]: 'resend' }))
    setRowFailure((f) => {
      const next = { ...f }
      delete next[inv.id]
      return next
    })
    try {
      await onResend(inv.id)
      setCooldowns((c) => ({ ...c, [inv.id]: Date.now() + resendCooldownSeconds * 1000 }))
      setNotice(p.resent)
    } catch (err) {
      const failure = classifyInviteError(err, 'admin')
      // The server's rate limit is authoritative: start the cooldown locally too.
      if (failure === 'rate-limited' || failure === 'duplicate') {
        setCooldowns((c) => ({ ...c, [inv.id]: Date.now() + resendCooldownSeconds * 1000 }))
      } else {
        setRowFailure((f) => ({ ...f, [inv.id]: failure }))
      }
    } finally {
      clearBusy(inv.id)
    }
  }

  async function revoke(inv: OrgInvitation) {
    setBusy((b) => ({ ...b, [inv.id]: 'revoke' }))
    try {
      await onRevoke(inv.id)
      setConfirm(null)
      setNotice(p.revoked)
    } catch (err) {
      setConfirm(null)
      setRowFailure((f) => ({ ...f, [inv.id]: classifyInviteError(err, 'admin') }))
    } finally {
      clearBusy(inv.id)
    }
  }

  return (
    <section
      data-panel="pending-invitations"
      data-state={state}
      aria-busy={loading ? 'true' : undefined}
      aria-label={p.title}
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div style={{ height: 'var(--border-width-strong)', background: 'var(--seam)' }} aria-hidden="true" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-lg)',
            color: 'var(--text-primary)',
          }}
        >
          {p.title}
        </h2>
        {state === 'populated' && (
          <span data-count="pending" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {t(p.count, { count: total ?? invitations.length })}
          </span>
        )}
      </div>

      <div role="status" aria-live="polite" style={{ paddingInline: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--success-color)' }}>
        {notice ?? ''}
      </div>

      {state === 'loading' && (
        <div role="status" aria-label={p.loadingLabel}>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--space-4)',
                padding: 'var(--space-4) var(--space-5)',
                borderBlockStart: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
                <Skeleton width="52%" height="1em" />
                <Skeleton width="30%" height="0.8em" />
              </div>
              <Skeleton width="4rem" height="1.4em" />
            </div>
          ))}
        </div>
      )}

      {state === 'forbidden' && (
        <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-5)' }}>
          <InvitationErrorState failure="forbidden" />
        </div>
      )}

      {state === 'error' && (
        <div data-error style={{ padding: 'var(--space-4) var(--space-5) var(--space-5)' }}>
          <InvitationErrorState failure="unknown" detail={error ?? undefined} onRetry={onRetry} />
        </div>
      )}

      {state === 'empty' && (
        <div
          data-empty
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-8) var(--space-5)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>{p.emptyTitle}</p>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{p.emptyBody}</p>
          {onInvite && (
            <Button variant="secondary" size="sm" data-action="open-invite" onClick={onInvite}>
              ＋ {messages.invitationsV2.invite.button}
            </Button>
          )}
        </div>
      )}

      {state === 'populated' && (
        <div data-list="pending">
          {invitations.map((inv) => (
            <div key={inv.id}>
              <PendingInvitationRow
                invitation={inv}
                currentUserId={currentUserId}
                canManage={canManage}
                busy={busy[inv.id]}
                cooldownUntil={cooldowns[inv.id]}
                onResend={() => void resend(inv)}
                onRevoke={() => setConfirm(inv)}
              />
              {rowFailure[inv.id] && (
                <div style={{ padding: '0 var(--space-5) var(--space-4)' }}>
                  <InvitationErrorState failure={rowFailure[inv.id]} />
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', justifyContent: 'center' }}>
              <Button variant="secondary" size="sm" data-action="load-more" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? messages.common.loading : p.loadMore}
              </Button>
            </div>
          )}
        </div>
      )}

      <RevokeInviteDialog
        open={confirm !== null}
        address={confirm ? inviteeAddress(confirm.invitee) : ''}
        busy={confirm ? busy[confirm.id] === 'revoke' : false}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void revoke(confirm)}
      />
    </section>
  )
}
