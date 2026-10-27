import { useEffect, useMemo, useState } from 'react'
import { useT } from '@fuzefront/i18n'
import { VerifyGateBanner, isAuthExperienceEnabled } from '@fuzefront/auth-ui'
import { authAPI } from '../services/api'
import { buildSignupLabels, type TFn } from '../pages/authI18n'

/**
 * The "verify your email to continue" gate banner (frame state `unverified-gate`),
 * shown to a signed-in but UNVERIFIED account.
 *
 * `fuzefront.auth.experience` (default OFF): with the flag off this renders nothing
 * and makes no request. With it on it asks the platform whether it verifies email at
 * all (`AuthMethods.verification.email`) and, if so, for the caller's status
 * (`GET /verify/status`). FAIL-OPEN: any error shows no banner rather than blocking
 * or nagging a user we could not classify. Resend is `POST /verify/email/start`.
 */
export function UnverifiedGate({ email }: { email?: string }) {
  const { t } = useT()
  const enabled = isAuthExperienceEnabled()
  const [unverified, setUnverified] = useState(false)

  useEffect(() => {
    if (!enabled || !email) return
    let cancelled = false
    ;(async () => {
      try {
        const methods = await authAPI.getAuthMethods()
        if (!methods.verification?.email) return
        const status = await authAPI.getVerificationStatus()
        if (!cancelled && !status.emailVerified) setUnverified(true)
      } catch {
        // fail open: unknown status -> no banner
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, email])

  const labels = useMemo(() => buildSignupLabels(t as unknown as TFn), [t])

  if (!enabled || !email || !unverified) return null
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <VerifyGateBanner
        email={email}
        labels={labels}
        onResend={() => authAPI.startEmailVerification()}
      />
    </div>
  )
}
