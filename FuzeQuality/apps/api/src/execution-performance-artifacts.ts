import type { QualityArtifact, TestExecution } from '@fuzequality/contracts'

/**
 * Loads the immutable artifact snapshots referenced by the selected executions.
 * Execution revisions are source commits; artifact storage is keyed by the
 * scanner's catalog revision, so each source commit must be resolved first.
 */
export async function artifactsForExecutionRevisions(
  repositoryId: string,
  executions: TestExecution[],
  tenantId: string,
  resolveCatalogRevision: (
    repositoryId: string,
    tenantId: string,
    sourceRevision: string,
  ) => Promise<string | undefined>,
  loadArtifacts: (
    repositoryId: string,
    tenantId: string,
    catalogRevision: string,
  ) => Promise<QualityArtifact[]>,
) {
  const sources = [...new Set(executions.map(execution => execution.revision))]
  const resolved = await Promise.all(sources.map(async sourceRevision => ({
    sourceRevision,
    catalogRevision: await resolveCatalogRevision(
      repositoryId,
      tenantId,
      sourceRevision,
    ),
  })))
  const catalogRevisions = [...new Set(
    resolved
      .map(item => item.catalogRevision)
      .filter((revision): revision is string => Boolean(revision)),
  )]
  const snapshots = await Promise.all(catalogRevisions.map(revision =>
    loadArtifacts(repositoryId, tenantId, revision)
  ))
  return [...new Map(
    snapshots.flat().map(artifact => [artifact.id, artifact]),
  ).values()]
}
