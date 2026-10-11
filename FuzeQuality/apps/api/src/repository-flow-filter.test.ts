import { describe, expect, it } from 'vitest'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { filterRepositoryFlowCandidates, repositoryFlowFilterSchema } from './repository-flow-filter'

const candidate = (overrides: Partial<RepositoryFlowCandidate> = {}): RepositoryFlowCandidate => ({
  id: 'flow-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', title: 'Checkout', confidence: 1,
  evidence: ['route-1'], steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout opens', targetIds: ['route-1'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Open checkout', targetIds: ['route-1'] }] }, status: 'proposed', source: 'deterministic', createdAt: '2026-10-09T00:00:00.000Z',
  ...overrides,
})

describe('repository flow inventory filter', () => {
  it('filters source, review status, revision, and exact LiteLLM provenance together', () => {
    const candidates = [
      candidate(),
      candidate({ id: 'flow-2', source: 'litellm', status: 'confirmed', revision: 'def', analysis: { provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '2.0' } }),
      candidate({ id: 'flow-3', source: 'litellm', status: 'confirmed', revision: 'def', analysis: { provider: 'fuzeinfra-litellm', model: 'legacy-analysis', promptVersion: 'flow-v1', schemaVersion: '1.0' } }),
    ]
    const filter = repositoryFlowFilterSchema.parse({ source: 'litellm', status: 'confirmed', revision: 'def', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '2.0' })
    expect(filterRepositoryFlowCandidates(candidates, filter)).toEqual([candidates[1]])
  })

  it('does not treat deterministic or legacy candidates as matching model provenance', () => {
    const filter = repositoryFlowFilterSchema.parse({ model: 'quality-analysis' })
    expect(filterRepositoryFlowCandidates([candidate()], filter)).toEqual([])
  })

  it('rejects unknown query keys and invalid filter values', () => {
    expect(repositoryFlowFilterSchema.safeParse({ source: 'direct-llm' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ status: 'published' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ model: '' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ unexpected: 'value' }).success).toBe(false)
  })
})
