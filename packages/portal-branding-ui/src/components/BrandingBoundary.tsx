import React from 'react'
import { Button, EmptyState } from '@fuzeone/design-system'
import { usePortalContext } from '../context/PortalBrandingProvider'
import type { NormalizedPortalContext } from '../types'
import { LoadingSkeleton } from './LoadingSkeleton'
import { PortalUnavailableNotice } from './PortalUnavailableNotice'

export interface BrandingBoundaryProps {
  /** Render prop — only invoked once the portal context has resolved
   * ('ready'), so callers never have to null-check `context` themselves. */
  children: (context: NormalizedPortalContext) => React.ReactNode
}

/**
 * The pre-auth boot boundary for PortalShell/PortalLoginFlow: renders the
 * no-flash loading skeleton, the error+retry surface, or the fail-closed
 * suspended notice while `GET /api/v1/portal/context` is pending/failed, and
 * only mounts `children(context)` once a portal (real or root-fallback) has
 * resolved. Manifest component: `BrandingBoundary`.
 */
export function BrandingBoundary({ children }: BrandingBoundaryProps) {
  const { status, context, retry } = usePortalContext()

  if (status === 'suspended') {
    return <PortalUnavailableNotice />
  }

  if (status === 'error') {
    return (
      <EmptyState
        data-state="error"
        role="alert"
        icon="⚠️"
        title="We couldn't load this workspace"
        body="The portal context request failed or timed out. We won't guess your branding."
        action={
          <Button type="button" data-action="retry" onClick={retry}>
            Try again
          </Button>
        }
      />
    )
  }

  if (status === 'ready' && context) {
    return <>{children(context)}</>
  }

  // 'loading' and 'disabled' (the latter should not occur here — PortalShell
  // / PortalLoginFlow always mount their provider with enabled) both render
  // the neutral skeleton rather than nothing, so there is never a blank paint.
  return <LoadingSkeleton />
}
