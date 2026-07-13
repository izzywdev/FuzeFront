import {
  permitSchema,
  syncPermitSchema,
  PermitSchemaClient,
} from '../src/permit/sync-permit-schema'
import {
  ProductPolicy,
  validateProductPolicy,
  namespaceProductPolicy,
  mergeProductPolicy,
  buildEnvSchema,
  namespaceKey,
  ProductPolicyError,
  PRODUCT_NS_SEP,
} from '../src/permit/product-policy'
import { fuzemarketPolicy } from '../src/permit/products/fuzemarket.policy'
import { mendysDatasetsPolicy } from '../src/permit/products/mendys-datasets.policy'

// Same fake control-plane client as permit-schema.test.ts, extended to capture
// the full payloads (so we can assert ReBAC relations/roles are forwarded).
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

const sample: ProductPolicy = {
  product: 'fuzemarket',
  name: 'FuzeMarket',
  resources: [
    { key: 'Listing', name: 'Listing', actions: { create: { name: 'Create' }, read: { name: 'Read' } } },
  ],
  roles: [
    { key: 'seller', name: 'Seller', permissions: ['Listing:create', 'Listing:read'] },
  ],
}

describe('namespaceKey', () => {
  it('joins product and bare key with the namespace separator', () => {
    expect(namespaceKey('fuzemarket', 'Listing')).toBe(`fuzemarket${PRODUCT_NS_SEP}Listing`)
    expect(namespaceKey('fuzemarket', 'seller')).toBe('fuzemarket_seller')
  })
})

describe('validateProductPolicy', () => {
  it('accepts a well-formed policy', () => {
    expect(() => validateProductPolicy(sample)).not.toThrow()
  })

  it('rejects an invalid product key', () => {
    expect(() => validateProductPolicy({ ...sample, product: 'Fuze Market' }))
      .toThrow(ProductPolicyError)
  })

  it('rejects a role referencing an undeclared resource', () => {
    expect(() => validateProductPolicy({
      ...sample,
      roles: [{ key: 'seller', name: 'Seller', permissions: ['Ghost:create'] }],
    })).toThrow(/unknown resource "Ghost"/)
  })

  it('rejects a role referencing an undeclared action', () => {
    expect(() => validateProductPolicy({
      ...sample,
      roles: [{ key: 'seller', name: 'Seller', permissions: ['Listing:delete'] }],
    })).toThrow(/unknown action "delete"/)
  })

  it('rejects duplicate resource keys', () => {
    expect(() => validateProductPolicy({
      ...sample,
      resources: [
        { key: 'Listing', name: 'A', actions: { read: { name: 'Read' } } },
        { key: 'Listing', name: 'B', actions: { read: { name: 'Read' } } },
      ],
    })).toThrow(/Duplicate resource/)
  })
})

describe('namespaceProductPolicy', () => {
  it('namespaces resource keys, role keys, and permission resource refs', () => {
    const ns = namespaceProductPolicy(sample)
    expect(ns.resources.map(r => r.key)).toEqual(['fuzemarket_Listing'])
    expect(ns.roles.map(r => r.key)).toEqual(['fuzemarket_seller'])
    expect(ns.roles[0].permissions).toEqual([
      'fuzemarket_Listing:create',
      'fuzemarket_Listing:read',
    ])
  })

  it('prefixes display names with the product name', () => {
    const ns = namespaceProductPolicy(sample)
    expect(ns.resources[0].name).toBe('FuzeMarket Listing')
    expect(ns.roles[0].name).toBe('FuzeMarket Seller')
  })
})

