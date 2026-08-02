import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@fuzefront/i18n'
import { Skeleton, StatusCallout } from '@fuzefront/design-system'
import { useOrganizations } from '../lib/shared'
import {
  Notification,
  archiveNotification,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  markSeen,
  subscribeToNotifications,
} from '../services/notifications'

/**
 * NotificationBell — the badge, the inbox panel, and the live stream.
 *
 * Degrades QUIET: when the notification-service is unreachable the bell shows
 * no badge at all and only the opened panel reports the error. A phantom badge
 * the user can never clear is worse than a missing one, and a notification
 * outage must never break the shell.
 *
 * Read and seen are different questions. Opening the panel marks everything
 * SEEN — the badge clears, because the user has now looked. It does not mark
 * each item read; that is a per-item action (or "mark all read").
 *
 * Frames: design/frames/app-scopes-user-menu/04-notifications.html.
 */

const PAGE_SIZE = 15
const BADGE_CAP = 99

type PanelState = 'idle' | 'loading' | 'error'

function NotificationBell() {
  const { t } = useT()
  const { activeOrganizationId } = useOrganizations()

  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState<number | null>(null)
  const [items, setItems] = useState<Notification[]>([])
  const [state, setState] = useState<PanelState>('idle')

  const orgId = activeOrganizationId ?? undefined

  // `unread === null` means "unknown" — the service did not answer. Rendered
  // identically to zero, deliberately (see the component docblock).
  const refreshCount = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setUnread(await getUnreadCount(orgId, signal))
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        setUnread(null)
      }
    },
    [orgId]
  )

  const loadItems = useCallback(async () => {
    setState('loading')
    try {
      const page = await listNotifications({ limit: PAGE_SIZE, organizationId: orgId })
      setItems(page.notifications)
      setState('idle')
    } catch {
      setState('error')
    }
  }, [orgId])

  // Badge on mount and whenever the active organization changes.
  useEffect(() => {
    const controller = new AbortController()
    void refreshCount(controller.signal)
    return () => controller.abort()
  }, [refreshCount])

  // Live arrivals. Re-subscribes when the org changes so the stream and the
  // rendered list are always scoped the same way.
  const orgRef = useRef(orgId)
  orgRef.current = orgId

  useEffect(() => {
    const unsubscribe = subscribeToNotifications({
      onNotification: notification => {
        // Ignore an arrival scoped to a different organization than the one on
        // screen; it will be there when the user switches.
        if (
          notification.organizationId &&
          orgRef.current &&
          notification.organizationId !== orgRef.current
        ) {
          return
        }
        setItems(prev =>
          prev.some(n => n.id === notification.id)
            ? prev
            : [notification, ...prev].slice(0, PAGE_SIZE)
        )
        setUnread(prev => (prev === null ? 1 : prev + 1))
      },
      // A drop can lose events. Re-fetching the count on reconnect is what stops
      // the badge drifting permanently low.
      onReconnect: () => void refreshCount(),
    })
    return unsubscribe
  }, [refreshCount])

  const openPanel = () => {
    setOpen(true)
    void loadItems()
    // Seen, not read — the badge clears because the user looked.
    void markSeen(orgId).then(() => setUnread(0)).catch(() => {})
  }

  const onMarkAllRead = async () => {
    const previous = items
    setItems(items.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
    setUnread(0)
    try {
      await markAllRead(orgId)
    } catch {
      setItems(previous)
      void refreshCount()
    }
  }

  const onArchive = async (id: string) => {
    const previous = items
    setItems(items.filter(n => n.id !== id))
    try {
      await archiveNotification(id)
      void refreshCount()
    } catch {
      setItems(previous)
    }
  }

  const onOpenItem = async (notification: Notification) => {
    if (!notification.readAt) {
      setItems(items.map(n =>
        n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n
      ))
      setUnread(prev => (prev && prev > 0 ? prev - 1 : prev))
      void markRead(notification.id).catch(() => void refreshCount())
    }
    if (notification.actionUrl) {
      setOpen(false)
      window.location.href = notification.actionUrl
    }
  }

  const badge =
    unread && unread > 0 ? (unread > BADGE_CAP ? `${BADGE_CAP}+` : String(unread)) : null

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-bell
        data-unread={unread === null ? 'unknown' : String(unread)}
        data-degraded={unread === null ? 'true' : undefined}
        data-topbar-control="notifications"
        aria-label={t('notifications.open')}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-lg)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--bg-quaternary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        🔔
        {badge && (
          <span
            data-badge
            style={{
              position: 'absolute',
              top: '2px',
              insetInlineEnd: '2px',
              minWidth: '16px',
              height: '16px',
              padding: '0 4px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--error-color)',
              color: 'white',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--weight-semibold)',
              display: 'grid',
              placeItems: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 999 }}
          />
          <div
            data-panel="notifications"
            data-state={state === 'idle' && items.length === 0 ? 'empty' : state === 'idle' ? 'ready' : state}
            style={{
              position: 'absolute',
              top: '100%',
              insetInlineEnd: 0,
              marginTop: 'var(--space-2)',
              width: '360px',
              maxWidth: 'calc(100vw - var(--space-4))',
              maxHeight: '70vh',
              overflowY: 'auto',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 16px 48px var(--shadow)',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-4) var(--space-4) var(--space-3)',
              }}
            >
              <span
                style={{
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-md)',
                }}
              >
                {t('notifications.title')}
              </span>
              {items.some(n => !n.readAt) && (
                <button
                  data-action="mark-all-read"
                  onClick={() => void onMarkAllRead()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-color)',
                    fontSize: 'var(--text-sm)',
                    cursor: 'pointer',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
            </div>

            {state === 'loading' &&
              [0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <Skeleton height="14px" width="60%" />
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <Skeleton height="14px" width="85%" />
                  </div>
                </div>
              ))}

            {state === 'error' && (
              <div style={{ padding: 'var(--space-4)' }}>
                <StatusCallout
                  tone="error"
                  title={t('notifications.loadFailed')}
                  actions={
                    <button
                      className="btn btn-ghost"
                      data-action="retry"
                      onClick={() => void loadItems()}
                    >
                      {t('actions.retry')}
                    </button>
                  }
                />
              </div>
            )}

            {state === 'idle' && items.length === 0 && (
              <div
                data-empty
                style={{
                  padding: 'var(--space-8) var(--space-4)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                {t('notifications.empty')}
              </div>
            )}

            {state === 'idle' &&
              items.map(notification => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={() => void onOpenItem(notification)}
                  onArchive={() => void onArchive(notification.id)}
                  archiveLabel={t('notifications.archive')}
                />
              ))}
          </div>
        </>
      )}
    </div>
  )
}

