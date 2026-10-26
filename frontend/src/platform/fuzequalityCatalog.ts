export interface FuzeQualityCatalogEntry {
  id: string
  slug?: string
  scope?: string
  remoteUrl?: string
  integrationType?: string
  isHealthy?: boolean
}

/**
 * Resolve FuzeQuality from either the app-registry DTO or the legacy
 * `/api/apps` DTO. The legacy surface exposes the database UUID as `id`, so a
 * slug-only id comparison produces a false "not registered" release failure.
 */
export function isFuzeQualityCatalogEntry(app: FuzeQualityCatalogEntry): boolean {
  return (
    app.id === 'fuzequality' ||
    app.slug === 'fuzequality' ||
    app.scope === 'fuzequality' ||
    /\/apps\/fuzequality(?:\/|$)/i.test(app.remoteUrl ?? '')
  )
}
