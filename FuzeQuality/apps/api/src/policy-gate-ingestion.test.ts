import { describe, expect, it, vi } from 'vitest'
import type { PolicyGateEvaluation } from '@fuzequality/contracts'
import { policyGateEvaluationIngestionSchema, policyGateOwnershipError } from './policy-gate-ingestion'

const evaluation: PolicyGateEvaluation = {
  id: 'evaluation-1',
  repositoryId: 'b4908e35-8a57-4c13-9366-489ec59071fe',
  tenantId: 'tenant-1',
  revision: 'abc123',
  kind: 'unguarded-policy',
  severity: 'high',
  title: 'Authentication policy has no gate',
  detail: 'No matching gate was found.',
  policyArtifactIds: ['policy-auth'],
  gateArtifactIds: [],
  confidence: 0.75,
  scope: { sourcePaths: ['governance/auth.md'], subjects: ['authentication'] },
  evidencePassages: [{ artifactId: 'policy-auth', sourcePath: 'governance/auth.md', text: 'Authentication is required.', signal: 'obligation' }],
  recommendation: 'Add an authentication gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-09T08:00:00.000Z',
}

describe('policy gate evaluation ingestion', () => {
  it('requires bounded confidence and concrete repository scope', () => {
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [evaluation] }).success).toBe(true)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{ ...evaluation, confidence: 2 }] }).success).toBe(false)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{ ...evaluation, scope: { sourcePaths: [], subjects: [] } }] }).success).toBe(false)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{
      ...evaluation,
      evidencePassages: [{ ...evaluation.evidencePassages![0], artifactId: 'unrelated-artifact' }],
    }] }).success).toBe(false)
  })

  it('binds evaluation evidence to the repository tenant', async () => {
    const parsed = policyGateEvaluationIngestionSchema.parse({ evaluations: [evaluation] })
    const lookup = vi.fn().mockResolvedValue({ id: evaluation.repositoryId, tenantId: evaluation.tenantId })
    await expect(policyGateOwnershipError(parsed.evaluations, lookup)).resolves.toBeUndefined()

    lookup.mockResolvedValue({ id: evaluation.repositoryId, tenantId: 'tenant-2' })
    await expect(policyGateOwnershipError(parsed.evaluations, lookup)).resolves.toEqual({
      evaluationId: evaluation.id,
      repositoryId: evaluation.repositoryId,
    })
  })
})
