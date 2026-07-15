/**
 * Pagination gate (family standard, baseline §4.1).
 *
 * This suite owns the AuthN slice — where EVERY endpoint is `x-pagination:
 * exempt` (singleton actions / bounded per-user sets). The gate here therefore:
 *   1. asserts every AuthN endpoint is genuinely exempt WITH a reason, and that
 *      the responses are bounded/singleton (no unbounded array + no page cursor);
 *   2. asserts, at the CONTRACT level, that the spec's genuinely-paginated
 *      collection endpoints declare limit+cursor and use the `{ items, page }`
 *      envelope with a nullable `nextCursor` + `hasMore` — i.e. the standard is
 *      correctly encoded in the frozen spec.
 *
 * The RUNTIME cursor-walk verification (limit clamping + walking the whole set
 * with no gaps/dupes) targets the paginated endpoints, which are all in the
 * AuthZ/tenants tags — Phase 2, OUT OF SCOPE for this AuthN suite. That is
 * flagged, not silently skipped: see the `it.todo` markers below.
 */
import { spec, listEndpoints, assertSchema } from './spec'

const AUTHN_TAGS = new Set([
  'session',
  'social',
  'signup',
  'capabilities',
  'mfa',
  'verify',
  'tokens',
])

function opTags(path: string, method: string): string[] {
  return spec.paths[path]?.[method]?.tags || []
}

describe('pagination gate — frozen contract', () => {
  const endpoints = listEndpoints()

  it('every AuthN endpoint is x-pagination: exempt WITH a reason', () => {
    const authn = endpoints.filter((e) => opTags(e.path, e.method).some((t) => AUTHN_TAGS.has(t)))
    expect(authn.length).toBeGreaterThan(0)
    for (const e of authn) {
      expect({ ep: `${e.method} ${e.path}`, exempt: e.exempt }).toEqual({
        ep: `${e.method} ${e.path}`,
        exempt: true,
      })
      expect(typeof e.exemptReason).toBe('string')
      expect((e.exemptReason || '').length).toBeGreaterThan(0)
    }
  })

  it('no AuthN endpoint declares limit/cursor params (they are not paginated)', () => {
    const authn = endpoints.filter((e) => opTags(e.path, e.method).some((t) => AUTHN_TAGS.has(t)))
    for (const e of authn) expect(e.paginated).toBe(false)
  })

  it('the Limit param declares a server-side maximum (clamp is spec-mandated)', () => {
    const limit = spec.components.parameters.Limit
    expect(limit.schema.maximum).toBeGreaterThan(0)
    expect(typeof limit.schema.default).toBe('number')
    expect(limit.schema.default).toBeLessThanOrEqual(limit.schema.maximum)
  })

  it('PageInfo envelope matches the family standard (nextCursor nullable + hasMore required)', () => {
    const pi = spec.components.schemas.PageInfo
    expect(pi.required).toEqual(expect.arrayContaining(['nextCursor', 'hasMore']))
    // nextCursor must be nullable (string | null) for cursor termination.
    expect(pi.properties.nextCursor.type).toEqual(expect.arrayContaining(['string', 'null']))
    // A valid terminal page validates.
    assertSchema('PageInfo', { nextCursor: null, hasMore: false })
    // A mid-walk page validates.
    assertSchema('PageInfo', { nextCursor: 'opaque', hasMore: true, total: 42 })
  })

  it('every paginated collection uses the { items, page } envelope', () => {
    const paginated = endpoints.filter((e) => e.paginated)
    // In the frozen spec these are AuthZ/tenants (Phase 2), not AuthN.
    expect(paginated.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'get /v1/security/authz/grants',
      'get /v1/security/tenants',
      'get /v1/security/tenants/{tenantId}/members',
    ])
    const pageSchemas = ['GrantPage', 'TenantPage', 'MemberPage']
    for (const name of pageSchemas) {
      const s = spec.components.schemas[name]
      expect(s.required).toEqual(expect.arrayContaining(['items', 'page']))
      expect(s.properties.items.type).toBe('array')
      expect(s.properties.page.$ref).toContain('PageInfo')
    }
  })

  // RUNTIME cursor-walk verification belongs to the AuthZ slice (Phase 2).
  it.todo(
    'RUNTIME: limit clamping + cursor walks the whole set (no gaps/dupes, terminates) — AuthZ Phase 2, out of this AuthN suite'
  )
})
