/**
 * Multi-tenant registry for the Authentik-backed identity provider.
 *
 * security-service is the single front door for identity across every tenant;
 * Authentik is an implementation detail behind it (see config.ts — "no vendor
 * name leaks past this boundary into the API surface"). Each tenant is backed
 * by its OWN Authentik instance with its own database, so two tenants' account
 * directories are unrelated: an account in one cannot sign in to the other, and
 * the same email may exist independently in both.
 *
 * This module owns the mapping from an inbound request host to the Authentik
 * instance that serves it. Nothing else in the service should read
 * `process.env.AUTHENTIK_*` directly.
 *
 * ── Two modes, and why ───────────────────────────────────────────────────────
 *
 * LEGACY (default, `SECURITY_TENANTS` unset): a single tenant is synthesised
 * from the existing `AUTHENTIK_*` environment variables and serves EVERY host.
 * This reproduces today's single-tenant behaviour exactly — deployments that
 * have not opted in see no change whatsoever.
 *
 * MULTI (`SECURITY_TENANTS` set): hosts are matched against the declared
 * tenants and an unknown host is REJECTED. The fail-closed rule deliberately
 * engages only in this mode. Applying it in legacy mode would break FuzeFront
 * immediately, because requests legitimately arrive on many hosts there
 * (app.fuzefront.com, fuzefront.dev.local, localhost, in-cluster service DNS).
 * Once you declare tenants you are asserting the full host list, and at that
 * point silently falling back to the first tenant would authenticate a user
 * against the WRONG directory — which is the one failure this whole split
 * exists to prevent. So: no fallback, no "default tenant", reject.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface AuthentikTenant {
  /** Stable identifier. Embedded in sessions, so changing one invalidates them. */
  id: string
  /** Hosts this tenant serves. Compared case-insensitively, port stripped. */
  hosts: string[]
  /** Browser-facing issuer used for OIDC discovery. */
  issuerUrl: string
  /** In-cluster base for server-side calls (token/userinfo/jwks/flow-executor). */
  baseUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Admin API token for server-side account operations. */
  adminToken: string
  /** Enrollment flow slug inside THIS tenant's Authentik. */
  enrollmentFlowSlug: string
  /**
   * Authentication flow slug inside THIS tenant's Authentik, driven by the
   * server-side flow-executor (authentikPassword.ts). Each tenant's Authentik
   * instance is free to name its login flow differently, so — like
   * enrollmentFlowSlug — this must not fall back to a global default that
   * silently points every tenant at the same slug.
   */
  authFlowSlug: string
  /** Origin the browser talks to for this tenant (same-origin API base). */
  appBaseUrl: string
  /** Whether the server-brokered social path is active for this tenant. */
  googleBrokered: boolean
  /**
   * OPTIONAL per-tenant Google OAuth client. Omit to share the platform-wide
   * client (GOOGLE_CLIENT_ID/SECRET) — today's behaviour, and fine where the
   * consent screen's branding does not matter.
   *
   * Supply them where it does. A tenant whose whole premise is that FuzeFront
   * is invisible to it should NOT send its users to a Google consent screen
   * displaying FuzeFront's application name; giving that tenant its own Google
   * client is the only way to brand it. This is deliberately configuration, not
   * a code fork: adding a client later is a values change, and until then the
   * shared client keeps working.
   */
  googleClientId?: string
  googleClientSecret?: string
}

/** Thrown when a request arrives on a host no tenant claims (MULTI mode). */
export class UnknownTenantHostError extends Error {
  readonly host: string
  constructor(host: string) {
    super(`No identity tenant is configured for host "${host}"`)
    this.name = 'UnknownTenantHostError'
    this.host = host
  }
}

/** Thrown when tenant-scoped config is read with no tenant in context. */
export class NoTenantContextError extends Error {
  constructor(what: string) {
    super(
      `${what} was read outside a tenant context. Wrap non-request callers in ` +
        `runWithTenant(tenant, fn); request paths get this from tenantContext middleware.`
    )
    this.name = 'NoTenantContextError'
  }
}

/**
 * Normalise a Host header for comparison: lowercase, strip the port, strip a
 * trailing dot (fully-qualified form), strip IPv6 brackets. `Host` is
 * attacker-influenced, so it is only ever used to LOOK UP a declared tenant —
 * never to construct a URL we then call.
 */
export function normaliseHost(host: string | undefined | null): string {
  if (!host) return ''
  let h = host.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    if (end !== -1) return h.slice(1, end)
  }
  const colon = h.lastIndexOf(':')
  if (colon !== -1 && !h.slice(colon + 1).includes(':')) h = h.slice(0, colon)
  if (h.endsWith('.')) h = h.slice(0, -1)
  return h
}

