import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/050_test_execution_version_evidence_links.sql', import.meta.url),
  'utf8',
)

describe('test execution version evidence migration', () => {
  it('adds and backfills immutable attachment evidence idempotently', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS evidence_links jsonb')
    expect(migration).toContain('INSERT INTO fuzequality.test_execution_versions')
    expect(migration).toContain('version.evidence_links = execution.evidence_links')
    expect(migration).toContain('jsonb_array_length(execution.evidence_links) > 0')
  })
})
