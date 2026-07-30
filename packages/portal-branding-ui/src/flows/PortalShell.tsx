import { PortalBrandingProvider } from '../context/PortalBrandingProvider'
import { BrandingBoundary } from '../components/BrandingBoundary'
import { PortalThemeScope } from '../components/PortalThemeScope'
import { BrandedTopBar } from '../components/BrandedTopBar'
import { BrandedSidePanel } from '../components/BrandedSidePanel'
import { PortalAppGrid } from '../components/PortalAppGrid'

// Baseline small-screen safety net: the side-panel + content row stacks
// instead of overflowing horizontally below ~48rem. This is deliberately
// minimal — a real collapsible drawer / touch-target pass for this shell is
// mobile-frontend-engineer's ownership (CLAUDE.md: "responsive shell layout,
// drawer sidebar ... mobile breakpoints"); this only keeps the shell usable
// (no horizontal scroll, no clipped content) until that pass lands.
const RESPONSIVE_CSS = `
  @media (max-width: 48rem) {
    .portal-shell-body { flex-direction: column; overflow: visible !important; }
    .portal-shell-body [data-region='side-panel'] {
      width: 100% !important;
      border-inline-end: none !important;
      border-bottom: 1px solid var(--border-color);
    }
  }
`

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
              <style>{RESPONSIVE_CSS}</style>
              <BrandedTopBar context={context} />
              <div className="portal-shell-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
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
