import { describe, expect, it } from 'vitest'
import { executionFilterSchema } from './execution-filter'

describe('execution evidence filter', () => {
  it('accepts a chronological ISO-8601 range', () => {
    expect(executionFilterSchema.safeParse({
      kind: 'post-production',
      status: 'failed',
      provider: 'github-actions',
      revision: 'abcdef123456',
      workflowPath: '.github/workflows/load.yml',
      from: '2026-10-01T00:00:00.000Z',
      until: '2026-10-08T00:00:00.000Z',
    }).success).toBe(true)
  })

  it('rejects an unknown execution provider', () => {
    expect(executionFilterSchema.safeParse({ provider: 'jenkins' }).success).toBe(false)
  })

  it('rejects an empty or oversized revision', () => {
    expect(executionFilterSchema.safeParse({ revision: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ revision: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects an empty or oversized workflow path', () => {
    expect(executionFilterSchema.safeParse({ workflowPath: ' ' }).success).toBe(false)
    expect(executionFilterSchema.safeParse({ workflowPath: 'a'.repeat(1001) }).success).toBe(false)
  })

  it('rejects an inverted time range instead of returning misleading empty evidence', () => {
    const result = executionFilterSchema.safeParse({
      from: '2026-10-08T00:00:00.000Z',
      until: '2026-10-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.flatten().fieldErrors.until).toContain('until must be greater than or equal to from')
  })
})
