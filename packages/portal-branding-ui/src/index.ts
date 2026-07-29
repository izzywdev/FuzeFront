// Boot state + context
export { PortalBrandingProvider, usePortalContext } from './context/PortalBrandingProvider'
export type { PortalBootState, PortalBrandingProviderProps } from './context/PortalBrandingProvider'

// Pre-auth flag resolution (see src/flags.ts for the tracked delivery gap)
export { isMultiTenantPortalsEnabled } from './flags'

// Normalization + client boundary
export { normalizePortalContext, ROOT_FALLBACK_CONTEXT } from './normalize'
export { createPortalClient } from './api/portalClient'
export type { PortalContextSource } from './api/portalClient'

// Components (manifest.build.components)
export { BrandingBoundary } from './components/BrandingBoundary'
export { PortalThemeScope } from './components/PortalThemeScope'
export { BrandedTopBar } from './components/BrandedTopBar'
export { BrandedSidePanel } from './components/BrandedSidePanel'
export { PortalAppGrid } from './components/PortalAppGrid'
export { PortalBrandLockup } from './components/PortalBrandLockup'
export { WhiteLabelLoginCard } from './components/WhiteLabelLoginCard'
export { PortalUnavailableNotice } from './components/PortalUnavailableNotice'
export { LoadingSkeleton } from './components/LoadingSkeleton'

// Flow orchestrators (manifest.build.flows)
export { PortalShell } from './flows/PortalShell'
export { PortalLoginFlow } from './flows/PortalLoginFlow'

// Types
export type { NormalizedPortalContext, PortalBrandingFields, PortalBootStatus } from './types'
