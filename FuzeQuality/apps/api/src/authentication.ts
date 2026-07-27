export function isPublicRequest(method: string, path: string) {
  return (
    path.startsWith('/health/') ||
    path === '/metrics' ||
    path.startsWith('/api/v1/webhooks/') ||
    (method === 'GET' && path === '/api/v1/portfolio')
  )
}

/**
 * Human-facing routes whose bearer tokens are validated by the route-level
 * FuzeFront Security/Permit middleware. The outer API-token guard must let
 * these requests reach that middleware without treating the human token as
 * the worker service token.
 */
export function isPlatformAuthenticatedRequest(method: string, path: string) {
  if (!path.startsWith('/api/v1/repositories')) return false
  return method === 'GET' || method === 'POST'
}
