import { Alert, Button } from '@fuzefront/design-system'

/**
 * d3 · Error — the list request failed (non-2xx other than 401/403, or a
 * network error). Renders `[data-action="retry"]` and NEVER a sign-in
 * redirect: the session is intact, this is a load failure, not an auth
 * failure (design/frames/portals-directory 02-portals-list-states, state
 * `error`).
 */
export function PortalsListError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="pd-panel-body" data-state="error">
      <Alert tone="error" title="Couldn't load your portals">
        The directory service didn't respond. Your session is still valid — this is a load error,
        not a sign-out.
      </Alert>
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Button variant="primary" onClick={onRetry} data-action="retry">
          Retry
        </Button>
      </div>
    </div>
  )
}
