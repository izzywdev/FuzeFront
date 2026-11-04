import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PasswordManagementFlow } from '@fuzefront/account-security-ui'
import { getActiveAuthToken } from '../lib/accounts'
import { ACCOUNT_SECURITY_FLAGS, FlaggedSurface } from '../components/account-security/FlaggedSurface'
import { useAccountSecurityLocale } from '../components/account-security/useAccountSecurityLocale'
import { isAuthExperienceEnabled } from '@fuzefront/auth-ui'

/**
 * Host route wrapper for `/account/security/password` (FFRNT-140). Change an
 * existing password, or set the first one on a social-only account, behind
 * `fuzefront.account-security.password-reset` (default OFF — flag OFF is the
 * unchanged "isn't available yet" placeholder).
 *
 * The "forgot password" / reset exits link to `/reset`, which App.tsx mounts only
 * when `isAuthExperienceEnabled()` — so they are offered only then (else a 404).
 */
export default function AccountPasswordPage() {
  const navigate = useNavigate()
  const getToken = useCallback(() => getActiveAuthToken(), [])
  const locale = useAccountSecurityLocale()
  return (
    <FlaggedSurface flag={ACCOUNT_SECURITY_FLAGS.passwordReset}>
      <PasswordManagementFlow
        getToken={getToken}
        locale={locale}
        canReset={isAuthExperienceEnabled()}
        onNavigate={(r) => navigate(r)}
      />
    </FlaggedSurface>
  )
}
