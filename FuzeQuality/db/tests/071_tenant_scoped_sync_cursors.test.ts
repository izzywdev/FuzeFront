import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/071_tenant_scoped_sync_cursors.sql', import.meta.url),
  'utf8',
)

describe('tenant-scoped requirement sync cursors migration', () => {
  it('fails closed for unattributable cursors and keys future state by tenant', () => {
    expect(migration).toContain('DELETE FROM fuzequality.sync_cursors WHERE tenant_id IS NULL')
    expect(migration).toContain('ALTER COLUMN tenant_id SET NOT NULL')
    expect(migration).toContain('PRIMARY KEY (tenant_id, source_type, source_key)')
  })
})
