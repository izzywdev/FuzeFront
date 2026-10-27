import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { App } from '@fuzefront/app-registry-client'
import { AppTile } from '@fuzefront/design-system'
import { useLanguage } from '../contexts/LanguageContext'
import { useRegisteredApps } from '../platform/appRegistry'
import { useCurrentUser, useOrganizations, ROOT_ORG_ID } from '../lib/shared'
import { isEmployeeUser } from '../utils/employee'
import {
  iconImageUrl,
  iconGlyph,
  integrationTypeOf,
  appHref,
} from '../platform/appManifest'

/**
 * The top-bar app launcher (the 9-dots menu). Renders activated apps from the
 * app-registry (manifest icon + menuLabel) as a compact icon+name grid using
 * the design-system <AppTile> — Google-launcher style, no per-app details.
 * Clicking an app navigates to its surface (portal mount or standalone
 * surface), per the manifest.
 */
// Stable id pair linking the trigger button to the panel it discloses
// (`aria-controls` / `aria-labelledby`) — module-scope so it stays stable
// across renders without needing React 18's useId in this file.
const PANEL_ID = 'app-selector-panel'
const PANEL_LABEL_ID = 'app-selector-panel-label'

function AppSelector() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { apps } = useRegisteredApps()
  const { user } = useCurrentUser()
  const { activeOrganizationId } = useOrganizations()
  const isPersonalContext = activeOrganizationId === null
  const isEmployee = isEmployeeUser(user?.roles)

  const visibleApps = apps.filter(app => {
    if (app.slug === 'executive') {
      if (isPersonalContext) return false
      if (activeOrganizationId === ROOT_ORG_ID && !isEmployee) return false
    }
    const manifest = app.manifest as any
    const orgRequired =
      manifest?.requiresOrgContext === true ||
      manifest?.visibility === 'organization'
    if (isPersonalContext && orgRequired) return false
    return true
  })

  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    placement: 'bottom',
  })

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const calculatePosition = () => {
        const button = buttonRef.current!
        const buttonRect = button.getBoundingClientRect()
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const dropdownWidth = 360
        const dropdownHeight = 420

        let top = buttonRect.bottom + 8
        let left = buttonRect.right - dropdownWidth
        let placement = 'bottom'

        if (top + dropdownHeight > viewport.height) {
          top = buttonRect.top - dropdownHeight - 8
          placement = 'top'
          if (top < 0) {
            top = Math.max(20, (viewport.height - dropdownHeight) / 2)
            placement = 'center'
          }
        }
        if (left < 20) {
          left = buttonRect.left
        } else if (left + dropdownWidth > viewport.width - 20) {
          left = viewport.width - dropdownWidth - 20
        }
        setDropdownPosition({ top, left, placement })
      }

      calculatePosition()
      const handleResize = () => calculatePosition()
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }
  }, [isOpen])

  const handleAppSelect = (app: App) => {
    setIsOpen(false)
    const href = appHref(app)
    if (href.startsWith('http')) window.location.href = href
    else navigate(href)
  }

  // Keyboard a11y: Escape dismisses the panel and returns focus to the
  // trigger button, same as clicking the backdrop would — but reachable
  // without a pointer.
  const closeAndRefocus = () => {
    setIsOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndRefocus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div className="app-selector">
      <button
        ref={buttonRef}
        className="app-grid-button"
        onClick={() => setIsOpen(!isOpen)}
        title={t('applications')}
        aria-label={t('applications')}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={isOpen ? PANEL_ID : undefined}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          transition: 'background-color var(--duration-base) ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--bg-quaternary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* 9-dots grid icon — purely decorative, the button already carries
            its own accessible name via aria-label, so hide this from AT. */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
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
          {/* Backdrop — a dismiss target only, never announced or focusable */}
          <div
            data-testid="app-selector-backdrop"
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'transparent',
              zIndex: 999,
            }}
            onClick={closeAndRefocus}
          />

          {/* App Grid Panel */}
          <div
            id={PANEL_ID}
            role="dialog"
            aria-modal="false"
            aria-labelledby={PANEL_LABEL_ID}
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              width: '360px',
              maxHeight: '420px',
              zIndex: 1000,
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
            }}
          >
            <div
              id={PANEL_LABEL_ID}
              style={{
                marginBottom: 'var(--space-3)',
                padding: '0 var(--space-1)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-md)',
                fontWeight: 'var(--weight-medium)',
              }}
            >
              {t('applications')}
            </div>

            {visibleApps.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'var(--space-2)',
                  maxHeight: '320px',
                  overflowY: 'auto',
                }}
              >
                {visibleApps.map(app => (
                  <AppTile
                    key={app.slug}
                    name={app.manifest.menuLabel}
                    integrationType={integrationTypeOf(app)}
                    iconUrl={iconImageUrl(app.manifest.icon)}
                    iconGlyph={iconGlyph(app.manifest.icon) ?? undefined}
                    isHealthy={app.isHealthy !== false}
                    onClick={() => handleAppSelect(app)}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--text-md)',
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
