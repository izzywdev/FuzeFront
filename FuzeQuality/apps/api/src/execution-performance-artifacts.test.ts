import { describe, expect, it, vi } from 'vitest'
import type { TestExecution } from '@fuzequality/contracts'
import { artifactsForExecutionRevisions } from './execution-performance-artifacts'

const execution = (id: string, revision: string): TestExecution => ({
  id,
  repositoryId: 'repo-1',
  tenantId: 'org-1',
  provider: 'github-actions',
  externalRunId: id,
  attempt: 1,
  revision,
  kind: 'ci',
  status: 'passed',
  name: 'CI',
  policyArtifactIds: [],
  gateArtifactIds: [],
  gateEvaluations: [],
  thresholds: [],
  evidenceLinks: [],
})

describe('historical execution artifact loading', () => {
  it('loads and merges each selected source revision exactly once', async () => {
    const resolve = vi.fn(async (_repositoryId, _tenantId, sourceRevision) =>
      sourceRevision === 'missing' ? undefined : `catalog-${sourceRevision}`
    )
    const load = vi.fn(async (_repositoryId, _tenantId, catalogRevision) => [{
      id: `policy-${catalogRevision}`,
      repositoryId: 'repo-1',
      kind: 'policy' as const,
      title: `Policy ${catalogRevision}`,
      sourcePath: 'governance/policy.md',
      summary: 'Policy evidence',
      evidence: [],
    }])

    const artifacts = await artifactsForExecutionRevisions(
      'repo-1',
      [execution('one', 'a'), execution('two', 'a'), execution('three', 'b'), execution('four', 'missing')],
      'org-1',
      resolve,
      load,
    )

    expect(resolve).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledWith('repo-1', 'org-1', 'catalog-a')
    expect(load).toHaveBeenCalledWith('repo-1', 'org-1', 'catalog-b')
    expect(artifacts.map(item => item.id)).toEqual(['policy-catalog-a', 'policy-catalog-b'])
  })

  it('does not query artifact storage when no executions are selected', async () => {
    const resolve = vi.fn()
    const load = vi.fn()

    await expect(artifactsForExecutionRevisions('repo-1', [], 'org-1', resolve, load)).resolves.toEqual([])
    expect(resolve).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })
})
