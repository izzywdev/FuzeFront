/**
 * Goal-5 regression suite: a product's AuthZ policy reaches Permit THROUGH the
 * platform, and a failure of that path is OBSERVABLE.
 *
 * The path under test is:
 *   product ships registration/policy.json (bare keys, never names Permit)
 *     -> register.sh PUTs it to /apps/{slug}/policy at deploy
 *       -> stored in apps.policy
 *         -> syncPermitSchemaFromRegistry() reads it, namespaces it, merges it into
 *            the base schema and pushes to Permit
 *
 * Every failure mode on the last leg is fail-soft ON PURPOSE. That is the right
 * design and these tests do not change it — they pin down that the outcome is
 * RECORDED, because fail-soft plus no signal means a dropped policy presents as
 * "this product's users have no permissions", which is indistinguishable from a bug
 * in the product. Nobody would look at the platform.
 */

import {
  syncPermitSchemaFromRegistry,
  loadRegisteredPolicyResult,
  getPermitSyncStatus,
  resetPermitSyncStatus,
  PermitSchemaClient,
  permitSchema,
} from '../src/permit/sync-permit-schema'
import {
  ProductPolicy,
  validateProductPolicy,
  ProductPolicyError,
  namespaceKey,
  PRODUCT_NS_SEP,
} from '../src/permit/product-policy'
import { fuzemarketPolicy } from '../src/permit/products/fuzemarket.policy'

// ── fakes ─────────────────────────────────────────────────────────────────────

function makeFakeClient(opts: { failOn?: string } = {}) {
  const created: any[] = []
  const createdRoles: any[] = []
  const client: PermitSchemaClient = {
    api: {
      resources: {
        get: async () => {
          throw new Error('not found')
        },
        create: async (def: any) => {
          if (opts.failOn && def.key === opts.failOn) throw new Error('permit exploded')
          created.push(def)
        },
        update: async () => undefined,
      },
      roles: {
        get: async () => {
          throw new Error('not found')
        },
        create: async (def: any) => {
          createdRoles.push(def)
        },
        update: async () => undefined,
      },
    },
  }
  return { client, created, createdRoles }
}

/**
 * The sync resolves `require('../config/database')` LAZILY so the module stays
 * import-safe without a DB. That is also what makes it stubbable here: the whole
 * registry read is replaced, so these cases run with no `apps` table and no
 * fixtures. `mockRegistryRows` may be a thrower, to simulate the DB being
 * unreachable — the case that previously looked identical to "no products".
 */
// eslint-disable-next-line prefer-const
let mockRegistryRows: any[] | (() => never) = []
jest.mock('../src/config/database', () => ({
  db: () => ({
    whereNotNull: () => ({
      whereNotNull: () => ({
        select: async () =>
          typeof mockRegistryRows === 'function' ? mockRegistryRows() : mockRegistryRows,
      }),
    }),
  }),
}))

function stubRegistry(rows: any[] | (() => never)) {
  mockRegistryRows = rows
}

const silent = () => undefined

const fuzeservicePolicy = {
  name: 'FuzeService',
  resources: [
    {
      key: 'Ticket',
      name: 'Ticket',
      actions: { read: { name: 'Read' }, transition: { name: 'Change status' } },
    },
  ],
  roles: [{ key: 'agent', name: 'Service Agent', permissions: ['Ticket:read', 'Ticket:transition'] }],
}

beforeEach(() => {
  resetPermitSyncStatus()
  mockRegistryRows = []
})

// ── the happy path a product actually depends on ──────────────────────────────

