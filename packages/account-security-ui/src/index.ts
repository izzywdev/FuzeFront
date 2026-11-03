// ---- Flow orchestrator ----------------------------------------------------
export { AccountSecurityHub } from './components/hub/AccountSecurityHub'
export type { AccountSecurityHubProps } from './components/hub/AccountSecurityHub'

// ---- Presentational hub + components --------------------------------------
export { SecurityHub } from './components/hub/SecurityHub'
export type { SecurityHubProps, SecurityHubRoutes } from './components/hub/SecurityHub'
export { SecurityPostureSummary, derivePosture } from './components/hub/SecurityPostureSummary'
export type { SecurityPostureSummaryProps } from './components/hub/SecurityPostureSummary'
export { SecurityCard } from './components/hub/SecurityCard'
export type { SecurityCardProps } from './components/hub/SecurityCard'
export { SignInMethodsList } from './components/hub/SignInMethodsList'
export type { SignInMethodsListProps } from './components/hub/SignInMethodsList'
export { SetPasswordBanner } from './components/hub/SetPasswordBanner'
export type { SetPasswordBannerProps } from './components/hub/SetPasswordBanner'
export { ConnectedAccountRow } from './components/connected-accounts/ConnectedAccountRow'
export type { ConnectedAccountRowProps } from './components/connected-accounts/ConnectedAccountRow'
export { SecurityCardGridSkeleton } from './components/hub/SecurityCardGridSkeleton'
export { LoadErrorRetry } from './components/hub/LoadErrorRetry'
export type { LoadErrorRetryProps } from './components/hub/LoadErrorRetry'
export { providerDisplayName } from './components/connected-accounts/providers'
export { ConnectProviderButton } from './components/connected-accounts/ConnectProviderButton'
export type { ConnectProviderButtonProps } from './components/connected-accounts/ConnectProviderButton'
export { ConnectedAccountsPanel } from './components/connected-accounts/ConnectedAccountsPanel'
export type { ConnectedAccountsPanelProps } from './components/connected-accounts/ConnectedAccountsPanel'

// ---- Password reset / change / set (FFRNT-140) -----------------------------
export {
  ChangePasswordFlow,
  SetPasswordFlow,
  PasswordManagementFlow,
} from './components/password/PasswordFlows'
export type { PasswordFlowCallbacks } from './components/password/PasswordFlows'
export {
  PasswordResetFlow,
  ResetRequestForm,
  ResetSentNotice,
  NewPasswordForm,
  TokenInvalidNotice,
  ResetDoneNotice,
} from './components/password/PasswordResetFlow'
export type { PasswordResetFlowProps } from './components/password/PasswordResetFlow'
export { ChangePasswordForm, SetPasswordForm } from './components/password/PasswordForms'
export type {
  ChangePasswordFormProps,
  SetPasswordFormProps,
  PasswordFormErrors,
} from './components/password/PasswordForms'
export { PasswordPolicyHints, PasswordStrengthMeter } from './components/password/PasswordFields'

// ---- MFA management + step-up (FFRNT-141 / FFRNT-362) ---------------------
export {
  MfaOverviewFlow,
  MfaOverviewPanel,
  MfaFactorList,
  MfaFactorRow,
  AddFactorMenu,
  DEFAULT_MFA_ROUTES,
} from './components/mfa/MfaOverview'
export type { MfaRoutes, MfaNavProps, MfaOverviewState } from './components/mfa/MfaOverview'
export { RemoveFactorDialog } from './components/mfa/RemoveFactorDialog'
export type { RemoveFactorDialogProps } from './components/mfa/RemoveFactorDialog'
export { TotpEnrollFlow, TotpEnrollPanel, QrProvisioning, buildQrMatrix } from './components/mfa/TotpEnroll'
export type { EnrollFlowProps, TotpEnrollPanelProps } from './components/mfa/TotpEnroll'
export { SmsEnrollFlow, SmsEnrollPanel, ChannelUnavailableNotice } from './components/mfa/SmsEnroll'
export type { SmsEnrollPanelProps } from './components/mfa/SmsEnroll'
export {
  RecoveryCodesFlow,
  RecoveryCodesShownOnce,
  RecoveryCodesStatus,
  RegenerateConfirm,
} from './components/mfa/RecoveryCodes'
export {
  MfaStepUpFlow,
  MfaStepUpMobileFlow,
  MfaChallengeCard,
  FactorPicker,
} from './components/mfa/StepUp'
export type { MfaStepUpProps } from './components/mfa/StepUp'
export { ConfirmContactFlow, ContactVerifyPanel } from './components/mfa/ConfirmContact'
export type { ConfirmContactFlowProps, ContactVerifyPanelProps } from './components/mfa/ConfirmContact'
export {
  SecurityStatusMobileFlow,
  SecurityStatusList,
  SecurityStatusRow,
} from './components/security-status/SecurityStatus'
export type { SecurityStatusMobileFlowProps } from './components/security-status/SecurityStatus'
export { FlowRoot, SeamCard } from './components/common/flowKit'
export type { FlowBaseProps } from './components/common/flowKit'

// ---- API client -----------------------------------------------------------
export { createAccountSecurityClient } from './api/securityClient'
export { HttpClient, HttpError } from './api/http'
export { isInvalidCode, isConflict, statusOf } from './api/errors'
export type { HttpClientOptions } from './api/http'

// ---- i18n -----------------------------------------------------------------
export {
  AccountSecurityI18nProvider,
  useAccountSecurityI18n,
} from './i18n/AccountSecurityI18nProvider'
export type {
  AccountSecurityLocale,
  AccountSecurityI18nContextValue,
  AccountSecurityI18nProviderProps,
} from './i18n/AccountSecurityI18nProvider'
export type { AccountSecurityMessages } from './i18n/messages'

// ---- Types ----------------------------------------------------------------
export type {
  IdentityConnections,
  SocialConnection,
  SocialLinkStart,
  AuthMethods,
  SocialProvider,
  ErrorBody,
  SecurityCardKey,
  PostureLevel,
  SecurityOverview,
  AccountSecurityClient,
  PasswordClient,
  MfaClient,
  StepUpClient,
  ContactClient,
  FullAccountSecurityClient,
  MfaFactor,
  MfaFactorType,
  MfaFactorRef,
  MfaEnrollResult,
  MfaChallengeAck,
  MfaSession,
  VerificationStatus,
} from './types'
