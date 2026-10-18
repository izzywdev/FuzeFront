import { useNavigate, useSearchParams } from 'react-router-dom'
import { Center } from '@fuzefront/design-system'
import { PasswordResetFlow } from '@fuzefront/account-security-ui'

/**
 * Pre-auth `/reset` route (FFRNT-140): request a reset link, or — with
 * `?token=` from the emailed link (`/reset/confirm?token=…`) — choose a new
 * password. Mounted by App.tsx only when `fuzefront.account-security.password-reset`
 * resolves ON through the pre-auth override (see platform/preAuthFlags.ts);
 * flag OFF leaves the unauthenticated experience unchanged (LoginPage).
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (
    <Center>
      <PasswordResetFlow
        token={params.get('token')}
        onNavigate={(r) => navigate(r)}
        onSignIn={() => navigate('/login')}
      />
    </Center>
  )
}
