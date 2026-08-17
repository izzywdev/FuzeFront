import { Tabs } from '@fuzefront/design-system'
import type { ReactNode } from 'react'

export type PortalConsoleTab = 'overview' | 'users' | 'catalog'

export interface PortalConsoleShellProps {
  portalName: string
  activeTab: PortalConsoleTab
  onTabChange: (tab: PortalConsoleTab) => void
  children: ReactNode
}

/**
 * Tabbed console shell (frames 05-07): Overview / Users / App catalog. The
 * App-catalog tab stays CLICKABLE even when `fuzefront.apps.portal-catalog`
 * is off — it renders an honest "not available yet" panel (the flow owns
 * that body) rather than a dead/disabled tab, so a caller can always see
 * which capabilities exist.
 */
export function PortalConsoleShell({ portalName, activeTab, onTabChange, children }: PortalConsoleShellProps) {
  return (
    <div data-frame="portal-console">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)', margin: '0 0 var(--space-4)' }}>
        {portalName} · Console
      </h1>
      <Tabs
        data-panel="portal-tabs"
        ariaLabel="Portal console"
        value={activeTab}
        onChange={value => onTabChange(value as PortalConsoleTab)}
        tabs={[
          { value: 'overview', label: 'Overview', id: 'tab-overview' },
          { value: 'users', label: 'Users', id: 'tab-users' },
          { value: 'catalog', label: 'App catalog', id: 'tab-catalog' },
        ]}
        style={{ marginBottom: 'var(--space-6)' }}
      />
      <div>{children}</div>
    </div>
  )
}