function envHost(url: string | undefined): string[] {
  if (!url) return []
  try {
    return [normaliseHost(new URL(url).host)].filter(Boolean)
  } catch {
    return []
  }
}

/** Build the implicit single tenant from the pre-multi-tenant env vars. */
function legacyTenant(): AuthentikTenant {
  const appBase = (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')
  return {
    id: process.env.SECURITY_TENANT_ID || 'fuzefront',
    hosts: envHost(appBase),
    issuerUrl:
      process.env.AUTHENTIK_ISSUER_URL || 'http://localhost:9000/application/o/fuzefront/',
    baseUrl: (process.env.AUTHENTIK_BASE_URL || '').replace(/\/$/, ''),
    clientId: process.env.AUTHENTIK_CLIENT_ID || '',
    clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || '',
    redirectUri:
      process.env.AUTHENTIK_REDIRECT_URI || 'http://fuzefront.dev.local/api/auth/oidc/callback',
    adminToken: process.env.AUTHENTIK_ADMIN_TOKEN || '',
    enrollmentFlowSlug: process.env.AUTHENTIK_ENROLLMENT_FLOW_SLUG || 'fuzefront-enrollment',
    authFlowSlug: process.env.AUTHENTIK_AUTH_FLOW_SLUG || 'default-authentication-flow',
    appBaseUrl: appBase,
    googleBrokered: process.env.SECURITY_GOOGLE_BROKERED !== 'false',
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
  }
}

interface RawTenant extends Partial<AuthentikTenant> {
  id?: string
  hosts?: string[]
}

function requireField(raw: RawTenant, field: keyof AuthentikTenant, index: number): string {
  const v = raw[field]
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(
      `SECURITY_TENANTS[${index}] (${raw.id ?? 'unnamed'}): "${field}" is required and must be a non-empty string`
    )
  }
  return v
}

/**
 * Per-tenant secret lookup.
 *
 * Secrets must NOT be inlined in SECURITY_TENANTS: that value is a plain env
 * var, visible in `kubectl describe pod` and in any log that dumps the
 * environment. Instead each tenant's client secret and admin token are read
 * from conventional per-tenant variables, which the chart wires from the
 * Secret via secretKeyRef:
 *
 *   SECURITY_TENANT_<ID>_CLIENT_SECRET
 *   SECURITY_TENANT_<ID>_ADMIN_TOKEN
 *   SECURITY_TENANT_<ID>_GOOGLE_CLIENT_SECRET
 *
 * <ID> is the tenant id upper-cased with non-alphanumerics as underscores.
 * An inline value in the JSON still wins where one is supplied (local dev and
 * tests), so this is additive.
 */
function tenantSecret(id: string, suffix: string): string | undefined {
  const key = `SECURITY_TENANT_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${suffix}`
  const v = process.env[key]
  return v && v.trim() !== '' ? v : undefined
}

function parseTenants(json: string): AuthentikTenant[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    throw new Error(`SECURITY_TENANTS is not valid JSON: ${(e as Error).message}`)
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('SECURITY_TENANTS must be a non-empty JSON array of tenant objects')
  }

  const tenants = (raw as RawTenant[]).map((t, i) => {
    const hosts = Array.isArray(t.hosts) ? t.hosts.map(normaliseHost).filter(Boolean) : []
    if (hosts.length === 0) {
      throw new Error(
        `SECURITY_TENANTS[${i}] (${t.id ?? 'unnamed'}): "hosts" must list at least one host`
      )
    }
    return {
      id: requireField(t, 'id', i),
      hosts,
      issuerUrl: requireField(t, 'issuerUrl', i),
      baseUrl: (t.baseUrl || '').replace(/\/$/, ''),
      clientId: requireField(t, 'clientId', i),
      clientSecret: t.clientSecret || tenantSecret(t.id ?? '', 'CLIENT_SECRET') || '',
      redirectUri: requireField(t, 'redirectUri', i),
      adminToken: t.adminToken || tenantSecret(t.id ?? '', 'ADMIN_TOKEN') || '',
      enrollmentFlowSlug: requireField(t, 'enrollmentFlowSlug', i),
      // Optional, unlike enrollmentFlowSlug: every product ships a bespoke
      // enrollment flow, but the LOGIN flow commonly stays at Authentik's
      // own out-of-box slug unless a tenant customises it.
      authFlowSlug: t.authFlowSlug || 'default-authentication-flow',
      appBaseUrl: requireField(t, 'appBaseUrl', i).replace(/\/$/, ''),
      googleBrokered: t.googleBrokered !== false,
      // Fall back to the platform-wide Google client when the tenant declares
      // none, so declaring tenants does not silently break social sign-in.
      googleClientId: t.googleClientId || process.env.GOOGLE_CLIENT_ID || undefined,
      googleClientSecret:
        t.googleClientSecret ||
        tenantSecret(t.id ?? '', 'GOOGLE_CLIENT_SECRET') ||
        process.env.GOOGLE_CLIENT_SECRET ||
        undefined,
    } as AuthentikTenant
  })

  // Reject collisions at BOOT rather than letting whichever tenant happens to
  // be first silently win a host at request time.
  const byHost = new Map<string, string>()
  const byId = new Set<string>()
  for (const t of tenants) {
    if (byId.has(t.id)) throw new Error(`SECURITY_TENANTS: duplicate tenant id "${t.id}"`)
    byId.add(t.id)
    for (const h of t.hosts) {
      const owner = byHost.get(h)
      if (owner) {
        throw new Error(
          `SECURITY_TENANTS: host "${h}" is claimed by both "${owner}" and "${t.id}"`
        )
      }
      byHost.set(h, t.id)
    }
  }
  return tenants
}

