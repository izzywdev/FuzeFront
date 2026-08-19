/**
 * machine-identity.ts
 *
 * Service for managing machine/service-account (agent) identities.
 *
 * Responsibilities:
 *  - Register a new OAuth2 client-credentials application in Authentik
 *  - Validate client-credentials bearer tokens via Authentik token introspection
 *  - Sync machine identities to Permit.io as service-account principals
 *
 * Machine identities bypass the human OIDC flow entirely. They use the
 * standard OAuth2 client_credentials grant and present their access tokens
 * as Bearer tokens, which are validated here via introspection (not local
 * JWT verify) so that revocation is respected in real time.
 */

import axios from 'axios'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MachineIdentity {
  /** Stable key — the OAuth2 client_id issued by Authentik */
  clientId: string
  /** Human-readable name of the agent/service */
  name: string
  /** Scopes granted to this machine identity */
  scopes: string[]
  /**
   * Optional human user this agent is delegating on behalf of.
   * Populated when the introspected token carries a `delegate_user_id` claim.
   */
  delegateUserId?: string
  /** Whether this identity is currently active */
  active: boolean
}

export interface TokenIntrospectionResult {
  active: boolean
  client_id?: string
  scope?: string
  sub?: string
  exp?: number
  iat?: number
  /** Custom claim set at token issuance to carry the delegate relationship */
  delegate_user_id?: string
  [key: string]: unknown
}

export interface RegisterMachineClientResult {
  clientId: string
  clientSecret: string
  name: string
  providerSlug: string
  applicationSlug: string
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function getAuthentikBaseUrl(): string {
  return (
    process.env.AUTHENTIK_BASE_URL ||
    process.env.AUTHENTIK_ISSUER_URL?.replace(/\/application\/o\/.*$/, '') ||
    'http://localhost:9000'
  )
}

function getAuthentikAdminToken(): string {
  const token = process.env.AUTHENTIK_ADMIN_TOKEN
  if (!token) {
    throw new Error('AUTHENTIK_ADMIN_TOKEN environment variable is required for machine client registration')
  }
  return token
}

function getIntrospectionEndpoint(): string {
  const issuerUrl = process.env.AUTHENTIK_ISSUER_URL ||
    'http://localhost:9000/application/o/fuzefront/'
  // Authentik introspection is at: <issuer>/introspect/
  return issuerUrl.replace(/\/$/, '') + '/introspect/'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers a new machine/service-account OAuth2 application in Authentik.
 *
 * Creates:
 *  1. An OAuth2 Provider configured for client_credentials grant only
 *  2. An Application bound to that provider
 *
 * This is the programmatic equivalent of the register-machine-client.sh script,
 * suitable for calling from administrative endpoints or provisioning pipelines.
 *
 * Requires AUTHENTIK_ADMIN_TOKEN (a token with API write access to Authentik).
 */
export async function registerMachineClient(
  name: string,
  scopes: string[] = ['openid']
): Promise<RegisterMachineClientResult> {
  const baseUrl = getAuthentikBaseUrl()
  const adminToken = getAuthentikAdminToken()

  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  // Step 1: Create an OAuth2 Provider
  const providerPayload = {
    name: `${name} (machine)`,
    authorization_flow: await resolveDefaultAuthorizationFlow(baseUrl, headers),
    client_type: 'confidential',
    // client_credentials only — no interactive flows
    access_code_validity: 'minutes=1',
    token_validity: 'hours=1',
    allowed_grant_types: ['client_credentials'],
    sub_mode: 'hashed_user_id',
    issuer_mode: 'global',
  }

  let providerId: number
  try {
    const providerRes = await axios.post(
      `${baseUrl}/api/v3/providers/oauth2/`,
      providerPayload,
      { headers }
    )
    providerId = providerRes.data.pk
    console.log(`[machine-identity] Created OAuth2 provider: ${providerRes.data.name} (id=${providerId})`)
  } catch (error) {
    const msg = extractAxiosErrorMessage(error)
    throw new Error(`Failed to create OAuth2 provider in Authentik: ${msg}`)
  }

  // Step 2: Create an Application bound to the provider
  const appPayload = {
    name,
    slug,
    provider: providerId,
    meta_description: `Machine identity for ${name}`,
    policy_engine_mode: 'any',
  }

  let applicationSlug: string
  let clientId: string
  let clientSecret: string
  try {
    const appRes = await axios.post(
      `${baseUrl}/api/v3/core/applications/`,
      appPayload,
      { headers }
    )
    applicationSlug = appRes.data.slug
    console.log(`[machine-identity] Created Application: ${appRes.data.name} (slug=${applicationSlug})`)

    // Retrieve the generated client_id / client_secret from the provider
    const providerDetail = await axios.get(
      `${baseUrl}/api/v3/providers/oauth2/${providerId}/`,
      { headers }
    )
    clientId = providerDetail.data.client_id
    clientSecret = providerDetail.data.client_secret
  } catch (error) {
    const msg = extractAxiosErrorMessage(error)
    throw new Error(`Failed to create Application in Authentik: ${msg}`)
  }

  return {
    clientId,
    clientSecret,
    name,
    providerSlug: slug,
    applicationSlug,
  }
}

/**
 * Validates a client-credentials bearer token by introspecting it at
 * Authentik's token introspection endpoint.
 *
 * Introspection is preferred over local JWT verification because it:
 *  - Respects token revocation in real time
 *  - Does not require the public key to be available locally
 *  - Returns richer context (scopes, client_id, custom claims)
 *
 * Falls back gracefully to { active: false } when Authentik is unreachable,
 * so callers can handle the degraded case explicitly.
 */
export async function introspectMachineToken(
  bearerToken: string
): Promise<TokenIntrospectionResult> {
  const introspectionEndpoint = getIntrospectionEndpoint()

  // Authentik introspection requires the client's own credentials for auth.
  // We use the application's CLIENT_ID + CLIENT_SECRET from env vars.
  const clientId = process.env.AUTHENTIK_CLIENT_ID
  const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.warn('[machine-identity] AUTHENTIK_CLIENT_ID/CLIENT_SECRET not set; cannot introspect token')
    return { active: false }
  }

  try {
    const params = new URLSearchParams()
    params.append('token', bearerToken)
    params.append('token_type_hint', 'access_token')

    const response = await axios.post(introspectionEndpoint, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: clientId,
        password: clientSecret,
      },
      timeout: 5000, // 5-second timeout to avoid blocking requests
    })

