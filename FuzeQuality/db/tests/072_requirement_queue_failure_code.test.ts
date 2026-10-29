import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/072_requirement_queue_failure_code.sql', import.meta.url),
  'utf8',
)

describe('requirement queue failure migration', () => {
  it('retains the dependency failure constraint and adds dispatch availability', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS sync_cursors_failure_code_check')
    expect(migration).toContain("'REQUIREMENT_QUEUE_UNAVAILABLE'")
    expect(migration).toContain("'INTELLIGENCE_INVALID_RESPONSE'")
    expect(migration).toContain("'SEMANTIC_INDEX_UNAVAILABLE'")
  })
})
