/**
 * provision-s2s-clients.ts
 *
 * The generic Authentik `client_credentials` provisioning template for platform
 * service-to-service (S2S) identity — izzywdev/FuzeFront#648.
 *
 * Context: today every S2S channel (LiteLLM gateway, custom-hostname-api,
 * ChromaDB tenant tokens, FuzeCall's control-plane key) uses a pre-shared opaque
 * bearer token. All callers to a given endpoint share one identity — no
 * per-caller attribution, no per-caller Permit.io policy, no audit trail linking
 * a call to an owning service. This module is the replacement primitive: FuzeFront
 * (the platform's identity authority) provisions a named Authentik service-account
 * application per S2S relationship, with a client_id + client_secret and a bound
 * set of scopes, so every cross-service call is attributable and independently
 * revocable.
 *
 * This is deliberately NOT a new pattern — it generalizes the two existing
 * client_credentials provisioners in this same directory:
 *   - `provision-m2m-clients.ts` — a single hardcoded FuzeSocial registration app
 *   - `provision-a2a-clients.ts` — per-repo A2A callers, with a scope mapping that
 *     emits a fixed {repo, aud} shape
 * `registerS2SClient` takes the next step: an arbitrary service name AND an
 * arbitrary list of scopes, so it is the reusable template every future S2S
 * consumer (fuzecall-backend, fuzex-api, …) provisions through, without a new
 * bespoke provisioner module per relationship.
 *
 * Resources created per service (all idempotent — existing resources are left
 * untouched):
 *   1. Scope mapping  — "s2s:<service-slug>"  (scope_name "s2s", emits
 *      {"aud": "s2s", "service": "<service>", "scopes": [<granted scopes>]})
 *   2. OAuth2 Provider — "<service> (s2s)"  (client_credentials, confidential)
 *   3. Application    — slug "s2s-<service-slug>" bound to the provider above
 *
 * The `scopes` list is carried as a claim on the issued JWT (not enforced by
 * Authentik's OAuth2 scope grant machinery — Authentik does not variably grant a
 * subset of a client_credentials client's configured scopes per token request).
 * A consuming service authorizes by checking the `scopes` claim itself and/or
 * calling into Permit (see `utils/permit/machine-roles.ts`'s `grantServiceInvoke`
 * for wiring a service account to a Permit `ServiceEndpoint:invoke` grant).
 *
 * The returned `clientId` is safe to share; the `clientSecret` is the caller
 * credential and MUST be sealed on the consumer side (FuzeInfra's
 * `credential-handoff.json` documents how a consumer's client_id + sealed
 * client_secret flows into its namespace as a SealedSecret — that mechanism
 * lives in FuzeInfra and is out of scope here; delegate any change to it via
 * `@claude`).
 *
 * Rotation: rotating a service's `client_secret` in Authentik does not invalidate
 * tokens already issued under the old secret — they simply expire naturally at
 * `token_validity` (see DEFAULT_TOKEN_VALIDITY below). There is no revocation
 * step required beyond re-sealing the new secret on the consumer side before the
 * old one is deleted. See docs/runbooks/s2s-client-credentials.md.
 *
 * Required env vars:
 *   AUTHENTIK_ADMIN_TOKEN — API token with write access to the Authentik Admin API
 *   AUTHENTIK_BASE_URL    — base URL of the Authentik instance
 *                           (falls back to AUTHENTIK_ISSUER_URL stripped of the
 *                            application path, then http://localhost:9000)
 */

import axios from 'axios'
import {
  AUTHENTIK_TIMEOUT_MS,
  buildHeaders,
  ensureScopeMapping,
  findAcrossPages,
  getAuthentikAdminToken,
  getAuthentikBaseUrl,
  resolveAuthorizationFlow,
  resolveInvalidationFlow,
} from './authentik-admin'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The `aud` claim every S2S client_credentials token carries, regardless of
 * which service issued it — deliberately distinct from `a2a` (agent callers)
 * and `fuzefront` (the human web app). The per-service `service` claim
 * distinguishes callers within this shared audience. */
export const S2S_AUDIENCE = 's2s'

