import type { QualityArtifact, TestSuiteDispatch } from '@fuzequality/contracts'
import { encodeHistoryCursor } from './history-pagination'

const dispatchableArtifactKinds = new Set<QualityArtifact['kind']>([
  'integration-test',
  'post-production-test',
  'load-test',
  'stress-test',
])

/**
 * Resolve a tenant-scoped dispatch audit identity without requiring the suite
 * to remain present in the latest repository scan. A current artifact takes
 * precedence; a retired artifact is accepted only when its latest durable
 * dispatch receipt belongs to the same repository and tenant query.
 */
export function testSuiteDispatchLogicalId(
  artifactId: string,
  artifacts: QualityArtifact[],
  latestDispatches: TestSuiteDispatch[],
): string | undefined {
  const artifact = artifacts.find(item =>
    item.id === artifactId && dispatchableArtifactKinds.has(item.kind)
  )
  if (artifact) return artifact.logicalId ?? artifact.id

  return latestDispatches.find(dispatch =>
    dispatch.artifactId === artifactId && dispatchableArtifactKinds.has(dispatch.artifactKind)
  )?.artifactLogicalId
}

export function testSuiteDispatchPage(items: TestSuiteDispatch[], limit: number) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last
        ? encodeHistoryCursor({ createdAt: last.requestedAt, id: last.id })
        : null,
      hasMore: items.length > limit,
    },
  }
}
