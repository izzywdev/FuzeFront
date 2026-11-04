import { up } from '../src/migrations/022_executive_root_org_private'

const ROOT = '00000000-0000-0000-0000-000000000010'

function fakeKnex(row: any | undefined) {
  const state = { row, patch: undefined as any }
  const knex: any = (table: string) => {
    if (table !== 'apps') throw new Error(`unexpected table ${table}`)
    return {
      where: (col: string, val: string) => ({
        first: async () => (col === 'slug' && state.row?.slug === val ? state.row : undefined),
        update: async (patch: any) => {
          state.patch = patch
          Object.assign(state.row, patch)
          return 1
        },
      }),
    }
  }
  return { knex, state }
}

describe('migration 022 — executive is a root-org-owned private app', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('sets organization_id=ROOT and visibility=private on column AND manifest', async () => {
    const { knex, state } = fakeKnex({
      id: 'a1',
      slug: 'executive',
      organization_id: 'some-org',
      visibility: 'organization',
      manifest: JSON.stringify({ slug: 'executive', visibility: 'organization' }),
    })
    await up(knex)
    expect(state.patch.organization_id).toBe(ROOT)
    expect(state.patch.visibility).toBe('private')
    expect(JSON.parse(state.patch.manifest).visibility).toBe('private')
  })

  it('is idempotent', async () => {
    const { knex, state } = fakeKnex({
      id: 'a1', slug: 'executive', organization_id: ROOT, visibility: 'private',
      manifest: { visibility: 'private' },
    })
    await up(knex)
    await up(knex)
    expect(state.row.organization_id).toBe(ROOT)
    expect(state.row.visibility).toBe('private')
  })

  it('is a no-op when the app is absent', async () => {
    const { knex, state } = fakeKnex(undefined)
    await up(knex)
    expect(state.patch).toBeUndefined()
  })
})
