import { permitSchema } from '../src/permit/schema'
import { syncPermitSchema, PermitSchemaClient } from '../src/permit/sync-permit-schema'

// Fake control-plane client that also records relation list/create calls.
function makeFakeClient(existing: {
  resources?: string[]
  roles?: string[]
  relations?: Record<string, string[]> // subjectResource -> existing relation keys
}) {
  const calls = {
    relationCreate: [] as Array<{ subjectResource: string; def: any }>,
  }
  const relations = existing.relations ?? {}
  const client: PermitSchemaClient = {
    api: {
      resources: {
        get: async (key: string) => {
          if (!(existing.resources ?? []).includes(key)) throw new Error('not found')
          return { key }
        },
        create: async () => undefined,
        update: async () => undefined,
      },
      roles: {
        get: async (key: string) => {
          if (!(existing.roles ?? []).includes(key)) throw new Error('not found')
          return { key }
        },
        create: async () => undefined,
        update: async () => undefined,
      },
      resourceRelations: {
        list: async (subjectResource: string) =>
          (relations[subjectResource] ?? []).map(key => ({ key })),
        create: async (subjectResource: string, def: any) => {
          calls.relationCreate.push({ subjectResource, def })
        },
      },
    },
  }
  return { client, calls }
}

describe('permit agent-identity schema', () => {
  it('declares Agent and User resource types with no actions', () => {
    const agent = permitSchema.resources.find(r => r.key === 'Agent')!
    const user = permitSchema.resources.find(r => r.key === 'User')!
    expect(agent).toBeDefined()
    expect(user).toBeDefined()
    expect(Object.keys(agent.actions)).toEqual([])
    expect(Object.keys(user.actions)).toEqual([])
  })

  it('declares exactly the Agent —delegate_of→ User relation', () => {
    expect(permitSchema.relations).toBeDefined()
    expect(permitSchema.relations!.map(r => r.key)).toEqual(['delegate_of'])
    const rel = permitSchema.relations![0]
    expect(rel.subject_resource).toBe('Agent')
    expect(rel.object_resource).toBe('User')
  })

  it('does NOT grant any role permissions on Agent/User resources (reach is the delegating user)', () => {
    const all = permitSchema.roles.flatMap(r => r.permissions)
    expect(all.some(p => p.startsWith('Agent:'))).toBe(false)
    expect(all.some(p => p.startsWith('User:'))).toBe(false)
  })

  it('creates the delegate_of relation when absent (idempotent: create path)', async () => {
    const { client, calls } = makeFakeClient({
      resources: [],
      roles: [],
      relations: {},
    })
    await syncPermitSchema(client)
    expect(calls.relationCreate).toHaveLength(1)
    expect(calls.relationCreate[0].subjectResource).toBe('Agent')
    expect(calls.relationCreate[0].def).toMatchObject({
      key: 'delegate_of',
      subject_resource: 'Agent',
      object_resource: 'User',
    })
  })

  it('skips creating the delegate_of relation when it already exists', async () => {
    const { client, calls } = makeFakeClient({
      resources: [],
      roles: [],
      relations: { Agent: ['delegate_of'] },
    })
    await syncPermitSchema(client)
    expect(calls.relationCreate).toHaveLength(0)
  })

  it('skips relations entirely when the client has no relation support', async () => {
    // A client whose api lacks resourceRelations must not throw.
    const client: PermitSchemaClient = {
      api: {
        resources: { get: async () => { throw new Error('x') }, create: async () => undefined, update: async () => undefined },
        roles: { get: async () => { throw new Error('x') }, create: async () => undefined, update: async () => undefined },
      },
    }
    await expect(syncPermitSchema(client)).resolves.toBeUndefined()
  })
})
