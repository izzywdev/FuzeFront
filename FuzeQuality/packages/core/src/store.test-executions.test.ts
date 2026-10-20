import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore, testExecutionCursorCreatedAt } from './store'

describe('test execution evidence', () => {
  it('keeps execution evidence isolated to the repository tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveTestExecution({ id: 'run-1', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '123', attempt: 1, revision: 'abc', kind: 'integration', status: 'failed', name: 'integration suite', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' }], thresholds: [], evidenceLinks: [], summary: 'one test failed' })
    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toHaveLength(1)
    await expect(store.testExecutions('repo-1', 'org-2')).resolves.toEqual([])
  })

  it('retains provider evidence collection failures with the exact execution attempt', async () => {
    const store = new MemoryCatalogStore()
    await store.saveTestExecution({
      id: 'run-evidence-timeout', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions',
      externalRunId: '124', attempt: 1, revision: 'abc', kind: 'post-production', status: 'passed',
      name: 'post-production browser journey', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [],
      thresholds: [], evidenceLinks: [],
      evidenceCollection: { status: 'unavailable', checkedAt: '2026-10-16T08:00:00.000Z', errorCode: 'PROVIDER_TIMEOUT' },
    })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({ evidenceCollection: expect.objectContaining({ errorCode: 'PROVIDER_TIMEOUT' }) }),
    ])
  })

  it('returns the latest load or stress execution for every reviewed workflow independently of mixed history', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, attempt: 1, revision: 'abc', branch: 'main', headRepository: 'acme/app', status: 'passed' as const, name: 'run', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    for (let index = 0; index < 60; index++) await store.saveTestExecution({ id: `ci-${index}`, ...base, externalRunId: `ci-${index}`, kind: 'ci', completedAt: `2026-10-13T12:${String(index).padStart(2, '0')}:00.000Z` })
    await store.saveTestExecution({ id: 'load-old', ...base, externalRunId: 'load-old', kind: 'load', workflowPath: '.github/workflows/load.yml', completedAt: '2026-10-10T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'load-new', ...base, externalRunId: 'load-new', kind: 'load', workflowPath: '.github/workflows/load.yml', completedAt: '2026-10-11T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'load-feature', ...base, branch: 'feature/faster-load', externalRunId: 'load-feature', kind: 'load', workflowPath: '.github/workflows/load.yml', completedAt: '2026-10-12T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'stress', ...base, externalRunId: 'stress', kind: 'stress', workflowPath: '.github/workflows/stress.yml', completedAt: '2026-10-09T00:00:00.000Z' })

    await store.saveTestExecution({ id: 'fork-load', ...base, headRepository: 'contributor/app', externalRunId: 'fork-load', kind: 'load', workflowPath: '.github/workflows/load.yml', completedAt: '2026-10-14T00:00:00.000Z' })

    await expect(store.latestPerformanceExecutions('repo-1', 'org-1', ['.github/workflows/load.yml', '.github/workflows/stress.yml'], 'main', 'acme/app')).resolves.toEqual([
      expect.objectContaining({ id: 'load-new' }),
      expect.objectContaining({ id: 'stress' }),
    ])
  })

  it('pushes tenant and reviewed workflow paths into the latest-performance Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    await store.latestPerformanceExecutions('repo-1', 'org-1', ['.github/workflows/load.yml'], 'main', 'acme/app')
    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain("kind IN ('load','stress')")
    expect(String(sql)).toContain('workflow_path=ANY($3::text[])')
    expect(String(sql)).toContain('branch=$4')
    expect(String(sql)).toContain("provider<>'github-actions' OR lower(head_repository)=lower($5)")
    expect(String(sql)).toContain('DISTINCT ON (workflow_path)')
    expect(parameters).toEqual(['repo-1', 'org-1', ['.github/workflows/load.yml'], 'main', 'acme/app'])
  })

  it('returns the latest post-production execution for every detected workflow', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, attempt: 1, revision: 'abc', branch: 'main', headRepository: 'acme/app', kind: 'post-production' as const, status: 'passed' as const, name: 'post-prod', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'old', ...base, externalRunId: 'old', workflowPath: '.github/workflows/post-prod.yml', completedAt: '2026-10-10T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'new', ...base, externalRunId: 'new', workflowPath: '.github/workflows/post-prod.yml', completedAt: '2026-10-11T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'feature', ...base, branch: 'feature/post-prod', externalRunId: 'feature', workflowPath: '.github/workflows/post-prod.yml', completedAt: '2026-10-13T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'other', ...base, externalRunId: 'other', kind: 'ci', workflowPath: '.github/workflows/post-prod.yml', completedAt: '2026-10-12T00:00:00.000Z' })

    await expect(store.latestPostProductionExecutions('repo-1', 'org-1', ['.github/workflows/post-prod.yml'], 'main', 'acme/app'))
      .resolves.toEqual([expect.objectContaining({ id: 'new' })])
  })

  it('pushes tenant and detected workflow paths into the latest post-production Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    await store.latestPostProductionExecutions('repo-1', 'org-1', ['.github/workflows/post-prod.yml'], 'main', 'acme/app')
    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain("kind='post-production'")
    expect(String(sql)).toContain('workflow_path=ANY($3::text[])')
    expect(String(sql)).toContain('branch=$4')
    expect(String(sql)).toContain('DISTINCT ON (workflow_path)')
    expect(parameters).toEqual(['repo-1', 'org-1', ['.github/workflows/post-prod.yml'], 'main', 'acme/app'])
  })

  it('returns the latest integration execution for every detected workflow', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, attempt: 1, revision: 'abc', branch: 'main', headRepository: 'acme/app', kind: 'integration' as const, status: 'passed' as const, name: 'integration', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'old-integration', ...base, externalRunId: 'old', workflowPath: '.github/workflows/integration.yml', completedAt: '2026-10-10T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'new-integration', ...base, externalRunId: 'new', workflowPath: '.github/workflows/integration.yml', completedAt: '2026-10-11T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'feature-integration', ...base, branch: 'feature/integration', externalRunId: 'feature', workflowPath: '.github/workflows/integration.yml', completedAt: '2026-10-13T00:00:00.000Z' })
    await store.saveTestExecution({ id: 'other-post-prod', ...base, externalRunId: 'other', kind: 'post-production', workflowPath: '.github/workflows/integration.yml', completedAt: '2026-10-12T00:00:00.000Z' })

    await expect(store.latestIntegrationExecutions('repo-1', 'org-1', ['.github/workflows/integration.yml'], 'main', 'acme/app'))
      .resolves.toEqual([expect.objectContaining({ id: 'new-integration' })])
  })

  it('pushes tenant and detected workflow paths into the latest integration Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    await store.latestIntegrationExecutions('repo-1', 'org-1', ['.github/workflows/integration.yml'], 'main', 'acme/app')
    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain("kind='integration'")
    expect(String(sql)).toContain('workflow_path=ANY($3::text[])')
    expect(String(sql)).toContain('branch=$4')
    expect(String(sql)).toContain('DISTINCT ON (workflow_path)')
    expect(parameters).toEqual(['repo-1', 'org-1', ['.github/workflows/integration.yml'], 'main', 'acme/app'])
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
    await expect(store.testExecutions('repo-1', 'org-1', { attemptScope: 'initial' }))
      .resolves.toEqual([expect.objectContaining({ attempt: 1 })])
    await expect(store.testExecutions('repo-1', 'org-1', { attemptScope: 'retry' }))
      .resolves.toEqual([expect.objectContaining({ attempt: 2 })])
    await expect(store.testExecutions('repo-1', 'org-1', { attemptScope: 'recovered' }))
      .resolves.toEqual([expect.objectContaining({ attempt: 2, status: 'passed' })])
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
    const firstPage = await store.testExecutions('repo-1', 'org-1', { limit: 2 })
    await expect(store.testExecutions('repo-1', 'org-1', {
      after: { createdAt: testExecutionCursorCreatedAt(firstPage[1]), id: firstPage[1].id },
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
    const filtered = await store.testExecutions('repo-1', 'org-1', {
      until: '2026-01-01T00:01:00.000Z',
    })
    await expect(store.testExecutions('repo-1', 'org-1', {
      after: { createdAt: testExecutionCursorCreatedAt(filtered[0]), id: filtered[0].id },
      until: '2026-01-01T00:01:00.000Z',
    })).resolves.toEqual([expect.objectContaining({ id: 'run-a' })])
  })

  it('does not skip a running execution that completes between immutable history pages', async () => {
    vi.useFakeTimers()
    try {
      const store = new MemoryCatalogStore()
      const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, revision: 'abc', kind: 'integration' as const, name: 'Integration', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
      vi.setSystemTime('2026-01-01T00:00:00.000Z')
      await store.saveTestExecution({ id: 'running', ...base, externalRunId: 'running', attempt: 1, status: 'running', startedAt: '2026-01-01T00:00:00.000Z' })
      vi.setSystemTime('2026-01-01T00:01:00.000Z')
      await store.saveTestExecution({ id: 'page-leader', ...base, externalRunId: 'leader', attempt: 1, status: 'passed', completedAt: '2026-01-01T00:01:00.000Z' })

      const firstPage = await store.testExecutions('repo-1', 'org-1', { limit: 1 })
      const cursor = { createdAt: testExecutionCursorCreatedAt(firstPage[0]), id: firstPage[0].id }
      await store.saveTestExecution({ id: 'running-update', ...base, externalRunId: 'running', attempt: 1, status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:02:00.000Z' })

      await expect(store.testExecutions('repo-1', 'org-1', { after: cursor, limit: 1 })).resolves.toEqual([
        expect.objectContaining({ id: 'running', status: 'passed', completedAt: '2026-01-01T00:02:00.000Z' }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('pushes execution filters and continuation into the tenant-scoped Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.testExecutions('repo-1', 'org-1', {
      kind: 'post-production',
      status: 'failed',
      provider: 'github-actions',
      name: 'Post-production browser suite',
      evidenceKind: 'video',
      evidenceCollectionStatus: 'unavailable',
      evidenceCheckedAfter: '2026-01-10T00:00:00.000Z',
      evidenceCheckedBefore: '2026-01-20T00:00:00.000Z',
      evidenceRequirement: 'post-production-video-missing',
      thresholdOutcome: 'failed',
      gateOutcome: 'failed',
      externalRunId: 'provider-run-42',
      branch: 'release/quality',
      revision: 'abc',
      workflowPath: '.github/workflows/post-prod.yml',
      attemptScope: 'recovered',
      minimumDurationMs: 60_000,
      maximumDurationMs: 180_000,
      from: '2026-01-01T00:00:00.000Z',
      until: '2026-01-31T00:00:00.000Z',
      policyArtifactId: 'policy-1',
      gateArtifactId: 'gate-1',
      after: { createdAt: '2026-01-15T00:00:00.000Z', id: 'run-2' },
      limit: 51,
    })

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('WHERE executions.repository_id=$1 AND executions.tenant_id=$2')
    expect(String(sql)).toContain('(executions.created_at,executions.id) <')
    expect(String(sql)).toContain('ORDER BY executions.created_at DESC,executions.id DESC')
    expect(String(sql)).toContain("$8='recovered'")
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9')
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10')
    expect(String(sql)).toContain('previous.external_run_id=executions.external_run_id')
    expect(String(sql)).toContain('executions.external_run_id=$16')
    expect(String(sql)).toContain("pair.value->>'policyArtifactId'=$17")
    expect(String(sql)).toContain("pair.value->>'gateArtifactId'=$18")
    expect(String(sql)).toContain("evidence.value->>'kind'=$19")
    expect(String(sql)).toContain("threshold.value->>'passed'=CASE $20")
    expect(String(sql)).toContain('executions.name=$21')
    expect(String(sql)).toContain("gate_evaluation.value->>'status',executions.status)=$22")
    expect(String(sql)).toContain('executions.branch=$23')
    expect(String(sql)).toContain("$24='not-collected' AND executions.evidence_collection IS NULL")
    expect(String(sql)).toContain("executions.evidence_collection->>'status'=$24")
    expect(String(sql)).toContain("$25='post-production-video-missing'")
    expect(String(sql)).toContain("required_evidence.value->>'kind'='video'")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz <= $26")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz >= $27")
    expect(parameters).toEqual([
      'repo-1', 'org-1', 'post-production', 'failed', 'github-actions', 'abc',
      '.github/workflows/post-prod.yml', 'recovered', 60_000, 180_000, '2026-01-01T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 'run-2', 51, 'provider-run-42', 'policy-1', 'gate-1', 'video', 'failed', 'Post-production browser suite', 'failed', 'release/quality', 'unavailable',
      'post-production-video-missing', '2026-01-20T00:00:00.000Z', '2026-01-10T00:00:00.000Z',
    ])
  })

  it('aggregates complete tenant-scoped outcome history by UTC day in Postgres', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ date: '2026-10-10', total: 3, passed: 2, failed: 1, cancelled: 0, running: 0, pass_rate: 2 / 3, duration_sample_count: 2, average_duration_ms: 45_000, maximum_duration_ms: 60_000, retry_attempt_count: 3, successful_retry_count: 2, recovered_run_count: 1 }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await expect(store.executionOutcomeTrend('repo-1', 'org-1', {
      kind: 'integration', name: 'Integration suite', externalRunId: 'provider-run-42', branch: 'feature/checkout', evidenceKind: 'report', evidenceCollectionStatus: 'complete', evidenceCheckedAfter: '2026-10-01T00:00:00.000Z', evidenceCheckedBefore: '2026-10-09T00:00:00.000Z', evidenceRequirement: 'post-production-video-missing', thresholdOutcome: 'passed', gateOutcome: 'passed', policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', minimumDurationMs: 60_000, maximumDurationMs: 180_000, beforeDate: '2026-10-11', limit: 51,
    })).resolves.toEqual([
      { date: '2026-10-10', total: 3, passed: 2, failed: 1, cancelled: 0, running: 0, passRate: 2 / 3, durationSampleCount: 2, averageDurationMs: 45_000, maximumDurationMs: 60_000, retryAttemptCount: 3, successfulRetryCount: 2, recoveredRunCount: 1 },
    ])

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('FROM fuzequality.test_execution_versions')
    expect(String(sql)).toContain('WHERE repository_id=$1 AND tenant_id=$2')
    expect(String(sql)).toContain('versioned_at <= $14')
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9')
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10')
    expect(String(sql)).toContain('COALESCE(executions.completed_at,executions.started_at) IS NOT NULL')
    expect(String(sql)).not.toContain("COALESCE(completed_at,started_at,'epoch'::timestamptz)")
    expect(String(sql)).toContain("AT TIME ZONE 'UTC'")
    expect(String(sql)).toContain("count(*) FILTER (WHERE status='failed')")
    expect(String(sql)).toContain('AS pass_rate')
    expect(String(sql)).toContain('duration_sample_count')
    expect(String(sql)).toContain('average_duration_ms')
    expect(String(sql)).toContain('maximum_duration_ms')
    expect(String(sql)).toContain('retry_attempt_count')
    expect(String(sql)).toContain('successful_retry_count')
    expect(String(sql)).toContain('recovered_run_count')
    expect(String(sql)).toContain('previous.external_run_id=executions.external_run_id')
    expect(String(sql)).toContain("previous.status='failed'")
    expect(String(sql)).toContain('executions.external_run_id=$16')
    expect(String(sql)).toContain("pair.value->>'policyArtifactId'=$17")
    expect(String(sql)).toContain("pair.value->>'gateArtifactId'=$18")
    expect(String(sql)).toContain("evidence.value->>'kind'=$19")
    expect(String(sql)).toContain("threshold.value->>'passed'=CASE $20")
    expect(String(sql)).toContain('executions.name=$21')
    expect(String(sql)).toContain("gate_evaluation.value->>'status',executions.status)=$22")
    expect(String(sql)).toContain('executions.branch=$23')
    expect(String(sql)).toContain("$24='not-collected' AND executions.evidence_collection IS NULL")
    expect(String(sql)).toContain("executions.evidence_collection->>'status'=$24")
    expect(String(sql)).toContain("$25='post-production-video-missing'")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz <= $26")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz >= $27")
    expect(String(sql)).toContain('evidence_links,evidence_collection,thresholds')
    expect(parameters).toEqual(['repo-1', 'org-1', 'integration', null, null, null, null, null, 60_000, 180_000, null, null, '2026-10-11', null, 51, 'provider-run-42', 'policy-1', 'gate-1', 'report', 'passed', 'Integration suite', 'passed', 'feature/checkout', 'complete', 'post-production-video-missing', '2026-10-09T00:00:00.000Z', '2026-10-01T00:00:00.000Z'])
  })

  it('pushes filtered policy-gate aggregation and its stable cursor into Postgres', async () => {
    const completedAt = new Date('2026-10-10T12:00:00.000Z')
    const query = vi.fn().mockResolvedValue({ rows: [{
      repository_id: 'repo-1', policy_artifact_id: 'policy-1', gate_artifact_id: 'gate-1',
      total: 6, passed: 4, failed: 2, cancelled: 0, running: 0, pass_rate: 2 / 3, revision_count: 3,
      latest_revision: 'revision-c', latest_completed_at: completedAt,
    }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await expect(store.policyGatePerformance('repo-1', 'org-1', {
      kind: 'post-production', name: 'Post-production browser suite', provider: 'github-actions', externalRunId: 'provider-run-42', branch: 'release/quality', evidenceKind: 'video', evidenceCollectionStatus: 'partial', evidenceCheckedAfter: '2026-10-01T00:00:00.000Z', evidenceCheckedBefore: '2026-10-09T00:00:00.000Z', evidenceRequirement: 'post-production-video-missing', thresholdOutcome: 'failed', gateOutcome: 'failed', policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', attemptScope: 'recovered', minimumDurationMs: 90_000, maximumDurationMs: 300_000,
      after: { failed: 3, passed: 5, gateArtifactId: 'gate-0', policyArtifactId: 'policy-0' },
      limit: 51,
    })).resolves.toEqual([{
      repositoryId: 'repo-1', policyArtifactId: 'policy-1', gateArtifactId: 'gate-1',
      total: 6, passed: 4, failed: 2, cancelled: 0, running: 0, passRate: 2 / 3, revisionCount: 3,
      latestRevision: 'revision-c', latestCompletedAt: completedAt.toISOString(),
    }])

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('WHERE repository_id=$1 AND tenant_id=$2')
    expect(String(sql)).toContain('jsonb_array_elements')
    expect(String(sql)).toContain('FROM fuzequality.test_execution_versions')
    expect(String(sql)).toContain('versioned_at <= $13')
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 >= $9')
    expect(String(sql)).toContain('EXTRACT(EPOCH FROM (executions.completed_at-executions.started_at))*1000 <= $10')
    expect(String(sql)).toContain('versioned_at DESC,version_id DESC')
    expect(String(sql)).toContain("$8='recovered'")
    expect(String(sql)).toContain('previous.external_run_id=executions.external_run_id')
    expect(String(sql)).toContain('executions.external_run_id=$19')
    expect(String(sql)).toContain("pair.value->>'policyArtifactId'=$20")
    expect(String(sql)).toContain("pair.value->>'gateArtifactId'=$21")
    expect(String(sql)).toContain("evidence.value->>'kind'=$22")
    expect(String(sql)).toContain("threshold.value->>'passed'=CASE $23")
    expect(String(sql)).toContain('executions.name=$24')
    expect(String(sql)).toContain("pair.value->>'status',execution.status)=$25")
    expect(String(sql)).toContain('executions.branch=$26')
    expect(String(sql)).toContain("$27='not-collected' AND executions.evidence_collection IS NULL")
    expect(String(sql)).toContain("executions.evidence_collection->>'status'=$27")
    expect(String(sql)).toContain("$28='post-production-video-missing'")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz <= $29")
    expect(String(sql)).toContain("executions.evidence_collection->>'checkedAt')::timestamptz >= $30")
    expect(String(sql)).toContain('evidence_links,evidence_collection,thresholds')
    expect(String(sql)).toContain('GROUP BY repository_id,policy_artifact_id,gate_artifact_id')
    expect(String(sql)).toContain('AS pass_rate')
    expect(String(sql)).toContain('ORDER BY failed DESC,passed DESC,gate_artifact_id,policy_artifact_id')
    expect(parameters).toEqual([
      'repo-1', 'org-1', 'post-production', null, 'github-actions', null, null, 'recovered', 90_000, 300_000, null, null, null,
      3, 5, 'gate-0', 'policy-0', 51, 'provider-run-42', 'policy-1', 'gate-1', 'video', 'failed', 'Post-production browser suite', 'failed', 'release/quality', 'partial', 'post-production-video-missing', '2026-10-09T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    ])
  })

  it('freezes an execution lifecycle state in a performance snapshot after it completes', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
      const store = new MemoryCatalogStore()
      const base = {
        repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const,
        externalRunId: 'snapshot-run', attempt: 1, revision: 'revision-a', kind: 'load' as const,
        name: 'Load', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'],
        thresholds: [], evidenceLinks: [],
      }
      await store.saveTestExecution({
        id: 'run-started', ...base, status: 'running', startedAt: '2026-10-10T11:59:00.000Z',
        gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'running' }],
      })
      const snapshotAt = '2026-10-10T12:00:01.000Z'

      vi.setSystemTime(new Date('2026-10-10T12:05:00.000Z'))
      await store.saveTestExecution({
        id: 'run-completed', ...base, status: 'passed', startedAt: '2026-10-10T11:59:00.000Z',
        completedAt: '2026-10-10T12:05:00.000Z',
        gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' }],
      })
      await store.saveTestExecution({
        id: 'run-created-after-snapshot', ...base, externalRunId: 'later-run', status: 'failed',
        startedAt: '2026-10-10T12:04:00.000Z', completedAt: '2026-10-10T12:05:00.000Z',
        gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' }],
      })

      await expect(store.policyGatePerformance('repo-1', 'org-1', { snapshotAt })).resolves.toEqual([
        expect.objectContaining({ policyArtifactId: 'policy-1', passed: 0, failed: 0, running: 1 }),
      ])
      await expect(store.policyGatePerformance('repo-1', 'org-1')).resolves.toEqual([
        expect.objectContaining({ policyArtifactId: 'policy-1', passed: 1, failed: 1, running: 0 }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('freezes outcome-trend buckets across lifecycle updates', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-10T23:59:00.000Z'))
      const store = new MemoryCatalogStore()
      const base = {
        repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const,
        externalRunId: 'trend-snapshot-run', attempt: 1, revision: 'revision-a', kind: 'integration' as const,
        name: 'Integration', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [],
        thresholds: [], evidenceLinks: [], startedAt: '2026-10-10T23:58:00.000Z',
      }
      await store.saveTestExecution({ id: 'run-started', ...base, status: 'running' })
      const snapshotAt = '2026-10-10T23:59:30.000Z'

      vi.setSystemTime(new Date('2026-10-11T00:05:00.000Z'))
      await store.saveTestExecution({
        id: 'run-completed', ...base, status: 'passed', completedAt: '2026-10-11T00:05:00.000Z',
      })

      await expect(store.executionOutcomeTrend('repo-1', 'org-1', { snapshotAt })).resolves.toEqual([
        { date: '2026-10-10', total: 1, passed: 0, failed: 0, cancelled: 0, running: 1, passRate: 0, durationSampleCount: 0, averageDurationMs: 0, maximumDurationMs: 0, retryAttemptCount: 0, successfulRetryCount: 0, recoveredRunCount: 0 },
      ])
      await expect(store.executionOutcomeTrend('repo-1', 'org-1')).resolves.toEqual([
        { date: '2026-10-11', total: 1, passed: 1, failed: 0, cancelled: 0, running: 0, passRate: 1, durationSampleCount: 1, averageDurationMs: 420_000, maximumDurationMs: 420_000, retryAttemptCount: 0, successfulRetryCount: 0, recoveredRunCount: 0 },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('appends the merged execution state to the Postgres snapshot history', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.saveTestExecution({
      id: 'run-1', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions',
      externalRunId: '123', attempt: 1, revision: 'abc', kind: 'integration', status: 'running',
      name: 'Integration', workflowPath: '.github/workflows/integration.yml',
      policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'],
      gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'running' }],
      thresholds: [], evidenceLinks: [],
    })

    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('WITH upserted AS')
    expect(sql).toContain('INSERT INTO fuzequality.test_execution_versions')
    expect(sql).toContain('gate_evaluations,thresholds,evidence_links')
    expect(sql).toContain('FROM upserted')
  })

  it('bounds in-memory policy-gate aggregates without returning an unbounded revision list', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'external' as const, attempt: 1, kind: 'ci' as const, name: 'CI', policyArtifactIds: ['policy-1'], gateArtifactIds: ['gate-1'], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'run-a', ...base, externalRunId: 'a', revision: 'revision-a', status: 'passed', completedAt: '2026-10-09T00:00:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'passed' }] })
    await store.saveTestExecution({ id: 'run-b', ...base, externalRunId: 'b', revision: 'revision-b', status: 'failed', completedAt: '2026-10-10T00:00:00.000Z', gateEvaluations: [{ policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', status: 'failed' }] })

    await expect(store.policyGatePerformance('repo-1', 'org-1', { limit: 2 })).resolves.toEqual([
      expect.objectContaining({
        policyArtifactId: 'policy-1', gateArtifactId: 'gate-1', total: 2, passed: 1, failed: 1, passRate: 0.5,
        revisionCount: 2, latestRevision: 'revision-b', revisions: undefined,
      }),
    ])
  })

  it('filters each explicit policy-gate pair in memory aggregates', async () => {
    const store = new MemoryCatalogStore()
    await store.saveTestExecution({
      id: 'mixed-pairs', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'external', externalRunId: 'mixed-pairs',
      attempt: 1, revision: 'revision-a', kind: 'ci', status: 'failed', name: 'Mixed gates', completedAt: '2026-10-10T00:00:00.000Z',
      policyArtifactIds: ['policy-a', 'policy-b'], gateArtifactIds: ['gate-a', 'gate-b'], thresholds: [], evidenceLinks: [],
      gateEvaluations: [
        { policyArtifactId: 'policy-a', gateArtifactId: 'gate-a', status: 'passed' },
        { policyArtifactId: 'policy-b', gateArtifactId: 'gate-b', status: 'failed' },
      ],
    })

    await expect(store.policyGatePerformance('repo-1', 'org-1', { policyArtifactId: 'policy-a' })).resolves.toEqual([
      expect.objectContaining({ policyArtifactId: 'policy-a', gateArtifactId: 'gate-a', passed: 1, failed: 0 }),
    ])
  })

  it('loads performance labels only by bounded artifact IDs inside the repository tenant', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.qualityArtifactsByIds('repo-1', 'org-1', ['policy-1', 'gate-1'], 'catalog-revision')

    expect(String(query.mock.calls[0][0])).toContain('repository.tenant_id=$2')
    expect(String(query.mock.calls[0][0])).toContain('artifact.id=requested.id OR artifact.logical_id=requested.id')
    expect(String(query.mock.calls[0][0])).toContain('(artifact.id=requested.id) DESC')
    expect(String(query.mock.calls[0][0])).toContain('artifact.revision=COALESCE($4::text,repository.last_scan_revision)')
    expect(query.mock.calls[0][1]).toEqual(['repo-1', 'org-1', ['policy-1', 'gate-1'], 'catalog-revision'])
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

  it('bounds merged lifecycle evidence to the response contract limit', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: 'bounded-evidence', attempt: 1, revision: 'abc', kind: 'post-production' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [] }
    const firstDelivery = Array.from({ length: 100 }, (_, index) => ({ kind: 'other' as const, name: `Initial artifact ${index}`, url: `https://evidence.example/initial/${index}` }))
    const secondDelivery = Array.from({ length: 100 }, (_, index) => ({ kind: 'other' as const, name: `Later artifact ${index}`, url: `https://evidence.example/later/${index}` }))

    await store.saveTestExecution({ id: 'first', ...base, status: 'running', evidenceLinks: firstDelivery })
    await store.saveTestExecution({ id: 'second', ...base, status: 'passed', evidenceLinks: secondDelivery })

    const [saved] = await store.testExecutions('repo-1', 'org-1')
    expect(saved.evidenceLinks).toHaveLength(100)
    expect(new Set(saved.evidenceLinks.map(link => `${link.kind}:${link.url}`)).size).toBe(100)
  })

  it('does not downgrade a completed artifact lookup on a transient redelivery failure', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '903', attempt: 1, revision: 'abc', kind: 'post-production' as const, status: 'passed' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'first', ...base, evidenceCollection: { status: 'complete', checkedAt: '2026-10-16T08:00:00.000Z' } })
    await store.saveTestExecution({ id: 'second', ...base, evidenceCollection: { status: 'unavailable', checkedAt: '2026-10-16T08:01:00.000Z', errorCode: 'PROVIDER_TIMEOUT' } })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({ evidenceCollection: { status: 'complete', checkedAt: '2026-10-16T08:00:00.000Z' } }),
    ])
  })

  it('replaces an older complete marker when bounded pagination proves collection was partial', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '904', attempt: 1, revision: 'abc', kind: 'post-production' as const, status: 'passed' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'first', ...base, evidenceCollection: { status: 'complete', checkedAt: '2026-10-16T08:00:00.000Z' } })
    await store.saveTestExecution({ id: 'second', ...base, evidenceCollection: { status: 'partial', checkedAt: '2026-10-16T08:01:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' } })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({ evidenceCollection: { status: 'partial', checkedAt: '2026-10-16T08:01:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' } }),
    ])
  })

  it('removes stale GitHub artifact links when a complete provider inventory replaces them', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: '905', attempt: 1, revision: 'abc', kind: 'post-production' as const, status: 'passed' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [] }
    await store.saveTestExecution({ id: 'first', ...base, evidenceLinks: [
      { kind: 'video', name: 'Expired video', url: 'https://github.com/acme/app/actions/runs/905/artifacts/7' },
      { kind: 'report', name: 'External report', url: 'https://evidence.example/run/905' },
    ], evidenceCollection: { status: 'partial', checkedAt: '2026-10-16T08:00:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' } })
    await store.saveTestExecution({ id: 'second', ...base, evidenceLinks: [
      { kind: 'trace', name: 'Current trace', url: 'https://github.com/acme/app/actions/runs/905/artifacts/8' },
    ], evidenceCollection: { status: 'complete', checkedAt: '2026-10-20T11:00:00.000Z' } })

    const [saved] = await store.testExecutions('repo-1', 'org-1')
    expect(saved.evidenceLinks).toEqual([
      expect.objectContaining({ name: 'External report' }),
      expect.objectContaining({ name: 'Current trace' }),
    ])
    expect(saved.evidenceLinks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Expired video' }),
    ]))
  })

  it('applies the same partial-evidence precedence in the Postgres upsert', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    await store.saveTestExecution({
      id: 'partial', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '904', attempt: 1,
      revision: 'abc', kind: 'post-production', status: 'passed', name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [],
      gateEvaluations: [], thresholds: [], evidenceLinks: [],
      evidenceCollection: { status: 'partial', checkedAt: '2026-10-16T08:01:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' },
    })

    expect(String(query.mock.calls[0][0])).toContain("EXCLUDED.evidence_collection->>'status' IN ('complete','partial')")
    expect(String(query.mock.calls[0][0])).toContain("EXCLUDED.provider='github-actions' AND EXCLUDED.evidence_collection->>'status'='complete'")
    expect(String(query.mock.calls[0][0])).toContain("existing_link->>'url' !~*")
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

  it('does not rewrite a terminal outcome with a conflicting terminal delivery for the same attempt', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions' as const, externalRunId: 'terminal-789', attempt: 1, revision: 'abc', kind: 'post-production' as const, name: 'Post-production', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] }
    await store.saveTestExecution({ id: 'failed-delivery', ...base, status: 'failed', completedAt: '2026-01-01T00:02:00.000Z', summary: 'Production journey failed' })
    await store.saveTestExecution({ id: 'conflicting-delivery', ...base, status: 'passed', completedAt: '2026-01-01T00:03:00.000Z', summary: 'Conflicting late success' })

    await expect(store.testExecutions('repo-1', 'org-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'failed-delivery',
        status: 'failed',
        completedAt: '2026-01-01T00:02:00.000Z',
        summary: 'Production journey failed',
      }),
    ])
  })

  it('guards the Postgres upsert against an out-of-order running delivery', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.saveTestExecution({ id: 'delivery', repositoryId: 'repo-1', tenantId: 'org-1', provider: 'github-actions', externalRunId: '789', attempt: 1, revision: 'abc', branch: 'feature/checkout', kind: 'ci', status: 'running', name: 'CI', workflowPath: '.github/workflows/ci.yml', policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [] })

    expect(query).toHaveBeenCalledOnce()
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain("WHERE fuzequality.test_executions.status = 'running' OR fuzequality.test_executions.status = EXCLUDED.status")
    expect(sql).toContain('workflow_path')
    expect(sql).toContain('jsonb_array_length(EXCLUDED.thresholds)>0')
    expect(sql).toContain("evaluation->>'status'='running'")
    expect(sql).toContain("DISTINCT ON (link->>'kind',link->>'url')")
    expect(sql).toContain('ORDER BY ordinal LIMIT 100')
    expect(sql).toContain("length(COALESCE(EXCLUDED.summary,''))")
    expect(sql).toContain('branch=COALESCE(EXCLUDED.branch')
    expect(sql).toContain('head_repository=COALESCE(EXCLUDED.head_repository')
    expect(sql).toContain('head_repository,kind,status,name,workflow_path')
    expect(query.mock.calls[0][1][7]).toBe('feature/checkout')
    expect(query.mock.calls[0][1][8]).toBeNull()
    expect(query.mock.calls[0][1][11]).toBe('CI')
    expect(query.mock.calls[0][1][12]).toBe('.github/workflows/ci.yml')
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
