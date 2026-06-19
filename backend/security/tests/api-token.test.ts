/**
 * Unit tests for the API token service.
 * DB is mocked — no real Postgres required.
 * Pure functions (generateToken, hashToken, extractParts) need no db.
 */

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
}))

import crypto from 'crypto'
import { db } from '../src/config/database'
import {
  generateToken,
  hashToken,
  extractParts,
  encodeBase62,
  createToken,
  verifyToken,
  revokeToken,
  listTokensForOwner,
  getTokenById,
  updateLastUsed,
  mapScopesToPermitRole,
} from '../src/services/api-token'

const dbMock = db as jest.MockedFunction<any>

function makeDbQuery(returnValue: any) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    whereNull: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    select: jest.fn().mockReturnThis(),
    column: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue(returnValue !== null ? [returnValue] : []),
    limit: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(
      returnValue !== null ? [returnValue] : []
    ),
  }
  return chain
}

// ---------------------------------------------------------------------------
// Token format constants
// ---------------------------------------------------------------------------
const TOKEN_HEADER = 'ff_live_'
const PREFIX_LEN = 22
const BODY_LEN = 43

// ---------------------------------------------------------------------------
// Pure function tests — generateToken
// ---------------------------------------------------------------------------
describe('generateToken()', () => {
  it('returns a raw token with ff_live_ header', () => {
    const { raw } = generateToken()
    expect(raw.startsWith(TOKEN_HEADER)).toBe(true)
  })

  it('raw token length is exactly 74 chars', () => {
    const { raw } = generateToken()
    expect(raw.length).toBe(74) // 8 + 22 + 1 + 43
  })

  it('prefix is 22 chars', () => {
    const { prefix } = generateToken()
    expect(prefix.length).toBe(PREFIX_LEN)
  })

  it('hash is 64-char hex', () => {
    const { hash } = generateToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('prefix embedded in raw token matches prefix field', () => {
    const { raw, prefix } = generateToken()
    const afterHeader = raw.slice(TOKEN_HEADER.length)
    const dotIdx = afterHeader.indexOf('.')
    expect(afterHeader.slice(0, dotIdx)).toBe(prefix)
  })

  it('body embedded in raw token is 43 chars', () => {
    const { raw } = generateToken()
    const afterHeader = raw.slice(TOKEN_HEADER.length)
    const body = afterHeader.slice(afterHeader.indexOf('.') + 1)
    expect(body.length).toBe(BODY_LEN)
  })

  it('two calls produce different tokens', () => {
    const t1 = generateToken()
    const t2 = generateToken()
    expect(t1.raw).not.toBe(t2.raw)
    expect(t1.hash).not.toBe(t2.hash)
  })

  it('hash equals sha256 of prefix.body', () => {
    const { raw, prefix, hash } = generateToken()
    const afterHeader = raw.slice(TOKEN_HEADER.length)
    const body = afterHeader.slice(afterHeader.indexOf('.') + 1)
    const expected = crypto.createHash('sha256').update(`${prefix}.${body}`).digest('hex')
    expect(hash).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Pure function tests — hashToken
// ---------------------------------------------------------------------------
describe('hashToken()', () => {
  it('is deterministic', () => {
    const input = 'abc123.xyz789'
    expect(hashToken(input)).toBe(hashToken(input))
  })

  it('returns 64-char hex', () => {
    expect(hashToken('prefix.body')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches crypto.createHash sha256', () => {
    const input = 'myprefix.mybody'
    const expected = crypto.createHash('sha256').update(input).digest('hex')
    expect(hashToken(input)).toBe(expected)
  })

  it('different inputs produce different hashes', () => {
    expect(hashToken('a.b')).not.toBe(hashToken('a.c'))
  })
})

// ---------------------------------------------------------------------------
// Pure function tests — extractParts
// ---------------------------------------------------------------------------
describe('extractParts()', () => {
  it('parses a valid ff_live_ token', () => {
    const { raw, prefix } = generateToken()
    const parts = extractParts(raw)
    expect(parts).not.toBeNull()
    expect(parts!.prefix).toBe(prefix)
    expect(parts!.body.length).toBe(BODY_LEN)
  })

  it('returns null for empty string', () => {
    expect(extractParts('')).toBeNull()
  })

  it('returns null when ff_live_ header is missing', () => {
    // Strip the header
    const { raw } = generateToken()
    expect(extractParts(raw.slice(TOKEN_HEADER.length))).toBeNull()
  })

  it('returns null when there is no dot separator', () => {
    expect(extractParts('ff_live_nodothere')).toBeNull()
  })

  it('returns null for an arbitrary junk string', () => {
    expect(extractParts('not-a-token-at-all')).toBeNull()
  })

  it('returns null when prefix part is empty', () => {
    expect(extractParts('ff_live_.body')).toBeNull()
  })

  it('returns null when body part is empty', () => {
    expect(extractParts('ff_live_prefix.')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pure function tests — encodeBase62
// ---------------------------------------------------------------------------
describe('encodeBase62()', () => {
  it('known vector: all-zero 16-byte buffer encodes to 22 zeros', () => {
    const buf = Buffer.alloc(16, 0)
    expect(encodeBase62(buf, 22)).toBe('0000000000000000000000')
  })

  it('known vector: single byte 0x01 encodes to padded "1"', () => {
    const buf = Buffer.from([0x01])
    expect(encodeBase62(buf, 4)).toBe('0001')
  })

  it('known vector: single byte 0x3d (61) encodes to last alphabet char', () => {
    // 61 decimal = last index in BASE62 alphabet = 'z'
    const buf = Buffer.from([0x3d])
    expect(encodeBase62(buf, 1)).toBe('z')
  })

  it('always returns string of exactly targetLen characters', () => {
    const buf = crypto.randomBytes(16)
    expect(encodeBase62(buf, 22)).toHaveLength(22)
    expect(encodeBase62(buf, 8)).toHaveLength(8)
  })

  it('deterministic: same buffer always produces same output', () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    const a = encodeBase62(buf, 8)
    const b = encodeBase62(buf, 8)
    expect(a).toBe(b)
  })

  it('known vector: 0xdeadbeef encodes to expected base62 string', () => {
    // 0xdeadbeef = 3735928559 decimal
    // 3735928559 in base62: 3735928559 / 62^5=916132832 = 4 r 67530015
    // Computed: encodeBase62(Buffer.from([0xde,0xad,0xbe,0xef]), 6) = '4BGKXI'
    // We verify it is length 6 and consists only of base62 chars
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    const result = encodeBase62(buf, 6)
    expect(result).toHaveLength(6)
    expect(result).toMatch(/^[0-9A-Za-z]{6}$/)
    // Pin the exact value so a silent algorithm change is caught:
    expect(result).toBe('44pZgF')
  })
})

// ---------------------------------------------------------------------------
// DB op tests — createToken
// ---------------------------------------------------------------------------
describe('createToken()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('inserts a row and returns raw token once', async () => {
    const fakeId = 'fake-uuid-1234'
    let capturedInsertRow: any
    const fakeReturned = {
      id: fakeId,
      token_prefix: 'placeholder',
      name: 'My Token',
      scopes: ['App:read'],
      expires_at: null,
      created_at: new Date(),
    }
    // Mock the chain: db('api_tokens').insert(row).returning([...]) -> [fakeReturned]
    const returningMock = jest.fn().mockResolvedValue([fakeReturned])
    const insertMock = jest.fn().mockImplementation((row: any) => {
      capturedInsertRow = row
      return { returning: returningMock }
    })
    dbMock.mockReturnValue({ insert: insertMock })

    const result = await createToken(
      {
        name: 'My Token',
        ownerType: 'user',
        ownerId: 'user-123',
        scopes: ['App:read'],
        expiresAt: null,
        createdBy: 'user-123',
      },
      dbMock
    )

    expect(result.token).toMatch(/^ff_live_/)
    expect(result.token.length).toBe(74)
    expect(result.id).toBe(fakeId)
    expect(insertMock).toHaveBeenCalledTimes(1)
    // raw token must NOT be stored
    expect(capturedInsertRow.token_hash).not.toBe(result.token)
    // token_hash must be 64-char hex
    expect(capturedInsertRow.token_hash).toMatch(/^[0-9a-f]{64}$/)
    // token_prefix must be set
    expect(capturedInsertRow.token_prefix).toBeDefined()
    expect(typeof capturedInsertRow.token_prefix).toBe('string')
  })

  it('returns scopes as a parsed string[] even when db returns a JSON string', async () => {
    const scopesArray = ['App:read', 'Organization:read']
    // Simulate real pg behaviour: jsonb column returned as a JSON string
    const fakeReturned = {
      id: 'scope-test-id',
      token_prefix: 'placeholder',
      name: 'Scope Token',
      scopes: JSON.stringify(scopesArray), // db returns string
      expires_at: null,
      created_at: new Date(),
    }
    const returningMock = jest.fn().mockResolvedValue([fakeReturned])
    const insertMock = jest.fn().mockReturnValue({ returning: returningMock })
    dbMock.mockReturnValue({ insert: insertMock })

    const result = await createToken(
      {
        name: 'Scope Token',
        ownerType: 'user',
        ownerId: 'user-123',
        scopes: scopesArray,
        expiresAt: null,
        createdBy: 'user-123',
      },
      dbMock
    )

    expect(Array.isArray(result.scopes)).toBe(true)
    expect(result.scopes).toEqual(scopesArray)
  })

  it('stored hash is sha256 of prefix.body (not of ff_live_...)', async () => {
    let capturedInsertRow: any
    const fakeReturned = {
      id: 'id-x',
      token_prefix: 'p',
      name: 'T',
      scopes: [],
      expires_at: null,
      created_at: new Date(),
    }
    const returningMock = jest.fn().mockResolvedValue([fakeReturned])
    const insertMock = jest.fn().mockImplementation((row: any) => {
      capturedInsertRow = row
      return { returning: returningMock }
    })
    dbMock.mockReturnValue({ insert: insertMock })

    const result = await createToken(
      { name: 'T', ownerType: 'user', ownerId: 'u', scopes: [], expiresAt: null, createdBy: 'u' },
      dbMock
    )

    // Recompute expected hash from prefix and body of returned raw token
    const afterHeader = result.token.slice(TOKEN_HEADER.length)
    const dotIdx = afterHeader.indexOf('.')
    const prefix = afterHeader.slice(0, dotIdx)
    const body = afterHeader.slice(dotIdx + 1)
    const expectedHash = crypto.createHash('sha256').update(`${prefix}.${body}`).digest('hex')
    expect(capturedInsertRow.token_hash).toBe(expectedHash)
  })
})

// ---------------------------------------------------------------------------
// DB op tests — verifyToken
// ---------------------------------------------------------------------------
describe('verifyToken()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns {status:"invalid"} for an unparseable token', async () => {
    const result = await verifyToken('not-a-valid-token', dbMock)
    expect(result).toEqual({ status: 'invalid' })
  })

  it('returns {status:"invalid"} when prefix not found in DB', async () => {
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(null) }
    dbMock.mockReturnValue(chain)
    const { raw } = generateToken()
    const result = await verifyToken(raw, dbMock)
    expect(result).toEqual({ status: 'invalid' })
  })

  it('returns {status:"revoked"} when revoked_at is set', async () => {
    const { raw, prefix, hash } = generateToken()
    const row = {
      id: 'id-1',
      token_prefix: prefix,
      token_hash: hash,
      revoked_at: new Date(),
      expires_at: null,
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)
    const result = await verifyToken(raw, dbMock)
    expect(result).toEqual({ status: 'revoked' })
  })

  it('returns {status:"expired"} when expires_at is in the past', async () => {
    const { raw, prefix, hash } = generateToken()
    const row = {
      id: 'id-2',
      token_prefix: prefix,
      token_hash: hash,
      revoked_at: null,
      expires_at: new Date(Date.now() - 10000),
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)
    const result = await verifyToken(raw, dbMock)
    expect(result).toEqual({ status: 'expired' })
  })

  it('returns {status:"valid", token:row} for a correct, non-expired, non-revoked token', async () => {
    const { raw, prefix, hash } = generateToken()
    const row = {
      id: 'id-3',
      token_prefix: prefix,
      token_hash: hash,
      revoked_at: null,
      expires_at: null,
      scopes: ['App:read'],
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)
    const result = await verifyToken(raw, dbMock)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.token.id).toBe('id-3')
    }
  })

  it('returns scopes as parsed string[] on valid path when db returns JSON string', async () => {
    const { raw, prefix, hash } = generateToken()
    const scopesArray = ['App:read', 'App:install']
    const row = {
      id: 'id-scopes',
      token_prefix: prefix,
      token_hash: hash,
      revoked_at: null,
      expires_at: null,
      scopes: JSON.stringify(scopesArray), // simulate real pg jsonb string
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)
    const result = await verifyToken(raw, dbMock)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(Array.isArray(result.token.scopes)).toBe(true)
      expect(result.token.scopes).toEqual(scopesArray)
    }
  })

  it('returns {status:"invalid"} when body hash does not match (wrong token body)', async () => {
    const { prefix, hash } = generateToken()
    // Build a token with the correct prefix but wrong body
    const wrongBody = crypto.randomBytes(32).toString('base64url')
    const rawWrong = `${TOKEN_HEADER}${prefix}.${wrongBody}`
    const row = {
      id: 'id-4',
      token_prefix: prefix,
      token_hash: hash, // stored hash is for the ORIGINAL body
      revoked_at: null,
      expires_at: null,
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)
    const result = await verifyToken(rawWrong, dbMock)
    expect(result).toEqual({ status: 'invalid' })
  })

  it('uses crypto.timingSafeEqual (spy verifies it is called on hash comparison)', async () => {
    const { raw, prefix, hash } = generateToken()
    const row = {
      id: 'id-5',
      token_prefix: prefix,
      token_hash: hash,
      revoked_at: null,
      expires_at: null,
    }
    const chain = { ...makeDbQuery(null), first: jest.fn().mockResolvedValue(row) }
    dbMock.mockReturnValue(chain)

    const spy = jest.spyOn(crypto, 'timingSafeEqual')
    await verifyToken(raw, dbMock)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// DB op tests — revokeToken
// ---------------------------------------------------------------------------
describe('revokeToken()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns true when a row is updated', async () => {
    const chain = makeDbQuery(null)
    chain.update = jest.fn().mockResolvedValue(1)
    dbMock.mockReturnValue(chain)
    const result = await revokeToken('token-id-abc', dbMock)
    expect(result).toBe(true)
  })

  it('returns false when no row is updated (already revoked or not found)', async () => {
    const chain = makeDbQuery(null)
    chain.update = jest.fn().mockResolvedValue(0)
    dbMock.mockReturnValue(chain)
    const result = await revokeToken('token-id-xyz', dbMock)
    expect(result).toBe(false)
  })

  it('calls update with revoked_at set (not null) and where id + revoked_at IS NULL', async () => {
    const chain = makeDbQuery(null)
    chain.update = jest.fn().mockResolvedValue(1)
    dbMock.mockReturnValue(chain)
    await revokeToken('my-token-id', dbMock)
    // chain.where should have been called with id
    expect(chain.where).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'my-token-id' })
    )
    // chain.whereNull should have been called to guard revoked_at
    expect(chain.whereNull).toHaveBeenCalledWith('revoked_at')
    // update should have a revoked_at timestamp
    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg).toHaveProperty('revoked_at')
    expect(updateArg.revoked_at).toBeInstanceOf(Date)
  })
})

