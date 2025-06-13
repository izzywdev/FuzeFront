import React, { useState } from 'react'
import { User, useCurrentUser } from '../lib/shared'
import { useLanguage } from '../contexts/LanguageContext'
import { logout } from '../services/api'

interface UserMenuProps {
  user: User | null
}

function UserMenu({ user }: UserMenuProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)
  const { t } = useLanguage()
  const { setUser } = useCurrentUser()

  const handleLogout = async () => {
    try {
      await logout()
      setUser(null)
      window.location.href = '/'
    } catch (error) {
      console.error('Logout failed:', error)
      setUser(null)
      localStorage.removeItem('authToken')
      window.location.href = '/'
    }
  }

  if (!user) {
    return (
      <div>
        <button
          style={{
            background: 'var(--accent-color)',
            border: 'none',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
          onClick={() => (window.location.href = '/login')}
        >
          {t('signIn')}
        </button>
      </div>
    )
  }

  const getInitials = (user: User) => {
    if (user.firstName && user.lastName) {
      return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
    }
    if (user.firstName) {
      return user.firstName.charAt(0).toUpperCase()
    }
    return user.email.charAt(0).toUpperCase()
  }

  const getDisplayName = (user: User) => {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    if (user.firstName) {
      return user.firstName
    }
    return user.email
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* Notification Bell */}
      <div style={{ position: 'relative' }}>
        <button
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
            transition: 'background-color 0.2s ease',
            color: 'var(--text-primary)',
            fontSize: '18px',
          }}
          onClick={() => setIsNotificationOpen(!isNotificationOpen)}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          title={t('notifications')}
        >
          🔔
          {/* Notification Badge */}
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              width: '8px',
              height: '8px',
              backgroundColor: 'var(--error-color)',
              borderRadius: '50%',
              border: '1px solid var(--bg-secondary)',
            }}
          />
        </button>

        {isNotificationOpen && (
          <>
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'transparent',
                zIndex: 999,
              }}
              onClick={() => setIsNotificationOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '16px',
                minWidth: '280px',
                zIndex: 1000,
                boxShadow: '0 8px 32px var(--shadow)',
              }}
            >
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '12px',
                  color: 'var(--text-primary)',
                }}
              >
                {t('notifications')}
              </div>
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: '14px',
                }}
              >
                {t('noNotifications')}
              </div>
            </div>
          </>
        )}
      </div>

      {/* User Avatar */}
      <div style={{ position: 'relative' }}>
        <button
          style={{
            background:
              'linear-gradient(45deg, var(--accent-color), var(--accent-hover))',
            border: 'none',
            cursor: 'pointer',
            padding: '0',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.05)'
            e.currentTarget.style.boxShadow =
              '0 4px 12px rgba(100, 108, 255, 0.3)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = 'none'
          }}
          title={getDisplayName(user)}
        >
          {getInitials(user)}
        </button>

        {isUserMenuOpen && (
          <>
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'transparent',
                zIndex: 999,
              }}
              onClick={() => setIsUserMenuOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '8px',
                minWidth: '200px',
                zIndex: 1000,
                boxShadow: '0 8px 32px var(--shadow)',
              }}
            >
              {/* User Info Header */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-color)',
                  marginBottom: '8px',
                }}
              >
                <div
                  style={{
                    fontWeight: '500',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                  }}
                >
                  {getDisplayName(user)}
                </div>
                <div
                  style={{
                    color: 'var(--text-tertiary)',
                    fontSize: '12px',
                    marginTop: '2px',
                  }}
                >
                  {user.email}
                </div>
                <div
                  style={{
                    color: 'var(--accent-color)',
                    fontSize: '11px',
                    marginTop: '4px',
                    textTransform: 'uppercase',
                  }}
                >
                  {user.roles.includes('admin')
                    ? t('administrator')
                    : t('user')}
                </div>
              </div>

              {/* Menu Items */}
              <div
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  transition: 'background-color 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-quaternary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
                onClick={() => {
                  setIsUserMenuOpen(false)
                  window.location.href = '/profile'
                }}
              >
                👤 {t('profile')}
              </div>

              <div
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  transition: 'background-color 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-quaternary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
                onClick={() => {
                  setIsUserMenuOpen(false)
                  window.location.href = '/settings'
                }}
              >
                ⚙️ {t('settings')}
              </div>

              {user.roles.includes('admin') && (
                <div
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    color: 'var(--warning-color)',
                    fontSize: '14px',
                    transition: 'background-color 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor =
                      'var(--bg-quaternary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                  onClick={() => {
                    setIsUserMenuOpen(false)
                    window.location.href = '/admin'
                  }}
                >
                  🛠️ {t('adminPanel')}
                </div>
              )}

              <div
                style={{
                  borderTop: '1px solid var(--border-color)',
                  marginTop: '8px',
                  paddingTop: '8px',
                }}
              >
                <div
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    color: 'var(--error-color)',
                    fontSize: '14px',
                    transition: 'background-color 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor =
                      'rgba(255, 107, 107, 0.1)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                  onClick={() => {
                    setIsUserMenuOpen(false)
                    handleLogout()
                  }}
                >
                  🚪 {t('signOut')}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default UserMenu
