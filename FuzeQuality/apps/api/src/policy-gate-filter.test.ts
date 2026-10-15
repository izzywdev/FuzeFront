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
  remediationAction: 'build-gate',
  recommendation: 'Add a deployment gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-10T00:00:00.000Z',
  ...overrides,
})

describe('policy-gate inventory filter', () => {
  it('filters anomaly, severity, review status, exact revision, subject, and confidence together', () => {
    const evaluations = [
      evaluation(),
      evaluation({
        id: 'evaluation-2',
        confidence: 0.8,
        kind: 'ambiguous-policy',
        severity: 'medium',
        reviewStatus: 'accepted',
        revision: 'def',
      }),
      evaluation({
        id: 'evaluation-3',
        confidence: 0.7,
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
      subject: 'DEPLOYMENT',
      minConfidence: '0.8',
      maxConfidence: '0.8',
    })

    expect(filterPolicyGateEvaluations(evaluations, filter)).toEqual([
      evaluations[1],
    ])
  })

  it('accepts successful guarded relationships as first-class evidence', () => {
    const guarded = evaluation({ kind: 'guarded-policy', severity: 'low' })
    const filter = policyGateFilterSchema.parse({ kind: 'guarded-policy' })

    expect(filterPolicyGateEvaluations([evaluation(), guarded], filter)).toEqual([guarded])
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
    expect(policyGateFilterSchema.safeParse({ minConfidence: -0.01 }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ maxConfidence: 1.01 }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ subject: '' }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ subject: 'x'.repeat(201) }).success).toBe(false)
    const inverted = policyGateFilterSchema.safeParse({ minConfidence: 0.9, maxConfidence: 0.7 })
    expect(inverted.success).toBe(false)
    if (!inverted.success) expect(inverted.error.issues[0]).toMatchObject({
      path: ['maxConfidence'],
      message: 'maxConfidence must be greater than or equal to minConfidence',
    })
    expect(policyGateFilterSchema.parse({ limit: 101 }).limit).toBe(100)
  })

  it('requires an exact case-insensitive subject match', () => {
    expect(filterPolicyGateEvaluations([evaluation()], policyGateFilterSchema.parse({ subject: 'DEPLOYMENT' }))).toHaveLength(1)
    expect(filterPolicyGateEvaluations([evaluation()], policyGateFilterSchema.parse({ subject: 'deploy' }))).toEqual([])
  })

  it('defaults bounded pagination and accepts an opaque continuation cursor', () => {
    expect(policyGateFilterSchema.parse({ cursor: 'opaque' })).toMatchObject({
      cursor: 'opaque',
      limit: 50,
    })
  })
})
