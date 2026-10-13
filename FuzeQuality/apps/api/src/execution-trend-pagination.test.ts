import { describe, expect, it } from 'vitest'
import { decodeExecutionTrendCursor, executionTrendPage } from './execution-trend-pagination'

describe('execution outcome trend pagination', () => {
  it('continues before the last UTC day without duplicating it', () => {
    const items = [
      { date: '2026-10-11', passed: 2, failed: 0, cancelled: 0, running: 0, durationSampleCount: 2, averageDurationMs: 30_000, retryAttemptCount: 1, successfulRetryCount: 1, recoveredRunCount: 1 },
      { date: '2026-10-10', passed: 1, failed: 1, cancelled: 0, running: 0, durationSampleCount: 2, averageDurationMs: 45_000, retryAttemptCount: 0, successfulRetryCount: 0, recoveredRunCount: 0 },
      { date: '2026-10-09', passed: 0, failed: 2, cancelled: 0, running: 0, durationSampleCount: 0, averageDurationMs: 0, retryAttemptCount: 1, successfulRetryCount: 0, recoveredRunCount: 0 },
    ]
    const page = executionTrendPage(items, 2, '2026-10-11T12:00:00.000Z')
    expect(page.items.map(item => item.date)).toEqual(['2026-10-11', '2026-10-10'])
    expect(page.page.hasMore).toBe(true)
    expect(decodeExecutionTrendCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { date: '2026-10-10', snapshotAt: '2026-10-11T12:00:00.000Z' },
    })
  })

  it('rejects malformed day cursors', () => {
    expect(decodeExecutionTrendCursor('not-json').success).toBe(false)
    expect(decodeExecutionTrendCursor(Buffer.from(JSON.stringify({ date: 'yesterday' })).toString('base64url')).success).toBe(false)
  })
})
