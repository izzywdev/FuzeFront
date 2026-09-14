import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(new URL('../migrations/011_requirement_review_findings.sql', import.meta.url), 'utf8')

describe('requirement review findings migration', () => {
  it('is additive and safe to retry', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS confidence/)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS source_passages/)
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS findings_requirement_review_idx/)
  })

  it('bounds semantic confidence and stores review context', () => {
    expect(migration).toContain('confidence >= 0 AND confidence <= 1')
    expect(migration).toContain('affected_flow_ids')
    expect(migration).toContain('affected_target_ids')
    expect(migration).toContain('remediation_options')
  })
})
