// Unit tests for the backend billing plan-state projection. No broker / no DB:
// the knex `db` export is mocked with a chainable stub so we assert the exact
// table + update payload, keyed by (entityType, entityId).

const updateMock = jest.fn().mockResolvedValue(1)
const whereMock = jest.fn(() => ({ update: updateMock }))
const dbMock = jest.fn(() => ({ where: whereMock }))

jest.mock('../src/config/database', () => ({
  db: (table: string) => (dbMock as unknown as (t: string) => unknown)(table),
}))

import { applySubscriptionChanged } from '../src/services/billingProjection'

describe('applySubscriptionChanged', () => {
  beforeEach(() => {
    updateMock.mockClear()
    whereMock.mockClear()
    dbMock.mockClear()
    updateMock.mockResolvedValue(1)
  })

  it('projects a user subscription onto public.users by id', async () => {
    const rows = await applySubscriptionChanged({
      entityType: 'user',
      entityId: '11111111-1111-1111-1111-111111111111',
      planTier: 'pro',
      status: 'active',
      stripeSubscriptionId: 'sub_1',
    })

    expect(dbMock).toHaveBeenCalledWith('users')
    expect(whereMock).toHaveBeenCalledWith({
      id: '11111111-1111-1111-1111-111111111111',
    })
    expect(updateMock).toHaveBeenCalledWith({
      billing_plan_tier: 'pro',
      billing_plan_status: 'active',
    })
    expect(rows).toBe(1)
  })

  it('projects an organization subscription onto public.organizations', async () => {
    await applySubscriptionChanged({
      entityType: 'organization',
      entityId: '22222222-2222-2222-2222-222222222222',
      planTier: 'starter',
      status: 'past_due',
      stripeSubscriptionId: 'sub_2',
    })

    expect(dbMock).toHaveBeenCalledWith('organizations')
    expect(updateMock).toHaveBeenCalledWith({
      billing_plan_tier: 'starter',
      billing_plan_status: 'past_due',
    })
  })

  it('returns 0 when no entity row matches (unknown entity)', async () => {
    updateMock.mockResolvedValueOnce(0)
    const rows = await applySubscriptionChanged({
      entityType: 'user',
      entityId: '33333333-3333-3333-3333-333333333333',
      planTier: 'free',
      status: 'canceled',
      stripeSubscriptionId: 'sub_3',
    })
    expect(rows).toBe(0)
  })
})
