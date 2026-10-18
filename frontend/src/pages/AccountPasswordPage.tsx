import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PasswordManagementFlow } from '@fuzefront/account-security-ui'
import { getActiveAuthToken } from '../lib/accounts'
import { ACCOUNT_SECURITY_FLAGS, FlaggedSurface } from '../components/account-security/FlaggedSurface'

/**
 * Host route wrapper for `/account/security/password` (FFRNT-140). Change an
 * existing password, or set the first one on a social-only account, behind
 * `fuzefront.account-security.password-reset` (default OFF — flag OFF is the
 * unchanged "isn't available yet" placeholder).
 */
export default function AccountPasswordPage() {
  const navigate = useNavigate()
  const getToken = useCallback(() => getActiveAuthToken(), [])
  return (
    <FlaggedSurface flag={ACCOUNT_SECURITY_FLAGS.passwordReset}>
      <PasswordManagementFlow getToken={getToken} onNavigate={(r) => navigate(r)} />
    </FlaggedSurface>
  )
}
