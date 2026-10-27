/**
 * FFRNT-307 — pure/unit coverage for services/invitationsV2 + the
 * `fuzefront.identity.invite-v2` flag reader (fail-safe OFF).
 */
jest.mock('../src/config/database', () => ({ db: require('./helpers/fakeDb').db }))
jest.mock('@fuzefront/core', () => ({
  ...jest.requireActual('@fuzefront/core'),
  enqueueEvent: jest.fn((...a: any[]) => (require('./helpers/fakeDb').enqueueEvent as any)(...a)),
}))

import {
  BULK_MAX,
  createInvitation,
  decodeCursor,
  encodeCursor,
  hashBindToken,
  InviteError,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  maskEmail,
  maskPhone,
  mintBindToken,
  parseBulkBody,
  parseCreateBody,
  parseInvitee,
  parseListLimit,
  portalKeyOf,
  refToUuid,
  toInvitationDto,
  wireIds,
} from '../src/services/invitationsV2'
import { fakeDb, ROOT } from './helpers/fakeDb'
import { INVITE_V2_FLAG, isInviteV2Enabled } from '../src/utils/inviteV2Flag'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const email = (e: string) => ({ kind: 'external', channel: 'email', email: e })

describe('parseInvitee / parseCreateBody / parseBulkBody', () => {
  it('normalizes external email; keeps account userId as a uuid', () => {
    expect(parseInvitee(email('  Mixed@Case.COM '))).toEqual({ kind: 'external', channel: 'email', email: 'mixed@case.com' })
    expect(parseInvitee({ kind: 'account', userId: U })).toEqual({ kind: 'account', userId: U })
  })

  it('accepts a prefixed user TypeID and rejects other entity types', () => {
    const { fromUuid } = require('@izzywdev/fuzefront-identity')
    expect(parseInvitee({ kind: 'account', userId: fromUuid('user', U) })).toEqual({ kind: 'account', userId: U })
    expect(() => parseInvitee({ kind: 'account', userId: fromUuid('organization', U) })).toThrow(InviteError)
  })

  it('defaults role to member, requires memberType, never allows owner', () => {
    expect(parseCreateBody({ invitee: email('a@b.co'), memberType: 'employee' }).role).toBe('member')
    expect(() => parseCreateBody({ invitee: email('a@b.co') })).toThrow(/memberType/)
    expect(() => parseCreateBody({ invitee: email('a@b.co'), memberType: 'employee', role: 'owner' })).toThrow(/Invalid role/)
  })

  it('rejects any client-supplied id/token/extra key (additionalProperties:false)', () => {
    for (const extra of ['id', 'token', 'bindToken', 'organizationId', 'status']) {
      expect(() => parseCreateBody({ invitee: email('a@b.co'), memberType: 'employee', [extra]: 'x' })).toThrow(/unknown field/)
    }
  })

  it('validates E.164 for whatsapp and email shape for email', () => {
    expect(parseInvitee({ kind: 'external', channel: 'whatsapp', phone: '+14155552671' })).toMatchObject({ phone: '+14155552671' })
    for (const phone of ['14155552671', '+0123', '+1', 'abc', '+1415555267112345678']) {
      expect(() => parseInvitee({ kind: 'external', channel: 'whatsapp', phone })).toThrow(InviteError)
    }
    expect(() => parseInvitee({ kind: 'external', channel: 'email' })).toThrow(InviteError)
    expect(() => parseInvitee({ kind: 'external', channel: 'sms', phone: '+14155552671' })).toThrow(InviteError)
  })

  it('bulk: 1..50 invitees', () => {
    const mk = (n: number) => ({ memberType: 'employee', invitees: Array.from({ length: n }, (_, i) => email(`u${i}@x.co`)) })
    expect(parseBulkBody(mk(BULK_MAX)).invitees).toHaveLength(BULK_MAX)
    expect(() => parseBulkBody(mk(BULK_MAX + 1))).toThrow(InviteError)
    expect(() => parseBulkBody(mk(0))).toThrow(InviteError)
  })
})

