import { describe, expect, it } from 'vitest'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
import {
  filterPolicyGateEvaluations,
  policyGateFilterSchema,
} from './policy-gate-filter'

const evaluation = (
  overrides: Partial<PolicyGateEvaluation> = {}
): PolicyGateEvaluation => ({
  id: 'evaluation-1',
  repositoryId: 'repo-1',
  tenantId: 'tenant-1',
  revision: 'abc',
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
  ...overrides,
})

describe('policy-gate inventory filter', () => {
  it('filters anomaly, severity, review status, and exact revision together', () => {
    const evaluations = [
      evaluation(),
      evaluation({
        id: 'evaluation-2',
        kind: 'ambiguous-policy',
        severity: 'medium',
        reviewStatus: 'accepted',
        revision: 'def',
      }),
      evaluation({
        id: 'evaluation-3',
        kind: 'ambiguous-policy',
        severity: 'medium',
        reviewStatus: 'dismissed',
        revision: 'def',
      }),
    ]
    const filter = policyGateFilterSchema.parse({
      kind: 'ambiguous-policy',
      severity: 'medium',
      reviewStatus: 'accepted',
      revision: 'def',
    })

    expect(filterPolicyGateEvaluations(evaluations, filter)).toEqual([
      evaluations[1],
    ])
  })

  it('rejects unknown query keys and invalid filter values', () => {
    expect(
      policyGateFilterSchema.safeParse({ kind: 'missing-owner' }).success
    ).toBe(false)
    expect(
      policyGateFilterSchema.safeParse({ severity: 'critical' }).success
    ).toBe(false)
    expect(
      policyGateFilterSchema.safeParse({ unexpected: 'value' }).success
    ).toBe(false)
  })
})
