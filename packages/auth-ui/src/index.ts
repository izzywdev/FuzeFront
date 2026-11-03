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
  SocialProviderSlug,
  SignupEmailAvailability,
  PasswordPolicy,
  CaptchaMethod,
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

// ── redesigned signup (flag: fuzefront.auth.experience) ──────────────────────
export { SignUpFlow } from './components/signup/SignUpFlow'
export type { SignUpFlowProps } from './components/signup/SignUpFlow'
export { DEFAULT_SIGNUP_LABELS } from './components/signup/labels'
export type { SignUpLabels } from './components/signup/labels'
export { DEFAULT_PASSWORD_POLICY, buildPolicyRules, meetsPolicy } from './components/signup/policy'
export type { PolicyRule, PolicyRuleId } from './components/signup/policy'
export { FullNameField } from './components/fields/FullNameField'
export type { FullNameFieldProps } from './components/fields/FullNameField'
export { InlineAvailabilityField } from './components/fields/InlineAvailabilityField'
export type {
  InlineAvailabilityFieldProps,
  AvailabilityState,
} from './components/fields/InlineAvailabilityField'
export { PasswordPolicyChecklist } from './components/fields/PasswordPolicyChecklist'
export type { PasswordPolicyChecklistProps } from './components/fields/PasswordPolicyChecklist'
export { TurnstileField, TURNSTILE_TEST_SITE_KEY } from './components/fields/TurnstileField'
export type { TurnstileFieldProps, TurnstileFieldState } from './components/fields/TurnstileField'
export { VerifyGateBanner } from './components/fields/VerifyGateBanner'
export type { VerifyGateBannerProps } from './components/fields/VerifyGateBanner'
export { SocialButton } from './components/SocialButton'
export type { SocialButtonProps } from './components/SocialButton'