describe('a registered product policy reaches Permit without the product naming Permit', () => {
  it('namespaces bare keys as <slug>_<Key> and pushes them alongside the base schema', async () => {
    stubRegistry([{ slug: 'fuzeservice', policy: JSON.stringify(fuzeservicePolicy) }])
    const { client, created, createdRoles } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [], silent)

    expect(status.outcome).toBe('ok')
    expect(status.registeredProducts).toEqual(['fuzeservice'])
    expect(created.map(r => r.key)).toEqual(
      expect.arrayContaining(['Organization', 'fuzeservice_Ticket'])
    )
    const role = createdRoles.find(r => r.key === 'fuzeservice_agent')
    expect(role).toBeDefined()
    // Permissions are rewritten to the namespaced resource — the product wrote
    // `Ticket:read` and never had to know the namespace exists.
    expect(role.permissions).toEqual(['fuzeservice_Ticket:read', 'fuzeservice_Ticket:transition'])
  })

  it('takes the slug as authoritative, ignoring a `product` in the stored body', async () => {
    // Defence in depth: the route already 400s a mismatched `product`, but a row
    // written any other way must not be able to namespace itself into another
    // product's keyspace.
    stubRegistry([
      { slug: 'fuzeservice', policy: JSON.stringify({ ...fuzeservicePolicy, product: 'fuzesales' }) },
    ])
    const { client, created } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [], silent)

    expect(status.registeredProducts).toEqual(['fuzeservice'])
    expect(created.map(r => r.key)).toContain('fuzeservice_Ticket')
    expect(created.map(r => r.key)).not.toContain('fuzesales_Ticket')
  })

  it('accepts a policy row already parsed by the driver (jsonb), not only a string', async () => {
    stubRegistry([{ slug: 'fuzeservice', policy: fuzeservicePolicy }])
    const { client, created } = makeFakeClient()
    await syncPermitSchemaFromRegistry(client, [], silent)
    expect(created.map(r => r.key)).toContain('fuzeservice_Ticket')
  })
})

// ── legacy in-tree policy vs registered policy ────────────────────────────────

describe('a registered policy supersedes the legacy in-tree copy', () => {
  it('drops the legacy copy and syncs ONLY the registered one', async () => {
    // The dangerous case: fuzemarket has both a legacy backend/src/permit/products/
    // policy and (hypothetically) a registered one. mergeProductPolicy THROWS on a
    // namespaced-key collision, and that throw is caught fail-soft at boot — so a
    // broken supersede would not merely double-register fuzemarket, it would drop
    // the ENTIRE schema sync, base schema included, for every product.
    const registered = {
      name: 'FuzeMarket',
      resources: [{ key: 'Listing', name: 'Listing', actions: { read: { name: 'Read' } } }],
      roles: [{ key: 'seller', name: 'Seller', permissions: ['Listing:read'] }],
    }
    stubRegistry([{ slug: 'fuzemarket', policy: JSON.stringify(registered) }])
    const { client, created, createdRoles } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [fuzemarketPolicy], silent)

    expect(status.supersededLegacy).toEqual(['fuzemarket'])
    expect(status.legacyProducts).toEqual([])
    expect(status.registeredProducts).toEqual(['fuzemarket'])

    // Exactly one fuzemarket_Listing, and no key from the legacy policy that the
    // registered one does not declare (legacy declares Order and Cart too).
    expect(created.filter(r => r.key === 'fuzemarket_Listing')).toHaveLength(1)
    expect(created.map(r => r.key)).not.toContain('fuzemarket_Order')
    expect(created.map(r => r.key)).not.toContain('fuzemarket_Cart')
    expect(createdRoles.map(r => r.key)).not.toContain('fuzemarket_buyer')
  })

  it('keeps the legacy copy in force while the product has NOT registered one', async () => {
    stubRegistry([])
    const { client, created } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [fuzemarketPolicy], silent)

    expect(status.outcome).toBe('ok')
    expect(status.supersededLegacy).toEqual([])
    expect(status.legacyProducts).toEqual(['fuzemarket'])
    expect(created.map(r => r.key)).toContain('fuzemarket_Listing')
  })
})

// ── the crux: is a silent failure detectable? ─────────────────────────────────