const SEVERITY_COLOR: Record<Notification['severity'], string> = {
  info: 'var(--accent-color)',
  success: 'var(--success-color)',
  warning: 'var(--warning-color)',
  error: 'var(--error-color)',
}

export function NotificationItem({
  notification,
  onOpen,
  onArchive,
  archiveLabel,
}: {
  notification: Notification
  onOpen: () => void
  onArchive: () => void
  archiveLabel: string
}) {
  const isRead = Boolean(notification.readAt)

  return (
    <div
      data-notification={notification.id}
      data-read={String(isRead)}
      data-category={notification.category}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-color)',
        // Unread is signalled by BOTH the tint and the leading dot — never
        // colour alone.
        background: isRead ? 'transparent' : 'var(--accent-soft)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          marginTop: '6px',
          flex: 'none',
          borderRadius: 'var(--radius-pill)',
          background: isRead ? 'transparent' : SEVERITY_COLOR[notification.severity],
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          onClick={onOpen}
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            border: 'none',
            background: 'none',
            textAlign: 'left',
            cursor: notification.actionUrl ? 'pointer' : 'default',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-medium)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {notification.title}
        </button>
        {notification.body && (
          <div
            style={{
              marginTop: 'var(--space-1)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          style={{
            marginTop: 'var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>{notification.category}</span>
          <span>{new Date(notification.createdAt).toLocaleString()}</span>
          <button
            data-action="archive"
            data-notification-id={notification.id}
            onClick={onArchive}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-color)',
              fontSize: 'var(--text-2xs)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {archiveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotificationBell
