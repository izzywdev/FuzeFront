import { describe, expect, it, vi } from 'vitest'
import type { QualityArtifact, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { candidateArtifactReferenceError, candidateOwnershipError, repositoryFlowCandidateIngestionSchema } from './repository-flow-ingestion'

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
  analysis: {
    provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'fuzequality-repository-flow-v1', schemaVersion: '1.0',
    inputArtifactCount: 140, promptArtifactCount: 100, promptOmittedArtifactCount: 40,
    promptContentTruncated: false, promptTruncated: true,
    grounding: { referencedArtifactCount: 1, groundedArtifactCount: 1, rejectedArtifactCount: 0, ungroundedStepCount: 0 },
  },
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

  it('rejects inconsistent prompt coverage provenance', () => {
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: { ...candidate.analysis!, promptArtifactCount: 141 },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: { ...candidate.analysis!, promptTruncated: false },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: { ...candidate.analysis!, promptOmittedArtifactCount: 39 },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: { ...candidate.analysis!, promptTruncated: undefined },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: {
          ...candidate.analysis!, inputArtifactCount: 140, promptArtifactCount: 140,
          promptOmittedArtifactCount: 0, promptContentTruncated: true, promptTruncated: undefined,
        },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: {
          ...candidate.analysis!,
          grounding: { referencedArtifactCount: 2, groundedArtifactCount: 1, rejectedArtifactCount: 0, ungroundedStepCount: 0 },
        },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: {
          ...candidate.analysis!,
          grounding: { referencedArtifactCount: 2, groundedArtifactCount: 2, rejectedArtifactCount: 0, ungroundedStepCount: 0 },
        },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        analysis: {
          ...candidate.analysis!,
          grounding: { referencedArtifactCount: 2, groundedArtifactCount: 1, rejectedArtifactCount: 1, ungroundedStepCount: 1 },
        },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        wireframe: {
          kind: 'sequence',
          nodes: [{ label: 'Confirmation', targetIds: ['route-2'] }],
        },
      }],
    }).success).toBe(false)
    expect(repositoryFlowCandidateIngestionSchema.safeParse({
      candidates: [{
        ...candidate,
        wireframe: {
          kind: 'sequence',
          nodes: [{ label: 'Confirmation', targetIds: ['route-2'] }],
        },
        analysis: {
          ...candidate.analysis!,
          grounding: {
            referencedArtifactCount: 2,
            groundedArtifactCount: 2,
            rejectedArtifactCount: 0,
            ungroundedStepCount: 0,
          },
        },
      }],
    }).success).toBe(true)
  })

  it('requires every LiteLLM evidence, step, and wireframe reference to resolve in the exact repository revision', async () => {
    const artifact: QualityArtifact = {
      id: 'route-1', logicalId: 'route-checkout', repositoryId: candidate.repositoryId,
      kind: 'route', title: 'Checkout', sourcePath: 'apps/web/checkout.tsx', summary: 'Checkout route', evidence: ['/checkout'],
    }
    const lookup = vi.fn().mockResolvedValue([artifact])

    await expect(candidateArtifactReferenceError([candidate], lookup)).resolves.toBeUndefined()
    expect(lookup).toHaveBeenCalledWith(candidate.repositoryId, candidate.tenantId, candidate.revision)
    await expect(candidateArtifactReferenceError([{
      ...candidate,
      steps: candidate.steps.map(step => ({ ...step, targetIds: [artifact.logicalId!] })),
      wireframe: { ...candidate.wireframe, nodes: candidate.wireframe.nodes.map(node => ({ ...node, targetIds: [artifact.logicalId!] })) },
    }], lookup)).resolves.toBeUndefined()
    await expect(candidateArtifactReferenceError([{
      ...candidate,
      wireframe: { ...candidate.wireframe, nodes: candidate.wireframe.nodes.map(node => ({ ...node, targetIds: ['invented-route'] })) },
    }], lookup)).resolves.toEqual({
      candidateId: candidate.id,
      repositoryId: candidate.repositoryId,
      revision: candidate.revision,
      targetId: 'invented-route',
    })
    await expect(candidateArtifactReferenceError([{
      ...candidate,
      evidence: ['missing-model-evidence'],
      steps: candidate.steps.map(step => ({ ...step, targetIds: [artifact.id] })),
      wireframe: { ...candidate.wireframe, nodes: candidate.wireframe.nodes.map(node => ({ ...node, targetIds: [artifact.id] })) },
    }], lookup)).resolves.toEqual({
      candidateId: candidate.id,
      repositoryId: candidate.repositoryId,
      revision: candidate.revision,
      targetId: 'missing-model-evidence',
    })
    await expect(candidateArtifactReferenceError([{
      ...candidate,
      source: 'deterministic',
      analysis: undefined,
      evidence: [artifact.id, 'GET /checkout returns the review screen'],
    }], lookup)).resolves.toBeUndefined()
  })
})