describe('pagination helpers', () => {
  it('limit: default, clamp to max, reject malformed', () => {
    expect(parseListLimit(undefined)).toBe(LIST_DEFAULT_LIMIT)
    expect(parseListLimit('10')).toBe(10)
    expect(parseListLimit('100000')).toBe(LIST_MAX_LIMIT)
    expect(parseListLimit(String(LIST_MAX_LIMIT + 1))).toBe(LIST_MAX_LIMIT)
    for (const bad of ['0', '-3', 'x', '1.5']) expect(() => parseListLimit(bad)).toThrow(InviteError)
  })

  it('cursor round-trips and is opaque; tampering is rejected', () => {
    const c = encodeCursor(new Date('2026-01-02T03:04:05.000Z'), '99999999-9999-4999-8999-999999999999')
    expect(c).not.toContain('2026')
    expect(decodeCursor(c)).toEqual({ c: '2026-01-02T03:04:05.000Z', i: '99999999-9999-4999-8999-999999999999' })
    for (const bad of ['', 'zzz', Buffer.from('{"c":"x","i":"y"}').toString('base64url'), Buffer.from('[]').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(InviteError)
    }
  })
})

describe('masking + bind token', () => {
  it('masks email and phone', () => {
    expect(maskEmail('user@example.com')).toBe('u***@example.com')
    expect(maskEmail('weird')).toBe('***')
    expect(maskPhone('+14155552671')).toBe('+1 *** *** 2671')
    expect(maskPhone('+1')).toBe('***')
  })

  it('mints high-entropy single-use tokens and stores only the digest', () => {
    const a = mintBindToken()
    const b = mintBindToken()
    expect(a.token).not.toBe(b.token)
    expect(a.token.length).toBeGreaterThanOrEqual(43) // 32 random bytes, base64url
    expect(a.hash).toBe(hashBindToken(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).not.toContain(a.token)
  })
})

describe('refToUuid / wireIds / DTO', () => {
  it('bare uuid tolerated, wrong type rejected, wire form round-trips', () => {
    const { fromUuid } = require('@izzywdev/fuzefront-identity')
    expect(refToUuid('user', U.toUpperCase())).toBe(U)
    expect(refToUuid('user', fromUuid('user', U))).toBe(U)
    expect(() => refToUuid('user', fromUuid('organization', U))).toThrow()
    expect(() => refToUuid('user', 'nope')).toThrow()
    expect(wireIds(true)('invitation', U)).toMatch(/^ivt_/)
    expect(wireIds(false)('invitation', U)).toBe(U)
    expect(wireIds(true)('user', null)).toBeUndefined()
  })

  it('projects an expired-pending row as expired and never leaks token/bind token', () => {
    const dto: any = toInvitationDto(
      { id: U, organization_id: U, email: 'a@b.co', channel: 'email', role: 'member', member_type: 'employee', status: 'pending',
        invited_by: U, token: 'secret', bind_token: 'digest', expires_at: new Date(Date.now() - 1000), created_at: new Date() },
      wireIds(false)
    )
    expect(dto.status).toBe('expired')
    expect(JSON.stringify(dto)).not.toMatch(/secret|digest|bind/)
  })
})

describe('portalKeyOf', () => {
  const O = (n: number) => `0000000${n}-0000-4000-8000-000000000000`
  beforeEach(() => {
    fakeDb.reset()
    fakeDb.tables.organizations.push(
      { id: ROOT, parent_id: null },
      { id: O(1), parent_id: ROOT },
      { id: O(2), parent_id: O(1) },
      { id: O(3), parent_id: O(2) },
      { id: O(4), parent_id: null } // a tree that never reaches the root (e.g. personal)
    )
  })
  it('root is its own portal; portal root and descendants share a key', async () => {
    expect(await portalKeyOf(ROOT)).toBe(ROOT)
    expect(await portalKeyOf(O(1))).toBe(O(1))
    expect(await portalKeyOf(O(3))).toBe(O(1))
  })
  it('an unrooted tree keys on its own topmost org', async () => {
    expect(await portalKeyOf(O(4))).toBe(O(4))
  })
})

describe('invite-v2 flag reader (fail-safe OFF)', () => {
  afterEach(() => {
    jest.resetModules()
  })

  it('names the locked flag key', () => {
    expect(INVITE_V2_FLAG).toBe('fuzefront.identity.invite-v2')
  })

  async function withClient(getBooleanValue: any) {
    jest.resetModules()
    jest.doMock('@fuzefront/feature-flags', () => ({ getClient: () => ({ getBooleanValue }) }), { virtual: true })
    return (await import('../src/utils/inviteV2Flag')).isInviteV2Enabled
  }

  it('ON when the client says so, evaluated with default OFF + standard context', async () => {
    const get = jest.fn().mockResolvedValue(true)
    const fn = await withClient(get)
    expect(await fn({ userId: 'u', organizationId: 'o' })).toBe(true)
    expect(get).toHaveBeenCalledWith(
      'fuzefront.identity.invite-v2',
      false,
      expect.objectContaining({ app: 'fuzefront-security', userId: 'u', organizationId: 'o', environment: expect.any(String) })
    )
  })

  it('OFF when the client says OFF, throws, or is absent', async () => {
    expect(await (await withClient(jest.fn().mockResolvedValue(false)))()).toBe(false)
    expect(await (await withClient(jest.fn().mockRejectedValue(new Error('unleash down'))))()).toBe(false)
    jest.resetModules()
    jest.doMock(
      '@fuzefront/feature-flags',
      () => {
        throw new Error('not installed')
      },
      { virtual: true }
    )
    expect(await (await import('../src/utils/inviteV2Flag')).isInviteV2Enabled()).toBe(false)
  })

  it('direct import keeps the type surface', async () => {
    expect(typeof isInviteV2Enabled).toBe('function')
  })
})

describe('createInvitation — account invitee with no email', () => {
  const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const INVITER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const NO_EMAIL_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

  beforeEach(() => {
    fakeDb.reset()
    fakeDb.tables.users.push(
      { id: INVITER, email: 'inviter@example.com' },
      { id: NO_EMAIL_USER, email: null, phone: '+14155550001', phone_verified: true }
    )
    fakeDb.tables.organizations.push({ id: ORG, name: 'Acme', owner_id: INVITER, parent_id: null })
    fakeDb.tables.organization_memberships.push({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: INVITER,
      organization_id: ORG,
      role: 'owner',
      status: 'active',
      member_type: 'employee',
    })
  })

  it('throws InviteError 400 instead of TypeError when the account has no email', async () => {
    const ctx = { userId: INVITER, org: { id: ORG }, isOwner: true }
    const invitee = { kind: 'account' as const, userId: NO_EMAIL_USER }
    await expect(
      createInvitation(ctx, { role: 'member', memberType: 'employee' }, invitee)
    ).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' })
  })
})