/** OAuth2 scope name the S2S scope mappings register under. */
export const S2S_SCOPE_NAME = 's2s'

/** Short-lived by default — see the rotation note above: the shorter this is,
 * the smaller the window between rotating a secret and every pre-rotation token
 * naturally expiring. */
export const DEFAULT_TOKEN_VALIDITY = 'hours=1'

/**
 * Service names are embedded into the Authentik expression and the token claim
 * a consumer checks, so restrict them to a safe, predictable shape (matches the
 * A2A provisioner's REPO_NAME_PATTERN).
 */
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/** A granted scope must be a colon/dot/dash-separated token — no whitespace,
 * quotes, or control characters that could make the JSON-encoded claim
 * ambiguous or oversized. */
const SCOPE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterS2SClientResult {
  /** OAuth2 client_id issued by Authentik — safe to share. */
  clientId: string
  /** OAuth2 client_secret — the caller credential; seal it, never commit it. */
  clientSecret: string
  /** The service name emitted as the `service` claim. */
  service: string
  /** The `aud` claim these tokens carry. */
  audience: string
  /** The granted scopes emitted as the `scopes` claim. */
  scopes: string[]
  /** Slug of the created OAuth2 provider/application. */
  applicationSlug: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(service: string): string {
  return service.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function validateInputs(service: string, scopes: string[]): void {
  if (!SERVICE_NAME_PATTERN.test(service)) {
    throw new Error(
      `[provision-s2s] Invalid service name "${service}". Expected a name matching ` +
      `${SERVICE_NAME_PATTERN} (e.g. "fuzecall-backend", "fuzex-api").`
    )
  }
  if (scopes.length === 0) {
    throw new Error('[provision-s2s] At least one scope is required.')
  }
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope)) {
      throw new Error(
        `[provision-s2s] Invalid scope "${scope}". Expected a name matching ${SCOPE_PATTERN} ` +
        '(e.g. "fuzecall:control-plane:auth").'
      )
    }
  }
}

/**
 * Ensures the per-service scope mapping that emits
 * {"aud": "s2s", "service": <service>, "scopes": [<scopes>]}.
 * Values are JSON-encoded into the (Python) expression so they are always
 * correctly quoted literals — inputs are also pattern-validated by the caller.
 */
async function ensureS2SScopeMapping(
  baseUrl: string,
  headers: Record<string, string>,
  service: string,
  scopes: string[]
): Promise<number> {
  const slug = toSlug(service)
  const expression =
    `return {"aud": ${JSON.stringify(S2S_AUDIENCE)}, ` +
    `"service": ${JSON.stringify(service)}, ` +
    `"scopes": ${JSON.stringify(scopes)}}`
  return ensureScopeMapping(baseUrl, headers, {
    name: `s2s:${slug}`,
    scopeName: S2S_SCOPE_NAME,
    expression,
  })
}

/**
 * Resolves (or creates) the "<service> (s2s)" OAuth2 provider, with the S2S
 * scope mapping attached. Returns the provider pk.
 */
