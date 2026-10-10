import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

describe('test execution evidence', () => {
  it('keeps execution evidence isolated to the repository tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveTestExecution({ id: 'run-1', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '123', attempt: 1, revision: 'abc', kind: 'integration', status: 'failed', name: 'integration suite', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' }], thresholds: [], evidenceLinks: [], summary: 'one test failed' })
    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toHaveLength(1)
    await expect(store.testExecutions('repo-1', 'org-2')).resolves.toEqual([])
  })

  it('updates a run lifecycle in place but preserves reruns without a source URL', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '456', revision: 'abc', kind: 'ci' as const, name: 'CI', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'delivery-1', ...base, attempt: 1, status: 'running' })
    await store.saveTestExecution({ id: 'delivery-2', ...base, attempt: 1, status: 'failed', completedAt: '2026-01-01T00:01:00.000Z' })
    await store.saveTestExecution({ id: 'delivery-3', ...base, attempt: 2, status: 'passed', completedAt: '2026-01-01T00:02:00.000Z' })

    const executions = await store.testExecutions('repo-1', 'org-1')
    expect(executions).toEqual([
      expect.objectContaining({ id: 'delivery-1', attempt: 1, status: 'failed' }),
      expect.objectContaining({ id: 'delivery-3', attempt: 2, status: 'passed' }),
    ])
    expect(executions.every(execution => execution.sourceUrl === undefined)).toBe(true)
  })

  it('does not erase detailed evidence when a later lifecycle delivery is sparse', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '900', attempt: 1, revision: 'abc', kind: 'load' as const, status: 'failed' as const, name: 'Load', workflowPath: '.github/workflows/load.yml' }
    await store.saveTestExecution({ id: 'stable-id', ...base, policyArtifactIds: ['policy-performance'], gateArtifactIds: ['gate-performance'], gateEvaluations: [{ policyArtifactId: 'policy-performance', gateArtifactId: 'gate-performance', status: 'failed' }], thresholds: [{ metric: 'p95', observed: 640, unit: 'ms', operator: 'lte', target: 500, passed: false }], evidenceLinks: [{ kind: 'video', name: 'Recorded run', url: 'https://evidence.example/load.webm' }], summary: 'p95 exceeded the 500 ms release threshold' })
    await store.saveTestExecution({ id: 'late-webhook-id', ...base, policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [{ kind: 'report', name: 'GitHub Actions artifacts', url: 'https://github.com/acme/app/actions/runs/900#artifacts' }], summary: 'failure' })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'stable-id',
        policyArtifactIds: ['policy-performance'],
        gateArtifactIds: ['gate-performance'],
        gateEvaluations: [expect.objectContaining({ status: 'failed' })],
        thresholds: [expect.objectContaining({ metric: 'p95', passed: false })],
        evidenceLinks: [
          expect.objectContaining({ kind: 'video' }),
          expect.objectContaining({ kind: 'report' }),
        ],
        summary: 'p95 exceeded the 500 ms release threshold',
      }),
    ])
  })

  it('does not regress terminal evidence when a running delivery arrives late', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '789', attempt: 1, revision: 'abc', kind: 'post-production' as const, name: 'Post-production', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'completed-delivery', ...base, status: 'passed', sourceUrl: 'https://github.com/acme/app/actions/runs/789', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:02:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' }], summary: 'success' })
    await store.saveTestExecution({ id: 'delayed-running-delivery', ...base, status: 'running', startedAt: '2026-01-01T00:00:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'running' }] })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'completed-delivery',
        status: 'passed',
        completedAt: '2026-01-01T00:02:00.000Z',
        sourceUrl: 'https://github.com/acme/app/actions/runs/789',
        gateEvaluations: [expect.objectContaining({ status: 'passed' })],
      }),
    ])
  })

  it('guards the Postgres upsert against an out-of-order running delivery', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.saveTestExecution({ id: 'delivery', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '789', attempt: 1, revision: 'abc', kind: 'ci', status: 'running', name: 'CI', workflowPath: '.github/workflows/ci.yml', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] })

    expect(query).toHaveBeenCalledOnce()
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain("WHERE fuzequality.test_executions.status = 'running' OR EXCLUDED.status <> 'running'")
    expect(sql).toContain('workflow_path')
    expect(sql).toContain('jsonb_array_length(EXCLUDED.thresholds)>0')
    expect(sql).toContain('test_executions.evidence_links || EXCLUDED.evidence_links')
    expect(sql).toContain("length(COALESCE(EXCLUDED.summary,''))")
    expect(query.mock.calls[0][1][10]).toBe('.github/workflows/ci.yml')
  })
})
