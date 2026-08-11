import { EmptyState } from '@fuzefront/design-system'

const InboxIcon = () => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
  </svg>
)

/**
 * d2 · Empty — the caller legitimately manages zero portals. A REAL,
 * non-error case (design/frames/portals-directory 02-portals-list-states,
 * state `empty`) — never rendered as/confused with the error state.
 */
export function PortalsListEmpty() {
  return (
    <div data-state="empty">
      <EmptyState
        icon={<InboxIcon />}
        title="No portals to manage"
        body="You don't manage any portals yet. When a portal is provisioned and you're granted admin on it, it appears here — ready to open in its own tab."
      />
    </div>
  )
}
