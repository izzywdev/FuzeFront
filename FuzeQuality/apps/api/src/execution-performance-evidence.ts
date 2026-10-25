import type { QualityArtifact } from '@fuzequality/contracts'
import type { PolicyGatePerformance } from '@fuzequality/core'

type PerformanceEvidenceDependencies = {
  catalogRevisionForSource: (
    repositoryId: string,
    tenantId: string,
    sourceRevision: string,
  ) => Promise<string | undefined>
  qualityArtifactsByIds: (
    repositoryId: string,
    tenantId: string,
    artifactIds: string[],
    catalogRevision: string,
  ) => Promise<QualityArtifact[]>
}

/**
 * Resolve policy/gate display evidence from the catalog that owns the selected
 * execution source revision. Historical filters must never inherit names or
 * paths from the repository's current catalog.
 */
export async function enrichPerformanceEvidence(
  repositoryId: string,
  tenantId: string,
  items: PolicyGatePerformance[],
  revisions: { sourceRevision?: string; currentCatalogRevision?: string },
  dependencies: PerformanceEvidenceDependencies,
): Promise<PolicyGatePerformance[]> {
  const catalogRevision = revisions.sourceRevision
    ? await dependencies.catalogRevisionForSource(repositoryId, tenantId, revisions.sourceRevision)
    : revisions.currentCatalogRevision
  const artifactIds = [...new Set(items.flatMap(item => [item.policyArtifactId, item.gateArtifactId]))]
  if (!catalogRevision || !artifactIds.length) return items

  const artifacts = new Map(
    (await dependencies.qualityArtifactsByIds(repositoryId, tenantId, artifactIds, catalogRevision))
      .flatMap(artifact => [
        [artifact.id, artifact] as const,
        ...(artifact.logicalId ? [[artifact.logicalId, artifact] as const] : []),
      ]),
  )
  return items.map(item => {
    const policy = artifacts.get(item.policyArtifactId)
    const gate = artifacts.get(item.gateArtifactId)
    return {
      ...item,
      ...(policy?.kind === 'policy' ? { policyTitle: policy.title, policySourcePath: policy.sourcePath } : {}),
      ...(gate?.kind === 'gate' ? { gateTitle: gate.title, gateSourcePath: gate.sourcePath } : {}),
    }
  })
}
