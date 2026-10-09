import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('test execution evidence', () => {
  it('keeps execution evidence isolated to the repository tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveTestExecution({ id: 'run-1', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '123', attempt: 1, revision: 'abc', kind: 'integration', status: 'failed', name: 'integration suite', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], summary: 'one test failed' })
    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toHaveLength(1)
    await expect(store.testExecutions('repo-1', 'org-2')).resolves.toEqual([])
  })

  it('updates a run lifecycle in place but preserves reruns without a source URL', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '456', revision: 'abc', kind: 'ci' as const, name: 'CI', policyArtifactIds: [], gateArtifactIds: [] }
    await store.saveTestExecution({ id: 'delivery-1', ...base, attempt: 1, status: 'running' })
    await store.saveTestExecution({ id: 'delivery-2', ...base, attempt: 1, status: 'failed', completedAt: '2026-01-01T00:01:00.000Z' })
    await store.saveTestExecution({ id: 'delivery-3', ...base, attempt: 2, status: 'passed', completedAt: '2026-01-01T00:02:00.000Z' })

    const executions = await store.testExecutions('repo-1', 'org-1')
    expect(executions).toEqual([
      expect.objectContaining({ id: 'delivery-2', attempt: 1, status: 'failed' }),
      expect.objectContaining({ id: 'delivery-3', attempt: 2, status: 'passed' }),
    ])
    expect(executions.every(execution => execution.sourceUrl === undefined)).toBe(true)
  })
})
