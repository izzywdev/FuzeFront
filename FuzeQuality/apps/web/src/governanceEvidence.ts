import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import {
  MAX_HISTORICAL_FLOW_EVIDENCE_REVISIONS,
  historicalEvidenceSelection,
} from './flowEvidence'

export type GovernanceEvidenceRequest = {
  repositoryId: string
  revision: string
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
  const artifactIds = new Map<string, GovernanceEvidenceRequest>()

  for (const evaluation of evaluations) {
    const isCurrent = evaluation.revision === currentRevisions.get(evaluation.repositoryId)
    if (
      revisionScope === 'all' &&
      !isCurrent &&
      !selectedHistorical.has(`${evaluation.repositoryId}\u0000${evaluation.revision}`)
    ) continue
    const key = `${evaluation.repositoryId}\u0000${evaluation.revision}`
    const request = artifactIds.get(key) ?? {
      repositoryId: evaluation.repositoryId,
      revision: evaluation.revision,
      artifactIds: [],
    }
    const ids = new Set(request.artifactIds)
    ;[
      ...evaluation.policyArtifactIds,
      ...evaluation.gateArtifactIds,
      ...(evaluation.evidencePassages ?? []).map(passage => passage.artifactId),
    ].forEach(id => ids.add(id))
    artifactIds.set(key, { ...request, artifactIds: [...ids] })
  }

  return {
    requests: [...artifactIds.values()]
      .map(request => ({ ...request, artifactIds: [...request.artifactIds].sort() }))
      .filter(request => request.artifactIds.length > 0),
    omittedHistoricalRevisions: historical.omitted,
  }
}
