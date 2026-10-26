/**
 * Unit tests (no database) for the org-list visibility rule
 * (services/orgListVisibility.ts) and its kill-switch flag
 * (utils/orgListDirectOnlyFlag.ts). The end-to-end behavior against real rows
 * is proven by organizations.list.visibility.integration.test.ts.
 */
import knex from 'knex'

jest.mock('../src/config/database', () => ({ db: jest.fn() }))
jest.mock('../src/utils/permit/role-assignment', () => ({
  userHasRole: jest.fn().mockResolvedValue(false),
}))

import {
  applyOrgListVisibility,
  viewerSeesRootOrg,
} from '../src/services/orgListVisibility'
import { ORG_LIST_DIRECT_ONLY_FLAG } from '../src/utils/orgListDirectOnlyFlag'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'

const qb = knex({ client: 'pg' })

function sqlFor(seesRoot: boolean) {
  const q = qb('organizations').select('organizations.*')
  applyOrgListVisibility(q, { userId: 'u-1', seesRoot }, qb)
  return q.toSQL().toNative()
}

describe('applyOrgListVisibility (SQL shape)', () => {
  it('non-staff: direct active membership required AND root + platform excluded', () => {
    const { sql, bindings } = sqlFor(false)
    expect(sql).toContain('"organization_memberships" as "om2"')
    expect(sql).toContain('"om2"."user_id" =')
    expect(sql).toContain('"om2"."status" =')
    expect(bindings).toEqual(expect.arrayContaining(['u-1', 'active', ROOT_ORG_ID]))
    // root excluded by id and by the reserved platform marker
    expect(sql).toContain('"organizations"."id" <>')
    expect(sql).toContain("organizations.type::text IS DISTINCT FROM 'platform'")
    // and NOT pulled back in by an OR on the root id
    expect(sql).not.toMatch(/or "organizations"\."id" =/)
  })

  it('never walks parent_id, so no ancestor can surface structurally', () => {
    expect(sqlFor(false).sql).not.toMatch(/parent_id/)
    expect(sqlFor(true).sql).not.toMatch(/parent_id/)
  })

  it('staff / kill-switch OFF: direct memberships OR the root org by id', () => {
    const { sql, bindings } = sqlFor(true)
    expect(sql).toMatch(/or "organizations"\."id" =/)
    expect(bindings).toContain(ROOT_ORG_ID)
    expect(sql).not.toContain('IS DISTINCT FROM')
  })
})

describe('viewerSeesRootOrg (fail-safe staff resolution)', () => {
  const dbReturning = (row: any) => {
    const chain: any = {
      where: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    }
    const database: any = jest.fn(() => chain)
    return { database, chain }
  }

  it('employee marker -> sees root, with no DB round trip', async () => {
    const { database } = dbReturning(undefined)
    await expect(
      viewerSeesRootOrg({ userId: 'u', roles: ['employee'] }, database)
    ).resolves.toBe(true)
    await expect(
      viewerSeesRootOrg({ userId: 'u', roles: ['admin'] }, database)
    ).resolves.toBe(true)
    expect(database).not.toHaveBeenCalled()
  })

  it('root owner/admin membership -> sees root', async () => {
    const { database, chain } = dbReturning({ id: 'm1' })
    await expect(
      viewerSeesRootOrg({ userId: 'u', roles: ['user'] }, database)
    ).resolves.toBe(true)
    expect(chain.whereIn).toHaveBeenCalledWith('role', ['owner', 'admin'])
  })

  it('plain member -> does not see root', async () => {
    const { database } = dbReturning(undefined)
    await expect(
      viewerSeesRootOrg({ userId: 'u', roles: ['user'] }, database)
    ).resolves.toBe(false)
  })

  it('FAIL SAFE: a lookup error hides root rather than leaking it', async () => {
    const database: any = jest.fn(() => {
      throw new Error('db down')
    })
    await expect(
      viewerSeesRootOrg({ userId: 'u', roles: ['user'] }, database)
    ).resolves.toBe(false)
  })

  it('malformed / absent roles are treated as non-staff', async () => {
    const { database } = dbReturning(undefined)
    await expect(viewerSeesRootOrg({ userId: 'u', roles: null }, database)).resolves.toBe(false)
    await expect(viewerSeesRootOrg({ userId: 'u', roles: 'not json' }, database)).resolves.toBe(false)
  })
})

describe('isOrgListDirectOnlyEnabled (ops-kill-switch, default ON)', () => {
  afterEach(() => {
    jest.resetModules()
  })

  async function withFlagsClient(client: any) {
    jest.resetModules()
    jest.doMock('@fuzefront/feature-flags', () => ({ getClient: () => client }), {
      virtual: true,
    })
    return (await import('../src/utils/orgListDirectOnlyFlag')).isOrgListDirectOnlyEnabled
  }

  it('is named per the <repo>.<domain>.<flag> convention', () => {
    expect(ORG_LIST_DIRECT_ONLY_FLAG).toBe(
      'fuzefront.identity.org-list-direct-only-kill-switch'
    )
  })

  it('defaults ON when the flags client is unavailable', async () => {
    jest.resetModules()
    jest.doMock(
      '@fuzefront/feature-flags',
      () => {
        throw new Error('not installed')
      },
      { virtual: true }
    )
    const fn = (await import('../src/utils/orgListDirectOnlyFlag')).isOrgListDirectOnlyEnabled
    await expect(fn({ userId: 'u' })).resolves.toBe(true)
  })

  it('ON path: honours an ON evaluation and passes the in-code default true', async () => {
    const getBooleanValue = jest.fn().mockResolvedValue(true)
    const fn = await withFlagsClient({ getBooleanValue })
    await expect(fn({ userId: 'u-1' })).resolves.toBe(true)
    expect(getBooleanValue).toHaveBeenCalledWith(
      ORG_LIST_DIRECT_ONLY_FLAG,
      true,
      expect.objectContaining({ app: 'fuzefront-security', userId: 'u-1' })
    )
  })

  it('OFF path: honours a kill (flag flipped OFF)', async () => {
    const fn = await withFlagsClient({
      getBooleanValue: jest.fn().mockResolvedValue(false),
    })
    await expect(fn({ userId: 'u-1' })).resolves.toBe(false)
  })

  it('an evaluation error fails safe to ON (filter stays active)', async () => {
    const fn = await withFlagsClient({
      getBooleanValue: jest.fn().mockRejectedValue(new Error('unleash down')),
    })
    await expect(fn({ userId: 'u-1' })).resolves.toBe(true)
  })
})
