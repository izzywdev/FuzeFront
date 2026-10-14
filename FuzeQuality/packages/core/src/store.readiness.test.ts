import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

describe('catalog store readiness', () => {
  it('keeps the in-memory store ready without reading the portfolio', async () => {
    const store = new MemoryCatalogStore()
    const portfolio = vi.spyOn(store, 'portfolio')

    await expect(store.checkReadiness()).resolves.toBeUndefined()
    expect(portfolio).not.toHaveBeenCalled()
  })

  it('uses one constant-time Postgres query instead of loading the catalog', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    const store = new PostgresCatalogStore('postgres://unused')
    const portfolio = vi.spyOn(store, 'portfolio')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await expect(store.checkReadiness()).resolves.toBeUndefined()

    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith('SELECT 1')
    expect(portfolio).not.toHaveBeenCalled()
  })

  it('fails closed when Postgres cannot answer the readiness query', async () => {
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = {
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    }

    await expect(store.checkReadiness()).rejects.toThrow('database unavailable')
  })
})
