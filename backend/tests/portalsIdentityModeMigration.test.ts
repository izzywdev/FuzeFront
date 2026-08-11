/**
 * Portals Directory (backend slice S1) — proves migration 023
 * (`portals.identity_mode`) is correct AND idempotent. Uses the shared jest
 * global setup (tests/setup.ts — real Postgres, full migration chain
 * already applied in beforeAll, including 023), then invokes migration
 * 023's `up()` directly a second/third time (mirrors
 * tests/rootMembershipBackfillMigration.test.ts's pattern for migration 022)
 * to prove idempotency and to exercise the Mendys backfill against data
 * seeded AFTER the initial migration run.
 */
import { v4 as uuidv4 } from 'uuid'

import { db, initializeDatabaseConnection } from '../src/config/database'
import * as migration023 from '../src/migrations/023_portals_identity_mode'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `identity-mode-${id.slice(0, 8)}@test.local`,
    first_name: 'IdentityMode',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createPortal(opts: { slug: string; identityMode?: 'soft' | 'hard' }): Promise<string> {
  const ownerId = await createUser()
  const orgId = uuidv4()
  await db('organizations').insert({
    id: orgId,
    name: opts.slug,
    slug: `${opts.slug}-${orgId.slice(0, 6)}`,
    owner_id: ownerId,
    type: 'organization',
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    provisioning_state: 'active',
  })
  const portalId = `prt_${uuidv4().replace(/-/g, '')}`
  const row: Record<string, unknown> = {
    id: portalId,
    organization_id: orgId,
    slug: opts.slug,
    name: opts.slug,
    status: 'active',
    billing_mode: 'free',
    branding: JSON.stringify({ name: opts.slug }),
    identity_policy: JSON.stringify({ allowPasswordLogin: true, allowSelfSignup: false }),
    is_root: false,
  }
  if (opts.identityMode) row.identity_mode = opts.identityMode
  await db('portals').insert(row)
  return portalId
}

describe('migration 023 — portals.identity_mode (Portals Directory backend slice S1)', () => {
  it('(a) new portal rows default to identity_mode = soft', async () => {
    const portalId = await createPortal({ slug: `soft-${uuidv4().slice(0, 8)}` })
    const row = await db('portals').where({ id: portalId }).first()
    expect(row.identity_mode).toBe('soft')
  })

  it('(b) backfills identity_mode = hard for an existing Mendys-slugged portal', async () => {
    const portalId = await createPortal({ slug: 'mendysrobotics' })

    await migration023.up(db)

    const row = await db('portals').where({ id: portalId }).first()
    expect(row.identity_mode).toBe('hard')
  })

  it('(c) no-op when no Mendys-slugged portal row exists — every other slug stays soft', async () => {
    const portalId = await createPortal({ slug: `northwind-${uuidv4().slice(0, 8)}` })

    await migration023.up(db)

    const row = await db('portals').where({ id: portalId }).first()
    expect(row.identity_mode).toBe('soft')
  })

  it('(d) idempotent: running the migration twice produces no diff on the second run', async () => {
    const portalId = await createPortal({ slug: 'mendys' })

    await migration023.up(db)
    const afterFirst = await db('portals').where({ id: portalId }).first()
    expect(afterFirst.identity_mode).toBe('hard')

    await expect(migration023.up(db)).resolves.toBeUndefined()
    const afterSecond = await db('portals').where({ id: portalId }).first()
    expect(afterSecond.identity_mode).toBe('hard')
    expect(afterSecond.id).toBe(afterFirst.id)
  })

  it('(e) an explicitly-set hard portal that does not match a Mendys slug is left untouched', async () => {
    const portalId = await createPortal({
      slug: `dedicated-${uuidv4().slice(0, 8)}`,
      identityMode: 'hard',
    })

    await migration023.up(db)

    const row = await db('portals').where({ id: portalId }).first()
    expect(row.identity_mode).toBe('hard')
  })
})
