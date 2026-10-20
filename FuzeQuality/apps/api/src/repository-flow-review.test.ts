import { describe, expect, it } from 'vitest'
import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowGroundingRationaleConflict, repositoryFlowReviewConflict, repositoryFlowReviewStateConflict } from './repository-flow-review'

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
})
