import { describe, expect, it, vi } from 'vitest'
import type { RepositoryScanHistoryEntry } from '@fuzequality/contracts'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

const item = (id: string, scannedAt: string): RepositoryScanHistoryEntry => ({
  id,
  revision: id,
  branch: 'main',
  status: 'complete',
  scannedAt,
  trigger: 'manual',
  counts: { operations: 1, surfaces: 2, tests: 3, diagnostics: 0 },
})

describe('repository scan history storage', () => {
  it('continues the in-memory tenant history after an exact revision cursor', async () => {
    const store = new MemoryCatalogStore()
    const repository = await store.addRepository({
      owner: 'acme', name: 'web', defaultBranch: 'main', kind: 'mixed',
      includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [],
    }, 'tenant-1')
    const first = item('00000000-0000-4000-8000-000000000003', '2026-10-11T03:00:00.000Z')
    const second = item('00000000-0000-4000-8000-000000000002', '2026-10-11T02:00:00.000Z')
    const third = item('00000000-0000-4000-8000-000000000001', '2026-10-11T01:00:00.000Z')
    ;(store as unknown as { scanHistory: Array<{ repositoryId: string; item: RepositoryScanHistoryEntry }> }).scanHistory = [
      { repositoryId: repository.id, item: first },
      { repositoryId: repository.id, item: second },
      { repositoryId: repository.id, item: third },
    ]

    await expect(store.repositoryScanHistory(repository.id, 'tenant-1', { limit: 2 })).resolves.toEqual([first, second])
    await expect(store.repositoryScanHistory(repository.id, 'tenant-1', {
      after: { scannedAt: second.scannedAt ?? null, id: second.id }, limit: 2,
    })).resolves.toEqual([third])
    await expect(store.repositoryScanHistory(repository.id, 'another-tenant', { limit: 2 })).resolves.toEqual([])
  })

  it('uses a timestamp and UUID keyset in the bounded Postgres query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    vi.spyOn(store, 'repository').mockResolvedValue({ id: 'repo-1' } as never)
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.repositoryScanHistory('repo-1', 'tenant-1', {
      after: { scannedAt: '2026-10-11T02:00:00.000Z', id: '00000000-0000-4000-8000-000000000002' },
      limit: 26,
    })

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('r.scanned_at = $2::timestamptz AND r.id < $3::uuid')
    expect(String(sql)).toContain('ORDER BY r.scanned_at DESC NULLS LAST, r.id DESC')
    expect(String(sql)).toContain('LIMIT $4')
    expect(parameters).toEqual([
      'repo-1', '2026-10-11T02:00:00.000Z', '00000000-0000-4000-8000-000000000002', 26,
    ])
  })
})
