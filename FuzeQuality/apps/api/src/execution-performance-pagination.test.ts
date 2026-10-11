import { describe, expect, it } from 'vitest'
import type { PolicyGatePerformance } from '@fuzequality/core'
import { decodePerformanceCursor, performancePage } from './execution-performance-pagination'

const pair = (policyArtifactId: string, gateArtifactId: string, failed: number, passed: number): PolicyGatePerformance => ({
  repositoryId: 'repo-1', policyArtifactId, gateArtifactId, failed, passed, cancelled: 0, running: 0,
})

describe('policy-gate performance pagination', () => {
  it('continues after an exact aggregate sort tuple without duplicates', () => {
    const items = [
      pair('policy-a', 'gate-a', 3, 1),
      pair('policy-b', 'gate-b', 2, 5),
      pair('policy-c', 'gate-c', 2, 4),
    ]
    const first = performancePage(items, 2)
    expect(first.items.map(item => item.policyArtifactId)).toEqual(['policy-a', 'policy-b'])
    expect(first.page.hasMore).toBe(true)
    const cursor = decodePerformanceCursor(first.page.nextCursor ?? undefined)
    expect(cursor.success).toBe(true)
    if (!cursor.success) return
    expect(performancePage(items, 2, cursor.data).items.map(item => item.policyArtifactId)).toEqual(['policy-c'])
  })

  it('rejects malformed or incomplete cursors', () => {
    expect(decodePerformanceCursor('not-json').success).toBe(false)
    expect(decodePerformanceCursor(Buffer.from(JSON.stringify({ failed: 1 })).toString('base64url')).success).toBe(false)
  })
})
