import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/070_sync_cursor_failure_code.sql', import.meta.url),
  'utf8',
)

describe('requirement-analysis failure provenance migration', () => {
  it('retains only safe dependency failure codes', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS failure_code text')
    expect(migration).toContain('JIRA_UNAVAILABLE')
    expect(migration).toContain('INTELLIGENCE_UNAVAILABLE')
    expect(migration).toContain('SEMANTIC_INDEX_UNAVAILABLE')
    expect(migration).toContain('INTELLIGENCE_TIMEOUT')
    expect(migration).toContain('INTELLIGENCE_INVALID_RESPONSE')
  })
})
