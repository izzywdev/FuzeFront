import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MfaOverviewFlow,
  RecoveryCodesFlow,
  SmsEnrollFlow,
  TotpEnrollFlow,
} from '@fuzefront/account-security-ui'
import { getActiveAuthToken } from '../lib/accounts'
import { ACCOUNT_SECURITY_FLAGS, FlaggedSurface } from '../components/account-security/FlaggedSurface'

export type AccountMfaView = 'overview' | 'authenticator' | 'phone' | 'recovery-codes'

/**
 * Host route wrapper for the MFA management routes (FFRNT-141), all behind
 * `fuzefront.security.mfa-management` (default OFF):
 *   /account/security/mfa                      overview + remove factor
 *   /account/security/mfa/add/authenticator    TOTP enrolment
 *   /account/security/mfa/add/phone            SMS enrolment (honest-degrades)
 *   /account/security/mfa/recovery-codes       recovery codes (reveal once)
 */
export default function AccountMfaPage({ view }: { view: AccountMfaView }) {
  const navigate = useNavigate()
  const getToken = useCallback(() => getActiveAuthToken(), [])
  const nav = { getToken, onNavigate: (r: string) => navigate(r) }
  return (
    <FlaggedSurface flag={ACCOUNT_SECURITY_FLAGS.mfaManagement}>
      {view === 'overview' && <MfaOverviewFlow {...nav} />}
      {view === 'authenticator' && <TotpEnrollFlow {...nav} />}
      {view === 'phone' && <SmsEnrollFlow {...nav} />}
      {view === 'recovery-codes' && <RecoveryCodesFlow {...nav} />}
    </FlaggedSurface>
  )
}
