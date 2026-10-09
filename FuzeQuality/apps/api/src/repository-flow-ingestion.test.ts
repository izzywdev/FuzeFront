import { describe, expect, it, vi } from 'vitest'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { candidateOwnershipError, repositoryFlowCandidateIngestionSchema } from './repository-flow-ingestion'

const candidate: RepositoryFlowCandidate = {
  id: 'repo-flow:123',
  repositoryId: 'b4908e35-8a57-4c13-9366-489ec59071fe',
  tenantId: 'tenant-1',
  revision: 'abc123',
  title: 'Checkout',
  confidence: 0.8,
  evidence: ['route-1'],
  steps: [{ actor: 'buyer', action: 'opens checkout', expectedOutcome: 'checkout appears', targetIds: ['route-1'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Open checkout', targetIds: ['route-1'] }] },
  status: 'proposed',
  source: 'litellm',
  analysis: { provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'fuzequality-repository-flow-v1', schemaVersion: '1.0' },
  createdAt: '2026-10-09T08:00:00.000Z',
}

describe('repository flow candidate ingestion', () => {
  it('rejects malformed and ungrounded LiteLLM candidates', () => {
    expect(repositoryFlowCandidateIngestionSchema.safeParse({ candidates: [{ ...candidate, confidence: 4 }] }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({ candidates: [{ ...candidate, analysis: undefined }] }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{ ...candidate, evidence: [], steps: candidate.steps.map(step => ({ ...step, targetIds: [] })) }],
    }).success).toBe(false)
  })

  it('accepts grounded FuzeInfra LiteLLM provenance and binds candidates to the repository tenant', async () => {
    const parsed = repositoryFlowCandidateIngestionSchema.parse({ candidates: [candidate] })
    const lookup = vi.fn().mockResolvedValue({ id: candidate.repositoryId, tenantId: candidate.tenantId })
    await expect(candidateOwnershipError(parsed.candidates, lookup)).resolves.toBeUndefined()

    lookup.mockResolvedValue({ id: candidate.repositoryId, tenantId: 'tenant-2' })
    await expect(candidateOwnershipError(parsed.candidates, lookup)).resolves.toEqual({
      candidateId: candidate.id,
      repositoryId: candidate.repositoryId,
    })
  })
})
