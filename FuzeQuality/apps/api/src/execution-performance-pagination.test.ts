import { describe, expect, it } from 'vitest'
import type { PolicyGatePerformance } from '@fuzequality/core'
import { decodePerformanceCursor, performancePage } from './execution-performance-pagination'

const pair = (policyArtifactId: string, gateArtifactId: string, failed: number, passed: number): PolicyGatePerformance => ({
  repositoryId: 'repo-1', policyArtifactId, gateArtifactId, total: failed + passed, failed, passed,
  cancelled: 0, running: 0, passRate: passed / (failed + passed),
})

describe('policy-gate performance pagination', () => {
  it('continues after an exact aggregate sort tuple without duplicates', () => {
    const items = [
      pair('policy-c', 'gate-c', 2, 4),
      pair('policy-a', 'gate-a', 3, 1),
      pair('policy-b', 'gate-b', 2, 5),
    ]
    const first = performancePage(items, 2, undefined, '2026-10-11T00:00:00.000Z')
    expect(first.items.map(item => item.policyArtifactId)).toEqual(['policy-a', 'policy-b'])
    expect(first.page.hasMore).toBe(true)
    const cursor = decodePerformanceCursor(first.page.nextCursor ?? undefined)
    expect(cursor).toMatchObject({ success: true, data: { snapshotAt: '2026-10-11T00:00:00.000Z' } })
    if (!cursor.success) return
    expect(performancePage(items, 2, cursor.data).items.map(item => item.policyArtifactId)).toEqual(['policy-c'])
  })

  it('rejects malformed or incomplete cursors', () => {
    expect(decodePerformanceCursor('not-json').success).toBe(false)
    expect(decodePerformanceCursor(Buffer.from(JSON.stringify({ failed: 1 })).toString('base64url')).success).toBe(false)
  })
})
