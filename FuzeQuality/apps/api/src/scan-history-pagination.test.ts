import { describe, expect, it } from 'vitest'
import type { RepositoryScanHistoryEntry } from '@fuzequality/contracts'
import {
  decodeScanHistoryCursor,
  scanHistoryPage,
  scanHistoryPageQuerySchema,
} from './scan-history-pagination'

const entry = (id: string, scannedAt?: string): RepositoryScanHistoryEntry => ({
  id,
  revision: id.replaceAll('-', ''),
  branch: 'main',
  status: 'complete',
  scannedAt,
  trigger: 'manual',
  counts: { operations: 1, surfaces: 2, tests: 3, diagnostics: 0 },
})

describe('repository scan history pagination', () => {
  it('creates a cursor from the last returned revision and retains null timestamps', () => {
    const items = [
      entry('00000000-0000-4000-8000-000000000001', '2026-10-11T10:00:00.000Z'),
      entry('00000000-0000-4000-8000-000000000002'),
    ]
    const page = scanHistoryPage(items, 1)

    expect(page.items).toEqual([items[0]])
    expect(page.page.hasMore).toBe(true)
    expect(decodeScanHistoryCursor(page.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { scannedAt: '2026-10-11T10:00:00.000Z', id: items[0].id },
    })

    const nullPage = scanHistoryPage([items[1], items[0]], 1)
    expect(decodeScanHistoryCursor(nullPage.page.nextCursor ?? undefined)).toEqual({
      success: true,
      data: { scannedAt: null, id: items[1].id },
    })
  })

  it('caps page sizes and rejects malformed cursors', () => {
    expect(scanHistoryPageQuerySchema.parse({ limit: '1000' }).limit).toBe(100)
    expect(decodeScanHistoryCursor('not-a-cursor')).toEqual({
      success: false,
      error: 'Scan history cursor is invalid',
    })
  })
})
