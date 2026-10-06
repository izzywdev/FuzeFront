import { productPolicySchema } from '../src/app-registry/onboarding.schema'

const declaration = () => ({ resources: [{ key: 'Identity', name: 'Identity',
  actions: { read: { name: 'Read' } }, roles: { owner: { name: 'Owner', permissions: ['read'] } },
}], roles: [] })

it('accepts instance ownership without adding tenant roles', () => {
  expect(productPolicySchema.parse(declaration()).roles).toEqual([])
})
it('rejects unrelated instance permissions', () => {
  const policy = declaration(); policy.resources[0].roles.owner.permissions = ['toString']
  expect(productPolicySchema.safeParse(policy).success).toBe(false)
})
it('rejects undeclared relation targets at ingress', () => {
  const policy = declaration()
  expect(productPolicySchema.safeParse({ ...policy, resources: [{ ...policy.resources[0],
    relations: { parent: 'Organization' },
  }] }).success).toBe(false)
})
