import type { NormalizedPortalContext } from '../types'
import { PortalBrandLockup } from './PortalBrandLockup'

export interface BrandedTopBarProps {
  context: NormalizedPortalContext
  userInitials?: string
}

/**
 * The pre-auth portal shell's topbar (frame 01/02, `[data-region="topbar"]`):
 * brand lockup + branded search affordance + avatar. Every accent-bearing
 * surface resolves through the `--accent-*` tokens `PortalThemeScope` (an
 * ancestor) has already re-pointed — nothing here reads `branding.accent`
 * directly.
 */
export function BrandedTopBar({ context, userInitials = '?' }: BrandedTopBarProps) {
  return (
    <header
      data-region="topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: '0 var(--space-6)',
        height: 'var(--top-bar-height)',
        flex: 'none',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <PortalBrandLockup context={context} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          color: 'var(--text-tertiary)',
          fontSize: 'var(--text-sm)',
          background: 'var(--bg-quaternary)',
          borderRadius: 'var(--radius-pill)',
          padding: 'var(--space-2) var(--space-4)',
        }}
      >
        <span aria-hidden="true">🔎</span>
        <span>Search {context.branding.name}…</span>
      </div>
      <div style={{ flex: 1 }} />
      <div
        aria-hidden="true"
        style={{
          width: 'var(--space-8)',
          height: 'var(--space-8)',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--accent-soft)',
          color: 'var(--accent-color)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
        }}
      >
        {userInitials}
      </div>
    </header>
  )
}
