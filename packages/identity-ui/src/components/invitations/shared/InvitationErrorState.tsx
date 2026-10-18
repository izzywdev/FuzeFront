import type { ReactNode } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { InviteFailure } from '../../../api/invitationsClient'

export interface InvitationErrorStateProps {
  failure: InviteFailure
  /** Org name, interpolated into already-accepted / last-owner copy. */
  orgName?: string
  /** The signed-in identity (identity-mismatch copy). */
  currentIdentity?: string
  /** The invited (masked) identity (identity-mismatch copy). */
  invitedIdentity?: string
  /** Extra server detail shown beneath the standard copy. */
  detail?: string
  onRetry?: () => void
  onSwitchAccount?: () => void
  onGoToOrg?: () => void
  onTransferOwnership?: () => void
}

interface Spec {
  state: string
  http?: string
  code: string
  tone: 'error' | 'warning' | 'success' | 'info'
  icon: string
}

const SPEC: Record<InviteFailure, Spec> = {
  expired: { state: 'token-invalid', http: '410', code: 'INVITATION_EXPIRED', tone: 'error', icon: '⏱️' },
  mismatch: { state: 'identity-mismatch', http: '403', code: 'IDENTITY_MISMATCH', tone: 'error', icon: '🔔' },
  'already-accepted': {
    state: 'already-accepted',
    http: '409',
    code: 'INVITATION_ALREADY_ACCEPTED',
    tone: 'success',
    icon: '✓',
  },
  'not-found': { state: 'not-found', http: '404', code: 'NOT_FOUND', tone: 'error', icon: '🔎' },
  'last-owner': { state: 'last-owner', http: '409', code: 'LAST_OWNER', tone: 'warning', icon: '🛡️' },
  forbidden: { state: 'forbidden', http: '403', code: 'FORBIDDEN', tone: 'error', icon: '⛔' },
  duplicate: { state: 'duplicate', http: '409', code: 'CONFLICT', tone: 'warning', icon: '⚠️' },
  'invalid-phone': { state: 'invalid-phone', http: '400', code: 'INVALID_PHONE', tone: 'error', icon: '⚠️' },
  'delivery-failed': { state: 'send-error', code: 'DELIVERY_FAILED', tone: 'error', icon: '⚠️' },
  'rate-limited': { state: 'rate-limited', http: '429', code: 'RATE_LIMITED', tone: 'warning', icon: '⏳' },
  unauthenticated: { state: 'unauthenticated', http: '401', code: 'NO_TOKEN', tone: 'error', icon: '🔒' },
  unknown: { state: 'error', code: 'UNKNOWN', tone: 'error', icon: '⚠️' },
}

/**
 * Renders every fail-closed invitation state from design/frames/org-invitations-v2
 * /06-states.html IN PLACE — never a redirect. Each carries `data-state`,
 * `data-http` and `data-error-code` so the frame contract is machine-checkable.
 * `already-accepted` is success-equivalent (go to the org); `forbidden` is a 403
 * rendered where it happened (only 401 re-authenticates).
 */
export function InvitationErrorState({
  failure,
  orgName = '',
  currentIdentity = '',
  invitedIdentity = '',
  detail,
  onRetry,
  onSwitchAccount,
  onGoToOrg,
  onTransferOwnership,
}: InvitationErrorStateProps) {
  const { messages, t } = useIdentityI18n()
  const s = messages.invitationsV2.states
  const inv = messages.invitationsV2.invite
  const acc = messages.invitationsV2.accept
  const spec = SPEC[failure]
  const vars = { orgName, current: currentIdentity, invited: invitedIdentity }

  let title: string
  let body: string
  let actions: ReactNode = null

  switch (failure) {
    case 'expired':
      title = s.expiredTitle
      body = s.expiredBody
      break
    case 'mismatch':
      title = s.mismatchTitle
      body = t(s.mismatchBody, vars)
      actions = onSwitchAccount ? (
        <Button variant="secondary" size="sm" data-action="switch-account" onClick={onSwitchAccount}>
          {s.switchAccount}
        </Button>
      ) : null
      break
    case 'already-accepted':
      title = t(s.alreadyTitle, vars)
      body = s.alreadyBody
      actions = onGoToOrg ? (
        <Button variant="primary" size="sm" data-action="go-to-org" onClick={onGoToOrg}>
          {t(acc.goToOrg, vars)}
        </Button>
      ) : null
      break
    case 'not-found':
      title = s.notFoundTitle
      body = s.notFoundBody
      break
    case 'last-owner':
      title = t(s.lastOwnerTitle, vars)
      body = s.lastOwnerBody
      actions = onTransferOwnership ? (
        <Button variant="secondary" size="sm" data-action="transfer-ownership" onClick={onTransferOwnership}>
          {s.transferOwnership}
        </Button>
      ) : null
      break
    case 'forbidden':
      title = s.forbiddenTitle
      body = s.forbiddenBody
      break
    case 'duplicate':
      title = inv.duplicate
      body = ''
      break
    case 'delivery-failed':
      title = inv.genericError
      body = inv.deliveryFailed
      actions = onRetry ? (
        <Button variant="secondary" size="sm" data-action="retry" onClick={onRetry}>
          {messages.invitationsV2.pending.resend}
        </Button>
      ) : null
      break
    case 'invalid-phone':
      title = inv.phoneInvalid
      body = ''
      break
    default:
      title = s.genericTitle
      body = s.genericBody
      actions = onRetry ? (
        <Button variant="secondary" size="sm" data-action="retry" onClick={onRetry}>
          {s.retry}
        </Button>
      ) : null
  }

  return (
    <div
      data-state={spec.state}
      data-http={spec.http}
      data-error-code={spec.code}
    >
      <StatusCallout tone={spec.tone} icon={spec.icon} title={title} actions={actions}>
        {body}
        {detail ? <span style={{ display: 'block', marginBlockStart: 'var(--space-1)' }}>{detail}</span> : null}
      </StatusCallout>
    </div>
  )
}
