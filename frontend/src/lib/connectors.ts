import { getActiveAuthToken } from './accounts'

export type ConnectorStatus = 'connected' | 'disconnected' | 'error' | 'authorization_pending' | 'loading'
export type ConnectorEntry = {
  id: string
  name: string
  description?: string
  authentication?: 'oauth' | 'api-key'
  configured?: boolean
  status?: ConnectorStatus
  identity_email?: string
  configuration?: { query?: string; include_spam_trash?: boolean }
}

export const CONNECTOR_STATUSES: ConnectorStatus[] = ['connected', 'disconnected', 'error', 'authorization_pending', 'loading']

export function isConnectorStatus(value: unknown): value is ConnectorStatus {
  return typeof value === 'string' && CONNECTOR_STATUSES.includes(value as ConnectorStatus)
}

/** Gmail remains served by the legacy OAuth route, so include it in the unified UI catalog. */
export function withGmailCatalogEntry(entries: ConnectorEntry[]): ConnectorEntry[] {
  return entries.some(entry => entry.id === 'google-gmail') ? entries : [
    { id: 'google-gmail', name: 'Google Gmail', description: 'Read and search email', authentication: 'oauth', configured: true },
    ...entries,
  ]
}

export async function connectorRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), !init?.method || init.method === 'GET' ? 10_000 : 30_000)
  try {
    const response = await fetch(`/api/v1/connectors${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getActiveAuthToken() || ''}`, ...(init?.headers || {}) },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(payload.error || payload.detail || `HTTP ${response.status}`)
    }
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Connector request timed out. Retry.')
    throw error
  } finally { window.clearTimeout(timeout) }
}

export function connectionLabel(connector: ConnectorEntry): string {
  if (connector.status === 'loading') return 'Loading connection status…'
  if (connector.status === 'connected') return `Connected${connector.identity_email ? ` as ${connector.identity_email}` : ''}`
  if (connector.status === 'authorization_pending') return 'Awaiting approval'
  if (connector.status === 'error') return 'Status unavailable'
  if (!connector.configured) return 'Provider setup pending'
  return 'Not connected'
}
