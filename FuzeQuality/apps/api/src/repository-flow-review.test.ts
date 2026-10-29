import { describe, expect, it } from 'vitest'
import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowAnalysisProvenanceConflict, repositoryFlowArtifactReferenceConflict, repositoryFlowGroundingRationaleConflict, repositoryFlowReviewConflict, repositoryFlowReviewStateConflict, repositoryFlowWireframeConflict } from './repository-flow-review'

const repository = {
  id: 'repo-1',
  owner: 'fuze',
  name: 'front',
  canonicalUrl: 'https://example.test/fuze/front',
  defaultBranch: 'main',
  kind: 'application',
  includeGlobs: [],
  excludeGlobs: [],
  jiraProjects: [],
  jiraBindings: [],
  enabled: true,
  lastScanRevision: 'current-revision',
  lastScanStatus: 'complete',
} satisfies Repository

const candidate = {
  id: 'flow-1',
  repositoryId: repository.id,
  tenantId: 'tenant-1',
  revision: 'current-revision',
  title: 'Checkout',
  confidence: 0.9,
  evidence: ['route-1'],
  steps: [
    {
      actor: 'Customer',
      action: 'Checks out',
      expectedOutcome: 'Order created',
      targetIds: ['route-1'],
    },
  ],
  wireframe: {
    kind: 'sequence',
    nodes: [{ label: 'Checkout', targetIds: ['route-1'] }],
  },
  status: 'proposed',
  source: 'litellm',
  analysis: {
    provider: 'fuzeinfra-litellm',
    model: 'quality-analysis',
    promptVersion: 'v3',
    schemaVersion: '1.0',
  },
  createdAt: '2026-10-10T00:00:00.000Z',
} satisfies RepositoryFlowCandidate

