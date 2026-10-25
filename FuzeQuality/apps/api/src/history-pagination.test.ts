import { describe, expect, it } from 'vitest'
import { decodeHistoryCursor, decodeUuidHistoryCursor, encodeHistoryCursor, historyPage } from './history-pagination'

describe('history pagination', () => {
  it('round-trips an opaque stable cursor', () => {
    const value = { createdAt: '2026-10-11T08:00:00.000Z', id: 'flow-1' }
    expect(decodeHistoryCursor(encodeHistoryCursor(value))).toEqual({ success: true, data: value })
  })

  it('rejects malformed or structurally invalid cursors', () => {
    expect(decodeHistoryCursor('not-json')).toEqual({ success: false, error: 'History cursor is invalid' })
    expect(decodeHistoryCursor(Buffer.from(JSON.stringify({ id: 'flow-1' })).toString('base64url'))).toEqual({
      success: false,
      error: 'History cursor is invalid',
    })
  })

  it('rejects non-UUID review-history cursor IDs before PostgreSQL casts them', () => {
    const cursor = encodeHistoryCursor({
      createdAt: '2026-10-11T08:00:00.000Z',
      id: 'flow-review-not-a-uuid',
    })
    expect(decodeUuidHistoryCursor(cursor)).toEqual({
      success: false,
      error: 'History cursor is invalid',
    })
    expect(decodeUuidHistoryCursor(encodeHistoryCursor({
      createdAt: '2026-10-11T08:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000002',
    }))).toEqual({
      success: true,
      data: {
        createdAt: '2026-10-11T08:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000002',
      },
    })
  })

  it('uses limit-plus-one lookahead without returning the extra record', () => {
    const items = [1, 2, 3].map(index => ({
      id: `item-${index}`,
      createdAt: `2026-10-0${4 - index}T08:00:00.000Z`,
    }))
    const page = historyPage(items, 2)
    expect(page.items).toEqual(items.slice(0, 2))
    expect(page.page.hasMore).toBe(true)
    expect(decodeHistoryCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { createdAt: items[1].createdAt, id: items[1].id },
    })
  })
})