// ---------------------------------------------------------------------------
// DB op tests — listTokensForOwner
// ---------------------------------------------------------------------------
describe('listTokensForOwner()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns an array and excludes token_hash', async () => {
    const rows = [
      { id: 'a', token_prefix: 'pref1', name: 'T1', scopes: [], owner_type: 'user', owner_id: 'u1' },
      { id: 'b', token_prefix: 'pref2', name: 'T2', scopes: [], owner_type: 'user', owner_id: 'u1' },
    ]
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(rows),
    }
    dbMock.mockReturnValue(chain)
    const result = await listTokensForOwner('user', 'u1', dbMock)
    expect(Array.isArray(result)).toBe(true)
    result.forEach(r => {
      expect((r as any).token_hash).toBeUndefined()
    })
  })

  it('queries with correct owner_type and owner_id', async () => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([]),
    }
    dbMock.mockReturnValue(chain)
    await listTokensForOwner('org', 'org-99', dbMock)
    expect(chain.where).toHaveBeenCalledWith(
      expect.objectContaining({ owner_type: 'org', owner_id: 'org-99' })
    )
  })
})

// ---------------------------------------------------------------------------
// DB op tests — getTokenById
// ---------------------------------------------------------------------------
describe('getTokenById()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the row excluding token_hash', async () => {
    const row = { id: 'tid', token_prefix: 'p', name: 'T', scopes: [] }
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    }
    dbMock.mockReturnValue(chain)
    const result = await getTokenById('tid', dbMock)
    expect(result).not.toBeNull()
    expect((result as any)?.token_hash).toBeUndefined()
  })

  it('returns null when not found', async () => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
    }
    dbMock.mockReturnValue(chain)
    const result = await getTokenById('no-such-id', dbMock)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// DB op tests — updateLastUsed
