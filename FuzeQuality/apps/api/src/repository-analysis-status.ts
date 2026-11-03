import { z } from 'zod'

const counts = z.object({
  deterministic: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
}).strict()

export const repositoryAnalysisStatusSchema = z.object({
  revision: z.string().trim().min(1).max(500),
  status: z.enum(['queued', 'running', 'complete', 'failed']),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  counts: counts.optional(),
  errorCode: z.enum(['INTELLIGENCE_UNAVAILABLE', 'INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_INVALID_RESPONSE']).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'complete' && !value.counts) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['counts'], message: 'Completed analysis requires counts' })
  }
  if (value.status === 'failed' && !value.errorCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'Failed analysis requires a safe error code' })
  }
})
