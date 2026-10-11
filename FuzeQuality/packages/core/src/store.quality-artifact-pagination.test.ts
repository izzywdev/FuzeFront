import { describe, expect, it, vi } from 'vitest'
import { PostgresCatalogStore } from './store'

describe('quality artifact page storage', () => {
  it('applies exact-revision ID continuation and a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    vi.spyOn(store, 'repository').mockResolvedValue({ id: 'repo-1' } as never)
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.qualityArtifacts('repo-1', 'tenant-1', 'catalog-1', {
      afterId: 'artifact-50',
      limit: 51,
    })

    const [sql, parameters] = query.mock.calls[0]
    expect(String(sql)).toContain('repository_id=$1')
    expect(String(sql)).toContain('revision=$2')
    expect(String(sql)).toContain('id > $3')
    expect(String(sql)).toContain('ORDER BY id')
    expect(String(sql)).toContain('LIMIT $4')
    expect(parameters).toEqual(['repo-1', 'catalog-1', 'artifact-50', 51])
  })
})
