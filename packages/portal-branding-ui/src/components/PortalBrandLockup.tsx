import { Logo } from '@fuzefront/design-system'
import type { NormalizedPortalContext } from '../types'

export interface PortalBrandLockupProps {
  context: NormalizedPortalContext
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Logo + name pairing shared by the topbar (frame 01) and the login brand
 * pane (frame 03) — `[data-branding-logo]` always renders (the DS `Logo`
 * primitive falls back to initials, never a broken image) and
 * `[data-branding-name]` renders `branding.name` verbatim.
 */
export function PortalBrandLockup({ context, size = 'md', className }: PortalBrandLockupProps) {
  return (
    <div
      className={className}
      data-branding="lockup"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
    >
      <Logo data-branding-logo src={context.branding.logo} name={context.branding.name} size={size} />
      <span
        data-branding-name
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--weight-semibold)',
          fontSize: size === 'lg' ? 'var(--text-xl)' : 'var(--text-md)',
          color: 'var(--text-primary)',
        }}
      >
        {context.branding.name}
      </span>
    </div>
  )
}
