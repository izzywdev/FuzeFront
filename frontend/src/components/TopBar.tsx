import { useCurrentUser } from '../lib/shared'
import { useTheme } from '../contexts/ThemeContext'
// `LanguageSelector` is deliberately NOT imported: the language control moved
// into the avatar menu (see the note on TopBar below). Portal branding stays.
import { useT } from '@fuzefront/i18n'
import { usePortalContext, PortalBrandLockup } from '@fuzefront/portal-branding-ui'
import AppSelector from './AppSelector'
import UserMenu from './UserMenu'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

interface TopBarProps {
  onMenuToggle?: () => void
}

/**
 * The shell top bar.
 *
 * Deliberately NOT here any more: the organization switcher and the language
 * selector. Both are identity controls — "which organization am I in", "which
 * language do I read" — and now live in the avatar menu alongside the account
 * switcher, where a user already looks for "who am I". Six controls did not fit
 * a phone; consolidating the three identity ones into one is what makes the bar
 * fit. See design/frames/app-scopes-user-menu/01-user-menu.html.
 */
function TopBar({ onMenuToggle }: TopBarProps) {
  const { user } = useCurrentUser()
  const { theme, toggleTheme } = useTheme()
  const { t } = useT()
  // White-label portal branding (FF-EPIC-13/FF-EPIC-10). `status` is only
  // ever 'ready' here when Layout.tsx's fuzefront.platform.multi-tenant-portals
  // flag is on AND the boot request resolved — otherwise this stays
  // 'disabled'/'loading'/'error' and the hardcoded FuzeFront wordmark below
  // renders exactly as before.
  const { status, context: portal } = usePortalContext()
  const branded = status === 'ready' && portal

  return (
    <div className="top-bar">
      {/* Hamburger — visible only on mobile via CSS */}
      <button
        className="hamburger-btn"
        onClick={onMenuToggle}
        aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
        aria-haspopup="true"
      >
        <span className="hamburger-bar" />
        <span className="hamburger-bar" />
        <span className="hamburger-bar" />
      </button>

      <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {branded ? (
          <PortalBrandLockup context={portal} />
        ) : (
          <>
            <img
              src={FuzeFrontLogo}
              alt="FuzeFront"
              style={{ height: 'var(--space-7)', width: 'auto' }}
            />
            <span className="brand-mark">
              <span className="brand-accent">Fuze</span>Front
            </span>
          </>
        )}
      </div>
      <div style={{ flex: 1 }}></div> {/* Spacer */}
      <div
        className="top-bar-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <AppSelector />

        {/* AI assistant is launched from its own floating fuse-seam launcher
            (FuzeChatWidget / @fuzefront/chat-ui), so no top-bar toggle here. */}

        {/* Theme Toggle */}
        <button
          className="theme-toggle"
          data-topbar-control="theme-toggle"
          onClick={toggleTheme}
          title={t(theme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Notification bell + avatar menu (accounts, organization, language). */}
        <UserMenu user={user} />
      </div>
    </div>
  )
}

export default TopBar