async function ensureS2SProvider(
  baseUrl: string,
  headers: Record<string, string>,
  service: string,
  scopeMappingPk: number,
  tokenValidity: string
): Promise<number> {
  const providerName = `${service} (s2s)`

  const found = await findAcrossPages<{ pk: number; name: string }>(
    `${baseUrl}/api/v3/providers/oauth2/`,
    { name: providerName },
    headers,
    p => p.name === providerName
  )
  if (found) {
    console.log(`[provision-s2s] OAuth2 provider "${providerName}" already exists (pk=${found.pk})`)
    return found.pk
  }

  const authorizationFlow = await resolveAuthorizationFlow(baseUrl, headers)
  if (!authorizationFlow) {
    throw new Error(
      '[provision-s2s] No authorization flow found in Authentik — cannot create OAuth2 provider. ' +
      'Ensure at least one flow with designation "authorization" exists.'
    )
  }

  const invalidationFlow = await resolveInvalidationFlow(baseUrl, headers)
  if (!invalidationFlow) {
    throw new Error(
      '[provision-s2s] No invalidation flow found in Authentik — cannot create OAuth2 provider. ' +
      'Ensure at least one flow with designation "invalidation" exists.'
    )
  }

  const createRes = await axios.post(
    `${baseUrl}/api/v3/providers/oauth2/`,
    {
      name: providerName,
      authorization_flow: authorizationFlow,
      invalidation_flow: invalidationFlow,
      client_type: 'confidential',
      allowed_grant_types: ['client_credentials'],
      property_mappings: [scopeMappingPk],
      // Required field on 2024.x; client_credentials has no redirect leg.
      redirect_uris: [],
      sub_mode: 'hashed_user_id',
      issuer_mode: 'global',
      access_code_validity: 'minutes=1',
      token_validity: tokenValidity,
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-s2s] Created OAuth2 provider "${providerName}" (pk=${createRes.data.pk})`)
  return createRes.data.pk as number
}

/**
 * Resolves (or creates) the "s2s-<service-slug>" application bound to the provider.
 */
async function ensureS2SApplication(
  baseUrl: string,
  headers: Record<string, string>,
  service: string,
  providerPk: number
): Promise<string> {
  const slug = `s2s-${toSlug(service)}`
  const appName = `${service} (s2s)`

  const found = await findAcrossPages<{ slug: string; name: string }>(
    `${baseUrl}/api/v3/core/applications/`,
    { slug },
    headers,
    a => a.slug === slug
  )
  if (found) {
    console.log(`[provision-s2s] Application "${appName}" already exists (slug=${found.slug})`)
    return found.slug
  }

  await axios.post(
    `${baseUrl}/api/v3/core/applications/`,
    {
      name: appName,
      slug,
      provider: providerPk,
      meta_description: `S2S machine identity for ${service} (client_credentials; emits service+scopes claims)`,
      policy_engine_mode: 'any',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-s2s] Created application "${appName}" (slug=${slug})`)
  return slug
}

/** Reads the issued client_id / client_secret from the provider. */
async function readCredentials(
  baseUrl: string,
  headers: Record<string, string>,
  providerPk: number
): Promise<{ clientId: string; clientSecret: string }> {
  const res = await axios.get(`${baseUrl}/api/v3/providers/oauth2/${providerPk}/`, {
    headers,
    timeout: AUTHENTIK_TIMEOUT_MS,
  })
  return {
    clientId: res.data.client_id || '',
    clientSecret: res.data.client_secret || '',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Idempotently registers an S2S machine identity for `service` in Authentik and
 * returns its credentials. Safe to call repeatedly — existing resources are
 * reused (their scopes/expression are NOT rewritten on re-run; delete-and-recreate
 * by hand if the granted scope set must change). Throws if AUTHENTIK_ADMIN_TOKEN
 * is missing, an input is invalid, or the Authentik API rejects a create.
 */
export async function registerS2SClient(
  service: string,
  scopes: string[],
  opts: { tokenValidity?: string } = {}
): Promise<RegisterS2SClientResult> {
  validateInputs(service, scopes)

  const adminToken = getAuthentikAdminToken()
  if (!adminToken) {
    throw new Error(
      '[provision-s2s] AUTHENTIK_ADMIN_TOKEN is required to register an S2S machine identity. ' +
      'Run this in-cluster where the admin token is available (never from CI / a public host).'
    )
  }

  const baseUrl = getAuthentikBaseUrl()
  const headers = buildHeaders(adminToken)
  const tokenValidity = opts.tokenValidity ?? DEFAULT_TOKEN_VALIDITY

  console.log(
    `[provision-s2s] Registering S2S machine identity "${service}" (scopes: ${scopes.join(', ')}) against ${baseUrl}`
  )

  const scopePk = await ensureS2SScopeMapping(baseUrl, headers, service, scopes)
  const providerPk = await ensureS2SProvider(baseUrl, headers, service, scopePk, tokenValidity)
  const applicationSlug = await ensureS2SApplication(baseUrl, headers, service, providerPk)
  const { clientId, clientSecret } = await readCredentials(baseUrl, headers, providerPk)

  return {
    clientId,
    clientSecret,
    service,
    audience: S2S_AUDIENCE,
    scopes,
    applicationSlug,
  }
}
