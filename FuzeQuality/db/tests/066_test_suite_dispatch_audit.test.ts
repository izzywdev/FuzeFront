import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/066_test_suite_dispatch_audit.sql', import.meta.url),
  'utf8',
)

describe('test-suite dispatch audit migration', () => {
  it('enforces tenant ownership and excludes workflow input values', () => {
    expect(migration).toContain('FOREIGN KEY (repository_id, tenant_id)')
    expect(migration).toContain('REFERENCES fuzequality.repositories(id, tenant_id)')
    expect(migration).toContain('input_names jsonb')
    expect(migration).not.toContain('input_values')
    expect(migration).toContain("status IN ('dispatching', 'accepted', 'failed')")
    expect(migration).toContain('test_suite_dispatches_latest_idx')
  })
})
