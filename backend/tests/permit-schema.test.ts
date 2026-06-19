import { permitSchema, syncPermitSchema, PermitSchemaClient } from '../src/permit/sync-permit-schema'

// A minimal fake of the permitio control-plane client surface we use.
function makeFakeClient(existing: { resources: string[]; roles: string[] }) {
  const calls = {
    resourceCreate: [] as any[],
    resourceUpdate: [] as any[],
    roleCreate: [] as any[],
    roleUpdate: [] as any[],
  }
  const client: PermitSchemaClient = {
    api: {
      resources: {
        get: async (key: string) => {
          if (!existing.resources.includes(key)) throw new Error('not found')
          return { key }
        },
        create: async (def: any) => { calls.resourceCreate.push(def) },
        update: async (key: string, def: any) => { calls.resourceUpdate.push({ key, def }) },
      },
      roles: {
        get: async (key: string) => {
          if (!existing.roles.includes(key)) throw new Error('not found')
          return { key }
        },
        create: async (def: any) => { calls.roleCreate.push(def) },
        update: async (key: string, def: any) => { calls.roleUpdate.push({ key, def }) },
      },
    },
  }
  return { client, calls }
}

describe('permit schema IaC', () => {
  it('defines exactly the resources and roles the code references', () => {
    expect(permitSchema.resources.map(r => r.key).sort()).toEqual(
      ['App', 'Chat', 'Docs', 'Organization', 'UserManagement']
    )
    expect(permitSchema.roles.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])

    const org = permitSchema.resources.find(r => r.key === 'Organization')!
    expect(Object.keys(org.actions).sort()).toEqual(
      ['create', 'delete', 'manage', 'read', 'update']
    )
    const app = permitSchema.resources.find(r => r.key === 'App')!
    expect(Object.keys(app.actions).sort()).toEqual(
      ['create', 'delete', 'install', 'read', 'uninstall', 'update']
    )
    const um = permitSchema.resources.find(r => r.key === 'UserManagement')!
    expect(Object.keys(um.actions).sort()).toEqual(
      ['invite', 'remove', 'update_role', 'view_members']
    )
    const docs = permitSchema.resources.find(r => r.key === 'Docs')!
    expect(Object.keys(docs.actions).sort()).toEqual(['read'])

    const chat = permitSchema.resources.find(r => r.key === 'Chat')!
    expect(Object.keys(chat.actions).sort()).toEqual(['manage', 'stream'])
  })

  it('admin role can manage organizations and user management', () => {
    const admin = permitSchema.roles.find(r => r.key === 'admin')!
    expect(admin.permissions).toContain('Organization:manage')
    expect(admin.permissions).toContain('UserManagement:invite')
    expect(admin.permissions).toContain('App:delete')
  })

  it('viewer role is read-only (no write/manage perms for org/app/user resources)', () => {
    const viewer = permitSchema.roles.find(r => r.key === 'viewer')!
    expect(viewer.permissions).toContain('Organization:read')
    expect(viewer.permissions).toContain('App:read')
    expect(viewer.permissions.some(p => /:(create|update|delete|manage|invite|remove|update_role)$/.test(p))).toBe(false)
  })

  it('admin gets Docs:read, Chat:stream, and Chat:manage', () => {
    const admin = permitSchema.roles.find(r => r.key === 'admin')!
    expect(admin.permissions).toContain('Docs:read')
    expect(admin.permissions).toContain('Chat:stream')
    expect(admin.permissions).toContain('Chat:manage')
  })

  it('editor gets Docs:read and Chat:stream but not Chat:manage', () => {
    const editor = permitSchema.roles.find(r => r.key === 'editor')!
    expect(editor.permissions).toContain('Docs:read')
    expect(editor.permissions).toContain('Chat:stream')
    expect(editor.permissions).not.toContain('Chat:manage')
  })

  it('viewer gets Docs:read and Chat:stream but not Chat:manage', () => {
    const viewer = permitSchema.roles.find(r => r.key === 'viewer')!
    expect(viewer.permissions).toContain('Docs:read')
    expect(viewer.permissions).toContain('Chat:stream')
    expect(viewer.permissions).not.toContain('Chat:manage')
  })

  it('creates resources and roles when none exist (idempotent: create path)', async () => {
    const { client, calls } = makeFakeClient({ resources: [], roles: [] })
    await syncPermitSchema(client)
    expect(calls.resourceCreate.map(r => r.key).sort()).toEqual(['App', 'Chat', 'Docs', 'Organization', 'UserManagement'])
    expect(calls.roleCreate.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])
    expect(calls.resourceUpdate).toHaveLength(0)
    expect(calls.roleUpdate).toHaveLength(0)
  })

  it('updates resources and roles when they already exist (idempotent: update path)', async () => {
    const { client, calls } = makeFakeClient({
      resources: ['App', 'Chat', 'Docs', 'Organization', 'UserManagement'],
      roles: ['admin', 'editor', 'viewer'],
    })
    await syncPermitSchema(client)
    expect(calls.resourceCreate).toHaveLength(0)
    expect(calls.roleCreate).toHaveLength(0)
    expect(calls.resourceUpdate.map(r => r.key).sort()).toEqual(['App', 'Chat', 'Docs', 'Organization', 'UserManagement'])
    expect(calls.roleUpdate.map(r => r.key).sort()).toEqual(['admin', 'editor', 'viewer'])
  })
})
