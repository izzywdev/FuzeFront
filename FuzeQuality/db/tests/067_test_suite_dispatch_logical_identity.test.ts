import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/067_test_suite_dispatch_logical_identity.sql', import.meta.url),
  'utf8',
)

describe('test-suite dispatch logical identity migration', () => {
  it('backfills stable suite identity without erasing exact artifact provenance', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS artifact_logical_id text')
    expect(migration).toContain('artifact.logical_id')
    expect(migration).toContain('dispatch.artifact_id')
    expect(migration).toContain('ALTER COLUMN artifact_logical_id SET NOT NULL')
    expect(migration).toContain('test_suite_dispatches_logical_history_idx')
    expect(migration).not.toContain('DROP COLUMN artifact_id')
  })
})
