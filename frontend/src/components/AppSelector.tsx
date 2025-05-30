import React, { useState, useEffect, useRef } from 'react'
import { useAppContext, App } from '@apphub/shared'
import { useLanguage } from '../contexts/LanguageContext'
import { fetchApps } from '../services/api'

function AppSelector() {
  const { state, dispatch } = useAppContext()
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    placement: 'bottom',
  })

  useEffect(() => {
    const loadApps = async () => {
      try {
        const allApps = await fetchApps() // Now returns apps with health status
        dispatch({ type: 'SET_APPS', payload: allApps })

        // Set default app if user has one and it's active and healthy
        const defaultApp = allApps.find(
          app =>
            app.id === state.user?.defaultAppId && app.isActive && app.isHealthy
        )
        if (defaultApp && !state.activeApp) {
          dispatch({ type: 'SET_ACTIVE_APP', payload: defaultApp })
        }
      } catch (error) {
        console.error('Failed to load apps:', error)
      }
    }
    loadApps()
  }, [dispatch, state.user?.defaultAppId, state.activeApp])

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const calculatePosition = () => {
        const button = buttonRef.current!
        const buttonRect = button.getBoundingClientRect()
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        }

        const dropdownWidth = 350 // Approximate dropdown width
        const dropdownHeight = 400 // Approximate dropdown height (with max height)

        let top = buttonRect.bottom + 8
        let left = buttonRect.right - dropdownWidth
        let placement = 'bottom'

        // Check if dropdown would go below viewport
        if (top + dropdownHeight > viewport.height) {
          // Position above the button instead
          top = buttonRect.top - dropdownHeight - 8
          placement = 'top'

          // If still not enough space above, center it vertically
          if (top < 0) {
            top = Math.max(20, (viewport.height - dropdownHeight) / 2)
            placement = 'center'
          }
        }

        // Check horizontal positioning
        if (left < 20) {
          // If too far left, position from left edge of button
          left = buttonRect.left
        } else if (left + dropdownWidth > viewport.width - 20) {
          // If too far right, position from right edge of viewport
          left = viewport.width - dropdownWidth - 20
        }

        setDropdownPosition({ top, left, placement })
      }

      calculatePosition()

      // Recalculate on window resize
      const handleResize = () => calculatePosition()
      window.addEventListener('resize', handleResize)

      return () => window.removeEventListener('resize', handleResize)
    }
  }, [isOpen])

  const handleAppSelect = (app: App) => {
    if (!app.isHealthy) {
      alert(`${app.name} ${t('appUnavailable')}`)
      return
    }
    dispatch({ type: 'SET_ACTIVE_APP', payload: app })
    setIsOpen(false)
    window.location.href = `/app/${app.id}`
  }

  const currentPath = window.location.pathname
  const isOnAppPage = currentPath.startsWith('/app/')

  return (
    <div className="app-selector">
      <button
        ref={buttonRef}
        className="app-grid-button"
        onClick={() => setIsOpen(!isOpen)}
        title={t('applications')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '8px',
          transition: 'background-color 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* 9-dots grid icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="5" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="12" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
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
            onClick={() => setIsOpen(false)}
          />

          {/* App Grid Panel */}
          <div
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '16px',
              width: '350px',
              maxHeight: '400px',
              zIndex: 1000,
              boxShadow: '0 8px 32px var(--shadow)',
              overflow: 'hidden',
              ...(dropdownPosition.placement === 'top' && {
                transform: 'translateY(0)',
              }),
              ...(dropdownPosition.placement === 'center' && {
                transform: 'translateY(0)',
              }),
            }}
          >
            <div
              style={{
                marginBottom: '12px',
                padding: '0 4px',
                color: 'var(--text-tertiary)',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              {t('applications')}
            </div>

            {state.apps && state.apps.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
              >
                {state.apps
                  .filter(app => app.isActive)
                  .map(app => (
                    <div
                      key={app.id}
                      onClick={() => handleAppSelect(app)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '16px 8px',
                        borderRadius: '8px',
                        cursor: app.isHealthy ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s ease',
                        backgroundColor: 'transparent',
                        opacity: app.isHealthy ? 1 : 0.5,
                        filter: app.isHealthy ? 'none' : 'grayscale(1)',
                        border: '1px solid transparent',
                      }}
                      onMouseEnter={e => {
                        if (app.isHealthy) {
                          e.currentTarget.style.backgroundColor =
                            'var(--bg-quaternary)'
                          e.currentTarget.style.borderColor =
                            'var(--accent-color)'
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                        e.currentTarget.style.borderColor = 'transparent'
                      }}
                    >
                      {/* App Icon */}
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          marginBottom: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '12px',
                          backgroundColor: 'var(--bg-tertiary)',
                          position: 'relative',
                        }}
                      >
                        {app.iconUrl ? (
                          <img
                            src={app.iconUrl}
                            alt=""
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                            }}
                            onError={e => {
                              ;(e.target as HTMLImageElement).style.display =
                                'none'
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '18px',
                              background:
                                app.integrationType === 'module-federation'
                                  ? 'linear-gradient(135deg, #1f4f5f, #5fb3d4)'
                                  : app.integrationType === 'iframe'
                                    ? 'linear-gradient(135deg, #4f3f1f, #d4b35f)'
                                    : 'linear-gradient(135deg, #3f1f4f, #b35fd4)',
                            }}
                          >
                            {app.integrationType === 'module-federation'
                              ? '🔗'
                              : app.integrationType === 'iframe'
                                ? '🖼️'
                                : app.integrationType === 'web-component'
                                  ? '🧩'
                                  : '📱'}
                          </div>
                        )}

                        {/* Health Status Indicator */}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '-2px',
                            right: '-2px',
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: app.isHealthy
                              ? 'var(--success-color)'
                              : 'var(--error-color)',
                            border: '2px solid var(--bg-secondary)',
                          }}
                        />
                      </div>

                      {/* App Name */}
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: '500',
                          color: app.isHealthy
                            ? 'var(--text-primary)'
                            : 'var(--text-tertiary)',
                          textAlign: 'center',
                          lineHeight: '1.2',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {app.name}
                      </div>

                      {/* Status Text */}
                      {!app.isHealthy && (
                        <div
                          style={{
                            fontSize: '10px',
                            color: 'var(--error-color)',
                            marginTop: '2px',
                          }}
                        >
                          {t('offline')}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: '14px',
                }}
              >
                {t('noAppsAvailable')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default AppSelector
