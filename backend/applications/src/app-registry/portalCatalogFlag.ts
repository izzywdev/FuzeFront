// FF-EPIC-12-S5 — the per-request, cached reader for the
// `fuzefront.apps.portal-catalog` flag. Mirrors the shared per-request-cache
// convention established by the host backend's `utils/portalFlag.ts`
// (`getRequestPortalsEnabled`) and `utils/identityFlag.ts`
// (`getRequestPortalScopingEnabled`): evaluate the flag AT MOST ONCE per
// request (stashed on `req.portalCatalogFlagEnabled`) so two call sites in the
// same request (e.g. `list()`'s portal filter and, on the admin surface, the
// S3 write-gate) can never observe a differing decision under
// gradual/per-user Unleash targeting. The underlying evaluation itself
// (`isPortalCatalogEnabled`) lives in `./flags.ts`, this service's own local
// flag-client convention (lazy `@fuzefront/feature-flags` resolution + the
// `setFlagClient` DI test seam) — NOT a re-implementation of Unleash/OpenFeature
// wiring.
import { isPortalCatalogEnabled } from './flags'

export interface CatalogFlagRequest {
  portalCatalogFlagEnabled?: boolean
  user?: { id?: string }
}

export async function getRequestPortalCatalogEnabled(
  req: CatalogFlagRequest,
  ctx?: { organizationId?: string | null }
): Promise<boolean> {
  const cached = req.portalCatalogFlagEnabled
  if (typeof cached === 'boolean') return cached

  const enabled = await isPortalCatalogEnabled({
    userId: req.user?.id,
    organizationId: ctx?.organizationId,
  })
  req.portalCatalogFlagEnabled = enabled
  return enabled
}
