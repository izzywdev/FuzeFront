import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/042_repository_scan_history_pagination.sql', import.meta.url),
  'utf8',
)

describe('repository scan history pagination migration', () => {
  it('indexes the exact newest-first keyset used by the API', () => {
    expect(migration).toContain('fuzequality_repository_revisions_history_idx')
    expect(migration).toContain('repository_id')
    expect(migration).toContain('scanned_at DESC NULLS LAST')
    expect(migration).toContain('id DESC')
  })
})
