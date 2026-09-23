/**
 * Unit tests for `PermitAuthorizationProvider.setAttributes()` — the
 * subject ABAC attribute-write (F2 implementation of the F1-frozen contract,
 * `packages/security/openapi.yaml`'s `setSubjectAttributes`).
 *
 * `permit.api.{users,tenants}.update` is mocked directly (rather than relying
 * on the CI no-op Permit proxy) so these tests can assert:
 *   1. `subjectType: 'user'` routes to `permit.api.users.update`, `'tenant'`
 *      routes to `permit.api.tenants.update` — the type is structural, never
 *      inferred from the bare key.
 *   2. The write is a MERGE: only the caller-supplied keys are forwarded —
 *      Permit's own `update()` is itself a merge, so no local
 *      read-modify-write is needed.
 *   3. A numeric attribute (`seat_limit: 25`) round-trips as a NUMBER, not a
 *      stringified value — the entire reason this endpoint exists instead of
 *      a role grant.
 *   4. THIS IS A WRITE, NOT A DECISION: a provider rejection THROWS out of
 *      `setAttributes()` — deliberately the OPPOSITE of `check`/`bulkCheck`'s
 *      fail-closed-returns-`false` contract. Never fail-open, never
 *      fail-silent.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = 'ci-no-real-permit-calls'

const usersUpdateMock = jest.fn().mockResolvedValue({})
const tenantsUpdateMock = jest.fn().mockResolvedValue({})

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: {
    api: {
      users: { update: (...args: unknown[]) => usersUpdateMock(...args) },
      tenants: { update: (...args: unknown[]) => tenantsUpdateMock(...args) },
    },
  },
  permitConfig: { token: 'ci-no-real-permit-calls', pdp: 'http://localhost:7766' },
}))

import { PermitAuthorizationProvider } from '../src/providers/permit/PermitAuthorizationProvider'

describe('PermitAuthorizationProvider.setAttributes', () => {
  const provider = new PermitAuthorizationProvider()

  beforeEach(() => {
    usersUpdateMock.mockClear()
    tenantsUpdateMock.mockClear()
    usersUpdateMock.mockResolvedValue({})
    tenantsUpdateMock.mockResolvedValue({})
  })

  it("maps subjectType 'user' to permit.api.users.update", async () => {
    await provider.setAttributes({
      subject: { type: 'user', key: 'usr_1' },
      attributes: { plan_tier: 'pro' },
    })

    expect(usersUpdateMock).toHaveBeenCalledWith('usr_1', { attributes: { plan_tier: 'pro' } })
    expect(tenantsUpdateMock).not.toHaveBeenCalled()
  })

  it("maps subjectType 'tenant' to permit.api.tenants.update", async () => {
    await provider.setAttributes({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_status: 'active' },
    })

    expect(tenantsUpdateMock).toHaveBeenCalledWith('org_acme', { attributes: { plan_status: 'active' } })
    expect(usersUpdateMock).not.toHaveBeenCalled()
  })

  it('is a MERGE — forwards only the caller-supplied attribute keys', async () => {
    await provider.setAttributes({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_tier: 'pro', plan_status: 'active', seat_limit: 25 },
    })

    expect(tenantsUpdateMock).toHaveBeenCalledWith('org_acme', {
      attributes: { plan_tier: 'pro', plan_status: 'active', seat_limit: 25 },
    })
  })

  it('round-trips a NUMERIC attribute (seat_limit) as a number, not a string', async () => {
    const result = await provider.setAttributes({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { seat_limit: 25 },
    })

    // What was sent to Permit must still be a number...
    const sentAttributes = tenantsUpdateMock.mock.calls[0][1].attributes
    expect(sentAttributes.seat_limit).toBe(25)
    expect(typeof sentAttributes.seat_limit).toBe('number')

    // ...and what the call returns to the caller must be a number too.
    expect(result.attributes.seat_limit).toBe(25)
    expect(typeof result.attributes.seat_limit).toBe('number')
  })

  it('round-trips a BOOLEAN attribute unchanged', async () => {
    const result = await provider.setAttributes({
      subject: { type: 'user', key: 'usr_1' },
      attributes: { beta_enrolled: true },
    })

    expect(usersUpdateMock).toHaveBeenCalledWith('usr_1', { attributes: { beta_enrolled: true } })
    expect(result.attributes.beta_enrolled).toBe(true)
  })

  it('echoes the subject and attributes it wrote, with an updatedAt timestamp', async () => {
    const before = Date.now()
    const result = await provider.setAttributes({
      subject: { type: 'user', key: 'usr_1' },
      attributes: { plan_tier: 'enterprise' },
    })
    const after = Date.now()

    expect(result.subject).toEqual({ type: 'user', key: 'usr_1' })
    expect(result.attributes).toEqual({ plan_tier: 'enterprise' })
    expect(result.updatedAt).toBeGreaterThanOrEqual(before)
    expect(result.updatedAt).toBeLessThanOrEqual(after)
  })

  it('THROWS (never resolves) when the provider rejects the write — this is a WRITE, not a fail-closed decision', async () => {
    usersUpdateMock.mockRejectedValueOnce(new Error('permit unreachable'))

    await expect(
      provider.setAttributes({
        subject: { type: 'user', key: 'usr_1' },
        attributes: { plan_tier: 'pro' },
      }),
    ).rejects.toThrow('permit unreachable')
  })

  it('THROWS on a tenant-scoped provider rejection too', async () => {
    tenantsUpdateMock.mockRejectedValueOnce(new Error('timeout'))

    await expect(
      provider.setAttributes({
        subject: { type: 'tenant', key: 'org_acme' },
        attributes: { seat_limit: 10 },
      }),
    ).rejects.toThrow('timeout')
  })
})
