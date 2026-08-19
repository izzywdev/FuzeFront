import type { Portfolio } from '@fuzequality/contracts'

export function repositoryCatalogStatus(
  portfolio: Portfolio,
  repositoryId: string,
  now = new Date(),
  staleAfterMs = 24 * 60 * 60 * 1000
) {
  const repository = portfolio.repositories.find(item => item.id === repositoryId)
  if (!repository) return undefined
  const diagnostics = portfolio.diagnostics.filter(item => item.repositoryId === repositoryId)
  const findings = portfolio.findings.filter(item => item.repositoryId === repositoryId)
  const details = repository.lastScanDetails
  const scannedAt = repository.lastScanAt ? Date.parse(repository.lastScanAt) : Number.NaN
  const stale = Number.isFinite(scannedAt) && now.getTime() - scannedAt > staleAfterMs
  const freshness = repository.lastScanStatus === 'never'
    ? 'never'
    : repository.lastScanStatus === 'queued'
      ? 'queued'
      : repository.lastScanStatus === 'running'
        ? 'running'
        : repository.lastScanStatus === 'failed'
          ? 'failed'
          : details?.partial
            ? 'partial'
            : stale ? 'stale' : 'fresh'

  return {
    repository,
    freshness,
    provenance: {
      sourceRevision: details?.sourceRevision,
      catalogRevision: details?.catalogRevision ?? repository.lastScanRevision,
      scannerVersion: details?.scannerVersion,
      configVersion: details?.configVersion,
      scannedAt: repository.lastScanAt,
    },
    counts: details?.counts ?? {
      candidates: 0,
      operations: portfolio.operations.filter(item => item.repositoryId === repositoryId).length,
      frontendSurfaces: portfolio.surfaces.filter(item => item.repositoryId === repositoryId).length,
      tests: portfolio.tests.filter(item => item.repositoryId === repositoryId).length,
      diagnostics: diagnostics.length,
    },
    candidates: details?.candidates ?? [],
    diagnostics,
    findings,
  }
}
