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
 * Which MFA step-up surface to render for an `mfa_required` challenge, or null
 * when both release flags are OFF (default) — in which case LoginPage keeps its
 * original behaviour (an info notice, no step-up UI). Pre-auth, so the flags
 * resolve through the pre-auth override (platform/preAuthFlags.ts).
 */
export function resolveStepUpVariant(
  compact: boolean
): 'desktop' | 'mobile' | null {
  const mobileOn = isPreAuthFlagEnabled(ACCOUNT_SECURITY_FLAGS.mfaStepUpMobile)
  const mgmtOn = isPreAuthFlagEnabled(ACCOUNT_SECURITY_FLAGS.mfaManagement)
  if (mobileOn && (compact || !mgmtOn)) return 'mobile'
  if (mgmtOn) return 'desktop'
  return null
}

/**
 * Login MFA step-up (FFRNT-141 / FFRNT-362), isolated from LoginPage so the page
 * carries only a hook call and two one-line hand-offs.
 *  - `begin(challenge)` returns true when a step-up flag is ON and the step-up took
 *    over (the caller then skips its own notice); false leaves behaviour unchanged.
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
    if (!variant) return false
    setChallenge(next)
    return true
  }

  if (!challenge || !variant) return { begin, view: null }
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
