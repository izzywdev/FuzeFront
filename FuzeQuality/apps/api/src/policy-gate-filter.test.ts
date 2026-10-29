import { describe, expect, it } from 'vitest'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
import {
  filterPolicyGateEvaluations,
  policyGateFilterSchema,
  policyGateStoreQuery,
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
  it('filters anomaly, remediation, severity, review status, exact revision, subject, source path, and confidence together', () => {
    const evaluations = [
      evaluation(),
      evaluation({
        id: 'evaluation-2',
        confidence: 0.8,
        kind: 'ambiguous-policy',
        remediationAction: 'disambiguate-policy',
        severity: 'medium',
        reviewStatus: 'accepted',
        revision: 'def',
        policyArtifactIds: ['policy-2'],
        gateArtifactIds: ['gate-2'],
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
      remediationAction: 'disambiguate-policy',
      severity: 'medium',
      reviewStatus: 'accepted',
      revision: 'def',
      subject: 'DEPLOYMENT',
      sourcePath: 'governance/deployment.md',
      policyArtifactId: 'policy-2',
      gateArtifactId: 'gate-2',
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

  it('classifies guarded relationships separately from reviewable anomalies', () => {
    const anomaly = evaluation()
    const relationship = evaluation({ id: 'guarded', kind: 'guarded-policy', severity: 'low' })

    expect(filterPolicyGateEvaluations([anomaly, relationship], policyGateFilterSchema.parse({ findingType: 'anomaly' }))).toEqual([anomaly])
    expect(filterPolicyGateEvaluations([anomaly, relationship], policyGateFilterSchema.parse({ findingType: 'relationship' }))).toEqual([relationship])
    expect(policyGateFilterSchema.safeParse({ findingType: 'finding' }).success).toBe(false)
  })

  it('rejects unknown query keys and invalid filter values', () => {
    expect(
      policyGateFilterSchema.safeParse({ kind: 'missing-owner' }).success
    ).toBe(false)
    expect(
      policyGateFilterSchema.safeParse({ severity: 'critical' }).success
    ).toBe(false)
    expect(
      policyGateFilterSchema.safeParse({ remediationAction: 'delete-policy' }).success
    ).toBe(false)
    expect(
      policyGateFilterSchema.safeParse({ unexpected: 'value' }).success
    ).toBe(false)
    expect(policyGateFilterSchema.safeParse({ minConfidence: -0.01 }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ maxConfidence: 1.01 }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ subject: '' }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ sourcePath: '' }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ sourcePath: 'x'.repeat(1001) }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ policyArtifactId: '' }).success).toBe(false)
    expect(policyGateFilterSchema.safeParse({ gateArtifactId: 'x'.repeat(501) }).success).toBe(false)
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

  it('requires an exact repository-relative source path match', () => {
    expect(filterPolicyGateEvaluations([evaluation()], policyGateFilterSchema.parse({ sourcePath: 'governance/deployment.md' }))).toHaveLength(1)
    expect(filterPolicyGateEvaluations([evaluation()], policyGateFilterSchema.parse({ sourcePath: 'deployment.md' }))).toEqual([])
    expect(filterPolicyGateEvaluations([evaluation()], policyGateFilterSchema.parse({ sourcePath: 'Governance/deployment.md' }))).toEqual([])
  })

  it('defaults bounded pagination and accepts an opaque continuation cursor', () => {
    expect(policyGateFilterSchema.parse({ cursor: 'opaque' })).toMatchObject({
      cursor: 'opaque',
      limit: 50,
    })
  })

  it('forwards every validated internal filter, including exact source path, with lookahead pagination', () => {
    const filter = policyGateFilterSchema.parse({
      findingType: 'anomaly',
      sourcePath: 'governance/deployment.md',
      subject: 'deployment',
      cursor: 'opaque',
      limit: 20,
    })
    const after = { createdAt: '2026-10-10T00:00:00.000Z', id: 'evaluation-1' }

    expect(policyGateStoreQuery(filter, after)).toEqual({
      findingType: 'anomaly',
      sourcePath: 'governance/deployment.md',
      subject: 'deployment',
      after,
      limit: 21,
    })
  })
})
