/**
 * FFRNT-307 — migration 021 against a REAL Postgres (skips gracefully when none
 * is reachable, like migrations.integration.test.ts). Runs the whole security
 * chain from the TypeScript sources, then asserts:
 *   - idempotent (up twice is a clean no-op; down then up round-trips),
 *   - back-compat defaults on pre-existing rows (member_type='employee', channel='email'),
 *   - the channel/identity CHECK holds, whatsapp rows need a phone,
 *   - the real CAS UPDATE used by accept is single-winner,
 *   - bind-token uniqueness index.
 */
import path from 'path'
import knexFactory, { Knex } from 'knex'
import { Client } from 'pg'

// The service under test talks to the same real database the migration test
// builds: point the `db` singleton at it (jest.mock factories may only close
// over variables prefixed `mock`).
let mockKnex: any
jest.mock('../src/config/database', () => ({
  db: new Proxy(function () {}, {
    apply: (_t, _this, args) => mockKnex(...args),
    get: (_t, p) => {
      const v = mockKnex[p]
      return typeof v === 'function' ? v.bind(mockKnex) : v
    },
  }),
}))

import {
  bindInvitation,
  createInvitation,
  issueBindToken,
  listInvitations,
  portalKeyOf,
  redeemBindToken,
} from '../src/services/invitationsV2'

const HOST = process.env.DB_HOST || 'localhost'
const PORT = parseInt(process.env.DB_PORT || '5432')
const USER = process.env.DB_USER || 'fuzeinfra'
const PASSWORD = process.env.DB_PASSWORD || 'fuzeinfra_secure_password'
const TEST_DB = 'fuzefront_security_invv2_mig_test'
const MIG_DIR = path.join(__dirname, '..', 'src', 'migrations')
const M021 = path.join(MIG_DIR, '021_invitations_v2_member_type_and_external_invitees')

async function pgReachable(): Promise<boolean> {
  const c = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}