describe('a sync that silently drops product policies is observable', () => {
  it('an unreadable registry is reported as registry_unavailable, NOT as "no products"', async () => {
    stubRegistry(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:5432')
    })
    const { client, created } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [], silent)

    // Fail-soft is preserved: the base schema still went out, the platform boots.
    expect(created.map(r => r.key)).toContain('Organization')
    // But the outcome is NOT 'ok', and the reason survives to the caller.
    expect(status.outcome).toBe('registry_unavailable')
    expect(status.error).toMatch(/ECONNREFUSED/)
    expect(status.registeredProducts).toEqual([])
    // Distinguishable from a genuinely empty registry, which is the whole point.
    expect(getPermitSyncStatus().outcome).toBe('registry_unavailable')
  })

  it('an empty registry is `ok` — not conflated with an outage', async () => {
    stubRegistry([])
    const { client } = makeFakeClient()
    const status = await syncPermitSchemaFromRegistry(client, [], silent)
    expect(status.outcome).toBe('ok')
    expect(status.error).toBeNull()
  })

  it('names the products whose stored policy was rejected, instead of only logging it', async () => {
    stubRegistry([
      { slug: 'fuzeservice', policy: JSON.stringify(fuzeservicePolicy) },
      // A role pointing at an action the policy never declares. Silent in Permit:
      // the role exists and grants nothing.
      {
        slug: 'fuzesales',
        policy: JSON.stringify({
          resources: [{ key: 'Order', name: 'Order', actions: { read: { name: 'Read' } } }],
          roles: [{ key: 'sales', name: 'Sales', permissions: ['Order:advance'] }],
        }),
      },
      { slug: 'fuzeplan', policy: '{ not json' },
    ])
    const { client, created } = makeFakeClient()

    const status = await syncPermitSchemaFromRegistry(client, [], silent)

    // One bad policy does not block the good ones — still fail-soft.
    expect(created.map(r => r.key)).toContain('fuzeservice_Ticket')
    expect(status.registeredProducts).toEqual(['fuzeservice'])
    // ...but the casualties are named.
    expect(status.rejectedProducts.map(r => r.slug).sort()).toEqual(['fuzeplan', 'fuzesales'])
    expect(status.rejectedProducts.find(r => r.slug === 'fuzesales')!.reason).toMatch(
      /unknown action "advance"/
    )
  })

  it('records sync_failed and re-throws when the push to Permit itself fails', async () => {
    stubRegistry([{ slug: 'fuzeservice', policy: JSON.stringify(fuzeservicePolicy) }])
    const { client } = makeFakeClient({ failOn: 'Organization' })

    await expect(syncPermitSchemaFromRegistry(client, [], silent)).rejects.toThrow('permit exploded')

    // Re-thrown so the CLI job can exit non-zero, AND recorded so the boot path
    // (which swallows it, deliberately) still has something to serve on /health.
    const status = getPermitSyncStatus()
    expect(status.outcome).toBe('sync_failed')
    expect(status.error).toMatch(/permit exploded/)
  })

  it('starts life as never_run, so "no sync has happened" is distinguishable too', () => {
    expect(getPermitSyncStatus().outcome).toBe('never_run')
    expect(getPermitSyncStatus().at).toBeNull()
  })

  it('counts what was actually pushed, so a shrinking schema is visible', async () => {
    stubRegistry([{ slug: 'fuzeservice', policy: JSON.stringify(fuzeservicePolicy) }])
    const { client } = makeFakeClient()
    const status = await syncPermitSchemaFromRegistry(client, [], silent)
    expect(status.resources).toBe(permitSchema.resources.length + 1)
    expect(status.roles).toBe(permitSchema.roles.length + 1)
  })
})

describe('loadRegisteredPolicyResult', () => {
  it('separates availability from emptiness', async () => {
    stubRegistry([])
    await expect(loadRegisteredPolicyResult(silent)).resolves.toMatchObject({
      available: true,
      policies: [],
      error: null,
    })
    stubRegistry(() => {
      throw new Error('relation "apps" does not exist')
    })
    await expect(loadRegisteredPolicyResult(silent)).resolves.toMatchObject({
      available: false,
      policies: [],
    })
  })
})

// ── the namespace separator invariant ─────────────────────────────────────────

describe('bare keys may not contain the namespace separator', () => {
  it('PRODUCT_NS_SEP is the underscore the ban is about', () => {
    expect(PRODUCT_NS_SEP).toBe('_')
    expect(namespaceKey('fuzekeys', 'VaultAsset')).toBe('fuzekeys_VaultAsset')
  })

  it.each(['Vault_Asset', 'my_role', '_Leading'])(
    'rejects "%s" — it would not split back into <product>_<Key>',
    bad => {
      const withResource: ProductPolicy = {
        product: 'fuzekeys',
        resources: [{ key: bad, name: bad, actions: { read: { name: 'Read' } } }],
        roles: [],
      }
      expect(() => validateProductPolicy(withResource)).toThrow(ProductPolicyError)

      const withRole: ProductPolicy = {
        product: 'fuzekeys',
        resources: [{ key: 'Asset', name: 'Asset', actions: { read: { name: 'Read' } } }],
        roles: [{ key: bad, name: bad, permissions: ['Asset:read'] }],
      }
      expect(() => validateProductPolicy(withRole)).toThrow(ProductPolicyError)
    }
  )

  it('still accepts hyphenated keys, which every shipped product policy uses', () => {
    expect(() =>
      validateProductPolicy({
        product: 'fuzedeploy',
        resources: [{ key: 'Deployment', name: 'Deployment', actions: { read: { name: 'Read' } } }],
        roles: [{ key: 'release-manager', name: 'Release Manager', permissions: ['Deployment:read'] }],
      })
    ).not.toThrow()
  })
})
