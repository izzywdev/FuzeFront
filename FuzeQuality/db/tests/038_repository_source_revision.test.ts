import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/038_repository_source_revision.sql', import.meta.url),
  'utf8',
)

describe('repository source revision migration', () => {
  it('retains source commits separately from catalog revisions and indexes the lookup', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS fuzequality.repository_revision_sources')
    expect(migration).toContain('PRIMARY KEY (repository_id, source_revision)')
    expect(migration).toContain('catalog_revision text NOT NULL')
    expect(migration).toContain("last_scan_details->>'sourceRevision'")
    expect(migration).toContain('(repository_id, catalog_revision)')
  })
})
