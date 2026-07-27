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

describe('startBillingProjection (regression: FFRNT-146 — the missing consumer)', () => {
  // Prior to this fix, backend had NO Kafka consumer for
  // billing.subscription.changed at all: billing_plan_tier/status columns
  // stayed at their migration defaults forever, silently. This test proves
  // the DB effect actually happens end-to-end through the wired consumer —
  // not merely that a function was called — by faking kafkajs's `run` to
  // deliver one event and asserting the projected columns change.
  const originalBrokers = process.env.KAFKA_BROKERS

  afterEach(() => {
    process.env.KAFKA_BROKERS = originalBrokers
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('is a no-op when KAFKA_BROKERS is unset (preserves prod degradation)', async () => {
    delete process.env.KAFKA_BROKERS
    jest.resetModules()
    const { startBillingProjection: start } = await import('../src/services/billingProjection')
    await expect(start()).resolves.toBeUndefined()
  })

  it('actually updates billing_plan_tier/status when the broker delivers a real event', async () => {
    process.env.KAFKA_BROKERS = 'kafka:9092'

    let deliveredHandler: ((event: unknown) => Promise<void>) | undefined

    jest.doMock('@fuzefront/shared/kafka', () => {
      const actual = jest.requireActual('@fuzefront/shared/kafka')
      return {
        ...actual,
        createKafkaClient: jest.fn(() => ({})),
        TypedConsumer: jest.fn().mockImplementation(() => ({
          connect: jest.fn().mockResolvedValue(undefined),
          subscribe: jest.fn().mockResolvedValue(undefined),
          run: jest.fn((handler: (event: unknown) => Promise<void>) => {
            deliveredHandler = handler
            return Promise.resolve()
          }),
          disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }
    })

    jest.resetModules()
    const { startBillingProjection: start } = await import('../src/services/billingProjection')
    await start()

    expect(deliveredHandler).toBeDefined()

    // Simulate the broker delivering the event the way TypedConsumer does:
    // handler receives the full FuzeEvent envelope with the parsed payload.
    await deliveredHandler!({
      version: '1.0',
      topic: 'billing.subscription.changed',
      correlationId: 'corr-1',
      occurredAt: new Date().toISOString(),
      payload: {
        entityType: 'organization',
        entityId: '55555555-5555-5555-5555-555555555555',
        planTier: 'enterprise',
        status: 'active',
        stripeSubscriptionId: 'sub_5',
      },
    })

    // The real, observable effect: the DB column actually changed.
    expect(dbMock).toHaveBeenCalledWith('organizations')
    expect(whereMock).toHaveBeenCalledWith({
      id: '55555555-5555-5555-5555-555555555555',
    })
    expect(updateMock).toHaveBeenCalledWith({
      billing_plan_tier: 'enterprise',
      billing_plan_status: 'active',
    })
  })
})
