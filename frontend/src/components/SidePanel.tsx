import { useNavigate } from 'react-router-dom'
import { MenuItem as DSMenuItem } from '@fuzefront/design-system'
import { useT } from '@fuzefront/i18n'
import { useCurrentUser, useAppContext } from '../lib/shared'
import type { MenuItem } from '../lib/shared'
import { useRegisteredApps } from '../platform/appRegistry'
import { useActiveApp } from '../platform/useActiveApp'
import { isMenuSubstituted, iconGlyph, appHref } from '../platform/appManifest'

interface SidePanelProps {
  isOpen?: boolean
  onClose?: () => void
}

/**
 * The host shell's side menu.
 *
 *  - Default (`chrome.menu = "host"`): renders the manifest-driven Apps section
 *    (activated apps from the registry) + the portal section + any runtime
 *    `category:'app'` items pushed through the platform bridge.
 *  - Substituted (`chrome.menu = "substitute"`): the host YIELDS its portal menu
 *    and renders the active app's `chrome.items` instead. The host ALWAYS keeps
 *    a non-removable, host-owned "Return to portal" control so the user is never
 *    trapped — this control is never app-supplied.
 *
 * On mobile (≤768 px) this renders as a slide-in drawer overlay. `isOpen` drives
 * the CSS open/closed state; `onClose` is called when the user taps the close
 * button or navigates (scrim tap is handled by Layout's scrim element).
 */
function SidePanel({ isOpen = false, onClose }: SidePanelProps) {
  const { user } = useCurrentUser()
  const { state } = useAppContext()
  const { t } = useT()
  const navigate = useNavigate()
  const { apps } = useRegisteredApps()
  const activeApp = useActiveApp()

  // App-injected menu items live in the AppContext reducer, where the platform
  // bridge (window.__FUZEFRONT__.menu) writes them at runtime.
  const appMenuItems = state.menuItems.filter(
    (item: MenuItem) => item.category === 'app'
  )

  // ---- Menu substitution: the active app owns the whole side menu ----------
  if (activeApp && isMenuSubstituted(activeApp.manifest)) {
    const items = [...(activeApp.manifest.chrome?.items ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )
    const glyph = iconGlyph(activeApp.manifest.icon)
    return (
      <div
        className="side-panel"
        data-substituted="true"
        data-open={isOpen}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
        }}
      >
        {/* App-menu seam edge marks that the app owns this menu. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background: 'var(--seam)',
          }}
        />
        {/* HOST-OWNED, non-removable return-to-portal affordance (anti-trap). */}
        <div style={{ padding: 'var(--space-2)' }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => { navigate('/dashboard'); onClose?.() }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { navigate('/dashboard'); onClose?.() }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-soft)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              border: '1px solid rgba(110,92,255,0.3)',
            }}
          >
            <span>←</span>
            <span>{t('nav.returnToPortal', { defaultValue: 'Return to portal' })}</span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--text-2xs)',
                color: 'var(--text-tertiary)',
              }}
            >
              host
            </span>
          </div>
        </div>

        {/* App identity header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3) var(--space-3)',
            margin: '0 var(--space-2) var(--space-2)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: 'var(--text-lg)' }}>{glyph ?? '▦'}</span>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            {activeApp.manifest.name}
          </span>
        </div>

        {/* The app's declared menu items */}
        {items.map(item => (
          <DSMenuItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            onClick={() => {
              if (item.route) navigate(`/app/${activeApp.slug}${item.route}`)
            }}
          />
        ))}
      </div>
    )
  }

  // ---- Default: host chrome (portal menu + manifest Apps section) -----------
  const handleNavigate = (to: string) => { navigate(to); onClose?.() }

  return (
    <div
      className="side-panel"
      data-open={isOpen}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Apps section — activated apps from the registry (manifest-driven). */}
      {apps.length > 0 && (
        <div className="menu-section">
          <div
            className="menu-section-header"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '0.5rem',
            }}
          >
            {t('nav.apps', { defaultValue: 'Apps' })}
          </div>
          {apps.map(app => (
            <DSMenuItem
              key={app.slug}
              icon={iconGlyph(app.manifest.icon) ?? '▦'}
              label={app.manifest.menuLabel}
              active={activeApp?.slug === app.slug}
              onClick={() => {
                const href = appHref(app)
                // Standalone apps with a dedicated host navigate out of the SPA.
                if (href.startsWith('http')) window.location.href = href
                else navigate(href)
              }}
            />
          ))}
        </div>
      )}

      {/* Portal Menu Section */}
      <div className="menu-section">
        <div
          className="menu-section-header"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderTop: apps.length > 0 ? '1px solid var(--border-color)' : 'none',
            borderBottom: '1px solid var(--border-color)',
            marginTop: apps.length > 0 ? '1rem' : 0,
            marginBottom: '0.5rem',
          }}
        >
          {t('nav.portal')}
        </div>

        <DSMenuItem
          icon="▦"
          label={t('nav.applications', { defaultValue: 'Applications' })}
          active={
            typeof window !== 'undefined' &&
            window.location.pathname.startsWith('/applications')
          }
          onClick={() => handleNavigate('/applications')}
        />
        <DSMenuItem
          icon="🏢"
          label={t('nav.organizations')}
          onClick={() => handleNavigate('/organizations')}
        />
        <DSMenuItem
          icon="👤"
          label={t('nav.profile')}
          onClick={() => handleNavigate('/profile')}
        />
        <DSMenuItem
          icon="💳"
          label={t('nav.billing', { defaultValue: 'Billing' })}
          onClick={() => handleNavigate('/billing')}
        />
        {user?.roles.includes('admin') && (
          <DSMenuItem
            icon="⚙️"
            label={t('nav.adminPanel')}
            onClick={() => handleNavigate('/admin')}
          />
        )}
      </div>

      {/* App-Specific (runtime bridge) Menu Section — backward compatible. */}
      {appMenuItems.length > 0 && (
        <div className="menu-section" style={{ flex: 1 }}>
          <div
            className="menu-section-header"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderTop: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
              marginTop: '1rem',
              marginBottom: '0.5rem',
            }}
          >
            {activeApp ? activeApp.manifest.name : t('nav.appMenu')}
          </div>
          {appMenuItems.map((item: MenuItem) => (
            <DSMenuItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              onClick={() => {
                if (item.route) window.location.href = item.route
                else if (item.action) item.action()
              }}
            />
          ))}
        </div>
      )}

      {/* Bottom section with Help and Status */}
      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          paddingTop: '0.5rem',
          marginTop: 'auto',
        }}
      >
        <DSMenuItem
          icon="❓"
          label={t('nav.help')}
          onClick={() => handleNavigate('/help')}
        />
        <DSMenuItem
          icon="🩺"
          label={t('nav.status')}
          onClick={() => handleNavigate('/status')}
        />
      </div>
    </div>
  )
}

export default SidePanel
