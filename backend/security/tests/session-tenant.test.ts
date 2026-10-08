import { fromUuid } from '@izzywdev/fuzefront-identity'
import { proveSessionTenant, canonicalSessionTenant } from '../src/services/session-tenant'
import { db } from '../src/config/database'
jest.mock('../src/config/database', () => ({ db: jest.fn() }))
const tenant = '0195a8f2-6c3d-7f11-8b2e-012345678901'
const subject = '0195a8f2-6c3d-7f11-8b2e-012345678902'
const where = jest.fn()
const first = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  const query = { join: jest.fn().mockReturnThis(), where, select: jest.fn().mockReturnThis(), first }
  where.mockReturnValue(query)
  ;(db as unknown as jest.Mock).mockReturnValue(query)
})
test('canonical typed IDs enforce active membership and organization', async () => {
  first.mockResolvedValue({ id: 'membership' })
  expect(await proveSessionTenant(fromUuid('user', subject), fromUuid('organization', tenant))).toBe(tenant)
  expect(where.mock.calls).toEqual([
    ['membership.user_id', subject], ['membership.organization_id', tenant],
    ['membership.status', 'active'], ['organization.is_active', true],
  ])
})
test('no active membership denies, without owner or public-org fallback', async () => {
  first.mockResolvedValue(undefined)
  expect(await proveSessionTenant(subject, tenant)).toBeNull()
})
test.each(['', '../tenant', ['a','b'], fromUuid('user', subject), 'a'.repeat(256)])('rejects invalid tenant %p', value => {
  expect(() => canonicalSessionTenant(value)).toThrow()
  expect(db).not.toHaveBeenCalled()
})
test('database errors propagate for fail-closed route handling', async () => {
  first.mockRejectedValue(new Error('private SQL'))
  await expect(proveSessionTenant(subject, tenant)).rejects.toThrow()
})
