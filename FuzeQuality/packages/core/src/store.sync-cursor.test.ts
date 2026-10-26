import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('requirement sync cursors', () => {
  it('moves the cursor only with a successfully saved intelligence batch', async () => {
    const store = new MemoryCatalogStore()
    expect(await store.syncCursor('jira', 'fq-product')).toBeUndefined()

    await store.saveIntelligence([], {
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
    })

    expect(await store.syncCursor('jira', 'fq-product')).toMatchObject({
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
      freshnessStatus: 'fresh',
    })
  })

  it('retains a safe dependency failure code and clears it after a successful batch', async () => {
    const store = new MemoryCatalogStore()

    await store.markSyncFailed('jira', 'fq-product', 'INTELLIGENCE_UNAVAILABLE')
    expect(await store.syncCursor('jira', 'fq-product')).toEqual({
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: undefined,
      lastSuccessAt: undefined,
      freshnessStatus: 'failed',
      failureCode: 'INTELLIGENCE_UNAVAILABLE',
    })

    await store.saveIntelligence([], {
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
    })
    expect(await store.syncCursor('jira', 'fq-product')).toMatchObject({
      freshnessStatus: 'fresh',
      failureCode: undefined,
    })
  })
})