let cached: { tenants: AuthentikTenant[]; multi: boolean; byHost: Map<string, AuthentikTenant> } | null =
  null

function registry() {
  const json = process.env.SECURITY_TENANTS
  const multi = typeof json === 'string' && json.trim() !== ''

  // LEGACY mode is rebuilt from the environment on EVERY read, deliberately.
  // The functions this replaces (appBaseUrl, googleBrokeredEnabled, …) each
  // read process.env per call, so anything mutating the environment after boot
  // — notably tests — saw the new value immediately. Memoising would silently
  // change that for every existing deployment, which is precisely what legacy
  // mode exists to avoid. Rebuilding one small object is not worth caching.
  if (!multi) {
    const tenant = legacyTenant()
    const byHost = new Map<string, AuthentikTenant>()
    for (const h of tenant.hosts) byHost.set(h, tenant)
    return { tenants: [tenant], multi: false, byHost }
  }

  // MULTI mode IS memoised: SECURITY_TENANTS is static configuration, so
  // re-parsing and re-validating per call would be waste, and caching makes the
  // boot-time validation errors surface once rather than on every request.
  if (cached) return cached
  const tenants = parseTenants(json as string)
  const byHost = new Map<string, AuthentikTenant>()
  for (const t of tenants) for (const h of t.hosts) byHost.set(h, t)
  cached = { tenants, multi: true, byHost }
  return cached
}

/** Drop the memoised registry. Tests only — config is read once at boot. */
export function resetTenantRegistryForTests(): void {
  cached = null
}

export function isMultiTenant(): boolean {
  return registry().multi
}

export function allTenants(): AuthentikTenant[] {
  return registry().tenants
}

export function getTenantById(id: string): AuthentikTenant | undefined {
  return registry().tenants.find((t) => t.id === id)
}

/**
 * Resolve the tenant serving `host`.
 *
 * LEGACY mode: always the single tenant, whatever the host — today's behaviour.
 * MULTI mode: exact host match, or `undefined`. Callers MUST treat `undefined`
 * as a rejection and must not substitute a default.
 */
export function resolveTenantByHost(host: string | undefined | null): AuthentikTenant | undefined {
  const reg = registry()
  if (!reg.multi) return reg.tenants[0]
  return reg.byHost.get(normaliseHost(host))
}

const tenantStore = new AsyncLocalStorage<AuthentikTenant>()

/**
 * Run `fn` with `tenant` as the ambient tenant. Required for callers with no
 * HTTP request — provisioning scripts, seed jobs, Kafka consumers — which
 * cannot inherit a request-scoped value.
 */
export function runWithTenant<T>(tenant: AuthentikTenant, fn: () => T): T {
  return tenantStore.run(tenant, fn)
}

/** The ambient tenant, or `undefined` outside any tenant context. */
export function currentTenantOrUndefined(): AuthentikTenant | undefined {
  const t = tenantStore.getStore()
  if (t) return t
  // In legacy mode there is exactly one tenant and it serves everything, so
  // ambient context is unnecessary. In MULTI mode, absence is a real error.
  const reg = registry()
  return reg.multi ? undefined : reg.tenants[0]
}

/** The ambient tenant. Throws rather than guessing. */
export function currentTenant(what = 'Tenant configuration'): AuthentikTenant {
  const t = currentTenantOrUndefined()
  if (!t) throw new NoTenantContextError(what)
  return t
}
