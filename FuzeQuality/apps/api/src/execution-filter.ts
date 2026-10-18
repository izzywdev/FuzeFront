import { z } from 'zod'
import { historyPageQueryFields } from './history-pagination'

/**
 * Query contract shared by execution evidence and policy–gate performance.
 *
 * An inverted range is a caller error, not evidence that nothing happened.
 * Keeping this separate from the Express bootstrap makes the boundary directly
 * testable without opening sockets or creating worker dependencies.
 */
export const executionFilterSchema = z.object({
  kind: z.enum(['ci', 'integration', 'post-production', 'load', 'stress']).optional(),
  status: z.enum(['passed', 'failed', 'cancelled', 'running']).optional(),
  provider: z.enum(['github-actions', 'external']).optional(),
  name: z.string().trim().min(1).max(500).optional(),
  evidenceKind: z.enum(['video', 'report', 'trace', 'screenshot', 'log', 'other']).optional(),
  evidenceCollectionStatus: z.enum(['complete', 'partial', 'unavailable']).optional(),
  thresholdOutcome: z.enum(['passed', 'failed']).optional(),
  gateOutcome: z.enum(['passed', 'failed', 'cancelled', 'running']).optional(),
  externalRunId: z.string().trim().min(1).max(500).optional(),
  policyArtifactId: z.string().trim().min(1).max(500).optional(),
  gateArtifactId: z.string().trim().min(1).max(500).optional(),
  branch: z.string().trim().min(1).max(500).optional(),
  revision: z.string().trim().min(1).max(200).optional(),
  workflowPath: z.string().trim().min(1).max(1000).optional(),
  attemptScope: z.enum(['initial', 'retry', 'recovered']).optional(),
  minimumDurationMs: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  maximumDurationMs: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  from: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.until && Date.parse(value.from) > Date.parse(value.until)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['until'], message: 'until must be greater than or equal to from' })
  }
  if (value.minimumDurationMs !== undefined && value.maximumDurationMs !== undefined && value.minimumDurationMs > value.maximumDurationMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maximumDurationMs'], message: 'maximumDurationMs must be greater than or equal to minimumDurationMs' })
  }
})

export const executionPageFilterSchema = z.object({
  kind: z.enum(['ci', 'integration', 'post-production', 'load', 'stress']).optional(),
  status: z.enum(['passed', 'failed', 'cancelled', 'running']).optional(),
  provider: z.enum(['github-actions', 'external']).optional(),
  name: z.string().trim().min(1).max(500).optional(),
  evidenceKind: z.enum(['video', 'report', 'trace', 'screenshot', 'log', 'other']).optional(),
  evidenceCollectionStatus: z.enum(['complete', 'partial', 'unavailable']).optional(),
  thresholdOutcome: z.enum(['passed', 'failed']).optional(),
  gateOutcome: z.enum(['passed', 'failed', 'cancelled', 'running']).optional(),
  externalRunId: z.string().trim().min(1).max(500).optional(),
  policyArtifactId: z.string().trim().min(1).max(500).optional(),
  gateArtifactId: z.string().trim().min(1).max(500).optional(),
  branch: z.string().trim().min(1).max(500).optional(),
  revision: z.string().trim().min(1).max(200).optional(),
  workflowPath: z.string().trim().min(1).max(1000).optional(),
  attemptScope: z.enum(['initial', 'retry', 'recovered']).optional(),
  minimumDurationMs: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  maximumDurationMs: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  from: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  ...historyPageQueryFields,
}).strict().superRefine((value, context) => {
  if (value.from && value.until && Date.parse(value.from) > Date.parse(value.until)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['until'], message: 'until must be greater than or equal to from' })
  }
  if (value.minimumDurationMs !== undefined && value.maximumDurationMs !== undefined && value.minimumDurationMs > value.maximumDurationMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maximumDurationMs'], message: 'maximumDurationMs must be greater than or equal to minimumDurationMs' })
  }
})

export const executionPerformanceFilterSchema = executionPageFilterSchema

export const executionAttemptHistoryFilterSchema = z.object({
  provider: z.enum(['github-actions', 'external']),
  externalRunId: z.string().trim().min(1).max(500),
  ...historyPageQueryFields,
}).strict()
