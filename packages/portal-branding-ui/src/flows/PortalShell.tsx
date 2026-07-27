import { PortalBrandingProvider } from '../context/PortalBrandingProvider'
import { BrandingBoundary } from '../components/BrandingBoundary'
import { PortalThemeScope } from '../components/PortalThemeScope'
import { BrandedTopBar } from '../components/BrandedTopBar'
import { BrandedSidePanel } from '../components/BrandedSidePanel'
import { PortalAppGrid } from '../components/PortalAppGrid'

/**
 * Route orchestrator for `/` (manifest flow `portal-shell`, frames 01/02).
 * Only ever mounted once the caller (frontend `App.tsx`) has already
 * confirmed `fuzefront.platform.multi-tenant-portals` is on for an
 * unauthenticated visitor — the provider is unconditionally `enabled`.
 */
export function PortalShell() {
  return (
    <PortalBrandingProvider enabled>
      <BrandingBoundary>
        {context => (
          <PortalThemeScope context={context}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100vh',
                background: 'var(--bg-primary)',
              }}
            >
              <BrandedTopBar context={context} />
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <BrandedSidePanel />
                <PortalAppGrid context={context} />
              </div>
            </div>
          </PortalThemeScope>
        )}
      </BrandingBoundary>
    </PortalBrandingProvider>
  )
}
