import { PortalBrandingProvider } from '../context/PortalBrandingProvider'
import { BrandingBoundary } from '../components/BrandingBoundary'
import { PortalThemeScope } from '../components/PortalThemeScope'
import { WhiteLabelLoginCard } from '../components/WhiteLabelLoginCard'

/**
 * Route orchestrator for `/login` (manifest flow `portal-login`, frame 03).
 * Shares the same boot boundary + theme scope as `PortalShell` so loading /
 * error / suspended states behave identically on both routes.
 */
export function PortalLoginFlow() {
  return (
    <PortalBrandingProvider enabled>
      <BrandingBoundary>
        {context => (
          <PortalThemeScope context={context}>
            <WhiteLabelLoginCard context={context} />
          </PortalThemeScope>
        )}
      </BrandingBoundary>
    </PortalBrandingProvider>
  )
}
