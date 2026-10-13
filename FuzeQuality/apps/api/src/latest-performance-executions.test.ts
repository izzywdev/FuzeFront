import { describe, expect, it } from 'vitest'
import type { QualityArtifact } from '@fuzequality/contracts'
import { reviewedPerformanceWorkflowPaths } from './latest-performance-executions'

const artifact = (overrides: Partial<QualityArtifact> = {}): QualityArtifact => ({
  id: 'load-1', repositoryId: 'repo-1', kind: 'load-test', title: 'Load',
  sourcePath: '.github/workflows/load.yml', summary: 'load', evidence: [],
  execution: { provider: 'github-actions', trigger: 'workflow_dispatch', workflowPath: '.github/workflows/load.yml', requiredInputs: [] },
  ...overrides,
})

describe('reviewed performance workflow lookup', () => {
  it('deduplicates executable load and stress workflow paths', () => {
    expect(reviewedPerformanceWorkflowPaths([artifact(), artifact({ id: 'load-2' })])).toEqual(['.github/workflows/load.yml'])
  })

  it('excludes inventory-only, mismatched, and unresolved-input definitions', () => {
    expect(reviewedPerformanceWorkflowPaths([
      artifact({ execution: undefined }),
      artifact({ sourcePath: '.github/workflows/other.yml' }),
      artifact({ execution: { ...artifact().execution!, requiredInputs: ['environment'] } }),
    ])).toEqual([])
  })
})
