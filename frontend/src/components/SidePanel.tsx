import React from 'react'
import { useGlobalMenu, useCurrentUser, useAppContext } from '../lib/shared'
import { useLanguage } from '../contexts/LanguageContext'
import type { MenuItem } from '../lib/shared'
import { NavLink } from 'react-router-dom'

function SidePanel() {
  const globalMenu = useGlobalMenu() as any // Temporary type assertion while types are updating
  const { user } = useCurrentUser()
  const { state } = useAppContext()
  const { t } = useLanguage()

  // Safely access new menu properties with fallbacks
  const portalMenuItems =
    globalMenu.portalMenuItems ||
    globalMenu.menuItems?.filter(
      (item: MenuItem) => !item.category || item.category === 'portal'
    ) ||
    []

  const appMenuItems =
    globalMenu.appMenuItems ||
    globalMenu.menuItems?.filter((item: MenuItem) => item.category === 'app') ||
    []

  const handleMenuClick = (item: MenuItem) => {
    if (item.route) {
      window.location.href = item.route
    } else if (item.action) {
      item.action()
    }
  }

  return (
    <div
      className="side-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Portal Menu Section */}
      <div className="menu-section">
        <div
          className="menu-section-header"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            fontWeight: '600',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: '0.5rem',
          }}
        >
          {t('portal')}
        </div>
        {portalMenuItems
          .filter((item: MenuItem) => item.id !== 'help') // Filter out help for now
          .map((item: MenuItem) => (
            <div
              key={item.id}
              className="menu-item"
              onClick={() => handleMenuClick(item)}
            >
              <span>{item.icon}</span>
              <span>{t(item.label.toLowerCase())}</span>
            </div>
          ))}

        {/* Organizations section */}
        <div
          className="menu-item"
          onClick={() => (window.location.href = '/organizations')}
          style={{ color: 'var(--accent-color)' }}
        >
          <span>🏢</span>
          <span>Organizations</span>
        </div>

        {/* Profile section */}
        <div
          className="menu-item"
          onClick={() => (window.location.href = '/profile')}
          style={{ color: '#4CAF50' }}
        >
          <span>👤</span>
          <span>Profile</span>
        </div>

        {/* Admin section within portal */}
        {user?.roles.includes('admin') && (
          <div
            className="menu-item"
            onClick={() => (window.location.href = '/admin')}
            style={{ color: 'var(--warning-color)' }}
          >
            <span>⚙️</span>
            <span>{t('adminPanel')}</span>
          </div>
        )}
      </div>

      {/* App-Specific Menu Section */}
      {appMenuItems.length > 0 && (
        <div className="menu-section" style={{ flex: 1 }}>
          <div
            className="menu-section-header"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontWeight: '600',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderTop: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
              marginTop: '1rem',
              marginBottom: '0.5rem',
            }}
          >
            {state.activeApp ? state.activeApp.name : t('appMenu')}
          </div>
          {appMenuItems.map((item: MenuItem) => (
            <div
              key={item.id}
              className="menu-item app-menu-item"
              onClick={() => handleMenuClick(item)}
              style={{
                paddingLeft: '1.25rem', // Slightly indented to show hierarchy
                borderLeft: '3px solid transparent',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderLeftColor = 'var(--accent-color)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderLeftColor = 'transparent'
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </div>
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
        <div
          className="menu-item"
          onClick={() => (window.location.href = '/test')}
          style={{ color: '#ff6b6b' }}
        >
          <span>🧪</span>
          <span>Test Components</span>
        </div>

        <div
          className="menu-item"
          onClick={() => (window.location.href = '/help')}
          style={{ color: '#64b5f6' }}
        >
          <span>❓</span>
          <span>{t('help')}</span>
        </div>

        <div
          className="menu-item"
          onClick={() => (window.location.href = '/status')}
          style={{ color: 'var(--success-color)' }}
        >
          <span>🩺</span>
          <span>{t('status')}</span>
        </div>
      </div>
    </div>
  )
}

export default SidePanel
