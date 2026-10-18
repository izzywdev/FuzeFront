import { useState, type ReactNode } from 'react'
import {
  MfaStepUpFlow,
  MfaStepUpMobileFlow,
} from '@fuzefront/account-security-ui'
import { isPreAuthFlagEnabled } from '../../platform/preAuthFlags'
import { isCompactViewport } from '../../lib/compactViewport'
import { ACCOUNT_SECURITY_FLAGS } from './FlaggedSurface'

/** Support contact for the step-up "no verification method" fail-closed state. */
const SUPPORT_MAILTO = 'mailto:support@frontfuse.dev'

export interface StepUpChallenge {
  challengeId: string
  factors?: { factorId: string; type: 'totp' | 'sms' | 'email' | 'webauthn' }[]
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
  onSession: (session: { token: string; sessionId?: string }) => void
): {
  begin: (challenge: StepUpChallenge) => boolean
  view: ReactNode
} {
  const [challenge, setChallenge] = useState<StepUpChallenge | null>(null)
  const variant = resolveStepUpVariant(isCompactViewport())

  const begin = (next: StepUpChallenge): boolean => {
    setChallenge(next)
    return true
  }

  if (!challenge) return { begin, view: null }
  const Flow = variant === 'mobile' ? MfaStepUpMobileFlow : MfaStepUpFlow
  return {
    begin,
    view: (
      <Flow
        challenge={challenge}
        onAuthenticated={onSession}
        onContactSupport={() => window.location.assign(SUPPORT_MAILTO)}
        onBack={() => setChallenge(null)}
      />
    ),
  }
}