describe('repository UX-flow review revision guard', () => {
  it('allows review only for the repository current analyzed revision', () => {
    expect(repositoryFlowReviewConflict(repository, candidate)).toBeUndefined()
    expect(
      repositoryFlowReviewConflict(repository, {
        ...candidate,
        revision: 'historical-revision',
      })
    ).toEqual({
      error:
        'This UX-flow candidate is not from the repository current analyzed revision. Refresh the analysis before reviewing it.',
      code: 'STALE_FLOW_CANDIDATE',
      candidateRevision: 'historical-revision',
      currentRevision: 'current-revision',
    })
  })

  it('fails closed when the repository has no completed analysis revision', () => {
    expect(
      repositoryFlowReviewConflict(
        { ...repository, lastScanRevision: undefined },
        candidate
      )
    ).toMatchObject({
      code: 'STALE_FLOW_CANDIDATE',
      currentRevision: null,
    })
  })

  it('detects when another reviewer changed the current decision', () => {
    const reviewed = {
      ...candidate,
      status: 'confirmed' as const,
      reviewedAt: '2026-10-15T01:00:00.000Z',
      reviewedBy: 'reviewer-1',
    }

    expect(repositoryFlowReviewStateConflict(reviewed, reviewed.reviewedAt)).toBeUndefined()
    expect(repositoryFlowReviewStateConflict(reviewed, undefined)).toBeUndefined()
    expect(repositoryFlowReviewStateConflict(reviewed, null)).toEqual({
      error: 'This UX-flow review changed while you were deciding. Refresh the current decision before reviewing it again.',
      code: 'STALE_FLOW_REVIEW',
      expectedReviewedAt: null,
      currentReviewedAt: reviewed.reviewedAt,
    })
  })

  it('requires a reviewer rationale before confirming a LiteLLM proposal with grounding gaps', () => {
    const incomplete = {
      ...candidate,
      analysis: {
        provider: 'fuzeinfra-litellm' as const,
        model: 'quality-analysis',
        promptVersion: 'v3',
        schemaVersion: '1.0',
        grounding: {
          referencedArtifactCount: 3,
          groundedArtifactCount: 1,
          rejectedArtifactCount: 1,
          ungroundedStepCount: 1,
        },
      },
    }

    expect(repositoryFlowGroundingRationaleConflict(incomplete, 'confirmed')).toMatchObject({
      code: 'FLOW_GROUNDING_RATIONALE_REQUIRED',
      grounding: incomplete.analysis.grounding,
    })
    expect(repositoryFlowGroundingRationaleConflict(incomplete, 'confirmed', 'Reviewer verified the remaining step manually.')).toBeUndefined()
    expect(repositoryFlowGroundingRationaleConflict(incomplete, 'confirmed', 'no')).toMatchObject({
      code: 'FLOW_GROUNDING_RATIONALE_REQUIRED',
    })
    expect(repositoryFlowGroundingRationaleConflict(incomplete, 'rejected')).toBeUndefined()
    expect(repositoryFlowGroundingRationaleConflict(candidate, 'confirmed')).toBeUndefined()
  })

  it('requires a reviewer rationale before confirming a proposal produced from bounded prompt evidence', () => {
    const bounded = {
      ...candidate,
      analysis: {
        provider: 'fuzeinfra-litellm' as const,
        model: 'quality-analysis', promptVersion: 'v3', schemaVersion: '1.0',
        inputArtifactCount: 20, promptArtifactCount: 19, promptOmittedArtifactCount: 1,
        promptContentTruncated: false, promptTruncated: true,
      },
    }

    expect(repositoryFlowGroundingRationaleConflict(bounded, 'confirmed')).toMatchObject({
      code: 'FLOW_PROMPT_COVERAGE_RATIONALE_REQUIRED',
      promptCoverage: { omittedArtifactCount: 1, contentTruncated: false },
    })
    expect(repositoryFlowGroundingRationaleConflict(bounded, 'confirmed', 'Reviewed the omitted repository evidence manually.')).toBeUndefined()
    expect(repositoryFlowGroundingRationaleConflict(bounded, 'rejected')).toBeUndefined()
  })

  it('derives bounded prompt review risk when legacy aggregate provenance is absent', () => {
    const omitted = {
      ...candidate,
      analysis: {
        provider: 'fuzeinfra-litellm' as const,
        model: 'quality-analysis', promptVersion: 'v3', schemaVersion: '1.0',
        inputArtifactCount: 20, promptArtifactCount: 19, promptOmittedArtifactCount: 1,
        promptContentTruncated: false,
      },
    }
    const contentTruncated = {
      ...candidate,
      analysis: {
        provider: 'fuzeinfra-litellm' as const,
        model: 'quality-analysis', promptVersion: 'v3', schemaVersion: '1.0',
        inputArtifactCount: 20, promptArtifactCount: 20, promptOmittedArtifactCount: 0,
        promptContentTruncated: true,
      },
    }

    expect(repositoryFlowGroundingRationaleConflict(omitted, 'confirmed')).toMatchObject({ code: 'FLOW_PROMPT_COVERAGE_RATIONALE_REQUIRED' })
    expect(repositoryFlowGroundingRationaleConflict(contentTruncated, 'confirmed')).toMatchObject({ code: 'FLOW_PROMPT_COVERAGE_RATIONALE_REQUIRED' })
  })

  it('blocks confirmation when a legacy LiteLLM candidate has no analysis provenance', () => {
    const withoutProvenance = { ...candidate, analysis: undefined }

    expect(repositoryFlowAnalysisProvenanceConflict(withoutProvenance, 'confirmed')).toEqual({
      error: 'This FuzeInfra LiteLLM flow has no stored model, prompt, and schema provenance. Regenerate the repository analysis before confirming it.',
      code: 'FLOW_ANALYSIS_PROVENANCE_REQUIRED',
      candidateId: candidate.id,
      revision: candidate.revision,
    })
    expect(repositoryFlowAnalysisProvenanceConflict(withoutProvenance, 'rejected')).toBeUndefined()
    expect(repositoryFlowAnalysisProvenanceConflict(candidate, 'confirmed')).toBeUndefined()
    expect(repositoryFlowAnalysisProvenanceConflict({
      ...withoutProvenance,
      source: 'deterministic',
    }, 'confirmed')).toBeUndefined()
  })

  it('blocks confirmation when a legacy candidate has no reviewable wireframe', () => {
    const withoutWireframe = {
      ...candidate,
      wireframe: { kind: 'sequence' as const, nodes: [] },
    }

    expect(repositoryFlowWireframeConflict(withoutWireframe, 'confirmed')).toEqual({
      error: 'This UX-flow candidate has no reviewable wireframe. Regenerate the repository analysis before confirming it.',
      code: 'FLOW_WIREFRAME_REQUIRED',
      candidateId: candidate.id,
      revision: candidate.revision,
    })
    expect(repositoryFlowWireframeConflict(withoutWireframe, 'rejected')).toBeUndefined()
    expect(repositoryFlowWireframeConflict(candidate, 'confirmed')).toBeUndefined()
  })

  it('blocks confirmation when an exact-revision target is unavailable but preserves rejection', () => {
    const artifact = {
      id: 'route-1',
      logicalId: 'route-checkout',
      repositoryId: repository.id,
      kind: 'route' as const,
      title: 'Checkout',
      sourcePath: 'apps/web/checkout.tsx',
      summary: 'Checkout route',
      evidence: ['/checkout'],
    }

    expect(repositoryFlowArtifactReferenceConflict(candidate, [artifact], 'confirmed')).toBeUndefined()
    expect(repositoryFlowArtifactReferenceConflict({
      ...candidate,
      steps: candidate.steps.map(step => ({ ...step, targetIds: [artifact.logicalId] })),
    }, [artifact], 'confirmed')).toBeUndefined()
    expect(repositoryFlowArtifactReferenceConflict({
      ...candidate,
      wireframe: { ...candidate.wireframe, nodes: [{ label: 'Missing', targetIds: ['missing-route'] }] },
    }, [artifact], 'confirmed')).toEqual({
      error: 'This UX-flow candidate references evidence that is unavailable in its exact repository revision. Regenerate the analysis before confirming it.',
      code: 'FLOW_ARTIFACT_REFERENCE_UNAVAILABLE',
      candidateId: candidate.id,
      revision: candidate.revision,
      targetId: 'missing-route',
    })
    expect(repositoryFlowArtifactReferenceConflict({
      ...candidate,
      evidence: ['missing-model-evidence'],
      analysis: {
        provider: 'fuzeinfra-litellm',
        model: 'quality-analysis',
        promptVersion: 'v3',
        schemaVersion: '1.0',
      },
    }, [artifact], 'confirmed')).toMatchObject({
      code: 'FLOW_ARTIFACT_REFERENCE_UNAVAILABLE',
      targetId: 'missing-model-evidence',
    })
    expect(repositoryFlowArtifactReferenceConflict({
      ...candidate,
      source: 'deterministic',
      evidence: [artifact.id, 'GET /checkout returns the review screen'],
    }, [artifact], 'confirmed')).toBeUndefined()
    expect(repositoryFlowArtifactReferenceConflict({
      ...candidate,
      steps: candidate.steps.map(step => ({ ...step, targetIds: ['missing-route'] })),
    }, [], 'rejected')).toBeUndefined()
  })
})
