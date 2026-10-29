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
  it('filters source, review status, revision, target, and exact LiteLLM provenance together', () => {
    const candidates = [
      candidate(),
      candidate({ id: 'flow-2', confidence: 0.8, source: 'litellm', status: 'confirmed', revision: 'def', analysis: { provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '2.0' } }),
      candidate({ id: 'flow-3', confidence: 0.7, source: 'litellm', status: 'confirmed', revision: 'def', analysis: { provider: 'fuzeinfra-litellm', model: 'legacy-analysis', promptVersion: 'flow-v1', schemaVersion: '1.0' } }),
    ]
    const filter = repositoryFlowFilterSchema.parse({ source: 'litellm', status: 'confirmed', revision: 'def', targetId: 'route-1', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '2.0', minConfidence: '0.8', maxConfidence: '0.8' })
    expect(filterRepositoryFlowCandidates(candidates, filter)).toEqual([candidates[1]])
  })

  it('does not treat deterministic or legacy candidates as matching model provenance', () => {
    const filter = repositoryFlowFilterSchema.parse({ model: 'quality-analysis' })
    expect(filterRepositoryFlowCandidates([candidate()], filter)).toEqual([])
  })

  it('isolates review risks retained with LiteLLM analysis provenance', () => {
    const groundingGap = candidate({
      id: 'grounding-gap', source: 'litellm', analysis: {
        provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v3', schemaVersion: '1.0',
        grounding: { referencedArtifactCount: 2, groundedArtifactCount: 1, rejectedArtifactCount: 1, ungroundedStepCount: 1 },
      },
    })
    const boundedPrompt = candidate({
      id: 'artifacts-omitted', source: 'litellm', analysis: {
        provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v3', schemaVersion: '1.0',
        inputArtifactCount: 140, promptArtifactCount: 100, promptOmittedArtifactCount: 40,
        promptContentTruncated: false, promptTruncated: true,
      },
    })
    const contentTruncated = candidate({
      id: 'content-truncated', source: 'litellm', analysis: {
        provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v3', schemaVersion: '1.0',
        inputArtifactCount: 100, promptArtifactCount: 100, promptOmittedArtifactCount: 0,
        promptContentTruncated: true, promptTruncated: true,
      },
    })
    const legacyOmitted = candidate({
      id: 'legacy-artifacts-omitted', source: 'litellm', analysis: {
        provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '1.0',
        inputArtifactCount: 10, promptArtifactCount: 9, promptOmittedArtifactCount: 1,
        promptContentTruncated: false,
      },
    })
    const legacyContentTruncated = candidate({
      id: 'legacy-content-truncated', source: 'litellm', analysis: {
        provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '1.0',
        inputArtifactCount: 10, promptArtifactCount: 10, promptOmittedArtifactCount: 0,
        promptContentTruncated: true,
      },
    })
    const missingProvenance = candidate({ id: 'missing-provenance', source: 'litellm', analysis: undefined })
    const incompleteProvenance = candidate({ id: 'incomplete-provenance', source: 'litellm', analysis: {
      provider: 'fuzeinfra-litellm', model: ' ', promptVersion: 'flow-v2', schemaVersion: '1.0',
    } })
    const missingWireframe = candidate({ id: 'missing-wireframe', wireframe: { kind: 'sequence', nodes: [] } })
    const candidates = [candidate(), groundingGap, boundedPrompt, contentTruncated, legacyOmitted, legacyContentTruncated, missingProvenance, incompleteProvenance, missingWireframe]
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'grounding-gaps' }))).toEqual([groundingGap])
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'prompt-truncated' }))).toEqual([boundedPrompt, contentTruncated, legacyOmitted, legacyContentTruncated])
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'artifacts-omitted' }))).toEqual([boundedPrompt, legacyOmitted])
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'content-truncated' }))).toEqual([contentTruncated, legacyContentTruncated])
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'provenance-missing' }))).toEqual([missingProvenance, incompleteProvenance])
    expect(filterRepositoryFlowCandidates(candidates, repositoryFlowFilterSchema.parse({ analysisRisk: 'wireframe-missing' }))).toEqual([missingWireframe])
  })

  it('rejects unknown query keys and invalid filter values', () => {
    expect(repositoryFlowFilterSchema.safeParse({ source: 'direct-llm' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ status: 'published' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ model: '' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ targetId: '' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ targetId: 'x'.repeat(501) }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ analysisRisk: 'low-confidence' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ unexpected: 'value' }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ minConfidence: -0.01 }).success).toBe(false)
    expect(repositoryFlowFilterSchema.safeParse({ maxConfidence: 1.01 }).success).toBe(false)
    const inverted = repositoryFlowFilterSchema.safeParse({ minConfidence: 0.9, maxConfidence: 0.7 })
    expect(inverted.success).toBe(false)
    if (!inverted.success) expect(inverted.error.issues[0]).toMatchObject({
      path: ['maxConfidence'],
      message: 'maxConfidence must be greater than or equal to minConfidence',
    })
    expect(repositoryFlowFilterSchema.parse({ limit: 101 }).limit).toBe(100)
  })

  it('matches exact revision-grounded evidence, step, and wireframe target IDs', () => {
    const evidenceOnly = candidate({ id: 'evidence-only', evidence: ['route-evidence'], steps: [{ ...candidate().steps[0], targetIds: [] }], wireframe: { kind: 'sequence', nodes: [{ label: 'Evidence', targetIds: [] }] } })
    const stepOnly = candidate({ id: 'step-only', evidence: [], steps: [{ ...candidate().steps[0], targetIds: ['route-step'] }], wireframe: { kind: 'sequence', nodes: [{ label: 'Step', targetIds: [] }] } })
    const wireframeOnly = candidate({ id: 'wireframe-only', evidence: [], steps: [{ ...candidate().steps[0], targetIds: [] }], wireframe: { kind: 'sequence', nodes: [{ label: 'Wireframe', targetIds: ['component-wireframe'] }] } })

    expect(filterRepositoryFlowCandidates([evidenceOnly, stepOnly, wireframeOnly], repositoryFlowFilterSchema.parse({ targetId: 'route-evidence' }))).toEqual([evidenceOnly])
    expect(filterRepositoryFlowCandidates([evidenceOnly, stepOnly, wireframeOnly], repositoryFlowFilterSchema.parse({ targetId: 'route-step' }))).toEqual([stepOnly])
    expect(filterRepositoryFlowCandidates([evidenceOnly, stepOnly, wireframeOnly], repositoryFlowFilterSchema.parse({ targetId: 'component-wireframe' }))).toEqual([wireframeOnly])
    expect(filterRepositoryFlowCandidates([evidenceOnly, stepOnly, wireframeOnly], repositoryFlowFilterSchema.parse({ targetId: 'route' }))).toEqual([])
  })

  it('defaults bounded pagination and accepts an opaque continuation cursor', () => {
    expect(repositoryFlowFilterSchema.parse({ cursor: 'opaque' })).toMatchObject({
      cursor: 'opaque',
      limit: 50,
    })
  })
})
