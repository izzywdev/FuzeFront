import { describe, expect, it } from 'vitest'
import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import { policyGateReviewConflict } from './policy-gate-review'

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

const evaluation = {
  id: 'evaluation-1',
  repositoryId: repository.id,
  tenantId: 'tenant-1',
  revision: 'current-revision',
  kind: 'unguarded-policy',
  severity: 'high',
  title: 'Deployment policy has no gate',
  detail: 'No matching deployment check was discovered.',
  policyArtifactIds: ['policy-1'],
  gateArtifactIds: [],
  confidence: 0.9,
  scope: {
    sourcePaths: ['governance/deployment.md'],
    subjects: ['deployment'],
  },
  recommendation: 'Add a deployment gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-10T00:00:00.000Z',
} satisfies PolicyGateEvaluation

describe('policy-gate review revision guard', () => {
  it('allows review only for the repository current analyzed revision', () => {
    expect(policyGateReviewConflict(repository, evaluation)).toBeUndefined()
    expect(
      policyGateReviewConflict(repository, {
        ...evaluation,
        revision: 'historical-revision',
      })
    ).toEqual({
      error:
        'This policy-gate finding is not from the repository current analyzed revision. Refresh the analysis before reviewing it.',
      code: 'STALE_POLICY_GATE_EVALUATION',
      evaluationRevision: 'historical-revision',
      currentRevision: 'current-revision',
    })
  })

  it('fails closed when the repository has no completed analysis revision', () => {
    expect(
      policyGateReviewConflict(
        { ...repository, lastScanRevision: undefined },
        evaluation
      )
    ).toMatchObject({
      code: 'STALE_POLICY_GATE_EVALUATION',
      currentRevision: null,
    })
  })
})
