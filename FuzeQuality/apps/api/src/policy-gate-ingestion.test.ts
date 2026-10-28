import { describe, expect, it, vi } from 'vitest'
import type { PolicyGateEvaluation, QualityArtifact } from '@fuzequality/contracts'
import { evaluatePolicyGates } from '@fuzequality/core'
import { policyGateArtifactReferenceError, policyGateEvaluationIngestionSchema, policyGateOwnershipError } from './policy-gate-ingestion'

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
  remediationAction: 'build-gate',
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
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{
      ...evaluation,
      evidencePassages: [{ ...evaluation.evidencePassages![0], signal: 'gate' }],
    }] }).success).toBe(false)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{
      ...evaluation, policyArtifactIds: [], evidencePassages: [],
    }] }).success).toBe(false)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{
      ...evaluation, remediationAction: 'build-policy',
    }] }).success).toBe(false)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: [{
      ...evaluation,
      kind: 'contradictory-policy',
      remediationAction: 'disambiguate-policy',
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

  it('accepts generated evaluations when repository evidence exceeds the passage limit', () => {
    const generated = evaluatePolicyGates({
      id: evaluation.repositoryId,
      tenantId: evaluation.tenantId,
      owner: 'fuze',
      name: 'FuzeFront',
      canonicalUrl: 'https://github.com/fuze/front',
      defaultBranch: 'main',
      kind: 'application',
      includeGlobs: [],
      excludeGlobs: [],
      jiraProjects: [],
      jiraBindings: [],
      enabled: true,
      lastScanStatus: 'complete',
    }, evaluation.revision, [{
      id: 'policy-long',
      repositoryId: evaluation.repositoryId,
      kind: 'policy',
      title: 'Authentication policy',
      sourcePath: 'governance/auth.md',
      summary: 'Authentication must be verified.',
      evidence: [`Authentication must be verified. ${'repository evidence '.repeat(200)}`],
    }])

    expect(generated[0]?.evidencePassages?.[0]?.text).toHaveLength(2000)
    expect(policyGateEvaluationIngestionSchema.safeParse({ evaluations: generated }).success).toBe(true)
  })

  it('requires policy, gate, and passage evidence from the exact repository revision', async () => {
    const policy: QualityArtifact = {
      id: 'policy-observation', logicalId: 'policy-auth', repositoryId: evaluation.repositoryId,
      revision: evaluation.revision, kind: 'policy', title: 'Authentication policy',
      sourcePath: 'governance/auth.md', summary: 'Authentication is required.',
      evidence: ['Authentication is required.'],
    }
    const lookup = vi.fn().mockResolvedValue([policy])

    await expect(policyGateArtifactReferenceError([evaluation], lookup)).resolves.toBeUndefined()
    expect(lookup).toHaveBeenCalledWith(evaluation.repositoryId, evaluation.tenantId, evaluation.revision)
    await expect(policyGateArtifactReferenceError([{
      ...evaluation,
      policyArtifactIds: ['missing-policy'],
      evidencePassages: [],
    }], lookup)).resolves.toMatchObject({
      artifactId: 'missing-policy', expectedKind: 'policy', reason: 'unavailable',
    })
    await expect(policyGateArtifactReferenceError([{
      ...evaluation,
      gateArtifactIds: ['policy-auth'],
    }], lookup)).resolves.toMatchObject({
      artifactId: 'policy-auth', expectedKind: 'gate', actualKind: 'policy', reason: 'kind-mismatch',
    })
    await expect(policyGateArtifactReferenceError([{
      ...evaluation,
      evidencePassages: [{ ...evaluation.evidencePassages![0], sourcePath: 'governance/other.md' }],
    }], lookup)).resolves.toMatchObject({
      artifactId: 'policy-auth', expectedSourcePath: 'governance/other.md',
      actualSourcePath: 'governance/auth.md', reason: 'source-path-mismatch',
    })
    await expect(policyGateArtifactReferenceError([{
      ...evaluation,
      evidencePassages: [{ ...evaluation.evidencePassages![0], signal: 'gate' }],
    }], lookup)).resolves.toMatchObject({
      artifactId: 'policy-auth', signal: 'gate', expectedKind: 'gate',
      actualKind: 'policy', reason: 'signal-kind-mismatch',
    })

    lookup.mockResolvedValue([{ ...policy, repositoryId: '22222222-2222-4222-8222-222222222222' }])
    await expect(policyGateArtifactReferenceError([evaluation], lookup)).resolves.toMatchObject({
      artifactId: 'policy-auth', expectedKind: 'policy', reason: 'unavailable',
    })

    lookup.mockResolvedValue([{ ...policy, revision: 'different-revision' }])
    await expect(policyGateArtifactReferenceError([evaluation], lookup)).resolves.toMatchObject({
      artifactId: 'policy-auth', expectedKind: 'policy', reason: 'unavailable',
    })
  })
})
