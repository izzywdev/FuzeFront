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
      expect.objectContaining({ id: 'delivery-3', attempt: 2, status: 'passed' }),
      expect.objectContaining({ id: 'delivery-1', attempt: 1, status: 'failed' }),
    ])
    expect(executions.every(execution => execution.sourceUrl === undefined)).toBe(true)
  })

  it('continues tenant-scoped execution evidence with a stable timestamp and id cursor', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, revision: 'abc', kind: 'integration' as const, status: 'passed' as const, name: 'Integration', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [], completedAt: '2026-01-01T00:01:00.000Z' }
    await store.saveTestExecution({ id: 'run-a', ...base, externalRunId: 'a', attempt: 1 })
    await store.saveTestExecution({ id: 'run-c', ...base, externalRunId: 'c', attempt: 1 })
    await store.saveTestExecution({ id: 'run-b', ...base, externalRunId: 'b', attempt: 1 })

    await expect(store.testExecutions('repo-1', 'org-1', { limit: 2 })).resolves.toEqual([
      expect.objectContaining({ id: 'run-c' }),
      expect.objectContaining({ id: 'run-b' }),
    ])
    await expect(store.testExecutions('repo-1', 'org-1', {
      after: { createdAt: base.completedAt, id: 'run-b' },
      limit: 2,
    })).resolves.toEqual([expect.objectContaining({ id: 'run-a' })])
  })

  it('compares equivalent in-memory execution timestamps as instants', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, revision: 'abc', kind: 'integration' as const, status: 'passed' as const, name: 'Integration', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'run-b', ...base, externalRunId: 'b', attempt: 1, completedAt: '2026-01-01T00:01:00Z' })
    await store.saveTestExecution({ id: 'run-a', ...base, externalRunId: 'a', attempt: 1, completedAt: '2026-01-01T00:01:00.000Z' })
    await store.saveTestExecution({ id: 'run-later', ...base, externalRunId: 'later', attempt: 1, completedAt: '2026-01-01T00:01:00.001Z' })

    await expect(store.testExecutions('repo-1', 'org-1', {
      until: '2026-01-01T00:01:00.000Z',
    })).resolves.toEqual([
      expect.objectContaining({ id: 'run-b' }),
      expect.objectContaining({ id: 'run-a' }),
    ])
    await expect(store.testExecutions('repo-1', 'org-1', {
      after: { createdAt: '2026-01-01T00:01:00.000Z', id: 'run-b' },
    })).resolves.toEqual([expect.objectContaining({ id: 'run-a' })])
  })

  it('pushes execution filters and continuation into the tenant-scoped Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.testExecutions('repo-1', 'org-1', {
      kind: 'post-production',
      status: 'failed',
      provider: 'github-actions',
      revision: 'abc',
      workflowPath: '.github/workflows/post-prod.yml',
      from: '2026-01-01T00:00:00.000Z',
      until: '2026-01-31T00:00:00.000Z',
      after: { createdAt: '2026-01-15T00:00:00.000Z', id: 'run-2' },
      limit: 51,
    })

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('WHERE repository_id=$1 AND tenant_id=$2')
    expect(String(sql)).toContain("COALESCE(completed_at,started_at,'epoch'::timestamptz),id")
    expect(parameters).toEqual([
      'repo-1', 'org-1', 'post-production', 'failed', 'github-actions', 'abc',
      '.github/workflows/post-prod.yml', '2026-01-01T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 'run-2', 51,
    ])
  })

  it('aggregates complete tenant-scoped outcome history by UTC day in Postgres', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ date: '2026-10-10', passed: 2, failed: 1, cancelled: 0, running: 0 }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await expect(store.executionOutcomeTrend('repo-1', 'org-1', {
      kind: 'integration', beforeDate: '2026-10-11', limit: 51,
    })).resolves.toEqual([
      { date: '2026-10-10', passed: 2, failed: 1, cancelled: 0, running: 0 },
    ])

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('WHERE repository_id=$1 AND tenant_id=$2')
    expect(String(sql)).toContain('COALESCE(completed_at,started_at) IS NOT NULL')
    expect(String(sql)).not.toContain("COALESCE(completed_at,started_at,'epoch'::timestamptz)")
    expect(String(sql)).toContain("AT TIME ZONE 'UTC'")
    expect(String(sql)).toContain("count(*) FILTER (WHERE status='failed')")
    expect(parameters).toEqual(['repo-1', 'org-1', 'integration', null, null, null, null, null, null, '2026-10-11', 51])
  })

  it('pushes filtered policy-gate aggregation and its stable cursor into Postgres', async () => {
    const completedAt = new Date('2026-10-10T12:00:00.000Z')
    const query = vi.fn().mockResolvedValue({ rows: [{
      repository_id: 'repo-1', policy_artifact_id: 'policy-1', gate_artifact_id: 'gate-1',
      passed: 4, failed: 2, cancelled: 0, running: 0, revision_count: 3,
      latest_revision: 'revision-c', latest_completed_at: completedAt,
    }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await expect(store.policyGatePerformance('repo-1', 'org-1', {
      kind: 'post-production', provider: 'github-actions',
      after: { failed: 3, passed: 5, gateArtifactId: 'gate-0', policyArtifactId: 'policy-0' },
      limit: 51,
    })).resolves.toEqual([{
      repositoryId: 'repo-1', policyArtifactId: 'policy-1', gateArtifactId: 'gate-1',
      passed: 4, failed: 2, cancelled: 0, running: 0, revisionCount: 3,
      latestRevision: 'revision-c', latestCompletedAt: completedAt.toISOString(),
    }])

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('WHERE repository_id=$1 AND tenant_id=$2')
    expect(String(sql)).toContain('jsonb_array_elements')
    expect(String(sql)).toContain('GROUP BY repository_id,policy_artifact_id,gate_artifact_id')
    expect(String(sql)).toContain('ORDER BY failed DESC,passed DESC,gate_artifact_id,policy_artifact_id')
    expect(parameters).toEqual([
      'repo-1', 'org-1', 'post-production', null, 'github-actions', null, null, null, null,
      3, 5, 'gate-0', 'policy-0', 51,
    ])
  })

  it('bounds in-memory policy-gate aggregates without returning an unbounded revision list', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'external' as const, attempt: 1, kind: 'ci' as const, name: 'CI', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'run-a', ...base, externalRunId: 'a', revision: 'revision-a', status: 'passed', completedAt: '2026-10-09T00:00:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' }] })
    await store.saveTestExecution({ id: 'run-b', ...base, externalRunId: 'b', revision: 'revision-b', status: 'failed', completedAt: '2026-10-10T00:00:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' }] })

    await expect(store.policyGatePerformance('repo-1', 'org-1', { limit: 2 })).resolves.toEqual([
      expect.objectContaining({
        policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', passed: 1, failed: 1,
        revisionCount: 2, latestRevision: 'revision-b', revisions: undefined,
      }),
    ])
  })

  it('loads performance labels only by bounded artifact IDs inside the repository tenant', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.qualityArtifactsByIds('repo-1', 'org-1', ['policy-1', 'gate-1'])

    expect(String(query.mock.calls[0][0])).toContain('repository.tenant_id=$2')
    expect(String(query.mock.calls[0][0])).toContain('artifact.id=ANY($3::text[])')
    expect(query.mock.calls[0][1]).toEqual(['repo-1', 'org-1', ['policy-1', 'gate-1']])
  })

  it('does not erase detailed evidence when a later lifecycle delivery is sparse', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '900', attempt: 1, revision: 'abc', kind: 'load' as const, status: 'failed' as const, name: 'Load', workflowPath: '.github/workflows/load.yml' }
    await store.saveTestExecution({ id: 'stable-id', ...base, policyArtifactIds: ['policy-performance'], gateArtifactIds: ['gate-performance'], gateEvaluations: [{ policyArtifactId: 'policy-performance', gateArtifactId: 'gate-performance', status: 'failed' }], thresholds: [{ metric: 'p95', observed: 640, unit: 'ms', operator: 'lte', target: 500, passed: false }], evidenceLinks: [{ kind: 'video', name: 'Recorded run', url: 'https://evidence.example/load.webm' }], summary: 'p95 exceeded the 500 ms release threshold' })
    const { workflowPath: _omittedWorkflowPath, ...sparseBase } = base
    await store.saveTestExecution({ id: 'late-webhook-id', ...sparseBase, policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [{ kind: 'report', name: 'GitHub Actions artifacts', url: 'https://github.com/acme/app/actions/runs/900#artifacts' }], summary: 'failure' })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'stable-id',
        workflowPath: '.github/workflows/load.yml',
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

  it('promotes retained running gate outcomes when a sparse terminal update arrives', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '901', attempt: 1, revision: 'abc', kind: 'ci' as const, name: 'CI', policyArtifactIds: ['policy-ci'], gateArtifactIds: ['gate-ci'], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'running', ...base, status: 'running', gateEvaluations: [{ policyArtifactId: 'policy-ci', gateArtifactId: 'gate-ci', status: 'running', detail: 'Waiting for checks.' }] })
    await store.saveTestExecution({ id: 'terminal', ...base, status: 'failed', completedAt: '2026-01-01T00:01:00.000Z', gateEvaluations: [] })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        gateEvaluations: [expect.objectContaining({ status: 'failed', detail: 'Waiting for checks.' })],
      }),
    ])
  })

  it('replaces evidence-link labels by stable kind and URL', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '902', attempt: 1, revision: 'abc', kind: 'post-production' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [] }
    const url = 'https://evidence.example/run-902/report'
    await store.saveTestExecution({ id: 'first', ...base, status: 'running', evidenceLinks: [{ kind: 'report', name: 'Pending report', url }] })
    await store.saveTestExecution({ id: 'second', ...base, status: 'passed', evidenceLinks: [{ kind: 'report', name: 'Final Playwright report', url }] })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        evidenceLinks: [{ kind: 'report', name: 'Final Playwright report', url }],
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
    expect(sql).toContain("evaluation->>'status'='running'")
    expect(sql).toContain("DISTINCT ON (link->>'kind',link->>'url')")
    expect(sql).toContain("length(COALESCE(EXCLUDED.summary,''))")
    expect(query.mock.calls[0][1][10]).toBe('.github/workflows/ci.yml')
  })

  it('resolves a source commit to its scanner catalog revision', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ catalog_revision: 'catalog-revision' }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    vi.spyOn(store, 'repository').mockResolvedValue({ id: 'repo-1' } as never)

    await expect(store.catalogRevisionForSource('repo-1', 'org-1', 'a'.repeat(40)))
      .resolves.toBe('catalog-revision')
    expect(String(query.mock.calls[0][0])).toContain('source_revision=$2')
    expect(query.mock.calls[0][1]).toEqual(['repo-1', 'a'.repeat(40)])
  })
})
