import { useEffect, useState } from 'react'
import { bridge, Toast, ToastLevel } from '../platform/bridge'

const LEVEL_COLORS: Record<ToastLevel, { bg: string; bar: string }> = {
  info: { bg: 'var(--bg-tertiary)', bar: 'var(--accent-2)' },
  success: { bg: 'var(--bg-tertiary)', bar: 'var(--success-color)' },
  warning: { bg: 'var(--bg-tertiary)', bar: 'var(--warning-color)' },
  error: { bg: 'var(--bg-tertiary)', bar: 'var(--error-color)' },
}

// Renders toasts pushed through window.__FUZEFRONT__.notify() by any app or by
// the host itself. Subscribes to the bridge's toast store.
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const unsubscribe = bridge.subscribeToasts(setToasts)
    return () => {
      unsubscribe()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map(t => {
        const c = LEVEL_COLORS[t.level]
        return (
          <div
            key={t.id}
            role="status"
            style={{
              background: c.bg,
              color: 'var(--text-primary)',
              borderLeft: `4px solid ${c.bar}`,
              borderRadius: 8,
              padding: '10px 12px',
              boxShadow: '0 8px 24px var(--shadow)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {t.title && (
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.title}</div>
              )}
              <div style={{ fontSize: 14, lineHeight: 1.35 }}>{t.message}</div>
              {t.appId && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                  from {t.appId}
                </div>
              )}
            </div>
            <button
              onClick={() => bridge.dismiss(t.id)}
              aria-label="Dismiss"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default Toaster
