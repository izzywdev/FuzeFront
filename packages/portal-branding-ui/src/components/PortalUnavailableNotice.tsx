import { EmptyState } from '@fuzeone/design-system'

/**
 * The suspended-portal fail-closed surface (frame 05, `data-state="suspended"`,
 * HTTP 403 `PORTAL_SUSPENDED` — FF-EPIC-10-S1 AC4). No retry: a suspended
 * portal doesn't self-heal by re-fetching, unlike the generic error state.
 */
export function PortalUnavailableNotice() {
  return (
    <EmptyState
      data-state="suspended"
      role="alert"
      icon="⛔"
      title="This portal is unavailable"
      body="This workspace has been suspended. Contact your administrator if you think this is a mistake."
    />
  )
}
