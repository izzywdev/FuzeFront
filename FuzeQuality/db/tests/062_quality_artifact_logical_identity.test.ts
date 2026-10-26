import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('quality artifact logical identity migration', () => {
  it('separates stable logical identity from revision-scoped observation rows', () => {
    const migration = readFileSync(
      new URL('../migrations/062_quality_artifact_logical_identity.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS logical_id text')
    expect(migration).toContain('SET logical_id = id')
    expect(migration).toContain('(repository_id, revision, logical_id)')
    expect(migration).toContain('(repository_id, logical_id, discovered_at DESC, id DESC)')
  })
})
