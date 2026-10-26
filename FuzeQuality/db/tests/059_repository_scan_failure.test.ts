import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('repository scan failure migration', () => {
  it('persists sanitized terminal scan failures on repositories', () => {
    const migration = readFileSync(
      new URL('../migrations/059_repository_scan_failure.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('last_scan_failure jsonb')
    expect(migration).toContain('Sanitized terminal failure details')
  })
})
