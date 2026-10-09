import { describe, expect, it } from 'vitest'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { MemoryCatalogStore } from './store'

const candidate: RepositoryFlowCandidate = {
  id: 'flow-candidate-1',
  repositoryId: 'repo-1',
  tenantId: 'tenant-1',
  revision: 'abc123',
  title: 'Install an application',
  confidence: 0.91,
  evidence: ['route-1'],
  steps: [{ actor: 'owner', action: 'installs the app', expectedOutcome: 'the app is available', targetIds: ['route-1'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Install the app', targetIds: ['route-1'] }] },
  status: 'proposed',
  source: 'litellm',
  createdAt: '2026-10-09T00:00:00.000Z',
}

describe('repository flow review lifecycle', () => {
  it('persists FuzeInfra LiteLLM analysis provenance', async () => {
    const store = new MemoryCatalogStore()
    const analysis = {
      provider: 'fuzeinfra-litellm' as const,
      model: 'quality-analysis',
      promptVersion: 'fuzequality-repository-flow-v1',
      schemaVersion: '1.0',
    }
    await store.saveRepositoryFlowCandidates([{ ...candidate, analysis }])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({ analysis }),
    ])
  })

  it('preserves the human decision and attribution when the same analysis is replayed', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([candidate])
    await expect(store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed',
      reviewedBy: 'reviewer-1',
      reason: 'Matches the production journey.',
    })).resolves.toMatchObject({
      status: 'confirmed',
      reviewedBy: 'reviewer-1',
      reviewReason: 'Matches the production journey.',
      reviewedAt: expect.any(String),
    })

    await store.saveRepositoryFlowCandidates([{ ...candidate, confidence: 0.97 }])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({
        confidence: 0.97,
        status: 'confirmed',
        reviewedBy: 'reviewer-1',
        reviewReason: 'Matches the production journey.',
        reviewedAt: expect.any(String),
      }),
    ])
  })

  it('keeps immutable newest-first history and isolates it by tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([candidate])
    await store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed', reviewedBy: 'reviewer-1', reason: 'Evidence is complete.',
    })
    await store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'rejected', reviewedBy: 'reviewer-2', reason: 'The route was removed.',
    })

    await expect(store.repositoryFlowReviewHistory(candidate.id, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({ status: 'rejected', reviewedBy: 'reviewer-2', reason: 'The route was removed.', createdAt: expect.any(String) }),
      expect.objectContaining({ status: 'confirmed', reviewedBy: 'reviewer-1', reason: 'Evidence is complete.', createdAt: expect.any(String) }),
    ])
    await expect(store.repositoryFlowReviewHistory(candidate.id, 'tenant-2')).resolves.toEqual([])
    await expect(store.reviewRepositoryFlowCandidate(candidate.id, 'tenant-2', {
      status: 'confirmed', reviewedBy: 'cross-tenant-reviewer',
    })).resolves.toBeUndefined()
  })
})
