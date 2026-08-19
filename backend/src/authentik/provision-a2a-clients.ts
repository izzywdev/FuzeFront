/**
 * provision-a2a-clients.ts
 *
 * Registers a machine identity for an A2A (agent-to-agent) caller as an
 * Authentik `client_credentials` OAuth2 application whose access tokens carry
 * the claims the A2A authorization model needs.
 *
 * Background (izzywdev/FuzeFront#364, FuzeAgent#93 GO-LIVE §1b):
 * A2A's frozen contract (`agent-templates/contracts/a2a/v1/authz.md §2`)
 * validates a caller by standard stateless JWT: check `iss`, check `aud`, then
 * read a claim → resolve the caller's repo name and check it against the
 * callee's `providesTo` allowlist. The pre-existing M2M provider
 * (`registerMachineClient` / `provisionM2MClients`) emits neither a repo name
 * (`sub` is a hashed id, the only stable key is the opaque `client_id`) nor a
 * meaningful `aud`, so its tokens fail that validation.
 *
 * The chosen design (Option 2 — repo-name JWTs) attaches a per-agent scope
 * mapping to the provider whose expression emits:
 *
 *   return {"repo": "<RepoName>", "aud": "a2a"}
 *
 * so the A2A server sets `callerClaim: "repo"` and `audience: "a2a"` and does
 * ordinary JWKS validation — no introspection round-trip, no per-pod
 * introspection credential, no `client_id → repo` map to maintain.
 *
 * Resources created per agent (all idempotent — existing resources are left
 * untouched):
 *   1. Scope mapping  — "a2a:<repo-slug>"  (scope_name "a2a", emits repo+aud)
 *   2. OAuth2 Provider — "<RepoName> (a2a)"  (client_credentials, confidential)
 *   3. Application    — slug "a2a-<repo-slug>" bound to the provider above
 *
 * The returned `clientId` is safe to post publicly; the `clientSecret` is the
 * caller credential and MUST be sealed on the FuzeAgent side (never committed).
 *
 * This is intended to run IN-CLUSTER against prod Authentik (the security /
 * backend pod already carries AUTHENTIK_ADMIN_TOKEN + AUTHENTIK_BASE_URL);
 * CLAUDE.md forbids operating the prod cluster from CI. See the companion CLI
 * `register-a2a-cli.ts` for the one-shot Job entry point.
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

/**
 * The shared audience emitted for every A2A machine token. One audience across
 * all A2A providers; the per-agent `repo` claim distinguishes callers. This is
 * deliberately NOT `fuzefront` (the human web-app application) — conflating M2M
 * with the interactive app is wrong. Maps to the A2A side's `a2a.auth.audience`.
 */
export const A2A_AUDIENCE = 'a2a'

/** OAuth2 scope name the A2A scope mappings register under. */
export const A2A_SCOPE_NAME = 'a2a'

/**
 * Repo names are embedded verbatim into the Authentik expression and the token
 * claim the allowlist checks, so restrict them to a safe, predictable shape
 * (`FuzeAgent`, `FuzePlan`, `Exec-cto`, …). Rejects anything that could break
 * the expression or produce an ambiguous claim value.
 */
