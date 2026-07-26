export function isPublicRequest(method: string, path: string) {
  return (
    path.startsWith('/health/') ||
    path === '/metrics' ||
    path.startsWith('/api/v1/webhooks/') ||
    (method === 'GET' && path === '/api/v1/portfolio')
  )
}