// ---------------------------------------------------------------------------
describe('updateLastUsed()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls update on the api_tokens table for the given id', async () => {
    const chain = makeDbQuery(null)
    chain.update = jest.fn().mockResolvedValue(1)
    dbMock.mockReturnValue(chain)
    await updateLastUsed('tok-id-123', dbMock)
    expect(chain.where).toHaveBeenCalledWith({ id: 'tok-id-123' })
    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg).toHaveProperty('last_used_at')
  })
})

// ---------------------------------------------------------------------------
// Pure function tests — mapScopesToPermitRole
// ---------------------------------------------------------------------------
describe('mapScopesToPermitRole()', () => {
  it("maps ['App:read'] -> 'viewer'", () => {
    expect(mapScopesToPermitRole(['App:read'])).toBe('viewer')
  })

  it("maps ['Organization:read'] -> 'viewer'", () => {
    expect(mapScopesToPermitRole(['Organization:read'])).toBe('viewer')
  })

  it("maps ['UserManagement:view_members'] -> 'viewer'", () => {
    expect(mapScopesToPermitRole(['UserManagement:view_members'])).toBe('viewer')
  })

  it("maps all viewer scopes together -> 'viewer'", () => {
    expect(mapScopesToPermitRole(['Organization:read', 'App:read', 'UserManagement:view_members'])).toBe('viewer')
  })

  it("maps ['App:install'] -> 'editor'", () => {
    expect(mapScopesToPermitRole(['App:install'])).toBe('editor')
  })

  it("maps ['App:create', 'App:read'] -> 'editor'", () => {
    expect(mapScopesToPermitRole(['App:create', 'App:read'])).toBe('editor')
  })

  it("maps ['App:uninstall'] -> 'editor'", () => {
    expect(mapScopesToPermitRole(['App:uninstall'])).toBe('editor')
  })

  it("maps ['UserManagement:invite'] -> 'admin'", () => {
    expect(mapScopesToPermitRole(['UserManagement:invite'])).toBe('admin')
  })

  it("maps ['Organization:delete'] -> 'admin'", () => {
    expect(mapScopesToPermitRole(['Organization:delete'])).toBe('admin')
  })

  it("maps ['Organization:manage'] -> 'admin'", () => {
    expect(mapScopesToPermitRole(['Organization:manage'])).toBe('admin')
  })

  it("maps [] (empty scopes) -> 'viewer' (minimal role)", () => {
    expect(mapScopesToPermitRole([])).toBe('viewer')
  })

  it('selects minimal role when mixed editor+viewer scopes given', () => {
    // All in editor's set => editor, not admin
    expect(mapScopesToPermitRole(['App:install', 'App:read'])).toBe('editor')
  })
})
