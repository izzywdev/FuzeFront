import { describe, expect, it, vi } from 'vitest'
import { POLICY_GATE_EVALUATION_BATCH_SIZE, repositoryQualityArtifactsPath, runRepositoryInventoryAnalysis, runTrackedRepositoryInventoryAnalysis } from './repository-analysis'
import { RepositoryFlowAnalysisTimeoutError } from '@fuzequality/core'

const repository = { id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }
const artifacts = [{ id: 'route-1', repositoryId: 'repo-1', kind: 'route' as const, title: 'Checkout', sourcePath: 'apps/web/Checkout.tsx', summary: 'Open checkout', evidence: [] }]

describe('repository inventory analysis ordering', () => {
  it('requests artifacts for the inventory event revision exactly', () => {
    expect(repositoryQualityArtifactsPath('repo/one', 'release #1')).toBe(
      '/api/v1/internal/repositories/repo%2Fone/quality-artifacts?revision=release%20%231'
    )
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
})
