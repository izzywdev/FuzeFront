/**
 * Same-origin client for the notification-service.
 *
 * The shell always talks to `/api/v1/notifications` on its own origin — the
 * host backend proxies to the service in-cluster. Never an absolute host: that
 * would break under local TLS and behind the prod ingress (mixed content), and
 * it is the repo's same-origin API rule.
 *
 * FAILS QUIET. Every read returns a safe empty value on error rather than
 * throwing. A notification outage must degrade to an empty bell, never to a
 * broken shell — the bell is chrome, not a feature the user came for.
 */
import { getActiveAuthToken } from '../lib/accounts'

const BASE = '/api/v1/notifications'

export type NotificationCategory =
  | 'system'
  | 'billing'
  | 'security'
  | 'app'
  | 'social'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id: string
  type: string
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  body: string | null
  actionUrl: string | null
  actionLabel: string | null
  data: Record<string, unknown>
  organizationId: string | null
  appId: string | null
  readAt: string | null
  seenAt: string | null
  createdAt: string
}

export interface NotificationPage {
  notifications: Notification[]
  nextCursor: string | null
}

export interface ListOptions {
  organizationId?: string
  category?: NotificationCategory
  status?: 'unread' | 'read' | 'all'
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

function authHeaders(): Record<string, string> {
  const token = getActiveAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  init: RequestInit,
  fallback: T
): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    if (res.status === 204) return fallback
    return (await res.json()) as T
  } catch (error) {
    // Re-throw only cancellation, which is not a failure.
    if ((error as Error)?.name === 'AbortError') throw error
    throw error
  }
}

export async function listNotifications(
  options: ListOptions = {}
): Promise<NotificationPage> {
  const params = new URLSearchParams()
  if (options.organizationId) params.set('organizationId', options.organizationId)
  if (options.category) params.set('category', options.category)
  if (options.status) params.set('status', options.status)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)

  const query = params.toString()
  return request<NotificationPage>(
    query ? `?${query}` : '',
    { method: 'GET', signal: options.signal },
    { notifications: [], nextCursor: null }
  )
}

export async function getUnreadCount(
  organizationId?: string,
  signal?: AbortSignal
): Promise<number> {
  const query = organizationId
    ? `?organizationId=${encodeURIComponent(organizationId)}`
    : ''
  const result = await request<{ unread: number }>(
    `/unread-count${query}`,
    { method: 'GET', signal },
    { unread: 0 }
  )
  return result.unread ?? 0
}

export async function markRead(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}/read`, { method: 'POST' }, undefined)
}

export async function markUnread(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}/unread`, { method: 'POST' }, undefined)
}

export async function markAllRead(organizationId?: string): Promise<void> {
  await request(
    '/read-all',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    },
    undefined
  )
}

/** Badge cleared. Distinct from read: opening the panel means the user has SEEN
 *  the notifications, not that they have read each one. */
export async function markSeen(organizationId?: string): Promise<void> {
  await request(
    '/seen',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    },
    undefined
  )
}

export async function archiveNotification(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' }, undefined)
}

/**
 * Subscribe to live arrivals over SSE.
 *
 * SSE, not a WebSocket: the stream is one-directional server→client, it needs
 * no upgrade dance through the ingress, and `EventSource` reconnects on its own.
 *
 * EventSource cannot set an Authorization header, so the token goes in the query
 * string. That is acceptable here and only here: the value is the same bearer
 * token already on every request, the connection is same-origin over TLS, and
 * the service treats the stream as read-only. `onReconnect` fires after a drop
 * so the caller can re-fetch the unread count — an event missed while
 * disconnected then self-heals instead of under-counting forever.
 */
export function subscribeToNotifications(handlers: {
  onNotification: (notification: Notification) => void
  onReconnect?: () => void
  onError?: () => void
}): () => void {
  const token = getActiveAuthToken()
  if (!token || typeof EventSource === 'undefined') {
    return () => {}
  }

  let source: EventSource | null = null
  let closed = false
  let hadError = false

  try {
    source = new EventSource(`${BASE}/stream?token=${encodeURIComponent(token)}`)
  } catch {
    return () => {}
  }

  source.addEventListener('notification', event => {
    try {
      handlers.onNotification(JSON.parse((event as MessageEvent).data))
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  })

  source.addEventListener('open', () => {
    if (hadError) {
      hadError = false
      handlers.onReconnect?.()
    }
  })

  source.addEventListener('error', () => {
    if (closed) return
    hadError = true
    handlers.onError?.()
    // EventSource retries on its own; do not close here or the retry is lost.
  })

  return () => {
    closed = true
    source?.close()
  }
}