describe('migration 021 — invitations v2 (integration)', () => {
  let reachable = false
  let knex: Knex

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable) {
      console.warn('Postgres unreachable — skipping migration 021 integration test')
      return
    }
    const admin = new Client({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.query(`CREATE DATABASE ${TEST_DB}`)
    await admin.end()
    knex = knexFactory({
      client: 'pg',
      connection: { host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB },
      migrations: {
        directory: MIG_DIR,
        loadExtensions: ['.ts'],
        tableName: 'knex_migrations',
      },
    })
    mockKnex = knex
  }, 60000)

  const cols = async (table: string) =>
    (await knex.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [table])).rows.map(
      (r: any) => r.column_name
    )

  it('runs the chain up to 020, seeds LEGACY rows, then 021 backfills safely', async () => {
    if (!reachable) return
    // Apply everything before 021.
    const all: string[] = require('fs')
      .readdirSync(MIG_DIR)
      .filter((f: string) => f.endsWith('.ts'))
      .sort()
    const before = all.filter(f => f < '021')
    for (const f of before) {
      const mod = require(path.join(MIG_DIR, f))
      await knex.transaction(async trx => {
        if ((mod.config && mod.config.transaction === false)) {
          // ALTER TYPE ... ADD VALUE cannot run in a transaction block
          await mod.up(knex)
        } else {
          await mod.up(trx)
        }
      })
    }

    const [{ id: userId }] = await knex('users').insert({ email: 'legacy@example.com' }).returning('id')
    const [{ id: orgId }] = await knex('organizations')
      .insert({ name: 'Legacy', slug: 'legacy-org', type: 'organization', owner_id: userId })
      .returning('id')
    await knex('organization_memberships').insert({ user_id: userId, organization_id: orgId, role: 'owner' })
    await knex('organization_invitations').insert({
      organization_id: orgId,
      email: 'old@example.com',
      token: 'legacy-token',
      expires_at: new Date(Date.now() + 86_400_000),
      invited_by: userId,
    })

    const m021 = require(M021)
    await m021.up(knex)

    const mem = await knex('organization_memberships').first()
    expect(mem.member_type).toBe('employee') // back-compat default
    const inv = await knex('organization_invitations').where('token', 'legacy-token').first()
    expect(inv).toMatchObject({ member_type: 'employee', channel: 'email', email: 'old@example.com', phone: null, invitee_user_id: null, bind_token: null })

    for (const c of ['member_type', 'channel', 'phone', 'invitee_user_id', 'bind_token', 'bind_token_expires_at']) {
      expect(await cols('organization_invitations')).toContain(c)
    }
    expect(await cols('organization_memberships')).toContain('member_type')
  }, 120000)

  it('is idempotent: up twice is a no-op', async () => {
    if (!reachable) return
    const m021 = require(M021)
    await expect(m021.up(knex)).resolves.toBeUndefined()
    await expect(m021.up(knex)).resolves.toBeUndefined()
  })

  it('CHECK: an email invite needs an email, a whatsapp invite needs a phone', async () => {
    if (!reachable) return
    const org = await knex('organizations').first()
    const base = { organization_id: org.id, expires_at: new Date(Date.now() + 1000) }
    await expect(
      knex('organization_invitations').insert({ ...base, token: 't-nomail', channel: 'email', email: null })
    ).rejects.toThrow(/organization_invitations_channel_identity_chk/)
    await expect(
      knex('organization_invitations').insert({ ...base, token: 't-nophone', channel: 'whatsapp', email: null, phone: null })
    ).rejects.toThrow(/organization_invitations_channel_identity_chk/)
    await expect(
      knex('organization_invitations').insert({ ...base, token: 't-wa', channel: 'whatsapp', email: null, phone: '+14155552671', member_type: 'customer' })
    ).resolves.toBeDefined()
    await expect(
      knex('organization_invitations').insert({ ...base, token: 't-bad-type', email: 'x@y.co', member_type: 'vip' as any })
    ).rejects.toThrow()
  })

  it('bind_token is unique among live carriers; NULLs are unconstrained', async () => {
    if (!reachable) return
    const org = await knex('organizations').first()
    const base = { organization_id: org.id, expires_at: new Date(Date.now() + 1000), email: 'b@y.co' }
    await knex('organization_invitations').insert({ ...base, token: 'bt-1', bind_token: 'digest-1' })
    await expect(
      knex('organization_invitations').insert({ ...base, token: 'bt-2', bind_token: 'digest-1' })
    ).rejects.toThrow(/organization_invitations_bind_token_uq/)
    await knex('organization_invitations').insert({ ...base, token: 'bt-3' })
    await knex('organization_invitations').insert({ ...base, token: 'bt-4' })
  })

  it('the accept CAS (the exact SQL the service runs) has a single winner and honours expiry', async () => {
    if (!reachable) return
    const org = await knex('organizations').first()
    const [{ id }] = await knex('organization_invitations')
      .insert({ organization_id: org.id, email: 'cas@y.co', token: 'cas-1', expires_at: new Date(Date.now() + 60_000), bind_token: 'to-clear' })
      .returning('id')
    const sql = `UPDATE organization_invitations
          SET status = 'accepted', bind_token = NULL, bind_token_expires_at = NULL
        WHERE id = ? AND status = 'pending' AND expires_at > now()
        RETURNING id`
    const results = await Promise.all([knex.raw(sql, [id]), knex.raw(sql, [id]), knex.raw(sql, [id])])
    expect(results.map(r => r.rowCount).sort()).toEqual([0, 0, 1])
    const row = await knex('organization_invitations').where({ id }).first()
    expect(row).toMatchObject({ status: 'accepted', bind_token: null })

    const [{ id: expired }] = await knex('organization_invitations')
      .insert({ organization_id: org.id, email: 'exp@y.co', token: 'cas-2', expires_at: new Date(Date.now() - 1000) })
      .returning('id')
    expect((await knex.raw(sql, [expired])).rowCount).toBe(0)
  })

  it('down() then up() round-trips and leaves legacy data intact', async () => {
    if (!reachable) return
    const m021 = require(M021)
    // Whatsapp (email-less) rows would keep `email` nullable on down; clear them for the round trip.
    await knex('organization_invitations').whereNull('email').delete()
    await m021.down(knex)
    expect(await cols('organization_invitations')).not.toContain('member_type')
    expect(await cols('organization_memberships')).not.toContain('member_type')
    expect(await knex('organization_invitations').where('token', 'legacy-token').first()).toBeDefined()
    await m021.up(knex)
    expect(await cols('organization_invitations')).toContain('channel')
  })
})

