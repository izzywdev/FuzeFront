import { Skeleton } from '@fuzefront/design-system'

/**
 * d1 · Loading — an `aria-busy` skeleton while
 * `GET /api/v1/admin/portals` is in flight (design/frames/portals-directory
 * 02-portals-list-states, state `loading`).
 */
export function PortalsListLoading() {
  return (
    <div data-state="loading" aria-busy="true" aria-label="Loading portals">
      <div className="pd-dir" aria-hidden="true">
        {[0, 1, 2].map(i => (
          <div className="pd-row" key={i}>
            <div className="pd-row__main">
              <div className="pd-row__top">
                <Skeleton width="55%" height="var(--text-md)" />
              </div>
              <Skeleton width="35%" height="var(--text-lg)" radius="var(--radius-pill)" />
            </div>
            <div className="pd-row__side">
              <Skeleton width="112px" height="var(--space-8)" radius="var(--radius-md)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
