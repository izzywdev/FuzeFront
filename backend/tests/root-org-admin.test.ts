import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import { ensureRootOrgAdmins } from '../src/services/rootOrgAdmin'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

beforeAll(() => {
  initializeDatabaseConnection()
})

function recorder() {
  const calls: Array<{ userId: string; orgId: string }> = []
  return {
    calls,
    assignOrgAdmin: async (userId: string, orgId: string) => {
      calls.push({ userId, orgId })
      return true
    },
  }
}

async function createUser(roles: string[]): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `roa-${id.slice(0, 8)}@test.local`,
    first_name: 'Root',
    last_name: 'Admin',
    roles: JSON.stringify(roles),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

describe('ensureRootOrgAdmins', () => {
  it('grants root org-admin to admin users', async () => {
    const adminId = await createUser(['admin', 'user'])
    const rec = recorder()

    const granted = await ensureRootOrgAdmins({
      db,
      assignOrgAdmin: rec.assignOrgAdmin,
    })

    expect(granted).toContain(adminId)
    expect(rec.calls).toContainEqual({ userId: adminId, orgId: ROOT_ORG_ID })
  })

  it('does not grant to non-admin users', async () => {
    const plainId = await createUser(['user'])
    const rec = recorder()

    await ensureRootOrgAdmins({ db, assignOrgAdmin: rec.assignOrgAdmin })

    expect(rec.calls.map(c => c.userId)).not.toContain(plainId)
  })

  // SECURITY: platform-registrar is a token-only service principal created by
  // migration 014 with roles ['admin','user'] and no password_hash. Granting it
  // tree-wide org-admin would give every holder of a sealed registration token
  // administrative authority over every tenant.
  it('never grants to the platform-registrar service principal', async () => {
    const registrar = await db('users')
      .where({ id: PLATFORM_REGISTRAR_ID })
      .first()
    expect(registrar).toBeTruthy() // seeded by migration 014
    expect(String(registrar.roles)).toContain('admin')

    const rec = recorder()
    const granted = await ensureRootOrgAdmins({
      db,
      assignOrgAdmin: rec.assignOrgAdmin,
    })

    expect(granted).not.toContain(PLATFORM_REGISTRAR_ID)
    expect(rec.calls.map(c => c.userId)).not.toContain(PLATFORM_REGISTRAR_ID)
  })

  // One Permit hiccup must not leave the remaining administrators ungranted.
  it('keeps going when one grant throws', async () => {
    const a = await createUser(['admin'])
    const b = await createUser(['admin'])
    const seen: string[] = []

    const granted = await ensureRootOrgAdmins({
      db,
      assignOrgAdmin: async (userId: string) => {
        seen.push(userId)
        if (userId === a) throw new Error('permit down')
        return true
      },
    })

    expect(seen).toEqual(expect.arrayContaining([a, b]))
    expect(granted).toContain(b)
    expect(granted).not.toContain(a)
  })
})
