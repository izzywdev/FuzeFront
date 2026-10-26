import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/043_quality_artifact_pagination.sql', import.meta.url),
  'utf8',
)

describe('quality artifact pagination migration', () => {
  it('indexes repository, exact revision, and stable artifact identity', () => {
    expect(migration).toContain('fuzequality_quality_artifacts_page_idx')
    expect(migration).toContain('(repository_id, revision, id)')
  })
})
