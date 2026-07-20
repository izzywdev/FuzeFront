import React from 'react'
import type { SecurityCardKey } from '../types'

export interface SecurityCardProps {
  cardKey: SecurityCardKey
  /** App-relative route this card navigates to (frame `data-route`). */
  route: string
  icon: React.ReactNode
  title: string
  desc: string
  /** Status badge(s) shown in the card meta row. */
  badge?: React.ReactNode
  /** Navigation handler; receives the route. Falls back to an anchor href. */
  onNavigate?: (route: string) => void
  /** Span the full grid width (the connected-accounts card). */
  fullWidth?: boolean
}

/**
 * One navigational hub card linking to a sibling security surface. Renders as a
 * real link (keyboard-focusable, visible focus) with a token-driven hover lift.
 * Uses logical properties so the chevron and layout mirror under RTL.
 */
export function SecurityCard({
  cardKey,
  route,
  icon,
  title,
  desc,
  badge,
  onNavigate,
  fullWidth,
}: SecurityCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (onNavigate) {
      e.preventDefault()
      onNavigate(route)
    }
  }
  const handleKey = (e: React.KeyboardEvent) => {
    if (onNavigate && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onNavigate(route)
    }
  }

  return (
    <a
      href={route}
      data-card={cardKey}
      data-route={route}
      onClick={handleClick}
      onKeyDown={handleKey}
      style={{
        gridColumn: fullWidth ? '1 / -1' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        transition: 'border-color var(--duration-base), transform var(--duration-base)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-strong)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)'
        e.currentTarget.style.transform = 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            fontWeight: 'var(--weight-medium)',
            fontSize: 'var(--text-md)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 'var(--space-8)',
              height: 'var(--space-8)',
              borderRadius: 'var(--radius-md)',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--accent-soft)',
              color: 'var(--accent-color)',
              fontSize: 'var(--text-md)',
              flex: 'none',
            }}
          >
            {icon}
          </span>
          {title}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
          →
        </span>
      </div>
      <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>{desc}</p>
      {badge != null && (
        <div
          style={{
            marginTop: 'var(--space-2)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {badge}
        </div>
      )}
    </a>
  )
}
