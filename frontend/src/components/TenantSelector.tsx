import { useState, useEffect, useRef } from 'react'
import { useT } from '@fuzefront/i18n'
import { useOrganizations } from '../lib/shared'
import { OrganizationSwitcherSection } from './UserMenu'

/**
 * TopBar Tenant / Organization Selector.
 *
 * Placed in the top-bar actions group to the left of the AppSelector (9-dots),
 * providing global, centralized tenant and personal context switching across
 * all hosted applications in the FuzeFront portal.
 */
export function TenantSelector() {
  const { t } = useT()
  const { organizations, activeOrganizationId } = useOrganizations()
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
  })

  const currentOrg = organizations.find(o => o.id === activeOrganizationId)
  const displayName =
    activeOrganizationId === null
      ? t('organizations.personal', { defaultValue: 'Personal' })
      : currentOrg
        ? currentOrg.name
        : organizations.length > 0 && !activeOrganizationId
          ? t('organizations.personal', { defaultValue: 'Personal' })
          : t('organizations.select', { defaultValue: 'Select Organization' })

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const calculatePosition = () => {
        const button = buttonRef.current!
        const buttonRect = button.getBoundingClientRect()
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const dropdownWidth = 320
        const dropdownHeight = 440

        let top = buttonRect.bottom + 6
        // Align dropdown right edge with button right edge by default
        let left = buttonRect.right - dropdownWidth

        if (top + dropdownHeight > viewport.height) {
          top = Math.max(10, buttonRect.top - dropdownHeight - 6)
        }
        if (left < 12) {
          left = Math.max(12, buttonRect.left)
        } else if (left + dropdownWidth > viewport.width - 12) {
          left = viewport.width - dropdownWidth - 12
        }

        setDropdownPosition({ top, left })
      }

      calculatePosition()
      const handleResize = () => calculatePosition()
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  return (
    <div className="tenant-selector" style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className="tenant-selector-btn"
        data-topbar-control="tenant-selector"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        title={displayName}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '6px 12px',
          background: isOpen ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-medium)',
          cursor: 'pointer',
          transition: 'all var(--duration-base) ease',
          outline: 'none',
          maxWidth: '220px',
        }}
        onMouseEnter={e => {
          if (!isOpen) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'
        }}
        onMouseLeave={e => {
          if (!isOpen) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'
        }}
      >
        {/* Modern building/tenant SVG icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, color: 'var(--accent-color)' }}
        >
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </svg>

        <span
          className="tenant-selector-name"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {displayName}
        </span>

        {/* Dropdown Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            opacity: 0.7,
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--duration-base) ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Transparent Backdrop for dismissing on click outside */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'transparent',
              zIndex: 999,
            }}
            onClick={() => setIsOpen(false)}
          />

          {/* Organization Switcher Dropdown Panel */}
          <div
            className="tenant-selector-dropdown"
            data-topbar-panel="tenant-selector"
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              width: '320px',
              maxHeight: '440px',
              overflowY: 'auto',
              zIndex: 1000,
              boxShadow: 'var(--shadow-lg)',
              padding: 'var(--space-2) 0',
            }}
          >
            <OrganizationSwitcherSection
              open={isOpen}
              onNavigate={() => setIsOpen(false)}
              borderTop={false}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default TenantSelector
