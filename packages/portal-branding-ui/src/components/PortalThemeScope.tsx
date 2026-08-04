import React from 'react'
import { BrandTokenScope } from '@fuzeone/design-system'
import type { NormalizedPortalContext } from '../types'

export interface PortalThemeScopeProps {
  /** `null` renders children with no override (loading/error/disabled — they
   * inherit whatever accent is already cascading; never a partial/wrong tint). */
  context: NormalizedPortalContext | null
  children: React.ReactNode
}

/**
 * The `[data-portal]` token-override hook: re-points `--accent-*` to the
 * resolved portal's brand color via the DS `BrandTokenScope`, layered over
 * the base `@fuzeone/design-system` tokens — never a fork. `isRoot`
 * resolves to the literal `data-portal="root"` value the frames/specs assert
 * (frame 02), not the root portal's `fuzefront` slug.
 */
export function PortalThemeScope({ context, children }: PortalThemeScopeProps) {
  if (!context) return <>{children}</>
  const portalAttr = context.isRoot ? 'root' : context.slug
  return (
    <BrandTokenScope accent={context.branding.accent} data-portal={portalAttr}>
      {children}
    </BrandTokenScope>
  )
}