const REPO_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterA2AClientResult {
  /** OAuth2 client_id issued by Authentik — safe to share; wire into #93. */
  clientId: string
  /** OAuth2 client_secret — the caller credential; seal it, never commit it. */
  clientSecret: string
  /** The repo name emitted as the `repo` claim (== allowlist key). */
  repo: string
  /** The `aud` claim these tokens carry. */
  audience: string
  /** Slug of the created OAuth2 provider/application. */
  applicationSlug: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower-cases and dash-normalises a repo name into an Authentik slug. */
function toSlug(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

/**
 * Ensures the per-agent scope mapping that emits `{"repo": <repo>, "aud": "a2a"}`.
 * The repo name is JSON-encoded into the expression so it is always a correctly
 * quoted literal (repo names are also pattern-validated by the caller).
 */
async function ensureA2AScopeMapping(
  baseUrl: string,
  headers: Record<string, string>,
  repo: string
): Promise<number> {
  const slug = toSlug(repo)
  // Authentik expressions are Python; a JSON object literal is valid Python and
  // JSON.stringify guarantees safe quoting of the repo/audience strings.
  const expression = `return {"repo": ${JSON.stringify(repo)}, "aud": ${JSON.stringify(A2A_AUDIENCE)}}`
  return ensureScopeMapping(baseUrl, headers, {
    name: `a2a:${slug}`,
    scopeName: A2A_SCOPE_NAME,
    expression,
  })
}

/**
 * Resolves (or creates) the "<RepoName> (a2a)" OAuth2 provider, with the A2A
 * scope mapping attached. Returns the provider pk.
 */
async function ensureA2AProvider(
  baseUrl: string,
  headers: Record<string, string>,
  repo: string,
  scopeMappingPk: number
): Promise<number> {
  const providerName = `${repo} (a2a)`

  const found = await findAcrossPages<{ pk: number; name: string }>(
    `${baseUrl}/api/v3/providers/oauth2/`,
    { name: providerName },
    headers,
    p => p.name === providerName
  )
  if (found) {
    console.log(`[provision-a2a] OAuth2 provider "${providerName}" already exists (pk=${found.pk})`)
    return found.pk
  }

  const authorizationFlow = await resolveAuthorizationFlow(baseUrl, headers)
  if (!authorizationFlow) {
    throw new Error(
      '[provision-a2a] No authorization flow found in Authentik — cannot create OAuth2 provider. ' +
      'Ensure at least one flow with designation "authorization" exists.'
    )
  }

  const invalidationFlow = await resolveInvalidationFlow(baseUrl, headers)
  if (!invalidationFlow) {
    throw new Error(
      '[provision-a2a] No invalidation flow found in Authentik — cannot create OAuth2 provider. ' +
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
      // Agent-to-agent tokens are short-lived; revocation lag == token_validity.
      // 15 min keeps the fail-open window tight without a per-call introspection.
      token_validity: 'minutes=15',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-a2a] Created OAuth2 provider "${providerName}" (pk=${createRes.data.pk})`)
  return createRes.data.pk as number
}

/**
 * Resolves (or creates) the "a2a-<repo-slug>" application bound to the provider.
 */
async function ensureA2AApplication(
  baseUrl: string,
  headers: Record<string, string>,
  repo: string,
  providerPk: number
): Promise<string> {
  const slug = `a2a-${toSlug(repo)}`
  const appName = `${repo} (a2a)`

  const found = await findAcrossPages<{ slug: string; name: string }>(
    `${baseUrl}/api/v3/core/applications/`,
    { slug },
    headers,
    a => a.slug === slug
  )
  if (found) {
    console.log(`[provision-a2a] Application "${appName}" already exists (slug=${found.slug})`)
    return found.slug
  }

  await axios.post(
    `${baseUrl}/api/v3/core/applications/`,
    {
      name: appName,
      slug,
      provider: providerPk,
      meta_description: `A2A machine identity for ${repo} (client_credentials; emits repo+aud claims)`,
      policy_engine_mode: 'any',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-a2a] Created application "${appName}" (slug=${slug})`)
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
 * Idempotently registers an A2A machine identity for `repo` in Authentik and
 * returns its credentials. Safe to call repeatedly — existing resources are
 * reused. Throws if AUTHENTIK_ADMIN_TOKEN is missing, the repo name is invalid,
 * or the Authentik API rejects a create.
 */
export async function registerA2AMachineClient(
  repo: string
): Promise<RegisterA2AClientResult> {
  if (!REPO_NAME_PATTERN.test(repo)) {
    throw new Error(
      `[provision-a2a] Invalid repo name "${repo}". Expected a name matching ${REPO_NAME_PATTERN} ` +
      '(e.g. "FuzeAgent", "FuzePlan", "Exec-cto").'
    )
  }

  const adminToken = getAuthentikAdminToken()
  if (!adminToken) {
    throw new Error(
      '[provision-a2a] AUTHENTIK_ADMIN_TOKEN is required to register an A2A machine identity. ' +
      'Run this in-cluster where the admin token is available (never from CI / a public host).'
    )
  }

  const baseUrl = getAuthentikBaseUrl()
  const headers = buildHeaders(adminToken)

  console.log(`[provision-a2a] Registering A2A machine identity "${repo}" against ${baseUrl}`)

  const scopePk = await ensureA2AScopeMapping(baseUrl, headers, repo)
  const providerPk = await ensureA2AProvider(baseUrl, headers, repo, scopePk)
  const applicationSlug = await ensureA2AApplication(baseUrl, headers, repo, providerPk)
  const { clientId, clientSecret } = await readCredentials(baseUrl, headers, providerPk)

  return {
    clientId,
    clientSecret,
    repo,
    audience: A2A_AUDIENCE,
    applicationSlug,
  }
}
