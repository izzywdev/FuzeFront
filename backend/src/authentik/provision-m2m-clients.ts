/**
 * provision-m2m-clients.ts
 *
 * Idempotently provisions the Authentik resources required for FuzeSocial's
 * Mode A (client_credentials) registration flow.
 *
 * Resources created (all idempotent — existing resources are left untouched):
 *   1. Scope mapping  — "fuzefront:apps"
 *   2. OAuth2 Provider — "FuzeSocial Registration"  (client_credentials, confidential)
 *   3. Application    — slug "fuzesocial-registration" bound to the provider above
 *
 * After provisioning the client_id and a partially-masked client_secret are
 * written to the INFO log.  An operator should copy those values and seal them
 * into the `fuzesocial-secrets` SealedSecret with kubeseal:
 *
 *   echo -n "<value>" | kubectl create secret generic fuzesocial-secrets \
 *     --dry-run=client --from-file=AUTHENTIK_CLIENT_ID=/dev/stdin -o yaml \
 *     | kubeseal --controller-name sealed-secrets --format yaml \
 *     >> deploy/helm/fuzesocial/templates/sealed-secret.yaml
 *
 * Required env vars:
 *   AUTHENTIK_ADMIN_TOKEN — API token with write access to the Authentik Admin API
 *   AUTHENTIK_BASE_URL    — base URL of the Authentik instance
 *                           (falls back to AUTHENTIK_ISSUER_URL stripped of the
 *                            application path, then http://localhost:9000)
 */

import axios from 'axios'

const AUTHENTIK_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Config helpers (mirrors machine-identity.ts conventions)
// ---------------------------------------------------------------------------

function getAuthentikBaseUrl(): string {
  return (
    process.env.AUTHENTIK_BASE_URL ||
    process.env.AUTHENTIK_ISSUER_URL?.replace(/\/application\/o\/.*$/, '') ||
    'http://localhost:9000'
  )
}

