import { describe, expect, it } from 'vitest'
import type { QualityArtifact } from '@fuzequality/contracts'
import { reviewedPostProductionWorkflowPaths } from './latest-post-production-executions'

const artifact = (overrides: Partial<QualityArtifact> = {}): QualityArtifact => ({
  id: 'post-prod-1', repositoryId: 'repo-1', kind: 'post-production-test', title: 'Post production',
  sourcePath: '.github/workflows/post-prod.yml', summary: 'post-production test', evidence: [],
  ...overrides,
})

describe('reviewed post-production workflow lookup', () => {
  it('deduplicates scanner-reviewed workflow paths', () => {
    expect(reviewedPostProductionWorkflowPaths([artifact(), artifact({ id: 'post-prod-2' })]))
      .toEqual(['.github/workflows/post-prod.yml'])
  })

  it('excludes other artifact kinds and non-workflow paths', () => {
    expect(reviewedPostProductionWorkflowPaths([
      artifact({ kind: 'gate' }),
      artifact({ sourcePath: 'tests/post-prod.spec.ts' }),
    ])).toEqual([])
  })
})
