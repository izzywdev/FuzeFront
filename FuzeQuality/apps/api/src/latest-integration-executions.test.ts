import { describe, expect, it } from 'vitest'
import type { QualityArtifact } from '@fuzequality/contracts'
import { reviewedIntegrationWorkflowPaths } from './latest-integration-executions'

const artifact = (overrides: Partial<QualityArtifact> = {}): QualityArtifact => ({
  id: 'integration-1', repositoryId: 'repo-1', kind: 'integration-test', title: 'Integration',
  sourcePath: '.github/workflows/integration.yml', summary: 'integration test', evidence: [],
  ...overrides,
})

describe('reviewed integration workflow lookup', () => {
  it('deduplicates scanner-reviewed workflow paths', () => {
    expect(reviewedIntegrationWorkflowPaths([artifact(), artifact({ id: 'integration-2' })]))
      .toEqual(['.github/workflows/integration.yml'])
  })

  it('excludes other artifact kinds and non-workflow paths', () => {
    expect(reviewedIntegrationWorkflowPaths([
      artifact({ kind: 'gate' }),
      artifact({ sourcePath: 'tests/integration.spec.ts' }),
    ])).toEqual([])
  })
})
