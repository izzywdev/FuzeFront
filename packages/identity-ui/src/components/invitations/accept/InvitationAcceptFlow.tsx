import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AuthCard, Skeleton } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import type { HttpClientOptions } from '../../../api/http'
import {
  classifyInviteError,

  isEnroll,
  type InvitationAcceptResult,
  type InvitationChannel,
  type InvitationResolveResult,
  type InvitationsApiClient,
  type InviteFailure,
} from '../../../api/invitationsClient'
import { useInvitationsClient } from '../shared/useInvitationsClient'
import { InvitationErrorState } from '../shared/InvitationErrorState'
import { InvitationAcceptCard } from './InvitationAcceptCard'
import { InvitationBindSuccess } from './InvitationBindSuccess'
import { InvitationSignupPanel } from './InvitationSignupPanel'

export interface SignupSlotContext {
  /** Single-use token from the `202` accept response — forward it as `SignupRequest.bindToken`. */
  bindToken: string
  /** The masked invited contact, for the "use the address this invite was sent to" hint. */
  maskedContact: string
  channel: InvitationChannel
  orgName: string
  /** Call once sign-up succeeded and a session exists, so the flow can confirm the bind. */
  onSignedUp: () => void
}

export interface InvitationAcceptFlowProps {
  /** The opaque invitation token from the URL — a lookup key, never a capability. */
  token: string
  client?: InvitationsApiClient
  getToken?: HttpClientOptions['getToken']
  /** The signed-in identity, or `null` when anonymous. */
  session: { email?: string } | null
  /**
   * The sign-up form slot (host mounts `@fuzefront/auth-ui`'s `AuthPanel` here).
   * Receives the `bindToken` so the server auto-binds on signup.
   */
  renderSignup: (ctx: SignupSlotContext) => ReactNode
  /** Anonymous secondary action: route to sign-in, carrying the invitation. */
  onSignIn: () => void
  /** Identity-mismatch recovery: sign out / switch account. */
  onSwitchAccount?: () => void
  onGoToOrg: (organizationId: string) => void
  /**
   * Fired when the accept call returns `202 enroll`, before the sign-up form is
   * shown — lets the host persist `{token, bindToken}` across an off-site social
   * round trip so the invite is not dropped.
   */
  onEnroll?: (info: { token: string; bindToken: string }) => void
  /** Accept immediately once resolved when a session exists (return from sign-up / social). */
  autoAccept?: boolean
  onBound?: (result: Pick<InvitationAcceptResult, 'organizationId' | 'role' | 'memberType'>) => void
}

type Step =
  | { name: 'resolving' }
  | { name: 'ready' }
  | { name: 'accepting' }
  | { name: 'signup'; bindToken: string }
  | { name: 'bound'; role: InvitationAcceptResult['role']; memberType: InvitationAcceptResult['memberType'] }
  | { name: 'failed'; failure: InviteFailure }

/**
 * InvitationAcceptFlow — resolve → accept → (sign up) → bind
 * (design/frames/org-invitations-v2, flow `accept-bind`, route `/invitations/accept`).
 *
 * Closes the v1 token-drop gap: an anonymous "Create account" no longer just
 * redirects away. The accept call returns `202` with a single-use `bindToken`,
 * which the sign-up form forwards (`SignupRequest.bindToken`) so the new account
 * is bound to the invited identity as part of signup — and `onEnroll` lets the
 * host persist the invite across a social (Google / Facebook) round trip, after
 * which `autoAccept` binds on return. After sign-up the flow re-confirms by
 * accepting with the new session: `200` → bound; `409` right after sign-up is the
 * bind having already happened, so it is shown as success too.
 *
 * Fail-closed states render in place: 410 expired/revoked, 403 identity
 * mismatch, 409 already-accepted (success-equivalent), 404 not found.
 */
