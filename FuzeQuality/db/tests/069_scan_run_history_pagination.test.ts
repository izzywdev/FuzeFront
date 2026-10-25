import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/069_scan_run_history_pagination.sql', import.meta.url),
  'utf8',
)

describe('immutable scan-run history pagination migration', () => {
  it('indexes the immutable newest-first scan-run keyset used by the API', () => {
    expect(migration).toContain('fuzequality_scan_runs_history_idx')
    expect(migration).toContain('repository_id')
    expect(migration).toContain('(COALESCE(finished_at, started_at)) DESC')
    expect(migration).toContain('id DESC')
  })
})
