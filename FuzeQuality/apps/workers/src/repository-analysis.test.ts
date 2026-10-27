import { describe, expect, it, vi } from 'vitest'
import { POLICY_GATE_EVALUATION_BATCH_SIZE, isRepositoryAnalysisTopic, reportExhaustedRepositoryAnalysis, repositoryQualityArtifactsPath, runRepositoryInventoryAnalysis, runTrackedRepositoryInventoryAnalysis, shouldRunRepositoryAnalysis } from './repository-analysis'
import { RepositoryFlowAnalysisInvalidResponseError, RepositoryFlowAnalysisTimeoutError } from '@fuzequality/core'
import { TOPICS } from '@fuzequality/contracts'

const repository = { id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }
const artifacts = [{ id: 'route-1', repositoryId: 'repo-1', kind: 'route' as const, title: 'Checkout', sourcePath: 'apps/web/Checkout.tsx', summary: 'Open checkout', evidence: [] }]

describe('repository inventory analysis ordering', () => {
  it('requests artifacts for the inventory event revision exactly', () => {
    expect(repositoryQualityArtifactsPath('repo/one', 'release #1')).toBe(
      '/api/v1/internal/repositories/repo%2Fone/quality-artifacts?revision=release%20%231'
    )
  })

  it('runs reviewed analysis for both new inventories and dedicated retry commands', () => {
    expect(isRepositoryAnalysisTopic(TOPICS.REPOSITORY_INVENTORY_CHANGED)).toBe(true)
    expect(isRepositoryAnalysisTopic(TOPICS.ANALYSIS_REQUESTED)).toBe(true)
    expect(isRepositoryAnalysisTopic(TOPICS.REQUIREMENT_SYNC_REQUESTED)).toBe(false)
  })

  it('runs only the durable queued revision and treats completed redeliveries as terminal', () => {
    expect(shouldRunRepositoryAnalysis({
      lastScanRevision: 'catalog-revision',
      lastAnalysis: { revision: 'catalog-revision', status: 'queued' },
    }, 'catalog-revision')).toBe(true)
    expect(shouldRunRepositoryAnalysis({
      lastScanRevision: 'catalog-revision',
      lastAnalysis: {
        revision: 'catalog-revision', status: 'complete',
        counts: { deterministic: 2, evaluations: 3, proposed: 1 },
      },
    }, 'catalog-revision')).toBe(false)
    expect(shouldRunRepositoryAnalysis({
      lastScanRevision: 'catalog-revision',
      lastAnalysis: { revision: 'catalog-revision', status: 'failed', errorCode: 'INTELLIGENCE_UNAVAILABLE' },
    }, 'catalog-revision')).toBe(true)
    expect(shouldRunRepositoryAnalysis({
      lastScanRevision: 'catalog-revision',
      lastAnalysis: { revision: 'catalog-revision', status: 'running', startedAt: '2026-10-24T00:00:00.000Z' },
    }, 'catalog-revision')).toBe(true)
    expect(shouldRunRepositoryAnalysis({
      lastScanRevision: 'new-revision',
      lastAnalysis: { revision: 'new-revision', status: 'queued' },
    }, 'stale-revision')).toBe(false)
  })

  it('marks setup failures terminal after bounded repository-analysis retries', async () => {
    const persistStatus = vi.fn(async () => undefined)

    await expect(reportExhaustedRepositoryAnalysis(
      TOPICS.REPOSITORY_INVENTORY_CHANGED,
      { repositoryId: 'repo-1', revision: 'catalog-revision' },
      new Error('catalog lookup returned provider details'),
      { persistStatus, now: () => '2026-10-23T18:15:00.000Z' },
    )).resolves.toBe(true)

    expect(persistStatus).toHaveBeenCalledWith('repo-1', {
      revision: 'catalog-revision',
      status: 'failed',
      finishedAt: '2026-10-23T18:15:00.000Z',
      errorCode: 'INTELLIGENCE_UNAVAILABLE',
    })
  })

  it('does not write terminal analysis state for unrelated or malformed deliveries', async () => {
    const persistStatus = vi.fn(async () => undefined)

    await expect(reportExhaustedRepositoryAnalysis(
      TOPICS.REQUIREMENT_SYNC_REQUESTED,
      { repositoryId: 'repo-1', revision: 'catalog-revision' },
      new Error('Jira unavailable'),
      { persistStatus },
    )).resolves.toBe(false)
    await expect(reportExhaustedRepositoryAnalysis(
      TOPICS.ANALYSIS_REQUESTED,
      { repositoryId: 'repo-1' },
      new Error('invalid delivery'),
      { persistStatus },
    )).resolves.toBe(false)

    expect(persistStatus).not.toHaveBeenCalled()
  })

  it('persists deterministic flows and policy evaluations before a failed LiteLLM call', async () => {
    const calls: string[] = []
    const persistCandidates = vi.fn(async () => { calls.push('deterministic') })
    const persistEvaluations = vi.fn(async () => { calls.push('evaluations') })
    const analyzer = { analyze: vi.fn(async () => { calls.push('litellm'); throw new Error('LiteLLM unavailable') }) }

    await expect(runRepositoryInventoryAnalysis(repository, 'abc', artifacts, {
      analyzer, persistCandidates, persistEvaluations,
    })).rejects.toThrow('LiteLLM unavailable')

    expect(calls).toEqual(['deterministic', 'evaluations', 'litellm'])
    expect(persistCandidates).toHaveBeenCalledWith([expect.objectContaining({ source: 'deterministic', revision: 'abc' })])
    expect(persistEvaluations).toHaveBeenCalledOnce()
  })

  it('persists every governance finding in bounded sequential batches before LiteLLM', async () => {
    const policyArtifacts = Array.from(
      { length: POLICY_GATE_EVALUATION_BATCH_SIZE + 5 },
      (_, index) => ({
        id: `policy-${index}`,
        repositoryId: repository.id,
        kind: 'policy' as const,
        title: `Policy ${index}`,
        sourcePath: `governance/policy-${index}.md`,
        summary: `Requirement ${index}`,
        evidence: [`Requirement ${index} must be enforced.`],
      })
    )
    const persisted: number[] = []
    let concurrent = 0
    let maxConcurrent = 0
    const persistEvaluations = vi.fn(async evaluations => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      persisted.push(evaluations.length)
      await Promise.resolve()
      concurrent -= 1
    })
    const analyzer = { analyze: vi.fn(async () => []) }

    const result = await runRepositoryInventoryAnalysis(repository, 'abc', policyArtifacts, {
      analyzer,
      persistCandidates: vi.fn(async () => undefined),
      persistEvaluations,
    })

    expect(result.evaluations).toBe(POLICY_GATE_EVALUATION_BATCH_SIZE + 5)
    expect(persisted).toEqual([POLICY_GATE_EVALUATION_BATCH_SIZE, 5])
    expect(maxConcurrent).toBe(1)
    expect(analyzer.analyze).toHaveBeenCalledOnce()
  })

  it('records safe revision-scoped lifecycle state around a LiteLLM failure', async () => {
    const states: Array<{ status: string; errorCode?: string }> = []
    await expect(runTrackedRepositoryInventoryAnalysis(repository, 'abc', artifacts, {
      analyzer: { analyze: vi.fn(async () => { throw new Error('provider leaked detail') }) },
      persistCandidates: vi.fn(async () => undefined),
      persistEvaluations: vi.fn(async () => undefined),
      persistStatus: vi.fn(async status => { states.push(status) }),
      now: () => '2026-10-13T00:00:00.000Z',
    })).rejects.toThrow('provider leaked detail')

    expect(states).toEqual([
      { revision: 'abc', status: 'running', startedAt: '2026-10-13T00:00:00.000Z' },
      { revision: 'abc', status: 'failed', startedAt: '2026-10-13T00:00:00.000Z', finishedAt: '2026-10-13T00:00:00.000Z', errorCode: 'INTELLIGENCE_UNAVAILABLE' },
    ])
  })

  it('records a distinct safe timeout status for a stalled LiteLLM request', async () => {
    const states: Array<{ status: string; errorCode?: string }> = []
    await expect(runTrackedRepositoryInventoryAnalysis(repository, 'abc', artifacts, {
      analyzer: { analyze: vi.fn(async () => { throw new RepositoryFlowAnalysisTimeoutError(5) }) },
      persistCandidates: vi.fn(async () => undefined),
      persistEvaluations: vi.fn(async () => undefined),
      persistStatus: vi.fn(async status => { states.push(status) }),
      now: () => '2026-10-13T00:00:00.000Z',
    })).rejects.toBeInstanceOf(RepositoryFlowAnalysisTimeoutError)

    expect(states.at(-1)).toEqual(expect.objectContaining({
      revision: 'abc', status: 'failed', errorCode: 'INTELLIGENCE_TIMEOUT',
    }))
  })

  it('records a distinct safe status when LiteLLM output fails the reviewed schema', async () => {
    const states: Array<{ status: string; errorCode?: string }> = []
    await expect(runTrackedRepositoryInventoryAnalysis(repository, 'abc', artifacts, {
      analyzer: { analyze: vi.fn(async () => { throw new RepositoryFlowAnalysisInvalidResponseError() }) },
      persistCandidates: vi.fn(async () => undefined),
      persistEvaluations: vi.fn(async () => undefined),
      persistStatus: vi.fn(async status => { states.push(status) }),
      now: () => '2026-10-13T00:00:00.000Z',
    })).rejects.toBeInstanceOf(RepositoryFlowAnalysisInvalidResponseError)

    expect(states.at(-1)).toEqual(expect.objectContaining({
      revision: 'abc', status: 'failed', errorCode: 'INTELLIGENCE_INVALID_RESPONSE',
    }))
  })

  it('heartbeats while reviewed LiteLLM analysis remains in flight', async () => {
    vi.useFakeTimers()
    let resolveAnalysis!: (value: []) => void
    const analysis = new Promise<[]>((resolve) => { resolveAnalysis = resolve })
    const heartbeat = vi.fn(async () => undefined)
    try {
      const tracked = runTrackedRepositoryInventoryAnalysis(repository, 'abc', artifacts, {
        analyzer: { analyze: vi.fn(() => analysis) },
        persistCandidates: vi.fn(async () => undefined),
        persistEvaluations: vi.fn(async () => undefined),
        persistStatus: vi.fn(async () => undefined),
        heartbeat,
        heartbeatIntervalMs: 100,
      })

      await vi.advanceTimersByTimeAsync(250)
      expect(heartbeat).toHaveBeenCalledTimes(3)
      resolveAnalysis([])
      await tracked
      await vi.advanceTimersByTimeAsync(250)
      expect(heartbeat).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
