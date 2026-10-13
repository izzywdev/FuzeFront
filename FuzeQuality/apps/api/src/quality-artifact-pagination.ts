import { z } from 'zod'
import type { QualityArtifact } from '@fuzequality/contracts'

const cursorSchema = z.object({
  id: z.string().trim().min(1).max(500),
  revision: z.string().trim().min(1).max(500).optional(),
}).strict()

export const qualityArtifactPageQuerySchema = z.object({
  revision: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).transform(value => Math.min(value, 100)).default(50),
  cursor: z.string().trim().min(1).max(2000).optional(),
}).strict()

const qualityArtifactIdSchema = z.string().trim().min(1).max(500)

export const qualityArtifactIdsQuerySchema = z.object({
  id: z.union([
    qualityArtifactIdSchema,
    z.array(qualityArtifactIdSchema).min(1).max(100),
  ]).transform(value => [...new Set(Array.isArray(value) ? value : [value])]),
}).strict()

export function encodeQualityArtifactCursor(id: string, revision?: string) {
  return Buffer.from(JSON.stringify({ id, ...(revision ? { revision } : {}) }), 'utf8').toString('base64url')
}

export function decodeQualityArtifactCursor(cursor?: string) {
  if (!cursor) return { success: true as const, data: undefined }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return parsed.success
      ? { success: true as const, data: parsed.data }
      : { success: false as const, error: 'Quality artifact cursor is invalid' }
  } catch {
    return { success: false as const, error: 'Quality artifact cursor is invalid' }
  }
}

export function resolveQualityArtifactRevision(
  requestedRevision?: string,
  cursorRevision?: string,
  currentRevision?: string,
) {
  if (requestedRevision && cursorRevision && requestedRevision !== cursorRevision) {
    return { success: false as const, error: 'Quality artifact cursor revision does not match the requested revision' }
  }
  return {
    success: true as const,
    data: requestedRevision ?? cursorRevision ?? currentRevision,
  }
}

export function qualityArtifactPage(items: QualityArtifact[], limit: number, revision?: string) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last ? encodeQualityArtifactCursor(last.id, revision) : null,
      hasMore: items.length > limit,
    },
  }
}
