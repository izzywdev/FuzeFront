export function isPublicRequest(method: string, path: string) {
  return (
    path.startsWith('/health/') ||
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
  if (!['GET', 'POST'].includes(method)) return false
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
    '/api/v1/repositories/',
    '/api/v1/catalog/',
    '/api/v1/coverage/',
    '/api/v1/test-implementations/',
    '/api/v1/suggestions/',
  ]
  return exact.includes(path) || prefixes.some(prefix => path.startsWith(prefix))
}