describe('mergeProductPolicy', () => {
  it('appends namespaced product resources/roles to the base schema (base untouched)', () => {
    const baseResourceCount = permitSchema.resources.length
    const baseRoleCount = permitSchema.roles.length
    const merged = mergeProductPolicy(permitSchema, sample)

    expect(merged.resources.map(r => r.key)).toContain('Organization')
    expect(merged.resources.map(r => r.key)).toContain('fuzemarket_Listing')
    expect(merged.roles.map(r => r.key)).toContain('fuzemarket_seller')
    // base unchanged
    expect(permitSchema.resources).toHaveLength(baseResourceCount)
    expect(permitSchema.roles).toHaveLength(baseRoleCount)
  })

  it('does not collide two different products that share bare keys', () => {
    const other: ProductPolicy = { ...sample, product: 'fuzeshop', name: 'FuzeShop' }
    const merged = mergeProductPolicy(permitSchema, sample, other)
    expect(merged.resources.map(r => r.key)).toEqual(
      expect.arrayContaining(['fuzemarket_Listing', 'fuzeshop_Listing'])
    )
    expect(merged.roles.map(r => r.key)).toEqual(
      expect.arrayContaining(['fuzemarket_seller', 'fuzeshop_seller'])
    )
  })

  it('throws on a re-used product namespace (same key twice)', () => {
    expect(() => mergeProductPolicy(permitSchema, sample, sample))
      .toThrow(/collision/)
  })
})

describe('base schema ReBAC (FuzeOne root → child)', () => {
  it('Organization declares a self parent relation and a derived org-admin role', () => {
    const org = permitSchema.resources.find(r => r.key === 'Organization')!
    expect(org.relations).toEqual({ parent: 'Organization' })
    const derived = org.roles!['org-admin']
    expect(derived.granted_to!.users_with_role[0]).toEqual({
      role: 'org-admin',
      on_resource: 'Organization',
      linked_by_relation: 'parent',
    })
  })
})

describe('syncPermitSchemaWithProducts (via merged schema)', () => {
  it('creates base + namespaced product resources and roles', async () => {
    const { client, calls } = makeFakeClient({ resources: [], roles: [] })
    await syncPermitSchema(client, buildEnvSchema(sample))
    expect(calls.resourceCreate.map(r => r.key)).toEqual(
      expect.arrayContaining(['Organization', 'App', 'fuzemarket_Listing'])
    )
    expect(calls.roleCreate.map(r => r.key)).toEqual(
      expect.arrayContaining(['admin', 'fuzemarket_seller'])
    )
  })

  it('syncs the registered consumer products (fuzemarket + mendys-datasets) side by side', async () => {
    const { client, calls } = makeFakeClient({ resources: [], roles: [] })
    await syncPermitSchema(client, buildEnvSchema(fuzemarketPolicy, mendysDatasetsPolicy))
    expect(calls.resourceCreate.map(r => r.key)).toEqual(
      expect.arrayContaining([
        'fuzemarket_Listing',
        'mendys-datasets_Dataset',
        'mendys-datasets_TalentProfile',
        'mendys-datasets_Order',
        'mendys-datasets_Equipment',
        'mendys-datasets_Report',
      ])
    )
    expect(calls.roleCreate.map(r => r.key)).toEqual(
      expect.arrayContaining([
        'fuzemarket_buyer',
        'mendys-datasets_talent',
        'mendys-datasets_buyer',
        'mendys-datasets_admin',
      ])
    )
  })

  it('forwards ReBAC relations + resource roles on the Organization update path', async () => {
    const { client, calls } = makeFakeClient({
      resources: permitSchema.resources.map(r => r.key),
      roles: permitSchema.roles.map(r => r.key),
    })
    await syncPermitSchema(client)
    const orgUpdate = calls.resourceUpdate.find(u => u.key === 'Organization')!
    expect(orgUpdate.def.relations).toEqual({ parent: 'Organization' })
    expect(orgUpdate.def.roles['org-admin']).toBeDefined()
    // Flat resources don't get spurious relations/roles fields.
    const docsUpdate = calls.resourceUpdate.find(u => u.key === 'Docs')!
    expect(docsUpdate.def.relations).toBeUndefined()
    expect(docsUpdate.def.roles).toBeUndefined()
  })
})

