import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmContactFlow } from '@fuzefront/account-security-ui'
import { getActiveAuthToken } from '../lib/accounts'
import { ACCOUNT_SECURITY_FLAGS, FlaggedSurface } from '../components/account-security/FlaggedSurface'

/**
 * Host route wrapper for `/account/security/verify/phone` (FFRNT-362): phone
 * OTP verification, behind `fuzefront.security.mfa-stepup-mobile` (default OFF).
 * Skippable — the profile re-prompts until verified.
 */
export default function AccountVerifyPhonePage() {
  const navigate = useNavigate()
  const getToken = useCallback(() => getActiveAuthToken(), [])
  return (
    <FlaggedSurface flag={ACCOUNT_SECURITY_FLAGS.mfaStepUpMobile}>
      <ConfirmContactFlow
        getToken={getToken}
        onSkip={() => navigate('/account/security')}
        onDone={() => navigate('/account/security')}
      />
    </FlaggedSurface>
  )
}
