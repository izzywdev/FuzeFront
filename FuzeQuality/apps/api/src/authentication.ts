export function isPublicRequest(method: string, path: string) {
  return (
    // NOTE the exact `/health` as well as the `/health/` prefix. They are two
    // different things to Express: `startsWith('/health/')` matches
    // /health/live and /health/ready but NOT /health itself, so the
    // platform-wide /health convention would have 401'd here — including the
    // kubelet, the nginx same-origin proxy and the portal's own reachability
    // check, none of which send a token.
    path === '/health' ||
    path.startsWith('/health/') ||
    // The OpenAPI document describes the SHAPE of the API, never any data held
    // in it. Requiring a token to discover the contract would gate the one
    // thing that helps a caller construct a correctly authorized request, while
    // protecting nothing.
    path === '/openapi.yaml' ||
    path === '/openapi.json' ||
    path === '/metrics' ||
    path.startsWith('/api/v1/webhooks/')
  )
}

/**
 * Human-facing routes whose bearer tokens are validated by the route-level
 * FuzeFront Security/Permit middleware. The outer API-token guard must let
 * these requests reach that middleware without treating the human token as
 * the worker service token.
 */
export function isPlatformAuthenticatedRequest(method: string, path: string) {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false
  const exact = [
    '/api/v1/portfolio',
    '/api/v1/repositories',
    '/api/v1/test-implementations',
    '/api/v1/requirements',
    '/api/v1/flows',
    '/api/v1/suggestions',
    '/api/v1/findings',
    '/api/v1/jira/sync',
  ]
  const prefixes = [
    '/api/v1/organization/',
    '/api/v1/repositories/',
    '/api/v1/catalog/',
    '/api/v1/coverage/',
    '/api/v1/test-implementations/',
    '/api/v1/suggestions/',
    '/api/v1/admin/',
  ]
  return exact.includes(path) || prefixes.some(prefix => path.startsWith(prefix))
}
