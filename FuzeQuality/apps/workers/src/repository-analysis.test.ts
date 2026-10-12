import { describe, expect, it, vi } from 'vitest'
import { runRepositoryInventoryAnalysis } from './repository-analysis'

const repository = { id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://example.test/front', defaultBranch: 'main', kind: 'application' as const, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete' as const }
const artifacts = [{ id: 'route-1', repositoryId: 'repo-1', kind: 'route' as const, title: 'Checkout', sourcePath: 'apps/web/Checkout.tsx', summary: 'Open checkout', evidence: [] }]

describe('repository inventory analysis ordering', () => {
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
})
