import { z } from 'zod'
import type { RepositoryScanHistoryEntry } from '@fuzequality/contracts'

const cursorSchema = z.object({
  scannedAt: z.string().datetime().nullable(),
  id: z.string().uuid(),
}).strict()

export const scanHistoryPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).transform(value => Math.min(value, 100)).default(25),
  cursor: z.string().trim().min(1).max(2000).optional(),
}).strict()

export function encodeScanHistoryCursor(value: { scannedAt: string | null; id: string }) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeScanHistoryCursor(cursor?: string) {
  if (!cursor) return { success: true as const, data: undefined }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return parsed.success
      ? { success: true as const, data: parsed.data }
      : { success: false as const, error: 'Scan history cursor is invalid' }
  } catch {
    return { success: false as const, error: 'Scan history cursor is invalid' }
  }
}

export function scanHistoryPage(items: RepositoryScanHistoryEntry[], limit: number) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last
        ? encodeScanHistoryCursor({ scannedAt: last.scannedAt ?? null, id: last.id })
        : null,
      hasMore: items.length > limit,
    },
  }
}