    return response.data as TokenIntrospectionResult
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      // Network error — Authentik unreachable
      console.warn('[machine-identity] Authentik unreachable during token introspection; treating as inactive')
      return { active: false }
    }
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // Our introspection client credentials are wrong
      console.error('[machine-identity] Introspection request rejected (401): check AUTHENTIK_CLIENT_ID/SECRET')
      return { active: false }
    }
    console.error('[machine-identity] Token introspection error:', error)
    return { active: false }
  }
}

/**
 * Constructs a MachineIdentity from a successful introspection result.
 * Returns null if the token is inactive or missing required claims.
 */
export function buildMachineIdentity(
  introspection: TokenIntrospectionResult
): MachineIdentity | null {
  if (!introspection.active || !introspection.client_id) {
    return null
  }

  const scopes = introspection.scope
    ? introspection.scope.split(' ').filter(Boolean)
    : []

  return {
    clientId: introspection.client_id,
    name: introspection.client_id, // Use client_id as name; enrich if needed
    scopes,
    delegateUserId: introspection.delegate_user_id,
    active: true,
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the slug of the default authorization flow in Authentik.
 * Authentik requires an authorization_flow when creating providers.
 * We look for the built-in "default-provider-authorization-implicit-consent" flow.
 */
async function resolveDefaultAuthorizationFlow(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string> {
  try {
    const res = await axios.get(`${baseUrl}/api/v3/flows/instances/`, {
      headers,
      params: { designation: 'authorization' },
    })
    const flows: Array<{ slug: string; pk: string }> = res.data.results || []
    const defaultFlow = flows.find(f =>
      f.slug.includes('implicit-consent') || f.slug.includes('authorization')
    )
    return defaultFlow?.pk || flows[0]?.pk || ''
  } catch {
    // Non-fatal: return empty string; Authentik may use its own default
    return ''
  }
}

function extractAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data
    if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data)
    }
    return error.message
  }
  return String(error)
}
