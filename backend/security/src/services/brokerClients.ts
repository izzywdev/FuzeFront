/**
 * Broker-client registry — consumer-product sign-in handoff (#238).
 *
 * The frozen contract (`packages/security/openapi.yaml`, `broker` tag) is
 * explicit that registration itself ("the `BrokerClient` registration
 * surface") is out of scope for THIS contract slice — there is no public
 * write endpoint. So the registry here is server-side configuration, not a
 * database table: a JSON array in `BROKER_CLIENTS_JSON`, one entry per
 * registered consumer product (e.g. the Mendys datasets marketplace, #238).
 *
 * Fail-closed: a missing/empty/malformed env value yields an EMPTY registry
 * (every client key resolves to "unknown"), never a wildcard allow. A
 * malformed individual entry is skipped (logged), not fatal to the rest of
 * the registry.
 *
 * Shape per entry:
 *   {
 *     "client": "mendys-datasets",
 *     "clientSecret": "<confidential, server-to-server only>",
 *     "redirectUris": ["https://marketplace.mendysrobotics.com/api/dsm/auth/callback"],
 *     "branding": { "name": "Mendys Datasets", "logo": null, "favicon": null, "accent": null, "tagline": null }
 *   }
 *
 * `redirectUris` is matched EXACTLY (no prefix/subdomain match) per contract.
 * `clientSecret` is NEVER exposed by `getBrokerClientPublicBranding` — only
 * `client` + `branding` are public (the themed sign-in page's branding read).
 */
import crypto from 'crypto'
import { logger } from '../lib/logger'

export interface BrokerClientBranding {
  name: string
  logo?: string | null
  favicon?: string | null
  accent?: string | null
  tagline?: string | null
}

export interface BrokerClientConfig {
  client: string
  clientSecret: string
  redirectUris: string[]
  branding: BrokerClientBranding
}

export interface BrokerClientPublic {
  client: string
  branding: BrokerClientBranding
}

let cache: Map<string, BrokerClientConfig> | null = null

function isValidBranding(value: unknown): value is BrokerClientBranding {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name) return false
  const optionalStringOrNull = (v: unknown) => v === undefined || v === null || typeof v === 'string'
  return (
    optionalStringOrNull(b.logo) &&
    optionalStringOrNull(b.favicon) &&
    optionalStringOrNull(b.accent) &&
    optionalStringOrNull(b.tagline)
  )
}

function isValidEntry(value: unknown): value is BrokerClientConfig {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return (
    typeof e.client === 'string' &&
    !!e.client &&
    typeof e.clientSecret === 'string' &&
    !!e.clientSecret &&
    Array.isArray(e.redirectUris) &&
    e.redirectUris.length > 0 &&
    e.redirectUris.every(u => typeof u === 'string' && !!u) &&
    isValidBranding(e.branding)
  )
}

function loadRegistry(): Map<string, BrokerClientConfig> {
  if (cache) return cache
  const map = new Map<string, BrokerClientConfig>()
  const raw = process.env.BROKER_CLIENTS_JSON
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        logger.error('brokerClients: BROKER_CLIENTS_JSON is not a JSON array — registry is EMPTY (fail-closed)')
      } else {
        for (const entry of parsed) {
          if (isValidEntry(entry)) {
            map.set(entry.client, entry)
          } else {
            logger.warn(
              { client: (entry as Record<string, unknown> | null)?.client },
              'brokerClients: skipping malformed registry entry'
            )
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'brokerClients: BROKER_CLIENTS_JSON failed to parse — registry is EMPTY (fail-closed)')
    }
  }
  cache = map
  return map
}

export function getBrokerClient(client: string): BrokerClientConfig | undefined {
  if (!client) return undefined
  return loadRegistry().get(client)
}

/** Public projection — NEVER includes redirectUris or clientSecret. */
export function getBrokerClientPublicBranding(client: string): BrokerClientPublic | undefined {
  const cfg = getBrokerClient(client)
  if (!cfg) return undefined
  return { client: cfg.client, branding: cfg.branding }
}

/** Exact match only — no wildcard, prefix, or subdomain matching. */
export function isAllowedRedirectUri(client: string, redirectUri: string): boolean {
  const cfg = getBrokerClient(client)
  if (!cfg) return false
  return cfg.redirectUris.includes(redirectUri)
}

/**
 * Constant-time comparison so this check cannot be timed into an oracle; the
 * caller (route) ALSO always returns the same generic 401 regardless of which
 * of {unknown client, wrong secret, unknown/expired code} failed.
 */
export function verifyClientSecret(client: string, clientSecret: string): boolean {
  const cfg = getBrokerClient(client)
  if (!cfg || typeof clientSecret !== 'string') return false
  // Hash both sides to a fixed-length digest before comparing so a length
  // mismatch never short-circuits the check — timingSafeEqual alone still
  // leaks the registered secret's byte length via an early return on
  // differing input lengths.
  const expected = crypto.createHash('sha256').update(cfg.clientSecret).digest()
  const actual = crypto.createHash('sha256').update(clientSecret).digest()
  return crypto.timingSafeEqual(expected, actual)
}

/** Test-only: forces the next read to re-parse `BROKER_CLIENTS_JSON`. */
export function __resetBrokerClientRegistryForTests(): void {
  cache = null
}
