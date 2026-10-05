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
      ['App', 'Chat', 'DevPortalCatalog', 'DevPortalPlayground', 'Docs', 'Organization', 'SelectionList', 'SelectionListCatalog', 'ServiceEndpoint', 'UserManagement']
    )
    expect(permitSchema.roles.map(r => r.key).sort()).toEqual(['admin', 'developer', 'editor', 'viewer'])

    const org = permitSchema.resources.find(r => r.key === 'Organization')!
    expect(Object.keys(org.actions).sort()).toEqual(
      ['create', 'delete', 'manage', 'read', 'update']
    )
    const app = permitSchema.resources.find(r => r.key === 'App')!
    expect(Object.keys(app.actions).sort()).toEqual(
      ['create', 'delete', 'install', 'read', 'uninstall', 'update']
    )
    // creator: instance-scoped, direct-assignment-only role (app-builder ownership model).
    expect(Object.keys(app.roles ?? {})).toEqual(['creator'])
    expect(app.roles!.creator.permissions.sort()).toEqual(['install', 'read', 'uninstall', 'update'])
    expect(app.roles!.creator.permissions).not.toContain('delete')
    expect(app.roles!.creator.granted_to).toBeUndefined()
    const um = permitSchema.resources.find(r => r.key === 'UserManagement')!
    expect(Object.keys(um.actions).sort()).toEqual(
      ['invite', 'remove', 'update_role', 'view_members']
    )
    const docs = permitSchema.resources.find(r => r.key === 'Docs')!
    expect(Object.keys(docs.actions).sort()).toEqual(['read'])

    const chat = permitSchema.resources.find(r => r.key === 'Chat')!
    expect(Object.keys(chat.actions).sort()).toEqual(['manage', 'stream'])

    const serviceEndpoint = permitSchema.resources.find(r => r.key === 'ServiceEndpoint')!
    expect(Object.keys(serviceEndpoint.actions).sort()).toEqual(['invoke'])

    const devPortalCatalog = permitSchema.resources.find(r => r.key === 'DevPortalCatalog')!
    expect(Object.keys(devPortalCatalog.actions).sort()).toEqual(['read'])

    const devPortalPlayground = permitSchema.resources.find(r => r.key === 'DevPortalPlayground')!
    expect(Object.keys(devPortalPlayground.actions).sort()).toEqual(['use', 'view_history'])
  })

  it('developer role is scoped to the dev portal only, with no inherited platform access', () => {
    const developer = permitSchema.roles.find(r => r.key === 'developer')!
    expect(developer.permissions.sort()).toEqual(
      ['DevPortalCatalog:read', 'DevPortalPlayground:use', 'DevPortalPlayground:view_history']
    )
    expect(developer.permissions.some(p => /^(Organization|App|UserManagement|Docs|Chat):/.test(p))).toBe(false)
  })

  it('ServiceEndpoint declares a direct (non-derived) s2s-caller instance role scoped to invoke only', () => {
    const serviceEndpoint = permitSchema.resources.find(r => r.key === 'ServiceEndpoint')!
    const role = serviceEndpoint.roles?.['s2s-caller']
    expect(role).toBeDefined()
    expect(role!.permissions).toEqual(['invoke'])
    // No `granted_to` — unlike Organization's org-admin, this role is never
    // derived from a role held elsewhere; every grant is a deliberate,
    // individually-revocable assignment (see machine-roles.ts grantServiceInvoke).
    expect(role!.granted_to).toBeUndefined()

    // Not part of any top-level tenant role — a human's admin/editor/viewer role
    // must never imply ServiceEndpoint:invoke.
    for (const tenantRole of permitSchema.roles) {
      expect(tenantRole.permissions).not.toContain('ServiceEndpoint:invoke')
    }
  })

  describe('selection lists', () => {
    const LIST_ACTIONS = [
      'add_value', 'delete', 'manage_access', 'read', 'remove_value', 'translate', 'update', 'update_value',
    ]
    const ROLE_MATRIX: Record<string, string[]> = {
      'list-owner': LIST_ACTIONS,
      'list-editor': ['add_value', 'read', 'remove_value', 'translate', 'update', 'update_value'],
      'list-contributor': ['add_value', 'read', 'translate', 'update_value'],
      'list-translator': ['read', 'translate'],
      'list-viewer': ['read'],
    }

    it('SelectionList declares the eight per-list actions', () => {
      const list = permitSchema.resources.find(r => r.key === 'SelectionList')!
      expect(Object.keys(list.actions).sort()).toEqual(LIST_ACTIONS)
    })

    it('SelectionList declares exactly the five instance roles with the contract matrix', () => {
      const list = permitSchema.resources.find(r => r.key === 'SelectionList')!
      expect(Object.keys(list.roles ?? {}).sort()).toEqual(Object.keys(ROLE_MATRIX).sort())
      for (const [role, perms] of Object.entries(ROLE_MATRIX)) {
        expect([...list.roles![role].permissions].sort()).toEqual(perms)
        // every permission names a declared action
        for (const p of list.roles![role].permissions) expect(list.actions[p]).toBeDefined()
        // direct assignment only: never derived from a role held elsewhere
        expect(list.roles![role].granted_to).toBeUndefined()
      }
    })

    it('SelectionListCatalog declares the four tenant-level actions', () => {
      const cat = permitSchema.resources.find(r => r.key === 'SelectionListCatalog')!
      expect(Object.keys(cat.actions).sort()).toEqual(['create', 'list', 'read_quota', 'resolve'])
      expect(cat.roles).toBeUndefined()
    })

    it('tenant roles hold ZERO SelectionList:* actions (per-list access is instance-granted only)', () => {
      for (const tenantRole of permitSchema.roles) {
        expect(tenantRole.permissions.filter(p => p.startsWith('SelectionList:'))).toEqual([])
      }
    })

    it('tenant roles hold the catalog actions per the matrix (developer: none)', () => {
      const catalog = (key: string) =>
        permitSchema.roles.find(r => r.key === key)!.permissions
          .filter(p => p.startsWith('SelectionListCatalog:')).map(p => p.split(':')[1]).sort()
      expect(catalog('admin')).toEqual(['create', 'list', 'read_quota', 'resolve'])
      expect(catalog('editor')).toEqual(['create', 'list', 'resolve'])
      expect(catalog('viewer')).toEqual(['list', 'resolve'])
      expect(catalog('developer')).toEqual([])
    })

    it('every tenant role permission references a declared resource and action', () => {
      for (const role of permitSchema.roles) {
        for (const p of role.permissions) {
          const [resKey, act] = p.split(':')
          const res = permitSchema.resources.find(r => r.key === resKey)
          expect(res).toBeDefined()
          expect(res!.actions[act]).toBeDefined()
        }
      }
    })

    it('syncs both selection-list resources (and instance roles) to Permit', async () => {
      const { client, calls } = makeFakeClient({ resources: [], roles: [] })
      await syncPermitSchema(client)
      const created = calls.resourceCreate.map((c: any) => c.key)
      expect(created).toEqual(expect.arrayContaining(['SelectionList', 'SelectionListCatalog']))
      const listDef = calls.resourceCreate.find((c: any) => c.key === 'SelectionList')
      expect(Object.keys(listDef.roles).sort()).toEqual(Object.keys(ROLE_MATRIX).sort())
    })
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
    expect(calls.resourceCreate.map(r => r.key).sort()).toEqual(['App', 'Chat', 'DevPortalCatalog', 'DevPortalPlayground', 'Docs', 'Organization', 'SelectionList', 'SelectionListCatalog', 'ServiceEndpoint', 'UserManagement'])
    expect(calls.roleCreate.map(r => r.key).sort()).toEqual(['admin', 'developer', 'editor', 'viewer'])
    expect(calls.resourceUpdate).toHaveLength(0)
    expect(calls.roleUpdate).toHaveLength(0)
  })

  it('updates resources and roles when they already exist (idempotent: update path)', async () => {
    const { client, calls } = makeFakeClient({
      resources: ['App', 'Chat', 'DevPortalCatalog', 'DevPortalPlayground', 'Docs', 'Organization', 'SelectionList', 'SelectionListCatalog', 'ServiceEndpoint', 'UserManagement'],
      roles: ['admin', 'developer', 'editor', 'viewer'],
    })
    await syncPermitSchema(client)
    expect(calls.resourceCreate).toHaveLength(0)
    expect(calls.roleCreate).toHaveLength(0)
    expect(calls.resourceUpdate.map(r => r.key).sort()).toEqual(['App', 'Chat', 'DevPortalCatalog', 'DevPortalPlayground', 'Docs', 'Organization', 'SelectionList', 'SelectionListCatalog', 'ServiceEndpoint', 'UserManagement'])
    expect(calls.roleUpdate.map(r => r.key).sort()).toEqual(['admin', 'developer', 'editor', 'viewer'])
  })
})
