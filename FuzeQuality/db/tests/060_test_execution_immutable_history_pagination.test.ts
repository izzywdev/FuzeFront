import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('immutable test execution history pagination migration', () => {
  it('indexes the immutable ingestion timestamp instead of mutable lifecycle timestamps', () => {
    const migration = readFileSync(
      new URL('../migrations/060_test_execution_immutable_history_pagination.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('created_at DESC')
    expect(migration).not.toContain('COALESCE(completed_at, started_at')
  })
})
