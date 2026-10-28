import { describe, expect, it, vi } from 'vitest'
import type { TestSuiteDispatch } from '@fuzequality/contracts'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

const repository = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  owner: 'acme',
  name: 'app',
  canonicalUrl: 'https://github.com/acme/app',
  defaultBranch: 'main',
  kind: 'service' as const,
  enabled: true,
  includeGlobs: [],
  excludeGlobs: [],
  jiraProjects: [],
  jiraBindings: [],
  lastScanStatus: 'complete' as const,
}

function dispatch(overrides: Partial<TestSuiteDispatch> = {}): TestSuiteDispatch {
  return {
    id: crypto.randomUUID(),
    repositoryId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    artifactId: 'suite:load',
    artifactLogicalId: 'workflow:.github/workflows/load.yml',
    artifactKind: 'load-test',
    workflowPath: '.github/workflows/load.yml',
    ref: 'main',
    sourceRevision: 'a'.repeat(40),
    requestedBy: '33333333-3333-4333-8333-333333333333',
    inputNames: ['environment'],
    status: 'dispatching',
    requestedAt: '2026-10-22T20:00:00.000Z',
    ...overrides,
  }
}

describe('test-suite dispatch audit', () => {
  it('updates one dispatch lifecycle without storing workflow input values', async () => {
    const store = new MemoryCatalogStore()
    const pending = dispatch()
    await store.saveTestSuiteDispatch(pending)
    await store.saveTestSuiteDispatch({
      ...pending,
      status: 'accepted',
      completedAt: '2026-10-22T20:00:01.000Z',
    })

    expect(await store.latestTestSuiteDispatches(pending.repositoryId, pending.tenantId)).toEqual([
      expect.objectContaining({
        id: pending.id,
        status: 'accepted',
        inputNames: ['environment'],
      }),
    ])
    expect(JSON.stringify(await store.latestTestSuiteDispatches(pending.repositoryId, pending.tenantId)))
      .not.toContain('production-secret')
  })

  it('persists the provider-accepted ref when completing a PostgreSQL dispatch lifecycle', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    const accepted = dispatch({
      ref: `fuzequality-revision-${'b'.repeat(40)}`,
      sourceRevision: 'b'.repeat(40),
      status: 'accepted',
      completedAt: '2026-10-22T20:00:01.000Z',
    })

    await store.saveTestSuiteDispatch(accepted)

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('source_ref=EXCLUDED.source_ref')
    expect(String(sql)).toContain('source_revision=EXCLUDED.source_revision')
    expect(parameters[7]).toBe(accepted.ref)
    expect(parameters[8]).toBe(accepted.sourceRevision)
  })

  it('returns only the newest receipt per logical suite within the requested tenant', async () => {
    const store = new MemoryCatalogStore()
    const first = dispatch({ id: '44444444-4444-4444-8444-444444444444' })
    const latest = dispatch({
      id: '55555555-5555-4555-8555-555555555555',
      artifactId: 'suite:load:new-revision',
      status: 'failed',
      error: 'provider unavailable',
      requestedAt: '2026-10-22T20:01:00.000Z',
    })
    await store.saveTestSuiteDispatch(first)
    await store.saveTestSuiteDispatch(latest)
    await store.saveTestSuiteDispatch(dispatch({
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: '77777777-7777-4777-8777-777777777777',
      requestedAt: '2026-10-22T20:02:00.000Z',
    }))

    expect(await store.latestTestSuiteDispatches(first.repositoryId, first.tenantId)).toEqual([
      expect.objectContaining({ id: latest.id, status: 'failed' }),
    ])
  })

  it('pages latest receipts by immutable request time after deduplicating logical suites', async () => {
    const store = new MemoryCatalogStore()
    const newest = dispatch({
      id: '77777777-7777-4777-8777-777777777777',
      artifactId: 'suite:newest',
      artifactLogicalId: 'workflow:.github/workflows/newest.yml',
      requestedAt: '2026-10-22T20:03:00.000Z',
    })
    const middle = dispatch({
      id: '66666666-6666-4666-8666-666666666666',
      artifactId: 'suite:middle',
      artifactLogicalId: 'workflow:.github/workflows/middle.yml',
      requestedAt: '2026-10-22T20:02:00.000Z',
    })
    const replacedMiddle = dispatch({
      id: '55555555-5555-4555-8555-555555555555',
      artifactId: 'suite:middle:old',
      artifactLogicalId: middle.artifactLogicalId,
      requestedAt: '2026-10-22T20:01:00.000Z',
    })
    const oldest = dispatch({
      id: '44444444-4444-4444-8444-444444444444',
      artifactId: 'suite:oldest',
      artifactLogicalId: 'workflow:.github/workflows/oldest.yml',
      requestedAt: '2026-10-22T20:00:00.000Z',
    })
    await Promise.all([newest, middle, replacedMiddle, oldest].map(item => store.saveTestSuiteDispatch(item)))

    expect(await store.latestTestSuiteDispatches(newest.repositoryId, newest.tenantId, { limit: 2 }))
      .toEqual([newest, middle])
    expect(await store.latestTestSuiteDispatches(newest.repositoryId, newest.tenantId, {
      after: { createdAt: middle.requestedAt, id: middle.id },
      limit: 2,
    })).toEqual([oldest])
  })

  it('retains the internal lookahead row for a maximum-size API page', async () => {
    const store = new MemoryCatalogStore()
    const receipts = Array.from({ length: 101 }, (_, index) => dispatch({
      id: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
      artifactId: `suite:${index}`,
      artifactLogicalId: `workflow:.github/workflows/suite-${index}.yml`,
      requestedAt: new Date(Date.UTC(2026, 9, 22, 20, index)).toISOString(),
    }))
    await Promise.all(receipts.map(item => store.saveTestSuiteDispatch(item)))

    expect(await store.latestTestSuiteDispatches(
      receipts[0].repositoryId,
      receipts[0].tenantId,
      { limit: 101 },
    )).toHaveLength(101)
  })

  it('pages one artifact history by immutable request time and id', async () => {
    const store = new MemoryCatalogStore()
    const newest = dispatch({
      id: '77777777-7777-4777-8777-777777777777',
      requestedAt: '2026-10-22T20:02:00.000Z',
    })
    const middle = dispatch({
      id: '66666666-6666-4666-8666-666666666666',
      requestedAt: '2026-10-22T20:01:00.000Z',
    })
    const oldest = dispatch({
      id: '55555555-5555-4555-8555-555555555555',
      requestedAt: '2026-10-22T20:00:00.000Z',
    })
    await store.saveTestSuiteDispatch(oldest)
    await store.saveTestSuiteDispatch(newest)
    await store.saveTestSuiteDispatch(middle)
    await store.saveTestSuiteDispatch(dispatch({
      id: '88888888-8888-4888-8888-888888888888',
      artifactId: 'suite:stress',
      artifactLogicalId: 'workflow:.github/workflows/stress.yml',
      requestedAt: '2026-10-22T20:03:00.000Z',
    }))

    expect(await store.testSuiteDispatchHistory(newest.repositoryId, newest.tenantId, newest.artifactLogicalId, { limit: 2 }))
      .toEqual([newest, middle])
    expect(await store.testSuiteDispatchHistory(newest.repositoryId, newest.tenantId, newest.artifactLogicalId, {
      after: { createdAt: middle.requestedAt, id: middle.id },
      limit: 2,
    })).toEqual([oldest])
  })

  it('links an accepted dispatch only to its exact retained execution outcome', async () => {
    const store = new MemoryCatalogStore({ repositories: [repository] })
    const accepted = dispatch({
      status: 'accepted',
      ref: `fuzequality-revision-${'a'.repeat(40)}`,
      completedAt: '2026-10-22T20:00:01.000Z',
    })
    await store.saveTestSuiteDispatch(accepted)
    await store.saveTestExecution({
      id: 'execution-result', repositoryId: accepted.repositoryId, tenantId: accepted.tenantId,
      provider: 'github-actions', externalRunId: 'provider-run-42', attempt: 2,
      revision: accepted.sourceRevision, branch: accepted.ref, headRepository: 'acme/app',
      kind: 'load', status: 'failed', name: 'Load test',
      workflowPath: `${accepted.workflowPath}@refs/tags/${accepted.ref}`,
      sourceUrl: 'https://github.com/acme/app/actions/runs/42',
      startedAt: '2026-10-22T20:01:00.000Z', completedAt: '2026-10-22T20:02:00.000Z',
      policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [{
        kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm',
      }],
      evidenceCollection: { status: 'complete', checkedAt: '2026-10-22T20:03:00.000Z' },
    })
    await store.saveTestExecution({
      id: 'fork-result', repositoryId: accepted.repositoryId, tenantId: accepted.tenantId,
      provider: 'github-actions', externalRunId: 'provider-run-fork', attempt: 1,
      revision: accepted.sourceRevision, branch: accepted.ref, headRepository: 'contributor/app',
      kind: 'load', status: 'passed', name: 'Fork load test', workflowPath: accepted.workflowPath,
      completedAt: '2026-10-22T20:04:00.000Z',
      policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
      evidenceCollection: {
        status: 'partial', checkedAt: '2026-10-22T20:04:00.000Z', issues: ['head-repository-unverified'],
      },
    })
    await store.saveTestExecution({
      id: 'pre-existing-result', repositoryId: accepted.repositoryId, tenantId: accepted.tenantId,
      provider: 'github-actions', externalRunId: 'provider-run-before-dispatch', attempt: 1,
      revision: accepted.sourceRevision, branch: accepted.ref, headRepository: 'acme/app',
      kind: 'load', status: 'passed', name: 'Earlier load test', workflowPath: accepted.workflowPath,
      startedAt: '2026-10-22T19:59:00.000Z', completedAt: '2026-10-22T20:05:00.000Z',
      policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
    })
    await store.saveTestExecution({
      id: 'wrong-revision', repositoryId: accepted.repositoryId, tenantId: accepted.tenantId,
      provider: 'github-actions', externalRunId: 'provider-run-99', attempt: 1,
      revision: 'b'.repeat(40), branch: accepted.ref, kind: 'load', status: 'passed',
      name: 'Unrelated load test', workflowPath: accepted.workflowPath,
      policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
    })
    await store.saveTestExecution({
      id: 'external-lookalike', repositoryId: accepted.repositoryId, tenantId: accepted.tenantId,
      provider: 'external', externalRunId: 'external-run', attempt: 1,
      revision: accepted.sourceRevision, branch: accepted.ref, kind: 'load', status: 'passed',
      name: 'External lookalike', workflowPath: accepted.workflowPath,
      completedAt: '2026-10-22T20:03:00.000Z',
      policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
    })

    await expect(store.testSuiteDispatchHistory(
      accepted.repositoryId, accepted.tenantId, accepted.artifactLogicalId,
    )).resolves.toEqual([expect.objectContaining({
      id: accepted.id,
      executionResult: {
        id: 'execution-result', provider: 'github-actions', externalRunId: 'provider-run-42',
        attempt: 2, status: 'failed', sourceUrl: 'https://github.com/acme/app/actions/runs/42',
        evidenceLinks: [{
          kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm',
        }],
        evidenceCollection: { status: 'complete', checkedAt: '2026-10-22T20:03:00.000Z' },
        startedAt: '2026-10-22T20:01:00.000Z', completedAt: '2026-10-22T20:02:00.000Z',
      },
    })])
    await expect(store.latestTestSuiteDispatches(
      accepted.repositoryId, accepted.tenantId,
    )).resolves.toEqual([expect.objectContaining({
      id: accepted.id,
      executionResult: expect.objectContaining({
        id: 'execution-result', externalRunId: 'provider-run-42', status: 'failed',
      }),
    })])
  })

  it('assigns repeated exact dispatch executions to separate request windows', async () => {
    const store = new MemoryCatalogStore({ repositories: [repository] })
    const first = dispatch({
      id: '44444444-4444-4444-8444-444444444444', status: 'accepted',
      requestedAt: '2026-10-22T20:00:00.000Z', completedAt: '2026-10-22T20:00:01.000Z',
    })
    const second = dispatch({
      id: '55555555-5555-4555-8555-555555555555', status: 'accepted',
      requestedAt: '2026-10-22T20:02:00.000Z', completedAt: '2026-10-22T20:02:01.000Z',
    })
    await store.saveTestSuiteDispatch(first)
    await store.saveTestSuiteDispatch(second)
    for (const [id, externalRunId, startedAt] of [
      ['first-result', 'provider-run-1', '2026-10-22T20:01:00.000Z'],
      ['second-result', 'provider-run-2', '2026-10-22T20:03:00.000Z'],
    ] as const) {
      await store.saveTestExecution({
        id, repositoryId: first.repositoryId, tenantId: first.tenantId,
        provider: 'github-actions', externalRunId, attempt: 1, revision: first.sourceRevision,
        branch: first.ref, headRepository: 'acme/app', kind: 'load', status: 'passed',
        name: 'Repeated load test', workflowPath: first.workflowPath, startedAt,
        completedAt: new Date(Date.parse(startedAt) + 30_000).toISOString(),
        policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], thresholds: [], evidenceLinks: [],
      })
    }

    const history = await store.testSuiteDispatchHistory(first.repositoryId, first.tenantId, first.artifactLogicalId)
    expect(history.map(item => [item.id, item.executionResult?.id])).toEqual([
      [second.id, 'second-result'],
      [first.id, 'first-result'],
    ])
  })

  it('joins exact dispatch outcomes in the PostgreSQL history query', async () => {
    const accepted = dispatch({ status: 'accepted' })
    const query = vi.fn().mockResolvedValue({ rows: [{
      id: accepted.id, repository_id: accepted.repositoryId, tenant_id: accepted.tenantId,
      artifact_id: accepted.artifactId, artifact_logical_id: accepted.artifactLogicalId,
      artifact_kind: accepted.artifactKind, workflow_path: accepted.workflowPath,
      source_ref: accepted.ref, source_revision: accepted.sourceRevision,
      requested_by: accepted.requestedBy, input_names: accepted.inputNames, status: accepted.status,
      error: null, requested_at: new Date(accepted.requestedAt), completed_at: null,
      result_id: 'execution-result', result_provider: 'github-actions',
      result_external_run_id: 'provider-run-42', result_attempt: 1, result_status: 'passed',
      result_source_url: 'https://github.com/acme/app/actions/runs/42',
      result_evidence_links: [
        { kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm' },
        { kind: 'video', name: 'Unsafe legacy video', url: 'javascript:alert(1)' },
      ],
      result_evidence_collection: {
        status: 'partial', checkedAt: '2026-10-22T20:03:00.000Z', issues: ['attempt-provenance-unverified'],
      },
      result_started_at: new Date('2026-10-22T20:01:00.000Z'),
      result_completed_at: new Date('2026-10-22T20:02:00.000Z'),
    }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    const [result] = await store.testSuiteDispatchHistory(
      accepted.repositoryId, accepted.tenantId, accepted.artifactLogicalId,
    )
    expect(result.executionResult).toMatchObject({
      id: 'execution-result', externalRunId: 'provider-run-42', status: 'passed',
      evidenceLinks: [{
        kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm',
      }],
      evidenceCollection: {
        status: 'partial', checkedAt: '2026-10-22T20:03:00.000Z', issues: ['attempt-provenance-unverified'],
      },
    })
    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('LEFT JOIN LATERAL')
    expect(String(sql)).toContain("dispatch.status='accepted'")
    expect(String(sql)).toContain('candidate.branch=dispatch.source_ref')
    expect(String(sql)).toContain("candidate.provider='github-actions'")
    expect(String(sql)).toContain("lower(candidate.head_repository)=lower(repository.owner || '/' || repository.name) AND candidate.started_at >= dispatch.requested_at")
    expect(String(sql)).toContain('lower(candidate.revision)=lower(dispatch.source_revision)')
    expect(String(sql)).toContain("split_part(candidate.workflow_path,'@',1)=dispatch.workflow_path")
    expect(String(sql)).toContain('next_dispatch.requested_at <= candidate.started_at')
    expect(String(sql)).toContain('(next_dispatch.requested_at,next_dispatch.id) > (dispatch.requested_at,dispatch.id)')
    expect(parameters).toEqual([accepted.repositoryId, accepted.tenantId, accepted.artifactLogicalId, 50])
  })

  it('joins exact dispatch outcomes in the PostgreSQL latest-receipt query', async () => {
    const accepted = dispatch({ status: 'accepted' })
    const query = vi.fn().mockResolvedValue({ rows: [{
      id: accepted.id, repository_id: accepted.repositoryId, tenant_id: accepted.tenantId,
      artifact_id: accepted.artifactId, artifact_logical_id: accepted.artifactLogicalId,
      artifact_kind: accepted.artifactKind, workflow_path: accepted.workflowPath,
      source_ref: accepted.ref, source_revision: accepted.sourceRevision,
      requested_by: accepted.requestedBy, input_names: accepted.inputNames, status: accepted.status,
      error: null, requested_at: new Date(accepted.requestedAt), completed_at: null,
      result_id: 'execution-result', result_provider: 'github-actions',
      result_external_run_id: 'provider-run-42', result_attempt: 2, result_status: 'failed',
      result_source_url: 'https://github.com/acme/app/actions/runs/42',
      result_evidence_links: [{
        kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm',
      }],
      result_evidence_collection: {
        status: 'unavailable', checkedAt: '2026-10-22T20:03:00.000Z', errorCode: 'PROVIDER_TIMEOUT',
      },
      result_started_at: new Date('2026-10-22T20:01:00.000Z'),
      result_completed_at: new Date('2026-10-22T20:02:00.000Z'),
    }] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    const [result] = await store.latestTestSuiteDispatches(accepted.repositoryId, accepted.tenantId)
    expect(result.executionResult).toMatchObject({
      id: 'execution-result', externalRunId: 'provider-run-42', status: 'failed',
      evidenceLinks: [{
        kind: 'video', name: 'Playwright video', url: 'https://evidence.example/run-42/video.webm',
      }],
      evidenceCollection: {
        status: 'unavailable', checkedAt: '2026-10-22T20:03:00.000Z', errorCode: 'PROVIDER_TIMEOUT',
      },
    })
    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('LEFT JOIN LATERAL')
    expect(String(sql)).toContain("latest.status='accepted'")
    expect(String(sql)).toContain('candidate.branch=latest.source_ref')
    expect(String(sql)).toContain("candidate.provider='github-actions'")
    expect(String(sql)).toContain("lower(candidate.head_repository)=lower(repository.owner || '/' || repository.name) AND candidate.started_at >= latest.requested_at")
    expect(String(sql)).toContain('lower(candidate.revision)=lower(latest.source_revision)')
    expect(String(sql)).toContain("split_part(candidate.workflow_path,'@',1)=latest.workflow_path")
    expect(String(sql)).toContain('next_dispatch.requested_at <= candidate.started_at')
    expect(String(sql)).toContain('(next_dispatch.requested_at,next_dispatch.id) > (latest.requested_at,latest.id)')
    expect(parameters).toEqual([accepted.repositoryId, accepted.tenantId])
  })

  it('resolves stable and legacy suite references without crossing tenant boundaries', async () => {
    const store = new MemoryCatalogStore()
    const receipt = dispatch({ artifactId: 'suite:load:revision-1' })
    await store.saveTestSuiteDispatch(receipt)

    expect(await store.testSuiteDispatchLogicalId(
      receipt.repositoryId,
      receipt.tenantId,
      receipt.artifactLogicalId,
    )).toBe(receipt.artifactLogicalId)
    expect(await store.testSuiteDispatchLogicalId(
      receipt.repositoryId,
      receipt.tenantId,
      receipt.artifactId,
    )).toBe(receipt.artifactLogicalId)
    expect(await store.testSuiteDispatchLogicalId(
      receipt.repositoryId,
      '99999999-9999-4999-8999-999999999999',
      receipt.artifactId,
    )).toBeUndefined()
  })
})
