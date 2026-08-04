// Pure unit tests for the app-registry slice — no DB, no Kafka, no network.
// Covers: BOLA visibility predicates (canRead/canMutate), manifest validation
// (400 ValidationError shape), and the heartbeat/register request schemas.
import type { z } from 'zod'
import {
  appManifestSchema,
  registerAppRequestSchema,
  heartbeatRequestSchema,
  toValidationErrorBody,
} from '../src/app-registry/manifest.schema'
import { canRead, canMutate, AppRecord, AppCaller } from '../src/app-registry/service'

const baseManifest = {
  manifestVersion: '1' as const,
  slug: 'market',
  name: 'Market',
  menuLabel: 'Market',
  mode: 'portal' as const,
  integration: {
    type: 'module-federation' as const,
    remoteEntry: 'https://market.example.com/remoteEntry.js',
    scope: 'marketApp',
    module: './MarketApp',
  },
}

function appWith(partial: Partial<AppRecord> & { visibility?: any; organizationId?: string | null }): AppRecord {
  const { visibility, organizationId, ...rest } = partial
  return {
    slug: 'market',
    status: 'activated',
    mode: 'portal',
    builtin: false,
    organizationId: organizationId ?? null,
    manifest: { ...baseManifest, visibility: visibility ?? 'private' } as any,
    isHealthy: null,
    lastSeenAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...rest,
  }
}

const memberOfOrgA: AppCaller = {
  userId: 'u1',
  organizationIds: ['org-a'],
  roles: ['user'],
  isPlatformAdmin: false,
}
const platformAdmin: AppCaller = {
  userId: 'admin',
  organizationIds: [],
  roles: ['admin'],
  isPlatformAdmin: true,
}

describe('app-registry BOLA visibility (canRead)', () => {
  it('public/marketplace apps are readable by anyone', () => {
    expect(canRead(appWith({ visibility: 'public', organizationId: 'org-x' }), memberOfOrgA)).toBe(true)
    expect(canRead(appWith({ visibility: 'marketplace', organizationId: 'org-x' }), memberOfOrgA)).toBe(true)
  })

  it('organization apps are readable only by members of the owning org', () => {
    expect(canRead(appWith({ visibility: 'organization', organizationId: 'org-a' }), memberOfOrgA)).toBe(true)
    expect(canRead(appWith({ visibility: 'organization', organizationId: 'org-b' }), memberOfOrgA)).toBe(false)
  })

  it('private apps are readable only by the owning org (cross-org denied)', () => {
    expect(canRead(appWith({ visibility: 'private', organizationId: 'org-a' }), memberOfOrgA)).toBe(true)
    expect(canRead(appWith({ visibility: 'private', organizationId: 'org-b' }), memberOfOrgA)).toBe(false)
  })

  it('platform admin reads everything', () => {
    expect(canRead(appWith({ visibility: 'private', organizationId: 'org-z' }), platformAdmin)).toBe(true)
  })

  it('platform-global (org-less) apps are readable', () => {
    expect(canRead(appWith({ visibility: 'private', organizationId: null }), memberOfOrgA)).toBe(true)
  })
})

describe('app-registry BOLA mutation (canMutate)', () => {
  it('member of owning org may mutate', () => {
    expect(canMutate(appWith({ organizationId: 'org-a' }), memberOfOrgA)).toBe(true)
  })
  it('non-member may NOT mutate (cross-org)', () => {
    expect(canMutate(appWith({ organizationId: 'org-b' }), memberOfOrgA)).toBe(false)
  })
  it('org-less apps are platform-admin-only to mutate', () => {
    expect(canMutate(appWith({ organizationId: null }), memberOfOrgA)).toBe(false)
    expect(canMutate(appWith({ organizationId: null }), platformAdmin)).toBe(true)
  })
})

describe('app-registry manifest validation', () => {
  it('accepts a valid module-federation manifest', () => {
    const r = appManifestSchema.safeParse(baseManifest)
    expect(r.success).toBe(true)
  })

  it('rejects module-federation without remoteEntry/scope/module', () => {
    const r = appManifestSchema.safeParse({
      ...baseManifest,
      integration: { type: 'module-federation' },
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      // `r.error` is read through an explicit cast, not the `!r.success`
      // narrowing above. This service compiles with `strict: false`, and with
      // strictNullChecks off TypeScript will not discriminate zod's
      // SafeParseSuccess | SafeParseError union on its `success` literal — so
      // the guard reads correctly to a human but the compiler still sees the
      // whole union and rejects `.error` (TS2339). The runtime guard is what
      // makes this safe; the cast only tells tsc what the guard already proved.
      const body = toValidationErrorBody((r as z.SafeParseError<unknown>).error)
      expect(body.error).toBe('validation_error')
      const paths = body.fields.map(f => f.path)
      expect(paths).toEqual(expect.arrayContaining(['integration.remoteEntry']))
    }
  })

  it('rejects a bad slug', () => {
    const r = appManifestSchema.safeParse({ ...baseManifest, slug: 'Bad Slug!' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown extra fields (strict)', () => {
    const r = appManifestSchema.safeParse({ ...baseManifest, bogus: true })
    expect(r.success).toBe(false)
  })

  it('register request requires a manifest', () => {
    expect(registerAppRequestSchema.safeParse({}).success).toBe(false)
    expect(registerAppRequestSchema.safeParse({ manifest: baseManifest }).success).toBe(true)
  })

  it('heartbeat defaults status to online', () => {
    const r = heartbeatRequestSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('online')
  })
})
