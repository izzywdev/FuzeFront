export { AuthPanel } from './components/AuthPanel'

export type {
  AuthPanelProps,
  AuthPanelMode,
  AuthPanelVariant,
  AuthTransport,
  AuthenticatedMeta,
  AuthLabels,
  PendingAction,
  SessionResult,
  AuthenticatedSession,
  MfaRequiredChallenge,
  AuthMethods,
  LoginRequest,
  SignupRequest,
} from './types'
export { DEFAULT_AUTH_LABELS } from './types'

// ── verify-email + password-reset (FFRNT-360, flag: fuzefront.auth.experience) ──
export { isAuthExperienceEnabled, AUTH_EXPERIENCE_FLAG } from './flags'
export { EmailVerificationFlow } from './components/verify-reset/EmailVerificationFlow'
export type { EmailVerificationFlowProps } from './components/verify-reset/EmailVerificationFlow'
export { PasswordResetFlow } from './components/verify-reset/PasswordResetFlow'
export type { PasswordResetFlowProps } from './components/verify-reset/PasswordResetFlow'
export { AuthCard } from './components/verify-reset/AuthCard'
export type { AuthFlowCardProps, HeroIconKind } from './components/verify-reset/AuthCard'
export { PasswordStrengthMeter, scorePassword } from './components/verify-reset/PasswordStrengthMeter'
export type {
  PasswordStrength,
  PasswordStrengthMeterProps,
} from './components/verify-reset/PasswordStrengthMeter'
export { PasswordConfirmField } from './components/verify-reset/PasswordConfirmField'
export type { PasswordConfirmFieldProps } from './components/verify-reset/PasswordConfirmField'
export { ResendCooldownButton, formatCountdown } from './components/verify-reset/ResendCooldownButton'
export type { ResendCooldownButtonProps } from './components/verify-reset/ResendCooldownButton'
export { VerifyStatusPanel } from './components/verify-reset/VerifyStatusPanel'
export type { VerifyStatusPanelProps, VerifyStatus } from './components/verify-reset/VerifyStatusPanel'
export { classifyAuthError } from './components/verify-reset/errors'
export { DEFAULT_VERIFY_RESET_LABELS } from './components/verify-reset/types'
export type {
  VerifyResetTransport,
  VerifyResetLabels,
  VerificationStatus,
  AuthErrorKind,
} from './components/verify-reset/types'
