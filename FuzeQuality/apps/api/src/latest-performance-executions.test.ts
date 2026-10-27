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
  it('deduplicates reviewed load and stress workflow paths independently of dispatch eligibility', () => {
    expect(reviewedPerformanceWorkflowPaths([
      artifact(),
      artifact({ id: 'load-2', execution: undefined }),
      artifact({ id: 'stress-1', kind: 'stress-test', sourcePath: '.github/workflows/stress.yaml', execution: undefined }),
    ])).toEqual(['.github/workflows/load.yml', '.github/workflows/stress.yaml'])
  })

  it('excludes non-performance and non-workflow definitions', () => {
    expect(reviewedPerformanceWorkflowPaths([
      artifact({ kind: 'integration-test' }),
      artifact({ sourcePath: 'tests/performance/load.js', execution: undefined }),
      artifact({ sourcePath: '.github/workflows/load.txt', execution: undefined }),
    ])).toEqual([])
  })
})
