import { describe, expect, it, vi } from 'vitest'
import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import { policyGateEvaluationForReview, policyGateReviewConflict, policyGateReviewStateConflict } from './policy-gate-review'

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
  remediationAction: 'build-gate',
  recommendation: 'Add a deployment gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-10T00:00:00.000Z',
} satisfies PolicyGateEvaluation

describe('policy-gate review revision guard', () => {
  it('loads the reviewed evaluation through a bounded point query', async () => {
    const policyGateEvaluations = vi.fn().mockResolvedValue([evaluation])

    await expect(policyGateEvaluationForReview(
      { policyGateEvaluations },
      repository.id,
      'tenant-1',
      evaluation.id,
    )).resolves.toEqual(evaluation)
    expect(policyGateEvaluations).toHaveBeenCalledWith(repository.id, 'tenant-1', {
      id: evaluation.id,
      limit: 1,
    })
  })

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

  it('rejects a decision when another reviewer changed the current review', () => {
    const reviewedEvaluation = {
      ...evaluation,
      reviewStatus: 'accepted' as const,
      reviewedAt: '2026-10-15T01:00:00.000Z',
      reviewedBy: 'reviewer-2',
    }

    expect(policyGateReviewStateConflict(
      reviewedEvaluation,
      '2026-10-15T00:00:00.000Z',
    )).toEqual({
      error: 'This policy/gate review changed while you were deciding. Refresh the current decision before reviewing it again.',
      code: 'STALE_POLICY_GATE_REVIEW',
      expectedReviewedAt: '2026-10-15T00:00:00.000Z',
      currentReviewedAt: '2026-10-15T01:00:00.000Z',
    })
    expect(policyGateReviewStateConflict(
      reviewedEvaluation,
      reviewedEvaluation.reviewedAt,
    )).toBeUndefined()
    expect(policyGateReviewStateConflict(evaluation, undefined)).toBeUndefined()
  })
})
