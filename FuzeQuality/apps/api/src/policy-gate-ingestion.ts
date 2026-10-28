import { z } from 'zod'
import type { PolicyGateEvaluation, QualityArtifact, Repository } from '@fuzequality/contracts'

const policyGateEvidencePassageSchema = z.object({
  artifactId: z.string().trim().min(1).max(500),
  sourcePath: z.string().trim().min(1).max(1000),
  text: z.string().trim().min(1).max(2000),
  signal: z.enum(['policy', 'gate', 'obligation', 'prohibition', 'ambiguous']),
}).strict()

const policyGateEvaluationSchema = z.object({
  id: z.string().trim().min(1).max(200),
  repositoryId: z.string().uuid(),
  tenantId: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(500),
  kind: z.enum(['guarded-policy', 'unguarded-policy', 'guard-without-policy', 'contradictory-policy', 'ambiguous-policy']),
  severity: z.enum(['high', 'medium', 'low']),
  title: z.string().trim().min(1).max(500),
  detail: z.string().trim().min(1).max(5000),
  policyArtifactIds: z.array(z.string().trim().min(1).max(500)).max(100),
  gateArtifactIds: z.array(z.string().trim().min(1).max(500)).max(100),
  confidence: z.number().min(0).max(1),
  scope: z.object({
    sourcePaths: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
    subjects: z.array(z.string().trim().min(1).max(200)).max(100),
  }).strict(),
  evidencePassages: z.array(policyGateEvidencePassageSchema).max(100).default([]),
  remediationAction: z.enum(['build-gate', 'build-policy', 'disambiguate-policy', 'align-policy-gate']),
  recommendation: z.string().trim().min(1).max(5000),
  reviewStatus: z.literal('proposed'),
  createdAt: z.string().datetime(),
}).strict().superRefine((evaluation, context) => {
  const expectedShape = {
    'guarded-policy': { minimumPolicies: 1, minimumGates: 1, remediationAction: 'align-policy-gate' },
    'unguarded-policy': { minimumPolicies: 1, minimumGates: 0, remediationAction: 'build-gate' },
    'guard-without-policy': { minimumPolicies: 0, minimumGates: 1, remediationAction: 'build-policy' },
    'contradictory-policy': { minimumPolicies: 2, minimumGates: 0, remediationAction: 'disambiguate-policy' },
    'ambiguous-policy': { minimumPolicies: 1, minimumGates: 0, remediationAction: 'disambiguate-policy' },
  } as const
  const expected = expectedShape[evaluation.kind]
  if (evaluation.policyArtifactIds.length < expected.minimumPolicies) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${evaluation.kind} requires at least ${expected.minimumPolicies} policy artifact reference(s)`,
    path: ['policyArtifactIds'],
  })
  if (evaluation.gateArtifactIds.length < expected.minimumGates) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${evaluation.kind} requires at least ${expected.minimumGates} gate artifact reference(s)`,
    path: ['gateArtifactIds'],
  })
  if (evaluation.remediationAction !== expected.remediationAction) context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${evaluation.kind} requires ${expected.remediationAction} remediation`,
    path: ['remediationAction'],
  })
  const artifactIds = new Set([
    ...evaluation.policyArtifactIds,
    ...evaluation.gateArtifactIds,
  ])
  const policyArtifactIds = new Set(evaluation.policyArtifactIds)
  const gateArtifactIds = new Set(evaluation.gateArtifactIds)
  for (const [index, passage] of evaluation.evidencePassages.entries()) {
    if (!artifactIds.has(passage.artifactId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Evidence passage must reference a policy or gate artifact in this evaluation',
      path: ['evidencePassages', index, 'artifactId'],
    })
    if (passage.signal === 'gate' && !gateArtifactIds.has(passage.artifactId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Gate evidence passages must reference a gate artifact in this evaluation',
      path: ['evidencePassages', index, 'signal'],
    })
    if (passage.signal !== 'gate' && !policyArtifactIds.has(passage.artifactId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Policy evidence passages must reference a policy artifact in this evaluation',
      path: ['evidencePassages', index, 'signal'],
    })
  }
})

export const policyGateEvaluationIngestionSchema = z.object({
  evaluations: z.array(policyGateEvaluationSchema).max(200),
}).strict()

export async function policyGateOwnershipError(
  evaluations: PolicyGateEvaluation[],
  repositoryLookup: (id: string) => Promise<Pick<Repository, 'id' | 'tenantId'> | undefined>,
) {
  const repositories = new Map<string, Pick<Repository, 'id' | 'tenantId'> | undefined>()
  for (const evaluation of evaluations) {
    if (!repositories.has(evaluation.repositoryId)) repositories.set(evaluation.repositoryId, await repositoryLookup(evaluation.repositoryId))
    const repository = repositories.get(evaluation.repositoryId)
    if (!repository || (repository.tenantId ?? 'legacy') !== evaluation.tenantId) {
      return { evaluationId: evaluation.id, repositoryId: evaluation.repositoryId }
    }
  }
  return undefined
}

export function policyGateArtifactReferenceConflict(
  evaluation: PolicyGateEvaluation,
  artifacts: QualityArtifact[],
) {
  const exactArtifacts = artifacts.filter(artifact =>
    artifact.repositoryId === evaluation.repositoryId &&
    (!artifact.revision || artifact.revision === evaluation.revision)
  )
  const artifactsById = new Map(exactArtifacts.flatMap(artifact => [
    [artifact.id, artifact] as const,
    ...(artifact.logicalId ? [[artifact.logicalId, artifact] as const] : []),
  ]))
  for (const [artifactId, expectedKind] of [
    ...evaluation.policyArtifactIds.map(id => [id, 'policy'] as const),
    ...evaluation.gateArtifactIds.map(id => [id, 'gate'] as const),
  ]) {
    const artifact = artifactsById.get(artifactId)
    if (!artifact || artifact.kind !== expectedKind) return {
      evaluationId: evaluation.id,
      repositoryId: evaluation.repositoryId,
      revision: evaluation.revision,
      artifactId,
      expectedKind,
      actualKind: artifact?.kind ?? null,
      reason: artifact ? 'kind-mismatch' : 'unavailable',
    } as const
  }
  for (const passage of evaluation.evidencePassages ?? []) {
    const artifact = artifactsById.get(passage.artifactId)
    if (!artifact || artifact.sourcePath !== passage.sourcePath) return {
      evaluationId: evaluation.id,
      repositoryId: evaluation.repositoryId,
      revision: evaluation.revision,
      artifactId: passage.artifactId,
      expectedSourcePath: passage.sourcePath,
      actualSourcePath: artifact?.sourcePath ?? null,
      reason: artifact ? 'source-path-mismatch' : 'unavailable',
    } as const
    const expectedKind = passage.signal === 'gate' ? 'gate' : 'policy'
    if (artifact.kind !== expectedKind) return {
      evaluationId: evaluation.id,
      repositoryId: evaluation.repositoryId,
      revision: evaluation.revision,
      artifactId: passage.artifactId,
      signal: passage.signal,
      expectedKind,
      actualKind: artifact.kind,
      reason: 'signal-kind-mismatch',
    } as const
  }
  return undefined
}

export async function policyGateArtifactReferenceError(
  evaluations: PolicyGateEvaluation[],
  artifactLookup: (repositoryId: string, tenantId: string, revision: string) => Promise<QualityArtifact[]>,
) {
  const artifactsBySnapshot = new Map<string, QualityArtifact[]>()
  for (const evaluation of evaluations) {
    const snapshot = `${evaluation.repositoryId}:${evaluation.tenantId}:${evaluation.revision}`
    if (!artifactsBySnapshot.has(snapshot)) {
      artifactsBySnapshot.set(
        snapshot,
        await artifactLookup(evaluation.repositoryId, evaluation.tenantId, evaluation.revision),
      )
    }
    const conflict = policyGateArtifactReferenceConflict(
      evaluation,
      artifactsBySnapshot.get(snapshot)!,
    )
    if (conflict) return conflict
  }
  return undefined
}
