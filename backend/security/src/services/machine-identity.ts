/**
 * machine-identity.ts (security-service local copy)
 *
 * Absorbed from `backend/src/services/machine-identity.ts` so the provider-agnostic
 * security-service compiles within its own tsconfig `rootDir` (no cross-package
 * relative import). Rewritten on native `fetch` (Node 18+) to avoid an axios
 * dependency — behaviour is preserved: register a client_credentials app in the
 * identity provider and introspect machine tokens (fail-closed to inactive).
 *
 * This is provider-internal (Authentik) machinery — it is only imported by the
 * concrete `AuthentikIdentityProvider`, never by the neutral API surface.
 */

export interface TokenIntrospectionResult {
  active: boolean
  client_id?: string
  scope?: string
  sub?: string
  exp?: number
  iat?: number
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
    throw new Error(
      'AUTHENTIK_ADMIN_TOKEN environment variable is required for machine client registration'
    )
  }
  return token
}

function getIntrospectionEndpoint(): string {
  const issuerUrl =
    process.env.AUTHENTIK_ISSUER_URL || 'http://localhost:9000/application/o/fuzefront/'
  return issuerUrl.replace(/\/$/, '') + '/introspect/'
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

/**
 * Registers a new machine/service-account OAuth2 application in the identity
 * provider (client_credentials grant only).
 */
export async function registerMachineClient(
  name: string,
  _scopes: string[] = ['openid']
): Promise<RegisterMachineClientResult> {
  const baseUrl = getAuthentikBaseUrl()
  const adminToken = getAuthentikAdminToken()
  const headers = { Authorization: `Bearer ${adminToken}` }

  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const providerPayload = {
    name: `${name} (machine)`,
    authorization_flow: await resolveDefaultAuthorizationFlow(baseUrl, headers),
    client_type: 'confidential',
    access_code_validity: 'minutes=1',
    token_validity: 'hours=1',
    allowed_grant_types: ['client_credentials'],
    sub_mode: 'hashed_user_id',
    issuer_mode: 'global',
  }

  let providerId: number
  try {
    const provider = await postJson(
      `${baseUrl}/api/v3/providers/oauth2/`,
      headers,
      providerPayload
    )
    providerId = provider.pk
  } catch (error) {
    throw new Error(`Failed to create OAuth2 provider in Authentik: ${(error as Error).message}`)
  }

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
    const app = await postJson(`${baseUrl}/api/v3/core/applications/`, headers, appPayload)
    applicationSlug = app.slug
    const providerDetail = await getJson(
      `${baseUrl}/api/v3/providers/oauth2/${providerId}/`,
      headers
    )
    clientId = providerDetail.client_id
    clientSecret = providerDetail.client_secret
  } catch (error) {
    throw new Error(`Failed to create Application in Authentik: ${(error as Error).message}`)
  }

  return { clientId, clientSecret, name, providerSlug: slug, applicationSlug }
}

/**
 * Validates a client-credentials bearer token via the provider's introspection
 * endpoint. Fail-closed: any error / unreachable provider returns inactive.
 */
export async function introspectMachineToken(
  bearerToken: string
): Promise<TokenIntrospectionResult> {
  const introspectionEndpoint = getIntrospectionEndpoint()
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
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    let res: Response
    try {
      res = await fetch(introspectionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: params.toString(),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (res.status === 401) {
      console.error('[machine-identity] Introspection rejected (401): check AUTHENTIK_CLIENT_ID/SECRET')
      return { active: false }
    }
    if (!res.ok) return { active: false }
    return (await res.json()) as TokenIntrospectionResult
  } catch (error) {
    console.warn('[machine-identity] Introspection failed; treating token as inactive:', (error as Error).message)
    return { active: false }
  }
}

async function resolveDefaultAuthorizationFlow(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string> {
  try {
    const data = await getJson(
      `${baseUrl}/api/v3/flows/instances/?designation=authorization`,
      headers
    )
    const flows: Array<{ slug: string; pk: string }> = data.results || []
    const defaultFlow = flows.find(
      f => f.slug.includes('implicit-consent') || f.slug.includes('authorization')
    )
    return defaultFlow?.pk || flows[0]?.pk || ''
  } catch {
    return ''
  }
}
