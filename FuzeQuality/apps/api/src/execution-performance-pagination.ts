import { z } from 'zod'
import type { PolicyGatePerformance } from '@fuzequality/core'

const cursorSchema = z.object({
  failed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  gateArtifactId: z.string().trim().min(1).max(500),
  policyArtifactId: z.string().trim().min(1).max(500),
}).strict()

type PerformanceCursor = z.infer<typeof cursorSchema>

function cursorFor(item: PolicyGatePerformance): PerformanceCursor {
  return {
    failed: item.failed,
    passed: item.passed,
    gateArtifactId: item.gateArtifactId,
    policyArtifactId: item.policyArtifactId,
  }
}

function compare(left: PerformanceCursor, right: PerformanceCursor) {
  return right.failed - left.failed ||
    right.passed - left.passed ||
    left.gateArtifactId.localeCompare(right.gateArtifactId) ||
    left.policyArtifactId.localeCompare(right.policyArtifactId)
}

export function encodePerformanceCursor(item: PolicyGatePerformance) {
  return Buffer.from(JSON.stringify(cursorFor(item)), 'utf8').toString('base64url')
}

export function decodePerformanceCursor(cursor?: string) {
  if (!cursor) return { success: true as const, data: undefined }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return parsed.success
      ? { success: true as const, data: parsed.data }
      : { success: false as const, error: 'Performance cursor is invalid' }
  } catch {
    return { success: false as const, error: 'Performance cursor is invalid' }
  }
}

export function performancePage(
  items: PolicyGatePerformance[],
  limit: number,
  after?: PerformanceCursor,
) {
  const remaining = after
    ? items.filter(item => compare(cursorFor(item), after) > 0)
    : items
  const pageItems = remaining.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: remaining.length > limit && last ? encodePerformanceCursor(last) : null,
      hasMore: remaining.length > limit,
    },
  }
}
