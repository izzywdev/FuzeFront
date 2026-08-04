/**
 * The FuzeFront side of self-service custom domains (FF-EPIC-16 / FFRNT-91).
 *
 * Wraps `@fuzeone/custom-hostname-client` with this repo's flag gate and the
 * bits of policy that belong to us rather than to FuzeInfra:
 *
 *   - the default-OFF feature gate (see ./flags),
 *   - rejecting in-zone domains BEFORE spending an upstream call,
 *   - the Authentik redirect-URI registration that must happen on `active` and
 *     nowhere else.
 *
 * What this module deliberately does NOT do:
 *
 *   - **No DNS polling verifier.** We do not generate a `_fuzefront-verify` TXT
 *     token and we do not resolve DNS to check one. Cloudflare's own
 *     `_cf-custom-hostname` validation is the same proof of DNS control,
 *     checked by the party that also issues the certificate, and it is one
 *     fewer record for the customer to publish. The records to show the
 *     customer come from `verification.records[]` on the API response.
 *   - **No Cloudflare credential.** FuzeInfra holds the Cloudflare token in its
 *     own namespace precisely so consumers never do. The only secret here is
 *     the bearer token identifying our route profile.
 *   - **No persistence.** See the note on `portal_domains` below.
 *
 * ## `portal_domains` — not yet available
 *
 * FF-EPIC-16 §5 asks for status to be persisted onto `portal_domains`. That
 * table does not exist in this repo: `portals`/`portal_domains` appear only in
 * the planning docs and in `services/portal-service/openapi.yaml`, which is a
 * contract with no implementation behind it. There is no migration creating
 * either table and no portal-context resolver to route a verified domain.
 *
 * Rather than invent a schema here, this module exposes a `DomainStatePatch`
 * — exactly the fields a `portal_domains` row needs — and hands it to an
 * injected `DomainStateStore`. When FF-EPIC-09 lands the table, the store
 * becomes a repository and nothing else in this file changes.
 */

import {
  CustomHostnameApiError,
  CustomHostnameClient,
  isAdvertisable,
  isTerminal,
  nextPollDelayMs,
  type CustomHostname,
  type DnsStatus,
  type TlsStatus,
  type VerificationRecord,
} from '@fuzeone/custom-hostname-client'
import { isCustomDomainsEnabled, type FlagContext } from './flags'

/**
 * Zones FuzeInfra already serves with a static wildcard. Sending one of these
 * is a `422 validation_error` upstream — it would burn Cloudflare quota and
 * shadow the wildcard certificate. We reject locally too, so the common
 * mistake never costs a round trip.
 *
 * `.local` is included for the kind overlay, whose wildcard is
 * `*.fuzefront.local`.
 */
export const MANAGED_ZONES = ['fuzefront.com', 'fuzefront.local'] as const

/** Thrown for input we reject before calling upstream. Mirrors the API's code. */
export class CustomDomainValidationError extends Error {
  readonly code = 'validation_error' as const
  constructor(message: string) {
    super(message)
    this.name = 'CustomDomainValidationError'
    Object.setPrototypeOf(this, CustomDomainValidationError.prototype)
  }
}

/** Thrown when the feature flag is off. Never leaks that the feature exists. */
export class CustomDomainsDisabledError extends Error {
  readonly code = 'feature_disabled' as const
  constructor() {
    super('Custom domains are not enabled')
    this.name = 'CustomDomainsDisabledError'
    Object.setPrototypeOf(this, CustomDomainsDisabledError.prototype)
  }
}

/**
 * The projection of a Custom Hostname onto a `portal_domains` row.
 *
 * `dnsStatus`/`tlsStatus` carry FuzeInfra's normalized enums verbatim — they
 * are already mapped from Cloudflare's rawer vocabulary, and unknown upstream
 * states deliberately arrive as `pending` rather than as a failure. Re-mapping
 * them here would only re-introduce the coupling FuzeInfra removed.
 *
 * `provider.*` is intentionally absent: it is a debugging passthrough
 * explicitly outside the frozen contract, so it must never reach persistence
 * where something could later branch on it.
 */
export interface DomainStatePatch {
  domain: string
  dnsStatus: DnsStatus
  tlsStatus: TlsStatus
  /** The ONLY field to gate on before advertising the domain to a user. */
  active: boolean
  /** Records the customer must publish, ordered ownership → certificate → routing. */
  verificationRecords: VerificationRecord[]
  cnameTarget: string | null
  error: string | null
  updatedAt: string
}

export interface DomainStateStore {
  /** Upsert the projection onto the portal's domain row. */
  save(portalId: string, patch: DomainStatePatch): Promise<void>
}

/** Registers/deregisters the per-portal OIDC redirect URI. See ./authentikRedirect. */
export interface RedirectUriRegistrar {
  register(domain: string): Promise<void>
  deregister(domain: string): Promise<void>
}

export interface CustomHostnameServiceDeps {
  client: CustomHostnameClient
  store?: DomainStateStore
  redirectUris?: RedirectUriRegistrar
  flagContext?: Partial<FlagContext>
}

export function toDomainStatePatch(hostname: CustomHostname): DomainStatePatch {
  return {
    domain: hostname.domain,
    dnsStatus: hostname.dns_status,
    tlsStatus: hostname.tls_status,
    active: isAdvertisable(hostname),
    verificationRecords: orderedRecords(hostname),
    cnameTarget: hostname.routing?.cname_target ?? null,
    error: hostname.error ?? null,
    updatedAt: hostname.updated_at ?? hostname.created_at,
  }
}

