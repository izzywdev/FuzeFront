/** Small transport boundary, kept independent of Express for failure-path tests. */
export interface FuzexProxyRequest {
  method: string
  url: string
  authorization?: string
  body?: unknown
}

export interface FuzexProxyDependencies {
  baseUrl: string
  tenant: string
  enabled: () => Promise<boolean>
  credentials: (subjectToken: string, scope: string, tenant: string) => Promise<{ workloadToken: string; delegatedToken: string }>
  fetcher?: typeof fetch
}

/** Accept only the product's JSON API. No open proxy, site HTML or admin paths. */
export function fuzexUpstreamPath(raw: string): string | null {
  const pathname = raw.split('?')[0]
  if (!/^\/api\/v1\/(features|projects|discussions)(\/|$)/.test(pathname)) return null
  try {
    const segments = pathname.split('/').slice(1)
    if (segments.some(segment => {
      const decoded = decodeURIComponent(segment)
      return decoded === '.' || decoded === '..' || !/^[a-zA-Z0-9_.~-]+$/.test(decoded)
    })) return null
  } catch { return null }
  return raw
}

export async function forwardFuzex(request: FuzexProxyRequest, deps: FuzexProxyDependencies): Promise<{ status: number; body: unknown }> {
  if (!(await deps.enabled())) return { status: 404, body: { error: 'FuzeX hosted review is not enabled' } }
  const suffix = fuzexUpstreamPath(request.url)
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
  if (!suffix || (!write && request.method !== 'GET' && request.method !== 'HEAD')) {
    return { status: 404, body: { error: 'Unknown FuzeX operation' } }
  }
  const bearer = request.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
  if (write && !bearer) return { status: 401, body: { error: 'A user session is required' } }
  if (request.authorization && !bearer) return { status: 401, body: { error: 'A valid bearer session is required' } }
  if (!deps.baseUrl) return { status: 503, body: { error: 'FuzeX upstream is not configured' } }
  try {
    const base = new URL(deps.baseUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      return { status: 503, body: { error: 'FuzeX upstream must be a configured service origin' } }
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (bearer) {
      if (!deps.tenant || /\s/.test(deps.tenant)) return { status: 503, body: { error: 'FuzeX organization is not configured' } }
      const credentials = await deps.credentials(bearer, `fuzex:frames:${write ? 'write' : 'read'}`, deps.tenant)
      headers.authorization = `Bearer ${credentials.workloadToken}`
      headers['x-fuze-delegation'] = `Bearer ${credentials.delegatedToken}`
    }
    if (write) headers['content-type'] = 'application/json'
    const response = await (deps.fetcher ?? fetch)(`${base.origin}${suffix}`, {
      method: request.method,
      headers,
      ...(write && request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (request.method === 'HEAD' || response.status === 204) return { status: response.status, body: null }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return { status: 502, body: { error: 'FuzeX returned an invalid response' } }
    }
    return { status: response.status, body: await response.json() }
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode
    return { status: status === 401 || status === 403 ? status : 502, body: { error: 'FuzeX request could not be authorized or completed' } }
  }
}
