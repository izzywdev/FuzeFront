import { useCurrentUser, useOrganizations } from '../lib/shared'
import { useTheme } from '../contexts/ThemeContext'
import { LanguageSelector, useT } from '@fuzefront/i18n'
import AppSelector from './AppSelector'
import UserMenu from './UserMenu'
import { OrganizationSelector } from './OrganizationSelector'
import FuzeFrontLogo from '../assets/FuzeFrontLogo.svg'

interface TopBarProps {
  onMenuToggle?: () => void
}

function TopBar({ onMenuToggle }: TopBarProps) {
  const { user } = useCurrentUser()
  const { activeOrganizationId, setActiveOrganization } = useOrganizations()
  const { theme, toggleTheme } = useTheme()
  const { t } = useT()

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

      <div
        className="logo"
        style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        <img
          src={FuzeFrontLogo}
          alt="FuzeFront"
          style={{ height: '28px', width: 'auto' }}
        />
        <span className="brand-mark">
          <span className="brand-accent">Fuze</span>Front
        </span>
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
        <OrganizationSelector
          compact={true}
          selectedOrganizationId={activeOrganizationId ?? undefined}
          onOrganizationChange={org => {
            if (org) setActiveOrganization(org.id)
          }}
        />
        <AppSelector />

        {/* Language Selector — design-system Select via @fuzefront/i18n.
            Selecting a language drives the shared i18next instance, persists the
            choice, and flips <html dir> through the centralized direction manager. */}
        <div style={{ minWidth: '150px' }} className="lang-selector-wrap">
          <LanguageSelector hideLabel />
        </div>

        {/* AI assistant is launched from its own floating fuse-seam launcher
            (FuzeChatWidget / @fuzefront/chat-ui), so no top-bar toggle here. */}

        {/* Theme Toggle */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={t(theme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <UserMenu user={user} />
      </div>
    </div>
  )
}

export default TopBar
