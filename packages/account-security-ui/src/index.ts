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

// ---- API client -----------------------------------------------------------
export { createAccountSecurityClient } from './api/securityClient'
export { HttpClient, HttpError } from './api/http'
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
} from './types'
