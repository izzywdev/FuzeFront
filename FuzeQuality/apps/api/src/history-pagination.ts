import { z } from 'zod'

const decodedCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().trim().min(1).max(500),
}).strict()

export const historyPageQueryFields = {
  limit: z.coerce.number().int().min(1).transform(value => Math.min(value, 100)).default(50),
  cursor: z.string().trim().min(1).max(2000).optional(),
}

export const historyPageQuerySchema = z.object(historyPageQueryFields).strict()

export function encodeHistoryCursor(value: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeHistoryCursor(cursor?: string) {
  if (!cursor) return { success: true as const, data: undefined }
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const parsed = decodedCursorSchema.safeParse(value)
    return parsed.success
      ? { success: true as const, data: parsed.data }
      : { success: false as const, error: 'History cursor is invalid' }
  } catch {
    return { success: false as const, error: 'History cursor is invalid' }
  }
}

export function historyPage<T extends { id: string; createdAt: string }>(
  items: T[],
  limit: number,
) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last
        ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id })
        : null,
      hasMore: items.length > limit,
    },
  }
}
