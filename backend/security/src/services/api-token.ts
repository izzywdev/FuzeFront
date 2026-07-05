/**
 * API token service.
 *
 * Token format: ff_live_<PREFIX>.<BODY>
 *   - ff_live_  : 8-char fixed header (enables secret scanning)
 *   - PREFIX    : 22-char base62-encoded crypto.randomBytes(16) — stored as token_prefix
 *   - .         : separator
 *   - BODY      : crypto.randomBytes(32).toString('base64url') — 43 chars
 *   Full length: 8 + 22 + 1 + 43 = 74 chars
 *
 * Hash input = "prefix.body" (WITHOUT the ff_live_ header).
 * Hash       = SHA-256 hex (64 chars) stored as token_hash.
 *
 * Security invariants:
 *   - Raw token is NEVER stored or logged. Only token_prefix may be logged.
 *   - verifyToken MUST use crypto.timingSafeEqual for hash comparison.
 *   - SHA-256 is intentional — no bcrypt/argon2 for API tokens.
 */
import crypto from 'crypto'
import { db as defaultDb } from '../config/database'
import { permitSchema } from '../permit/schema'
import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full DB row shape (internal use only — includes token_hash). */
interface ApiTokenDbRow {
  id: string
  token_prefix: string
  token_hash: string
  owner_type: 'user' | 'org'
  owner_id: string
  name: string
  scopes: string[] | string
  expires_at: Date | null
  last_used_at: Date | null
  created_by: string | null
  revoked_at: Date | null
  created_at: Date
  updated_at: Date
}

/** Public token row — token_hash is omitted; scopes is always string[]. */
export type ApiTokenRow = Omit<ApiTokenDbRow, 'token_hash' | 'scopes'> & { scopes: string[] }

/**
 * Discriminated union returned by verifyToken.
 * - 'valid'   : token authenticated; row attached (token_hash excluded from row)
 * - 'revoked' : prefix found but token was revoked
 * - 'expired' : prefix found but token is past expires_at
 * - 'invalid' : token could not be parsed, prefix not found, or hash mismatch
 */
export type VerifyResult =
  | { status: 'valid'; token: ApiTokenRow }
  | { status: 'revoked' }
  | { status: 'expired' }
  | { status: 'invalid' }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Defensively parse a jsonb scopes value into string[].
 * Real pg returns jsonb columns as a JSON string; mocked DBs in tests may
 * hand back an already-parsed array.  This handles both.
 */
function parseScopes(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw
  return JSON.parse(raw || '[]')
}

// ---------------------------------------------------------------------------
// Internal: base62 encoder
// ---------------------------------------------------------------------------

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE62_LENGTH = BigInt(62)

/**
 * Encode a Buffer as a base62 string.
 * Interprets the buffer bytes as a big-endian unsigned integer, then converts
 * to base62. Left-pads / right-truncates to exactly `targetLen` characters.
 */