export function InvitationAcceptFlow({
  token,
  client: injected,
  getToken,
  session,
  renderSignup,
  onSignIn,
  onSwitchAccount,
  onGoToOrg,
  onEnroll,
  autoAccept = false,
  onBound,
}: InvitationAcceptFlowProps) {
  const { messages } = useIdentityI18n()
  const client = useInvitationsClient(injected, getToken)
  const [resolved, setResolved] = useState<InvitationResolveResult | null>(null)
  const [step, setStep] = useState<Step>({ name: 'resolving' })
  const fromSignup = useRef(false)
  const autoAccepted = useRef(false)

  // 1. Resolve the token server-side — never trust client state.
  useEffect(() => {
    let cancelled = false
    setStep({ name: 'resolving' })
    client
      .resolve(token)
      .then((res) => {
        if (cancelled) return
        setResolved(res)
        const status = res.invitation.status
        if (status === 'accepted') setStep({ name: 'failed', failure: 'already-accepted' })
        else if (status === 'revoked' || status === 'expired') setStep({ name: 'failed', failure: 'expired' })
        else setStep({ name: 'ready' })
      })
      .catch((err) => {
        if (!cancelled) setStep({ name: 'failed', failure: classifyInviteError(err, 'accept') })
      })
    return () => {
      cancelled = true
    }
  }, [client, token])

  const accept = useCallback(async () => {
    if (!resolved) return
    setStep({ name: 'accepting' })
    try {
      const outcome = await client.accept(token)
      if (isEnroll(outcome)) {
        // 202 — the invitee has no session yet. Hand the bindToken to the sign-up form.
        onEnroll?.({ token, bindToken: outcome.bindToken })
        setStep({ name: 'signup', bindToken: outcome.bindToken })
        return
      }
      setStep({ name: 'bound', role: outcome.role, memberType: outcome.memberType })
      onBound?.(outcome)
    } catch (err) {
      const failure = classifyInviteError(err, 'accept')
      if (failure === 'already-accepted' && fromSignup.current) {
        // The bindToken redeemed on signup already bound the membership.
        setStep({ name: 'bound', role: resolved.invitation.role, memberType: resolved.invitation.memberType })
        return
      }
      setStep({ name: 'failed', failure })
    }
  }, [client, token, resolved, onEnroll, onBound])

  // Return from sign-up / social: bind straight away, once.
  useEffect(() => {
    if (autoAccept && session && step.name === 'ready' && !autoAccepted.current) {
      autoAccepted.current = true
      fromSignup.current = true
      void accept()
    }
  }, [autoAccept, session, step.name, accept])

  const orgName = resolved?.organization.name ?? ''
  const maskedContact = resolved?.invitation.maskedContact ?? ''

  if (step.name === 'resolving') {
    return (
      <AuthCard maxWidth="30rem" data-panel="accept-resolve" data-state="loading" aria-busy="true">
        <div role="status" aria-label={messages.invitationsV2.accept.resolving} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Skeleton width="60%" height="1.4em" />
          <Skeleton width="100%" height="6rem" />
          <Skeleton width="100%" height="2.5rem" />
        </div>
      </AuthCard>
    )
  }

  if (step.name === 'failed') {
    return (
      <AuthCard maxWidth="30rem" data-panel="accept-resolve">
        <InvitationErrorState
          failure={step.failure}
          orgName={orgName}
          currentIdentity={session?.email}
          invitedIdentity={maskedContact}
          onSwitchAccount={onSwitchAccount ?? onSignIn}
          onGoToOrg={resolved ? () => onGoToOrg(resolved.organization.id) : undefined}
          onRetry={step.failure === 'unknown' ? () => void accept() : undefined}
        />
      </AuthCard>
    )
  }

  if (step.name === 'bound' && resolved) {
    return (
      <InvitationBindSuccess
        orgName={orgName}
        role={step.role}
        memberType={step.memberType}
        account={session?.email}
        onGoToOrg={() => onGoToOrg(resolved.organization.id)}
      />
    )
  }

  if (step.name === 'signup' && resolved) {
    return (
      <InvitationSignupPanel resolved={resolved}>
        {renderSignup({
          bindToken: step.bindToken,
          maskedContact,
          channel: resolved.invitation.channel,
          orgName,
          onSignedUp: () => {
            fromSignup.current = true
            void accept()
          },
        })}
      </InvitationSignupPanel>
    )
  }

  if (!resolved) return null

  return (
    <InvitationAcceptCard
      resolved={resolved}
      mode={session ? 'authenticated' : 'anonymous'}
      accepting={step.name === 'accepting'}
      onCreateAccount={() => void accept()}
      onAccept={() => void accept()}
      onSignIn={onSignIn}
    />
  )
}
