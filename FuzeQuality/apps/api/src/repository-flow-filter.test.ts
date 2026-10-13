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
  it('filters source, review status, and exact analysis revision together', () => {
    const candidates = [
      candidate(),
      candidate({ id: 'flow-2', source: 'litellm', status: 'confirmed', revision: 'def' }),
      candidate({ id: 'flow-3', source: 'litellm', status: 'rejected', revision: 'def' }),
    ]
    const filter = repositoryFlowFilterSchema.parse({ source: 'litellm', status: 'confirmed', revision: 'def' })
    expect(filterRepositoryFlowCandidates(candidates, filter)).toEqual([candidates[1]])
  })

  it('rejects unknown query keys and invalid filter values', () => {
    expect(repositoryFlowFilterSchema.safeParse({ source: 'direct-llm' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ status: 'published' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ unexpected: 'value' }).success).toBe(false)
  })
})
