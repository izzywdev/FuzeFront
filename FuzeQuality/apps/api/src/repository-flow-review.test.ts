import { describe, expect, it } from 'vitest'
import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowReviewConflict } from './repository-flow-review'

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
})