describe('FuzeMarket sample policy', () => {
  it('is a valid product policy', () => {
    expect(() => validateProductPolicy(fuzemarketPolicy)).not.toThrow()
  })

  it('declares Listing/Order/Cart and seller/buyer/market-admin', () => {
    expect(fuzemarketPolicy.resources.map(r => r.key).sort()).toEqual(['Cart', 'Listing', 'Order'])
    expect(fuzemarketPolicy.roles.map(r => r.key).sort()).toEqual(['buyer', 'market-admin', 'seller'])
  })

  it('buyer cannot create or publish listings; seller can', () => {
    const buyer = fuzemarketPolicy.roles.find(r => r.key === 'buyer')!
    const seller = fuzemarketPolicy.roles.find(r => r.key === 'seller')!
    expect(buyer.permissions).not.toContain('Listing:create')
    expect(buyer.permissions).not.toContain('Listing:publish')
    expect(seller.permissions).toContain('Listing:publish')
  })

  it('market-admin can refund orders', () => {
    const admin = fuzemarketPolicy.roles.find(r => r.key === 'market-admin')!
    expect(admin.permissions).toContain('Order:refund')
  })
})

describe('MendysRobotics datasets policy', () => {
  it('is a valid product policy', () => {
    expect(() => validateProductPolicy(mendysDatasetsPolicy)).not.toThrow()
  })

  it('declares Dataset/TalentProfile/Order/Equipment/Report and talent/buyer/admin', () => {
    expect(mendysDatasetsPolicy.product).toBe('mendys-datasets')
    expect(mendysDatasetsPolicy.resources.map(r => r.key).sort()).toEqual(
      ['Dataset', 'Equipment', 'Order', 'Report', 'TalentProfile']
    )
    expect(mendysDatasetsPolicy.roles.map(r => r.key).sort()).toEqual(
      ['admin', 'buyer', 'talent']
    )
  })

  it('buyer can checkout/cancel orders and read equipment, but cannot create datasets', () => {
    const buyer = mendysDatasetsPolicy.roles.find(r => r.key === 'buyer')!
    expect(buyer.permissions).toEqual(
      expect.arrayContaining([
        'Dataset:read',
        'Order:create', 'Order:read', 'Order:checkout', 'Order:cancel',
        'Equipment:read',
      ])
    )
    expect(buyer.permissions).not.toContain('Dataset:create')
    expect(buyer.permissions).not.toContain('Order:manage')
    expect(buyer.permissions).not.toContain('Equipment:manage')
  })

  it('talent manages their datasets + profile but cannot approve profiles or publish', () => {
    const talent = mendysDatasetsPolicy.roles.find(r => r.key === 'talent')!
    expect(talent.permissions).toEqual(
      expect.arrayContaining([
        'Dataset:create', 'Dataset:read', 'Dataset:update',
        'TalentProfile:create', 'TalentProfile:read', 'TalentProfile:update',
      ])
    )
    expect(talent.permissions).not.toContain('TalentProfile:approve')
    expect(talent.permissions).not.toContain('Dataset:publish')
  })

  it('admin holds every declared action on every declared resource', () => {
    const admin = mendysDatasetsPolicy.roles.find(r => r.key === 'admin')!
    const allPerms = mendysDatasetsPolicy.resources.flatMap(r =>
      Object.keys(r.actions).map(a => `${r.key}:${a}`)
    )
    expect(admin.permissions.slice().sort()).toEqual(allPerms.sort())
  })

  it('namespaces cleanly (hyphenated product key is valid)', () => {
    expect(namespaceKey('mendys-datasets', 'Order')).toBe('mendys-datasets_Order')
    const ns = namespaceProductPolicy(mendysDatasetsPolicy)
    expect(ns.roles.map(r => r.key)).toEqual(
      expect.arrayContaining(['mendys-datasets_talent', 'mendys-datasets_buyer', 'mendys-datasets_admin'])
    )
  })
})
