import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

export const MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS = 20

export type HistoricalFlowEvidenceRevision = {
  repositoryId: string
  revision: string
}

/**
 * Selects the newest distinct historical revisions whose expanded artifacts
 * are prefetched. Candidates themselves remain visible beyond this bound.
 */
export function historicalFlowEvidenceSelection(
  candidates: RepositoryFlowCandidate[],
  repositories: Pick<Repository, 'id' | 'lastScanRevision'>[],
  limit = MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS,
) {
  const currentRevisions = new Map(
    repositories.map(repository => [repository.id, repository.lastScanRevision])
  )
  const revisions = new Map<string, HistoricalFlowEvidenceRevision & { createdAt: number }>()
  for (const candidate of candidates) {
    if (candidate.revision === currentRevisions.get(candidate.repositoryId)) continue
    const key = `${candidate.repositoryId}\u0000${candidate.revision}`
    const createdAt = Date.parse(candidate.createdAt)
    const comparableCreatedAt = Number.isFinite(createdAt) ? createdAt : -Infinity
    const existing = revisions.get(key)
    if (!existing || comparableCreatedAt > existing.createdAt) {
      revisions.set(key, {
        repositoryId: candidate.repositoryId,
        revision: candidate.revision,
        createdAt: comparableCreatedAt,
      })
    }
  }
  const ordered = [...revisions.values()].sort((left, right) =>
    right.createdAt - left.createdAt ||
    left.repositoryId.localeCompare(right.repositoryId) ||
    left.revision.localeCompare(right.revision)
  )
  const selected = ordered.slice(0, Math.max(0, limit)).map(
    ({ repositoryId, revision }) => ({ repositoryId, revision })
  )
  return { selected, omitted: Math.max(0, ordered.length - selected.length), total: ordered.length }
}