function getAuthentikAdminToken(): string | undefined {
  return process.env.AUTHENTIK_ADMIN_TOKEN
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/**
 * Fetches all items from a paginated Authentik list endpoint, following
 * `data.next` links until exhausted, then returns the first item matching
 * the predicate — or undefined if none is found.
 *
 * Server-side filter params are passed as hints (Authentik may ignore them),
 * so client-side matching via `predicate` is the authoritative filter.
 */
async function findAcrossPages<T>(
  url: string,
  params: Record<string, string>,
  headers: Record<string, string>,
  predicate: (item: T) => boolean
): Promise<T | undefined> {
  // Authentik paginates via { pagination: { next: <page_number|0> }, results: [] }
  // `pagination.next` is the next page number, or 0/falsy when on the last page.
  let page = 1
  let hasMore = true
  while (hasMore) {
    const res = await axios.get(url, {
      headers,
      params: { ...params, page },
      timeout: AUTHENTIK_TIMEOUT_MS,
    })
    const items: T[] = res.data.results || []
    const match = items.find(predicate)
    if (match) return match
    const nextPage: number = res.data.pagination?.next ?? 0
    if (!nextPage) {
      hasMore = false
    } else {
      page = nextPage
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

/**
 * Resolves (or creates) the "fuzefront:apps" scope mapping.
 * Returns the pk (number) of the mapping.
 */
async function ensureScopeMapping(
  baseUrl: string,
  headers: Record<string, string>
): Promise<number> {
  const scopeName = 'fuzefront:apps'

  // Check existence across all pages; scope_name param is a hint only.
  // NB: scope property mappings live under /propertymappings/provider/scope/ on
  // Authentik 2024.x (the older /propertymappings/scope/ path 404s).
  const found = await findAcrossPages<{ pk: number; scope_name: string }>(
    `${baseUrl}/api/v3/propertymappings/provider/scope/`,
    { scope_name: scopeName },
    headers,
    m => m.scope_name === scopeName
  )
  if (found) {
    console.log(`[provision-m2m] Scope mapping "${scopeName}" already exists (pk=${found.pk})`)
    return found.pk
  }

  // Create
  const createRes = await axios.post(
    `${baseUrl}/api/v3/propertymappings/provider/scope/`,
    {
      name: scopeName,
      scope_name: scopeName,
      expression: 'return {}',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-m2m] Created scope mapping "${scopeName}" (pk=${createRes.data.pk})`)
  return createRes.data.pk as number
}

/**
 * Resolves the pk of the default authorization flow.
 * Reuses the same pattern as machine-identity.ts.
 */
async function resolveAuthorizationFlow(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string> {
  try {
    const res = await axios.get(`${baseUrl}/api/v3/flows/instances/`, {
      headers,
      params: { designation: 'authorization' },
      timeout: AUTHENTIK_TIMEOUT_MS,
    })
    const flows: Array<{ slug: string; pk: string }> = res.data.results || []
    const defaultFlow = flows.find(
      f => f.slug.includes('implicit-consent') || f.slug.includes('authorization')
    )
    return defaultFlow?.pk || flows[0]?.pk || ''
  } catch {
    return ''
  }
}

/**
 * Resolves the pk of an invalidation flow. Authentik 2024.x requires
 * `invalidation_flow` on OAuth2 provider creation; prefer the built-in
 * default-provider-invalidation-flow, else any invalidation-designated flow.
 */
async function resolveInvalidationFlow(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string> {
  try {
    const res = await axios.get(`${baseUrl}/api/v3/flows/instances/`, {
      headers,
      params: { designation: 'invalidation' },
      timeout: AUTHENTIK_TIMEOUT_MS,
    })
    const flows: Array<{ slug: string; pk: string }> = res.data.results || []
    const preferred = flows.find(f => f.slug === 'default-provider-invalidation-flow')
    return preferred?.pk || flows[0]?.pk || ''
  } catch {
    return ''
  }
}

/**
 * Resolves (or creates) the "FuzeSocial Registration" OAuth2 provider.
 * Returns the pk (number) of the provider.
 */
async function ensureOAuth2Provider(
  baseUrl: string,
  headers: Record<string, string>,
  scopeMappingPk: number
): Promise<number> {
  const providerName = 'FuzeSocial Registration'

  // Check existence across all pages; name param is a hint only
  const found = await findAcrossPages<{ pk: number; name: string }>(
    `${baseUrl}/api/v3/providers/oauth2/`,
    { name: providerName },
    headers,
    p => p.name === providerName
  )
  if (found) {
    console.log(`[provision-m2m] OAuth2 provider "${providerName}" already exists (pk=${found.pk})`)
    return found.pk
  }

  // Require a valid authorization flow before attempting creation
  const authorizationFlow = await resolveAuthorizationFlow(baseUrl, headers)
  if (!authorizationFlow) {
    throw new Error(
      '[provision-m2m] No authorization flow found in Authentik — cannot create OAuth2 provider. ' +
      'Ensure at least one flow with designation "authorization" exists.'
    )
  }

  // Authentik 2024.x makes invalidation_flow required on OAuth2 providers.
  const invalidationFlow = await resolveInvalidationFlow(baseUrl, headers)
  if (!invalidationFlow) {
    throw new Error(
      '[provision-m2m] No invalidation flow found in Authentik — cannot create OAuth2 provider. ' +
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
      token_validity: 'hours=1',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-m2m] Created OAuth2 provider "${providerName}" (pk=${createRes.data.pk})`)
  return createRes.data.pk as number
}

/**
 * Resolves (or creates) the "FuzeSocial Registration" application.
 */
async function ensureApplication(
  baseUrl: string,
  headers: Record<string, string>,
  providerPk: number
): Promise<void> {
  const slug = 'fuzesocial-registration'
  const appName = 'FuzeSocial Registration'

  // Check existence across all pages; slug param is a hint only
  const found = await findAcrossPages<{ slug: string; name: string }>(
    `${baseUrl}/api/v3/core/applications/`,
    { slug },
    headers,
    a => a.slug === slug
  )
  if (found) {
    console.log(`[provision-m2m] Application "${appName}" already exists (slug=${found.slug})`)
    return
  }

  // Create
  await axios.post(
    `${baseUrl}/api/v3/core/applications/`,
    {
      name: appName,
      slug,
      provider: providerPk,
      meta_description: 'Machine-identity application for FuzeSocial client_credentials registration',
      policy_engine_mode: 'any',
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[provision-m2m] Created application "${appName}" (slug=${slug})`)
}

/**
 * Reads the client_id and client_secret from the provisioned OAuth2 provider
 * and logs them at INFO level (secret partially masked).
 */
async function logCredentials(
  baseUrl: string,
  headers: Record<string, string>,
  providerPk: number
): Promise<void> {
  const res = await axios.get(
    `${baseUrl}/api/v3/providers/oauth2/${providerPk}/`,
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  const clientId: string = res.data.client_id || '(not set)'
  const clientSecret: string = res.data.client_secret || ''

  const maskedSecret =
    clientSecret.length > 4
      ? `${clientSecret.slice(0, 4)}****`
      : '****'

  console.log('[provision-m2m] -------------------------------------------------------')
  console.log('[provision-m2m] FuzeSocial Registration credentials (Mode A):')
  console.log(`[provision-m2m]   AUTHENTIK_CLIENT_ID     = ${clientId}`)
  console.log(`[provision-m2m]   AUTHENTIK_CLIENT_SECRET = ${maskedSecret}`)
  console.log('[provision-m2m] Retrieve the full secret from the Authentik Admin UI')
  console.log('[provision-m2m] then seal it into fuzesocial-secrets via kubeseal.')
  console.log('[provision-m2m] -------------------------------------------------------')
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Idempotently provisions the Authentik resources required for FuzeSocial
 * client_credentials (Mode A) registration.
 *
 * Designed to be called from startServer() after the database is ready.
 * Errors are caught and logged; the server continues even if Authentik is
 * temporarily unavailable (the static-token fallback still works).
 */
export async function provisionM2MClients(): Promise<void> {
  const adminToken = getAuthentikAdminToken()
  if (!adminToken) {
    console.warn(
      '[provision-m2m] AUTHENTIK_ADMIN_TOKEN not set — skipping M2M client provisioning. ' +
      'Set AUTHENTIK_ADMIN_TOKEN to enable automatic FuzeSocial registration.'
    )
    return
  }

  const baseUrl = getAuthentikBaseUrl()
  const headers = buildHeaders(adminToken)

  console.log(`[provision-m2m] Provisioning Authentik M2M clients against ${baseUrl}`)

  try {
    const scopePk = await ensureScopeMapping(baseUrl, headers)
    const providerPk = await ensureOAuth2Provider(baseUrl, headers, scopePk)
    await ensureApplication(baseUrl, headers, providerPk)
    await logCredentials(baseUrl, headers, providerPk)
    console.log('[provision-m2m] Provisioning complete.')
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const body = JSON.stringify(error.response?.data ?? error.message)
      console.error(`[provision-m2m] Authentik API error (HTTP ${status}): ${body}`)
    } else {
      console.error('[provision-m2m] Unexpected error during provisioning:', error)
    }
    console.warn('[provision-m2m] Continuing startup — M2M provisioning can be retried later.')
  }
}
