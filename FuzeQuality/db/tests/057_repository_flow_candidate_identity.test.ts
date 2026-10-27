import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/057_repository_flow_candidate_identity.sql', import.meta.url),
  'utf8',
)

describe('repository flow candidate identity migration', () => {
  it('removes title-only uniqueness and documents grounded identity', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS repository_flow_candidates_repository_id_revision_title_source_key')
    expect(migration).toContain('grounded flow content')
  })
})
