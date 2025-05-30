import React from 'react'
import { useGlobalMenu, useCurrentUser } from '@apphub/shared'
import { useLanguage } from '../contexts/LanguageContext'

function SidePanel() {
  const { menuItems } = useGlobalMenu()
  const { user } = useCurrentUser()
  const { t } = useLanguage()

  const handleMenuClick = (item: any) => {
    if (item.route) {
      window.location.href = item.route
    } else if (item.action) {
      item.action()
    }
  }

  // Filter out help from main menu items since we'll show it at the bottom
  const mainMenuItems = menuItems.filter(item => item.id !== 'help')

  return (
    <div
      className="side-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Main menu items */}
      <div style={{ flex: 1 }}>
        {mainMenuItems.map(item => (
          <div
            key={item.id}
            className="menu-item"
            onClick={() => handleMenuClick(item)}
          >
            <span>{item.icon}</span>
            <span>{t(item.label.toLowerCase())}</span>
          </div>
        ))}

        {/* Admin section */}
        {user?.roles.includes('admin') && (
          <>
            <div
              style={{
                borderTop: '1px solid var(--border-color)',
                margin: '1rem 0 0.5rem 0',
              }}
            ></div>
            <div
              className="menu-item"
              onClick={() => (window.location.href = '/admin')}
              style={{ color: 'var(--warning-color)' }}
            >
              <span>⚙️</span>
              <span>{t('adminPanel')}</span>
            </div>
          </>
        )}
      </div>

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