function orderedRecords(hostname: CustomHostname): VerificationRecord[] {
  // Re-exported from the client so ordering policy lives in exactly one place.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { orderedVerificationRecords } = require('@fuzeone/custom-hostname-client')
  return orderedVerificationRecords(hostname)
}

/** Reject in-zone/wildcard domains before spending an upstream call. */
export function assertAttachable(domain: string): void {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized) {
    throw new CustomDomainValidationError('A domain is required')
  }
  if (normalized.includes('*')) {
    throw new CustomDomainValidationError('Wildcard domains are not supported')
  }
  for (const zone of MANAGED_ZONES) {
    if (normalized === zone || normalized.endsWith(`.${zone}`)) {
      throw new CustomDomainValidationError(
        `${normalized} is already served by the ${zone} wildcard and does not need a custom domain`
      )
    }
  }
}

export class CustomHostnameService {
  private readonly client: CustomHostnameClient
  private readonly store?: DomainStateStore
  private readonly redirectUris?: RedirectUriRegistrar
  private readonly flagContext?: Partial<FlagContext>
  /** Domains we have already registered a redirect URI for, to keep it once-only. */
  private readonly registered = new Set<string>()

  constructor(deps: CustomHostnameServiceDeps) {
    this.client = deps.client
    this.store = deps.store
    this.redirectUris = deps.redirectUris
    this.flagContext = deps.flagContext
  }

  private async assertEnabled(): Promise<void> {
    if (!(await isCustomDomainsEnabled(this.flagContext))) {
      throw new CustomDomainsDisabledError()
    }
  }

  /**
   * Attach a customer domain to a portal.
   *
   * Idempotent by contract — re-POSTing a known domain returns 200 with the
   * existing record, so this doubles as the documented **retry** for a
   * `failed`/`expired` certificate.
   */
  async attach(portalId: string, domain: string): Promise<DomainStatePatch> {
    await this.assertEnabled()
    assertAttachable(domain)
    const hostname = await this.client.createCustomHostname(domain.trim().toLowerCase())
    return this.project(portalId, hostname)
  }

  /** Poll one domain's status once. */
  async refresh(portalId: string, domain: string): Promise<DomainStatePatch> {
    await this.assertEnabled()
    const hostname = await this.client.getCustomHostname(domain)
    return this.project(portalId, hostname)
  }

  /**
   * Detach a domain: deregister its redirect URI, then deprovision.
   *
   * Order matters — the redirect URI is deregistered first so a half-failed
   * detach never leaves Authentik trusting a domain we no longer serve.
   * DELETE is idempotent (unknown domains also return 204), so a retry after a
   * partial failure is safe.
   */
  async detach(domain: string): Promise<void> {
    await this.assertEnabled()
    const normalized = domain.trim().toLowerCase()
    if (this.redirectUris) {
      await this.redirectUris.deregister(normalized)
    }
    this.registered.delete(normalized)
    await this.client.deleteCustomHostname(normalized)
  }

  /**
   * Persist the projection and, only once the domain is genuinely `active`,
   * register its OIDC redirect URI.
   *
   * Gating on `active` rather than on `tls_status === 'active'` is deliberate
   * and is the whole point of FuzeInfra's single boolean: a certificate can be
   * live while the routing Ingress is missing, and Authentik rejects
   * unregistered redirect URIs, so registering early produces a callback
   * failure that looks like an auth bug rather than a provisioning one.
   */
  private async project(
    portalId: string,
    hostname: CustomHostname
  ): Promise<DomainStatePatch> {
    const patch = toDomainStatePatch(hostname)
    if (this.store) {
      await this.store.save(portalId, patch)
    }
    if (patch.active && this.redirectUris && !this.registered.has(patch.domain)) {
      await this.redirectUris.register(patch.domain)
      this.registered.add(patch.domain)
    }
    return patch
  }

  /**
   * Poll until the domain reaches a terminal state.
   *
   * Uses FuzeInfra's documented schedule — every 10s for the first 2 minutes,
   * then every 60s. That is a rate limit we were asked to respect, not a tuning
   * knob: every GET is a Cloudflare API call. Polling stops on any terminal
   * state (active, or a terminal `failed`/`expired`/`blocked`), so a stuck
   * domain does not poll forever.
   *
   * `sleep` and `now` are injectable so tests exercise the real schedule
   * without real time passing.
   */
  async pollUntilSettled(
    portalId: string,
    domain: string,
    opts: {
      timeoutMs?: number
      sleep?: (ms: number) => Promise<void>
      now?: () => number
      onUpdate?: (patch: DomainStatePatch) => void
    } = {}
  ): Promise<DomainStatePatch> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const now = opts.now ?? (() => Date.now())
    const timeoutMs = opts.timeoutMs ?? 30 * 60_000
    const started = now()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hostname = await this.client.getCustomHostname(domain)
      const patch = await this.project(portalId, hostname)
      opts.onUpdate?.(patch)

      if (isTerminal(hostname)) return patch

      const elapsed = now() - started
      if (elapsed >= timeoutMs) return patch
      await sleep(nextPollDelayMs(elapsed))
    }
  }
}

export { CustomHostnameApiError }
