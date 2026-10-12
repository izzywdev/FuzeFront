import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import {
  MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS,
  historicalEvidenceSelection,
} from './flowEvidence'

export type GovernanceEvidenceRequest = {
  repositoryId: string
  artifactIds: string[]
}

/** Resolves exact evidence while bounding historical expansion by revision. */
export function governanceEvidenceSelection(
  evaluations: PolicyGateEvaluation[],
  repositories: Pick<Repository, 'id' | 'lastScanRevision'>[],
  revisionScope: 'current' | 'all',
  limit = MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS,
) {
  const historical = revisionScope === 'all'
    ? historicalEvidenceSelection(evaluations, repositories, limit)
    : { selected: [], omitted: 0, total: 0 }
  const selectedHistorical = new Set(
    historical.selected.map(({ repositoryId, revision }) => `${repositoryId}\u0000${revision}`)
  )
  const currentRevisions = new Map(
    repositories.map(repository => [repository.id, repository.lastScanRevision])
  )
  const artifactIds = new Map<string, Set<string>>()

  for (const evaluation of evaluations) {
    const isCurrent = evaluation.revision === currentRevisions.get(evaluation.repositoryId)
    if (
      revisionScope === 'all' &&
      !isCurrent &&
      !selectedHistorical.has(`${evaluation.repositoryId}\u0000${evaluation.revision}`)
    ) continue
    const ids = artifactIds.get(evaluation.repositoryId) ?? new Set<string>()
    ;[
      ...evaluation.policyArtifactIds,
      ...evaluation.gateArtifactIds,
      ...(evaluation.evidencePassages ?? []).map(passage => passage.artifactId),
    ].forEach(id => ids.add(id))
    artifactIds.set(evaluation.repositoryId, ids)
  }

  return {
    requests: [...artifactIds]
      .map(([repositoryId, ids]) => ({ repositoryId, artifactIds: [...ids].sort() }))
      .filter(request => request.artifactIds.length > 0),
    omittedHistoricalRevisions: historical.omitted,
  }
}
