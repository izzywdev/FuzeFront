import { useRef, useState, type ReactNode } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import {
  MfaStepUpFlow,
  MfaStepUpMobileFlow,
} from '@fuzefront/account-security-ui'
import { isPreAuthFlagEnabled } from '../../platform/preAuthFlags'
import { isCompactViewport } from '../../lib/compactViewport'
import { ACCOUNT_SECURITY_FLAGS } from './FlaggedSurface'
import { useAccountSecurityLocale } from './useAccountSecurityLocale'
import { authError, buildAuthLabels, buildSignupLabels, type TFn } from '../../pages/authI18n'

/** Support contact for the step-up "no verification method" fail-closed state. */
const SUPPORT_MAILTO = 'mailto:support@frontfuse.dev'

export interface StepUpChallenge {
  challengeId: string
  factors?: { factorId: string; type: 'totp' | 'sms' | 'email' | 'webauthn' }[]
  /** `mfa_required.recoveryAvailable` (security contract 1.3.0); missing = false (fail-closed). */
  recoveryAvailable?: boolean
}

/**
 * Which MFA step-up surface answers an `mfa_required` challenge. NEVER null: once
 * the server has issued a challenge the user MUST be able to answer it, or anyone
 * who enrolled a factor would be locked out at their next sign-in whenever no
 * pre-auth flag is on (pre-auth flags can't be served by Unleash — see
 * platform/preAuthFlags.ts). The flags only choose the PRESENTATION:
 *   - mobile variant: mfa-stepup-mobile flag ON and a compact viewport;
 *   - desktop variant otherwise (the default, flags OFF included).
 */
export function resolveStepUpVariant(compact: boolean): 'desktop' | 'mobile' {
  return isPreAuthFlagEnabled(ACCOUNT_SECURITY_FLAGS.mfaStepUpMobile) && compact
    ? 'mobile'
    : 'desktop'
}

/**
 * Login MFA step-up (FFRNT-141 / FFRNT-362), isolated from LoginPage so the page
 * carries only a hook call and two one-line hand-offs.
 *  - `begin(challenge)` always takes over (returns true): a server challenge is never
 *    left unanswerable; the caller skips its own dead-end notice.
 *  - `view` is the step-up UI to render in place of the sign-in panel, or null.
 */
export function useLoginStepUp(
  /** Persist the minted session and hydrate the user. REJECTS when hydration fails. */
  onSession: (session: { token: string; sessionId?: string }) => void | Promise<void>,
  /** Hydrate again from the already-persisted session. Must never re-verify. */
  onRetryHydrate: (session: { token: string; sessionId?: string }) => void | Promise<void>,
  t: TFn
): {
  begin: (challenge: StepUpChallenge) => boolean
  view: ReactNode
} {
  const [challenge, setChallenge] = useState<StepUpChallenge | null>(null)
  // Set when verification SUCCEEDED but loading the account failed afterwards.
  const [hydrate, setHydrate] = useState<
    { session: { token: string; sessionId?: string }; retrying: boolean } | null
  >(null)
  const retrying = useRef(false)
  const variant = resolveStepUpVariant(isCompactViewport())
  const locale = useAccountSecurityLocale()

  const begin = (next: StepUpChallenge): boolean => {
    setHydrate(null)
    setChallenge(next)
    return true
  }

  if (!challenge) return { begin, view: null }

  if (hydrate) {
    const retry = async () => {
      if (retrying.current) return
      retrying.current = true
      setHydrate({ session: hydrate.session, retrying: true })
      try {
        await onRetryHydrate(hydrate.session)
      } catch {
        setHydrate({ session: hydrate.session, retrying: false })
      } finally {
        retrying.current = false
      }
    }
    return {
      begin,
      view: (
        <div data-component="mfa-challenge" data-state="signed-in-load-failed" role="alert" style={{ textAlign: 'start' }}>
          <StatusCallout
            tone="error"
            icon="!"
            actions={
              <>
                <Button variant="primary" data-action="retry-load-account" onClick={() => void retry()} disabled={hydrate.retrying} aria-busy={hydrate.retrying || undefined}>
                  {buildSignupLabels(t).retry}
                </Button>
                <Button
                  variant="ghost"
                  data-action="back-to-sign-in"
                  onClick={() => {
                    setHydrate(null)
                    setChallenge(null)
                  }}
                  disabled={hydrate.retrying}
                >
                  {buildAuthLabels(t).toggleToSignInCta}
                </Button>
              </>
            }
          >
            {authError(t, 'profileLoad')}
          </StatusCallout>
        </div>
      ),
    }
  }

  const Flow = variant === 'mobile' ? MfaStepUpMobileFlow : MfaStepUpFlow
  return {
    begin,
    view: (
      <Flow
        challenge={challenge}
        locale={locale}
        hosted
        onAuthenticated={(session) => {
          // The challenge is consumed once verify succeeds. If the account then fails to load,
          // leave the (verifying) step-up for a retryable state instead of stranding the user in it.
          void (async () => {
            try {
              await onSession(session)
            } catch {
              setHydrate({ session, retrying: false })
            }
          })()
        }}
        onContactSupport={() => window.location.assign(SUPPORT_MAILTO)}
        onBack={() => setChallenge(null)}
      />
    ),
  }
}
