import { z } from 'zod'
import type { QualityArtifact, Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

const analysisSchema = z.object({
  provider: z.literal('fuzeinfra-litellm'),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100),
  schemaVersion: z.string().trim().min(1).max(100),
  inputArtifactCount: z.number().int().nonnegative().optional(),
  promptArtifactCount: z.number().int().nonnegative().optional(),
  promptOmittedArtifactCount: z.number().int().nonnegative().optional(),
  promptContentTruncated: z.boolean().optional(),
  promptTruncated: z.boolean().optional(),
  grounding: z.object({
    referencedArtifactCount: z.number().int().nonnegative(),
    groundedArtifactCount: z.number().int().nonnegative(),
    rejectedArtifactCount: z.number().int().nonnegative(),
    ungroundedStepCount: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict().superRefine((analysis, context) => {
  const hasInputCount = analysis.inputArtifactCount !== undefined
  const hasPromptCount = analysis.promptArtifactCount !== undefined
  if (hasInputCount !== hasPromptCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptArtifactCount'],
      message: 'Prompt and input artifact counts must be supplied together',
    })
  }
  if (
    analysis.inputArtifactCount !== undefined &&
    analysis.promptArtifactCount !== undefined &&
    analysis.promptArtifactCount > analysis.inputArtifactCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptArtifactCount'],
      message: 'Prompt artifact count cannot exceed repository input',
    })
  }
  if (
    analysis.promptTruncated === false &&
    analysis.inputArtifactCount !== analysis.promptArtifactCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptTruncated'],
      message: 'Complete prompt provenance requires equal artifact counts',
    })
  }
  if (
    analysis.promptOmittedArtifactCount !== undefined &&
    analysis.inputArtifactCount !== undefined &&
    analysis.promptArtifactCount !== undefined &&
    analysis.promptOmittedArtifactCount !== analysis.inputArtifactCount - analysis.promptArtifactCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptOmittedArtifactCount'],
      message: 'Omitted artifact count must match repository input minus prompt artifacts',
    })
  }
  if (
    analysis.promptTruncated === false &&
    (analysis.promptOmittedArtifactCount !== 0 || analysis.promptContentTruncated === true)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptTruncated'],
      message: 'Complete prompt provenance cannot report omitted artifacts or truncated content',
    })
  }
  if (
    analysis.promptTruncated !== true &&
    ((analysis.promptOmittedArtifactCount ?? 0) > 0 ||
      analysis.promptContentTruncated === true ||
      (analysis.inputArtifactCount !== undefined && analysis.promptArtifactCount !== undefined && analysis.promptArtifactCount < analysis.inputArtifactCount))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptTruncated'],
      message: 'Bounded prompt provenance requires the aggregate truncation flag',
    })
  }
  if (
    analysis.grounding &&
    analysis.grounding.groundedArtifactCount + analysis.grounding.rejectedArtifactCount !== analysis.grounding.referencedArtifactCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['grounding', 'referencedArtifactCount'],
      message: 'Referenced artifact count must equal grounded plus rejected references',
    })
  }
})

const stepSchema = z.object({
  actor: z.string().trim().min(1).max(500),
  action: z.string().trim().min(1).max(2000),
  expectedOutcome: z.string().trim().min(1).max(2000),
  targetIds: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict()

const repositoryFlowCandidateSchema = z.object({
  id: z.string().trim().min(1).max(200),
  repositoryId: z.string().uuid(),
  tenantId: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(200),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().trim().min(1).max(1000)).max(100),
  steps: z.array(stepSchema).min(1).max(20),
  wireframe: z.object({
    kind: z.literal('sequence'),
    nodes: z.array(z.object({
      label: z.string().trim().min(1).max(2000),
      targetIds: z.array(z.string().trim().min(1).max(500)).max(30),
    }).strict()).min(1).max(20),
  }).strict(),
  status: z.literal('proposed'),
  source: z.enum(['deterministic', 'litellm']),
  analysis: analysisSchema.optional(),
  createdAt: z.string().datetime(),
}).strict().superRefine((candidate, context) => {
  if (candidate.source === 'litellm' && !candidate.analysis) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis'], message: 'LiteLLM candidates require analysis provenance' })
  }
  if (candidate.source === 'deterministic' && candidate.analysis) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis'], message: 'Deterministic candidates cannot carry model provenance' })
  }
  if (candidate.source === 'litellm' && candidate.evidence.length === 0 && candidate.steps.every(step => step.targetIds.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'LiteLLM candidates require grounded evidence or target IDs' })
  }
  if (candidate.analysis?.grounding) {
    const groundedIds = new Set([
      ...candidate.evidence,
      ...candidate.steps.flatMap(step => step.targetIds),
      ...candidate.wireframe.nodes.flatMap(node => node.targetIds),
    ])
    if (candidate.analysis.grounding.groundedArtifactCount !== groundedIds.size) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis', 'grounding', 'groundedArtifactCount'], message: 'Grounded artifact count must match persisted candidate references' })
    }
    if (candidate.analysis.grounding.ungroundedStepCount !== candidate.steps.filter(step => step.targetIds.length === 0).length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['analysis', 'grounding', 'ungroundedStepCount'], message: 'Ungrounded step count must match persisted candidate steps' })
    }
  }
})

export const repositoryFlowCandidateIngestionSchema = z.object({
  candidates: z.array(repositoryFlowCandidateSchema).max(60),
}).strict()

export async function candidateOwnershipError(
  candidates: RepositoryFlowCandidate[],
  repositoryLookup: (id: string) => Promise<Pick<Repository, 'id' | 'tenantId'> | undefined>,
) {
  const repositories = new Map<string, Pick<Repository, 'id' | 'tenantId'> | undefined>()
  for (const candidate of candidates) {
    if (!repositories.has(candidate.repositoryId)) repositories.set(candidate.repositoryId, await repositoryLookup(candidate.repositoryId))
    const repository = repositories.get(candidate.repositoryId)
    if (!repository || (repository.tenantId ?? 'legacy') !== candidate.tenantId) {
      return { candidateId: candidate.id, repositoryId: candidate.repositoryId }
    }
  }
  return undefined
}

/** Rejects stale or invented model evidence and wireframe targets before persistence. */
export async function candidateArtifactReferenceError(
  candidates: RepositoryFlowCandidate[],
  artifactLookup: (repositoryId: string, tenantId: string, revision: string) => Promise<QualityArtifact[]>,
) {
  const artifactsBySnapshot = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    const snapshot = `${candidate.repositoryId}:${candidate.tenantId}:${candidate.revision}`
    if (!artifactsBySnapshot.has(snapshot)) {
      const artifacts = await artifactLookup(candidate.repositoryId, candidate.tenantId, candidate.revision)
      artifactsBySnapshot.set(snapshot, new Set(artifacts.flatMap(artifact => [
        artifact.id,
        ...(artifact.logicalId ? [artifact.logicalId] : []),
      ])))
    }
    const knownArtifactIds = artifactsBySnapshot.get(snapshot)!
    const targetIds = new Set([
      ...(candidate.source === 'litellm' && candidate.analysis ? candidate.evidence : []),
      ...candidate.steps.flatMap(step => step.targetIds),
      ...candidate.wireframe.nodes.flatMap(node => node.targetIds),
    ])
    const targetId = [...targetIds].find(id => !knownArtifactIds.has(id))
    if (targetId) return { candidateId: candidate.id, repositoryId: candidate.repositoryId, revision: candidate.revision, targetId }
  }
  return undefined
}
