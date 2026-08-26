import type { ReactNode } from 'react'
import { SearchField } from '@fuzefront/design-system'

/**
 * The directory panel chrome (`[data-panel="portals-directory"]` per
 * design/frames/portals-directory's testHooks): header (title + count),
 * search field, and a swappable body — loading / empty / error /
 * permission-denied / the populated `PortalsList` — plus an optional footer
 * ("Load more").
 */
export function PortalsDirectoryShell({
  title = 'Portals you manage',
  subtitle,
  showSearch = true,
  searchValue,
  onSearchChange,
  children,
  footer,
}: {
  title?: string
  subtitle?: ReactNode
  showSearch?: boolean
  searchValue?: string
  onSearchChange?: (value: string) => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="pd-panel" data-panel="portals-directory">
      <div className="pd-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="pd-sub">{subtitle}</p>}
        </div>
      </div>

      {showSearch && (
        <div className="pd-searchbar">
          <SearchField
            label="Search portals"
            placeholder="Search portals by name or domain…"
            value={searchValue}
            onChange={e => onSearchChange?.(e.target.value)}
            data-input="search"
          />
        </div>
      )}

      {children}

      {footer && <div className="pd-panel-foot">{footer}</div>}
    </div>
  )
}
