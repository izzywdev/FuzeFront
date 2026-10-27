import { useMemo } from 'react'
import type { App } from '@fuzefront/app-registry-client'
import { mobileInstallTarget } from '../platform/appManifest'

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true ||
    document.referrer.startsWith('android-app://')
  )
}

/**
 * A deliberately small install prompt shown only for a mobile WEB browser.
 * Native/TWA/PWA standalone sessions are already installed and never see it.
 */
export function MobileInstallBanner({ app }: { app: App | null | undefined }) {
  const target = useMemo(
    () =>
      app
        ? mobileInstallTarget(
            app.manifest.distribution,
            navigator.userAgent,
            isStandaloneDisplayMode()
          )
        : null,
    [app]
  )

  if (!app || !target) return null

  return (
    <aside
      aria-label={`Install ${app.manifest.name}`}
      data-mobile-install-banner={app.slug}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        color: 'var(--text-primary)',
        background: 'var(--accent-subtle, var(--bg-tertiary))',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span>
        Install the app: <strong>{app.manifest.menuLabel}</strong>
      </span>
      <a
        className="btn btn-primary"
        href={target.href}
        rel="noopener noreferrer"
      >
        {target.label}
      </a>
    </aside>
  )
}

export default MobileInstallBanner
