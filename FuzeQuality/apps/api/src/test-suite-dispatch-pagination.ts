import type { TestSuiteDispatch } from '@fuzequality/contracts'
import { encodeHistoryCursor } from './history-pagination'

export function testSuiteDispatchPage(items: TestSuiteDispatch[], limit: number) {
  const pageItems = items.slice(0, limit)
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    page: {
      nextCursor: items.length > limit && last
        ? encodeHistoryCursor({ createdAt: last.requestedAt, id: last.id })
        : null,
      hasMore: items.length > limit,
    },
  }
}
