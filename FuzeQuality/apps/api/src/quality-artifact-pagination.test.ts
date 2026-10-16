import { describe, expect, it } from 'vitest'
import type { QualityArtifact } from '@fuzequality/contracts'
import {
  decodeQualityArtifactCursor,
  qualityArtifactIdsQuerySchema,
  qualityArtifactPage,
  qualityArtifactPageQuerySchema,
  resolveQualityArtifactRevision,
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
    const page = qualityArtifactPage([artifact('artifact-a'), artifact('artifact-b')], 1, 'catalog-revision-1')
    expect(page.items.map(item => item.id)).toEqual(['artifact-a'])
    expect(page.page.hasMore).toBe(true)
    expect(decodeQualityArtifactCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { id: 'artifact-a', revision: 'catalog-revision-1' },
    })
  })

  it('pins implicit pagination to the first page revision and rejects revision changes', () => {
    expect(resolveQualityArtifactRevision(undefined, undefined, 'catalog-current')).toEqual({
      success: true,
      data: 'catalog-current',
    })
    expect(resolveQualityArtifactRevision(undefined, 'catalog-original', 'catalog-new')).toEqual({
      success: true,
      data: 'catalog-original',
    })
    expect(resolveQualityArtifactRevision('catalog-new', 'catalog-original', 'catalog-new')).toEqual({
      success: false,
      error: 'Quality artifact cursor revision does not match the requested revision',
    })
  })

  it('bounds page sizes and rejects malformed cursors', () => {
    expect(qualityArtifactPageQuerySchema.parse({ limit: '1000' }).limit).toBe(100)
    expect(decodeQualityArtifactCursor('invalid')).toEqual({
      success: false,
      error: 'Quality artifact cursor is invalid',
    })
  })

  it('bounds and deduplicates exact artifact ID lookups', () => {
    expect(qualityArtifactIdsQuerySchema.parse({ revision: 'catalog-a', id: ['artifact-a', 'artifact-a', 'artifact-b'] })).toEqual({
      revision: 'catalog-a',
      id: ['artifact-a', 'artifact-b'],
    })
    expect(qualityArtifactIdsQuerySchema.safeParse({
      id: Array.from({ length: 101 }, (_, index) => `artifact-${index}`),
    }).success).toBe(false)
  })
})
