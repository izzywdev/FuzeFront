import { describe, expect, it } from 'vitest'
import type { QualityArtifact } from '@fuzequality/contracts'
import {
  decodeQualityArtifactCursor,
  qualityArtifactPage,
  qualityArtifactPageQuerySchema,
} from './quality-artifact-pagination'

const artifact = (id: string): QualityArtifact => ({
  id,
  repositoryId: '00000000-0000-4000-8000-000000000001',
  kind: 'documentation',
  title: id,
  sourcePath: `docs/${id}.md`,
  summary: id,
  evidence: [id],
})

describe('quality artifact pagination', () => {
  it('continues after the last stable artifact ID', () => {
    const page = qualityArtifactPage([artifact('artifact-a'), artifact('artifact-b')], 1)
    expect(page.items.map(item => item.id)).toEqual(['artifact-a'])
    expect(page.page.hasMore).toBe(true)
    expect(decodeQualityArtifactCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { id: 'artifact-a' },
    })
  })

  it('bounds page sizes and rejects malformed cursors', () => {
    expect(qualityArtifactPageQuerySchema.parse({ limit: '1000' }).limit).toBe(100)
    expect(decodeQualityArtifactCursor('invalid')).toEqual({
      success: false,
      error: 'Quality artifact cursor is invalid',
    })
  })
})
