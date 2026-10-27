import { z } from 'zod'
import type { ExecutionOutcomeTrend } from '@fuzequality/core'

const cursorSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  snapshotAt: z.string().datetime().optional(),
}).strict()

export function encodeExecutionTrendCursor(item: ExecutionOutcomeTrend, snapshotAt?: string) {
  return Buffer.from(JSON.stringify({ date: item.date, ...(snapshotAt ? { snapshotAt } : {}) }), 'utf8').toString('base64url')
}

export function decodeExecutionTrendCursor(cursor?: string) {
  if (!cursor) return { success: true as const, data: undefined }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return parsed.success
      ? { success: true as const, data: parsed.data }
      : { success: false as const, error: 'Execution trend cursor is invalid' }
  } catch {
    return { success: false as const, error: 'Execution trend cursor is invalid' }
  }
}

export function executionTrendPage(items: ExecutionOutcomeTrend[], limit: number, snapshotAt?: string) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last ? encodeExecutionTrendCursor(last, snapshotAt) : null,
      hasMore: items.length > limit,
    },
  }
}
