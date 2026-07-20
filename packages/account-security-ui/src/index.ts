// ---- Flow orchestrator ----------------------------------------------------
export { AccountSecurityHub } from './components/AccountSecurityHub'
export type { AccountSecurityHubProps } from './components/AccountSecurityHub'

// ---- Presentational hub + components --------------------------------------
export { SecurityHub } from './components/SecurityHub'
export type { SecurityHubProps, SecurityHubRoutes } from './components/SecurityHub'
export { SecurityPostureSummary, derivePosture } from './components/SecurityPostureSummary'
export type { SecurityPostureSummaryProps } from './components/SecurityPostureSummary'
export { SecurityCard } from './components/SecurityCard'
export type { SecurityCardProps } from './components/SecurityCard'
export { SignInMethodsList } from './components/SignInMethodsList'
export type { SignInMethodsListProps } from './components/SignInMethodsList'
export { SetPasswordBanner } from './components/SetPasswordBanner'
export type { SetPasswordBannerProps } from './components/SetPasswordBanner'
export { ConnectedAccountRow } from './components/ConnectedAccountRow'
export type { ConnectedAccountRowProps } from './components/ConnectedAccountRow'
export { SecurityCardGridSkeleton } from './components/SecurityCardGridSkeleton'
export { LoadErrorRetry } from './components/LoadErrorRetry'
export type { LoadErrorRetryProps } from './components/LoadErrorRetry'
export { providerDisplayName } from './components/providers'

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
  AuthMethods,
  SocialProvider,
  ErrorBody,
  SecurityCardKey,
  PostureLevel,
  SecurityOverview,
  AccountSecurityClient,
} from './types'
