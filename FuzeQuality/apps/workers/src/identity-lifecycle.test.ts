import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  apiRequest: vi.fn(async () => ({ accepted: true })),
  handler: undefined as undefined | ((topic: string, payload: unknown) => Promise<void>),
  topics: [] as string[],
}))

vi.mock('./runtime', () => ({
  apiRequest: runtime.apiRequest,
  runConsumer: vi.fn(async (
    _groupId: string,
    topics: string[],
    handler: (topic: string, payload: unknown) => Promise<void>,
  ) => {
    runtime.topics = topics
    runtime.handler = handler
  }),
}))

await import('./identity-lifecycle')

const organizationId = '0195a8f2-6c3d-7f11-8b2e-012345678901'
const userId = '0195a8f2-6c3d-7f11-8b2e-012345678902'

function postedBody() {
  const calls = runtime.apiRequest.mock.calls as unknown as Array<[string, RequestInit]>
  return JSON.parse(calls.at(-1)?.[1]?.body as string)
}

describe('identity lifecycle event bridge', () => {
  beforeEach(() => runtime.apiRequest.mockClear())

  it('subscribes to the complete organization, user, and membership lifecycle', () => {
    expect(runtime.topics).toEqual([
      'identity.org.created', 'identity.org.updated', 'identity.org.deleted',
      'identity.user.created', 'identity.user.updated', 'identity.user.deleted',
      'identity.membership.added', 'identity.membership.removed',
    ])
  })

  it('projects event-carried organization snapshots', async () => {
    await runtime.handler?.('identity.org.created', {
      organizationId, slug: 'personal-user', name: 'Personal workspace', type: 'personal',
      parentId: null, ownerId: userId, isActive: true,
    })

    expect(postedBody()).toEqual({
      type: 'organization.upsert', organizationId, slug: 'personal-user', name: 'Personal workspace',
      organizationType: 'personal', ownerId: userId, isActive: true,
    })
  })

  it('projects user snapshots without requiring create-only intent on updates', async () => {
    await runtime.handler?.('identity.user.updated', {
      userId, email: 'person@example.com', firstName: 'Updated', homePortalId: null,
    })

    expect(postedBody()).toEqual({
      type: 'user.upsert', userId, email: 'person@example.com', firstName: 'Updated',
    })
  })

  it.each(['soft', 'hard'] as const)(
    'preserves the %s user-deletion cascade for local privacy handling',
    async cascade => {
      await runtime.handler?.('identity.user.deleted', {
        userId, email: 'person@example.com', cascade,
      })

      expect(postedBody()).toEqual({ type: 'user.deleted', userId, cascade })
    },
  )

  it('defaults legacy user-deletion events to a soft local cascade', async () => {
    await runtime.handler?.('identity.user.deleted', {
      userId, email: 'person@example.com',
    })

    expect(postedBody()).toEqual({ type: 'user.deleted', userId, cascade: 'soft' })
  })

  it.each([
    ['identity.membership.added', true],
    ['identity.membership.removed', false],
  ] as const)('projects %s as organization-wide membership state', async (topic, active) => {
    await runtime.handler?.(topic, { organizationId, userId, role: 'member' })

    expect(postedBody()).toEqual({
      type: 'membership.changed', organizationId, userId, role: 'member', active,
    })
  })
})
