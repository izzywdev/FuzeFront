import { describe, it, expect, vi } from 'vitest'
import { createInvitationsClient, classifyInviteError, isEnroll } from './invitationsClient'
import { HttpError } from './http'

function fetchStub(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  })) as unknown as typeof fetch
}

describe('createInvitationsClient', () => {
  it('lists with the cursor envelope params on the same-origin /api base', async () => {
    const fetchImpl = fetchStub(200, { items: [], page: { nextCursor: null, hasMore: false } })
    const client = createInvitationsClient({ fetchImpl, getToken: () => 't0k' })
    await client.list('org_1', { limit: 25, cursor: 'c1', status: 'pending' })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/organizations/org_1/invitations?limit=25&cursor=c1&status=pending')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer t0k')
  })

  it('creates with a discriminated InviteeRef body and no client-supplied id', async () => {
    const fetchImpl = fetchStub(201, { id: 'inv_1' })
    const client = createInvitationsClient({ fetchImpl })
    await client.create('org_1', {
      invitee: { kind: 'external', channel: 'whatsapp', phone: '+447700900123' },
      role: 'viewer',
      memberType: 'customer',
    })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/organizations/org_1/invitations')
    expect(JSON.parse(init.body)).toEqual({
      invitee: { kind: 'external', channel: 'whatsapp', phone: '+447700900123' },
      role: 'viewer',
      memberType: 'customer',
    })
  })

  it('resends, revokes, resolves and accepts against the contract paths', async () => {
    const fetchImpl = fetchStub(200, { action: 'bound' })
    const client = createInvitationsClient({ fetchImpl })
    await client.resend('org_1', 'inv_9')
    await client.revoke('org_1', 'inv_9')
    await client.resolve('tok/en')
    await client.accept('tok/en')
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[1].method, c[0]])
    expect(calls).toEqual([
      ['POST', '/api/organizations/org_1/invitations/inv_9/resend'],
      ['DELETE', '/api/organizations/org_1/invitations/inv_9'],
      ['GET', '/api/invitations/tok%2Fen'],
      ['POST', '/api/invitations/tok%2Fen/accept'],
    ])
  })

  it('narrows the 202 enroll outcome', () => {
    expect(isEnroll({ action: 'enroll', enrollUrl: 'https://x', bindToken: 'b' })).toBe(true)
    expect(
      isEnroll({ action: 'bound', organizationId: 'o', userId: 'u', role: 'member', memberType: 'employee' }),
    ).toBe(false)
  })
})

describe('classifyInviteError', () => {
  const e = (status: number, body?: unknown) => new HttpError(status, 'm', body)
  it('maps accept-context statuses to the fail-closed frames', () => {
    expect(classifyInviteError(e(410), 'accept')).toBe('expired')
    expect(classifyInviteError(e(403), 'accept')).toBe('mismatch')
    expect(classifyInviteError(e(409), 'accept')).toBe('already-accepted')
    expect(classifyInviteError(e(404), 'accept')).toBe('not-found')
    expect(classifyInviteError(e(401), 'accept')).toBe('unauthenticated')
  })
  it('maps admin-context statuses in place (403 is forbidden, never a sign-in)', () => {
    expect(classifyInviteError(e(403), 'admin')).toBe('forbidden')
    expect(classifyInviteError(e(409), 'admin')).toBe('duplicate')
    expect(classifyInviteError(e(409, { code: 'LAST_OWNER' }), 'admin')).toBe('last-owner')
    expect(classifyInviteError(e(400, { error: 'INVALID_PHONE' }), 'admin')).toBe('invalid-phone')
    expect(classifyInviteError(e(502, { error: 'DELIVERY_FAILED' }), 'admin')).toBe('delivery-failed')
    expect(classifyInviteError(e(429), 'admin')).toBe('rate-limited')
    expect(classifyInviteError(new Error('boom'), 'admin')).toBe('unknown')
  })
})
