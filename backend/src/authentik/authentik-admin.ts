/**
 * authentik-admin.ts
 *
 * Shared, idempotent helpers for provisioning resources against the Authentik
 * Admin API (scope mappings, OAuth2 providers, applications, flow resolution).
 *
 * These were originally private to `provision-m2m-clients.ts`; they are shared
 * verbatim by the A2A machine-identity provisioner (`provision-a2a-clients.ts`)
 * so both flows resolve flows, paginate, and create resources identically.
 *
 * Required env vars (read lazily by callers):
 *   AUTHENTIK_ADMIN_TOKEN — API token with write access to the Admin API
 *   AUTHENTIK_BASE_URL    — base URL of the Authentik instance
 *                           (falls back to AUTHENTIK_ISSUER_URL stripped of the
 *                            application path, then http://localhost:9000)
 */

import axios from 'axios'

export const AUTHENTIK_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function getAuthentikBaseUrl(): string {
  return (
    process.env.AUTHENTIK_BASE_URL ||
    process.env.AUTHENTIK_ISSUER_URL?.replace(/\/application\/o\/.*$/, '') ||
    'http://localhost:9000'
  )
}

export function getAuthentikAdminToken(): string | undefined {
  return process.env.AUTHENTIK_ADMIN_TOKEN
}

export function buildHeaders(token: string): Record<string, string> {
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
 * `pagination.next` links until exhausted, then returns the first item matching
 * the predicate — or undefined if none is found.
 *
 * Server-side filter params are passed as hints (Authentik may ignore them),
 * so client-side matching via `predicate` is the authoritative filter.
 */
export async function findAcrossPages<T>(
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
// Flow resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the pk of the default authorization flow.
 */
export async function resolveAuthorizationFlow(
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
export async function resolveInvalidationFlow(
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

// ---------------------------------------------------------------------------
// Scope mapping
// ---------------------------------------------------------------------------

/**
 * Resolves (or creates) a provider scope mapping with the given name and
 * expression. Returns the pk (number) of the mapping.
 *
 * The `expression` is the body of the mapping — an Authentik expression that
 * `return`s a dict of claims to merge into the issued token, e.g.
 *   return {"repo": "FuzeAgent", "aud": "a2a"}
 *
 * Idempotent: an existing mapping matched by name is returned untouched (its
 * expression is NOT rewritten — delete-and-recreate by hand if it must change).
 */
export async function ensureScopeMapping(
  baseUrl: string,
  headers: Record<string, string>,
  opts: { name: string; scopeName: string; expression: string }
): Promise<number> {
  // Check existence across all pages; scope_name param is a hint only.
  // NB: scope property mappings live under /propertymappings/provider/scope/ on
  // Authentik 2024.x (the older /propertymappings/scope/ path 404s).
  const found = await findAcrossPages<{ pk: number; name: string }>(
    `${baseUrl}/api/v3/propertymappings/provider/scope/`,
    { name: opts.name },
    headers,
    m => m.name === opts.name
  )
  if (found) {
    console.log(`[authentik-admin] Scope mapping "${opts.name}" already exists (pk=${found.pk})`)
    return found.pk
  }

  const createRes = await axios.post(
    `${baseUrl}/api/v3/propertymappings/provider/scope/`,
    {
      name: opts.name,
      scope_name: opts.scopeName,
      expression: opts.expression,
    },
    { headers, timeout: AUTHENTIK_TIMEOUT_MS }
  )
  console.log(`[authentik-admin] Created scope mapping "${opts.name}" (pk=${createRes.data.pk})`)
  return createRes.data.pk as number
}
