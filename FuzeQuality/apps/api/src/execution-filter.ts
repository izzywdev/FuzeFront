import { z } from 'zod'

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
  revision: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
}).strict().superRefine((value, context) => {
  if (!value.from || !value.until) return
  if (Date.parse(value.from) <= Date.parse(value.until)) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['until'],
    message: 'until must be greater than or equal to from',
  })
})