describe('invitations v2 service against REAL Postgres', () => {
  let reachable = false
  let knex: Knex
  let owner: string
  let org: string
  let sub: string
  let otherPortalOrg: string

  beforeAll(async () => {
    reachable = await pgReachable()
    if (!reachable || !mockKnex) return
    knex = mockKnex // built (and migrated through 021) by the describe above
    ;[{ id: owner }] = await knex('users').insert({ email: 'svc-owner@example.com' }).returning('id')
    const root = '00000000-0000-0000-0000-000000000010'
    await knex('organizations')
      .insert({ id: root, name: 'Root', slug: 'root-svc', type: 'platform', owner_id: owner })
      .onConflict('id')
      .ignore()
    ;[{ id: org }] = await knex('organizations')
      .insert({ name: 'Portal', slug: 'svc-portal', type: 'organization', owner_id: owner, parent_id: root })
      .returning('id')
    ;[{ id: sub }] = await knex('organizations')
      .insert({ name: 'Sub', slug: 'svc-sub', type: 'organization', owner_id: owner, parent_id: org })
      .returning('id')
    ;[{ id: otherPortalOrg }] = await knex('organizations')
      .insert({ name: 'Other', slug: 'svc-other', type: 'organization', owner_id: owner, parent_id: root })
      .returning('id')
  }, 60000)

  it('portalKeyOf resolves through the real recursive CTE', async () => {
    if (!reachable || !knex) return
    expect(await portalKeyOf(org)).toBe(org)
    expect(await portalKeyOf(sub)).toBe(org)
    expect(await portalKeyOf(otherPortalOrg)).toBe(otherPortalOrg)
  })

  it('cursor pagination walks rows that tie within one millisecond (microsecond cursor)', async () => {
    if (!reachable || !knex) return
    const stamps = [
      '2026-02-01 00:00:00.123456+00',
      '2026-02-01 00:00:00.123456+00', // exact tie -> id tiebreaker
      '2026-02-01 00:00:00.123457+00', // same millisecond, later microsecond
      '2026-02-01 00:00:00.123458+00',
      '2026-02-01 00:00:00.124000+00',
      '2026-02-01 00:00:00.123100+00',
      '2026-02-01 00:00:00.123999+00',
    ]
    const ids: string[] = []
    for (let i = 0; i < stamps.length; i++) {
      const [{ id }] = await knex('organization_invitations')
        .insert({
          organization_id: sub,
          email: `tie${i}@example.com`,
          token: `tie-${i}`,
          expires_at: new Date(Date.now() + 86_400_000),
          created_at: knex.raw('?::timestamptz', [stamps[i]]),
        })
        .returning('id')
      ids.push(id)
    }
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 10; i++) {
      const page = await listInvitations(sub, { limit: 2, cursor })
      seen.push(...page.rows.map(r => r.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(ids.length)
    expect(new Set(seen).size).toBe(ids.length)
    expect([...seen].sort()).toEqual([...ids].sort())
  })

  it('createInvitation persists v2 columns + the outbox event atomically (real transaction)', async () => {
    if (!reachable || !knex) return
    const ctx = { userId: owner, org: { id: org, name: 'Portal', owner_id: owner, parent_id: null }, isOwner: true }
    const invitee = { kind: 'external', channel: 'whatsapp', phone: '+14155552671' } as const
    const out = await createInvitation(ctx, { role: 'viewer', memberType: 'customer' }, invitee)
    expect(out.status).toBe('created')
    const row = await knex('organization_invitations').where('id', out.row.id).first()
    expect(row).toMatchObject({ channel: 'whatsapp', phone: '+14155552671', email: null, member_type: 'customer', role: 'viewer', status: 'pending' })
    const ev = await knex('event_outbox').where('topic', 'identity.invitation.created').orderBy('created_at', 'desc').first()
    expect(ev.payload).toMatchObject({ invitationId: out.row.id, phone: '+14155552671', memberType: 'customer' })
    const dup = await createInvitation(ctx, { role: 'viewer', memberType: 'customer' }, invitee)
    expect(dup).toMatchObject({ status: 'skipped', reason: 'already-pending' })
  })

  it('bindInvitation + redeemBindToken: membership gets role + member_type, events enqueued, single winner', async () => {
    if (!reachable || !knex) return
    const [{ id: newUser }] = await knex('users').insert({ email: 'bind-me@example.com' }).returning('id')
    const [{ id: invId }] = await knex('organization_invitations')
      .insert({
        organization_id: org,
        email: 'bind-me@example.com',
        token: 'bind-token-1',
        role: 'viewer',
        member_type: 'customer',
        expires_at: new Date(Date.now() + 86_400_000),
        invited_by: owner,
      })
      .returning('id')
    const inv = await knex('organization_invitations').where('id', invId).first()
    const bindToken = await issueBindToken(inv)
    expect((await knex('organization_invitations').where('id', invId).first()).bind_token).not.toBe(bindToken)

    const [a, b] = await Promise.all([
      redeemBindToken(bindToken, { id: newUser }),
      redeemBindToken(bindToken, { id: newUser }),
    ])
    expect([a.bound, b.bound].sort()).toEqual([false, true])
    const m = await knex('organization_memberships').where({ user_id: newUser, organization_id: org })
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ role: 'viewer', member_type: 'customer', status: 'active' })
    const topics = (await knex('event_outbox').select('topic').whereRaw(`payload->>'userId' = ?`, [newUser])).map((r: any) => r.topic)
    expect(topics).toEqual(expect.arrayContaining(['identity.invitation.accepted', 'identity.membership.added']))
    expect(await knex('organization_invitations').where('id', invId).first()).toMatchObject({ status: 'accepted', bind_token: null })
    expect((await bindInvitation(inv, newUser)).outcome).toBe('conflict')
  })
})

afterAll(async () => {
  if (mockKnex) await mockKnex.destroy()
})
