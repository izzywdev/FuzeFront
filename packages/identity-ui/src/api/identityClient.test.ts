import { describe, it, expect, vi } from 'vitest'
import { createIdentityClient } from './identityClient'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response)
}

describe('identity client — members', () => {
  it('listMembers GETs /api/organizations/:id/members (array response)', async () => {
    const members = [{ id: 'm1', role: 'admin', status: 'active', user: { id: 'u1', email: 'a@b.c' } }]
    const fetchImpl = mockFetch(200, members)
    const client = createIdentityClient({ fetchImpl })
    const result = await client.listMembers('org-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/members',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual(members)
  })

  it('updateMemberRole PUTs the role', async () => {
    const fetchImpl = mockFetch(200, {})
    const client = createIdentityClient({ fetchImpl })
    await client.updateMemberRole('org-1', 'm1', 'viewer')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/members/m1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'viewer' }) })
    )
  })

  it('removeMember DELETEs the member', async () => {
    const fetchImpl = mockFetch(200, {})
    const client = createIdentityClient({ fetchImpl })
    await client.removeMember('org-1', 'm1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/members/m1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('identity client — invitations', () => {
  it('listInvitations GETs and unwraps { invitations }', async () => {
    const fetchImpl = mockFetch(200, { invitations: [{ id: 'i1', email: 'x@y.z', role: 'member', status: 'pending' }] })
    const client = createIdentityClient({ fetchImpl })
    const result = await client.listInvitations('org-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual([{ id: 'i1', email: 'x@y.z', role: 'member', status: 'pending' }])
  })

  it('invite POSTs { email, role }', async () => {
    const fetchImpl = mockFetch(201, { invitation: {} })
    const client = createIdentityClient({ fetchImpl })
    await client.invite('org-1', 'x@y.z', 'admin')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'x@y.z', role: 'admin' }) })
    )
  })

  it('bulkInvite POSTs { emails, role } and summarizes backend { results }', async () => {
    const fetchImpl = mockFetch(201, {
      results: [
        { email: 'a@b.c', status: 'invited' },
        { email: 'd@e.f', status: 'skipped', error: 'already exists' },
        { email: 'bad', status: 'skipped', error: 'Invalid email format' },
      ],
    })
    const client = createIdentityClient({ fetchImpl })
    const summary = await client.bulkInvite('org-1', [
      { email: 'a@b.c', role: 'member' },
      { email: 'd@e.f', role: 'member' },
      { email: 'bad', role: 'member' },
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ emails: ['a@b.c', 'd@e.f', 'bad'], role: 'member' }),
      })
    )
    expect(summary.created).toBe(1)
    expect(summary.skipped).toBe(2)
    expect(summary.errors.length).toBe(2)
  })

  it('resendInvitation POSTs the resend path', async () => {
    const fetchImpl = mockFetch(200, {})
    const client = createIdentityClient({ fetchImpl })
    await client.resendInvitation('org-1', 'i1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations/i1/resend',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('revokeInvitation DELETEs the invitation', async () => {
    const fetchImpl = mockFetch(200, {})
    const client = createIdentityClient({ fetchImpl })
    await client.revokeInvitation('org-1', 'i1')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/organizations/org-1/invitations/i1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
