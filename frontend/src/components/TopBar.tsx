import { useCurrentUser } from '../lib/shared'
import { useTheme } from '../contexts/ThemeContext'
import { LanguageSelector, useT } from '@fuzefront/i18n'
import AppSelector from './AppSelector'
import UserMenu from './UserMenu'
import { OrganizationSelector } from './OrganizationSelector'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

function TopBar() {
  const { user } = useCurrentUser()
  const { theme, toggleTheme } = useTheme()
  const { t } = useT()

  return (
    <div className="top-bar">
      <div
        className="logo"
        style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        <img
          src={FrontFuseLogo}
          alt="FuzeFront"
          style={{ height: '28px', width: 'auto' }}
        />
        <span className="brand-mark">
          <span className="brand-accent">Fuze</span>Front
        </span>
      </div>
      <div style={{ flex: 1 }}></div> {/* Spacer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <OrganizationSelector compact={true} />
        <AppSelector />

        {/* Language Selector — design-system Select via @fuzefront/i18n.
            Selecting a language drives the shared i18next instance, persists the
            choice, and flips <html dir> through the centralized direction manager. */}
        <div style={{ minWidth: '150px' }}>
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