export function encodeBase62(buf: Buffer, targetLen: number): string {
  // Interpret bytes as big-endian bigint
  let n = BigInt(0)
  for (const byte of buf) {
    n = (n << BigInt(8)) | BigInt(byte)
  }

  // Build base62 digits (least-significant first)
  const digits: string[] = []
  if (n === BigInt(0)) {
    digits.push(BASE62_ALPHABET[0])
  } else {
    while (n > BigInt(0)) {
      digits.push(BASE62_ALPHABET[Number(n % BASE62_LENGTH)])
      n = n / BASE62_LENGTH
    }
  }

  // Reverse to most-significant first
  const result = digits.reverse().join('')

  // Left-pad with '0' if shorter than targetLen, then take last targetLen chars
  const padded = result.padStart(targetLen, '0')
  return padded.slice(-targetLen)
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Generate a new API token.
 * Returns the raw token (shown once), the token_prefix (safe to store/log),
 * and the token_hash (sha256 of prefix.body, stored in DB).
 */
export function generateToken(): { raw: string; prefix: string; hash: string } {
  const prefixBytes = crypto.randomBytes(16)
  const prefix = encodeBase62(prefixBytes, 22)
  const body = crypto.randomBytes(32).toString('base64url')
  const raw = `ff_live_${prefix}.${body}`
  const hash = hashToken(`${prefix}.${body}`)
  return { raw, prefix, hash }
}

/**
 * Compute SHA-256 hex hash of a "prefix.body" string (WITHOUT the ff_live_ header).
 */
export function hashToken(prefixDotBody: string): string {
  return crypto.createHash('sha256').update(prefixDotBody).digest('hex')
}

/**
 * Parse a raw ff_live_ token into its prefix and body parts.
 * Returns null if the token does not match the expected shape.
 */
export function extractParts(rawToken: string): { prefix: string; body: string } | null {
  if (!rawToken || !rawToken.startsWith('ff_live_')) return null
  const afterHeader = rawToken.slice('ff_live_'.length)
  const dotIdx = afterHeader.indexOf('.')
  if (dotIdx === -1) return null
  const prefix = afterHeader.slice(0, dotIdx)
  const body = afterHeader.slice(dotIdx + 1)
  if (!prefix || !body) return null
  return { prefix, body }
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/**
 * Create a new API token and persist it to the database.
 * The raw token is returned ONCE; only the prefix and hash are stored.
 */
export async function createToken(
  params: {
    name: string
    ownerType: 'user' | 'org'
    ownerId: string
    scopes: string[]
    expiresAt: Date | null
    createdBy: string
  },
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<{
  id: string
  token: string
  token_prefix: string
  name: string
  scopes: string[]
  expires_at: Date | null
  created_at: Date
}> {
  const { raw, prefix, hash } = generateToken()

  const row = {
    token_prefix: prefix,
    token_hash: hash,
    owner_type: params.ownerType,
    owner_id: params.ownerId,
    name: params.name,
    scopes: JSON.stringify(params.scopes),
    expires_at: params.expiresAt,
    created_by: params.createdBy,
  }

  const [inserted] = await (dbInstance as any)('api_tokens')
    .insert(row)
    .returning(['id', 'token_prefix', 'name', 'scopes', 'expires_at', 'created_at'])

  return {
    id: inserted.id,
    token: raw, // raw returned ONCE; never stored
    token_prefix: inserted.token_prefix,
    name: inserted.name,
    scopes: parseScopes(inserted.scopes),
    expires_at: inserted.expires_at,
    created_at: inserted.created_at,
  }
}

/**
 * Verify a raw API token.
 * Returns a VerifyResult discriminated union:
 *   - 'invalid'  : unparseable / unknown prefix / hash mismatch
 *   - 'revoked'  : token was revoked
 *   - 'expired'  : token is past expires_at
 *   - 'valid'    : token authenticated; attached row excludes token_hash
 */
export async function verifyToken(
  rawToken: string,
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<VerifyResult> {
  const parts = extractParts(rawToken)
  if (!parts) return { status: 'invalid' }

  const { prefix, body } = parts

  const row: ApiTokenDbRow | null = await (dbInstance as any)('api_tokens')
    .where({ token_prefix: prefix })
    .first()

  if (!row) return { status: 'invalid' }

  if (row.revoked_at != null) return { status: 'revoked' }

  if (row.expires_at != null && row.expires_at <= new Date()) return { status: 'expired' }

  // Constant-time hash comparison.
  // Both hashes are always 64-hex chars (256-bit SHA-256), so lengths are equal.
  // Guard against any length mismatch anyway (treat as invalid).
  const storedHash = row.token_hash
  const computedHash = hashToken(`${prefix}.${body}`)

  if (storedHash.length !== computedHash.length) {
    return { status: 'invalid' }
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    Buffer.from(computedHash, 'hex')
  )

  if (!match) return { status: 'invalid' }

  // Return the row without token_hash exposed; parse scopes from jsonb string
  const { token_hash: _omit, ...safeRow } = row as any
  safeRow.scopes = parseScopes(safeRow.scopes)
  return { status: 'valid', token: safeRow as ApiTokenRow }
}

/**
 * Revoke a token by id.
 * Sets revoked_at on the row if it is not already revoked.
 * Returns true if a row was updated, false otherwise.
 */
export async function revokeToken(
  tokenId: string,
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<boolean> {
  const count = await (dbInstance as any)('api_tokens')
    .where({ id: tokenId })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date() })

  return count > 0
}

/** Columns to select when returning rows to callers — excludes token_hash. */
const SAFE_COLUMNS = [
  'id',
  'token_prefix',
  'owner_type',
  'owner_id',
  'name',
  'scopes',
  'expires_at',
  'last_used_at',
  'created_by',
  'revoked_at',
  'created_at',
  'updated_at',
]

/**
 * List all tokens for an owner (user or org).
 * Excludes token_hash. Returns all rows (active + revoked) ordered by created_at desc.
 */
export async function listTokensForOwner(
  ownerType: 'user' | 'org',
  ownerId: string,
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<ApiTokenRow[]> {
  const rows: ApiTokenDbRow[] = await (dbInstance as any)('api_tokens')
    .select(SAFE_COLUMNS)
    .where({ owner_type: ownerType, owner_id: ownerId })
    .orderBy('created_at', 'desc')
  return rows.map(r => ({ ...r, scopes: parseScopes(r.scopes) }))
}

/**
 * Fetch a single token row by id.
 * Excludes token_hash. Returns null if not found.
 */
export async function getTokenById(
  tokenId: string,
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<ApiTokenRow | null> {
  const row: ApiTokenDbRow | null = await (dbInstance as any)('api_tokens')
    .select(SAFE_COLUMNS)
    .where({ id: tokenId })
    .first()
  if (!row) return null
  return { ...row, scopes: parseScopes(row.scopes) }
}

/**
 * Update the last_used_at timestamp for a token.
 * Fire-and-forget: callers may choose not to await this.
 */
export async function updateLastUsed(
  tokenId: string,
  dbInstance: Knex = defaultDb as unknown as Knex
): Promise<void> {
  await (dbInstance as any)('api_tokens')
    .where({ id: tokenId })
    .update({ last_used_at: new Date() })
}

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

/**
 * Map a set of scopes to the MINIMAL Permit role whose permission set is a
 * superset of all requested scopes.
 *
 * Algorithm:
 *   viewer  — if every scope is in viewer's permission set
 *   editor  — else if every scope is in editor's permission set
 *   admin   — otherwise
 *
 * Permission sets are imported from permit/schema.ts to stay in sync with
 * any future schema changes.
 */
export function mapScopesToPermitRole(scopes: string[]): 'viewer' | 'editor' | 'admin' {
  const roles = permitSchema.roles

  const viewerRole = roles.find(r => r.key === 'viewer')
  const editorRole = roles.find(r => r.key === 'editor')

  const viewerPerms = new Set(viewerRole ? viewerRole.permissions : [])
  const editorPerms = new Set(editorRole ? editorRole.permissions : [])

  if (scopes.every(s => viewerPerms.has(s))) return 'viewer'
  if (scopes.every(s => editorPerms.has(s))) return 'editor'
  return 'admin'
}
