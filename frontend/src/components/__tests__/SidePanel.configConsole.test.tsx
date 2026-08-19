import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SidePanel from '../SidePanel'

// Isolates the ONE thing this test is for: the "Configuration" menu entry is
// gated by fuzefront.config.management-console (both states), independent of
// the sibling fuzefront.platform.portals-directory flag SidePanel also reads.
vi.mock('../../lib/shared', () => ({
  useCurrentUser: () => ({ user: { roles: ['admin'] } }),
  useAppContext: () => ({ state: { menuItems: [] } }),
}))
vi.mock('../../platform/appRegistry', () => ({
  useRegisteredApps: () => ({ apps: [] }),
}))
vi.mock('../../platform/useActiveApp', () => ({
  useActiveApp: () => null,
}))
vi.mock('@fuzefront/i18n', () => ({
  useT: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}))

let configConsoleFlag = false
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (key: string, fallback: boolean) =>
    key === 'fuzefront.config.management-console' ? configConsoleFlag : fallback,
}))

function renderSidePanel() {
  return render(
    <MemoryRouter>
      <SidePanel />
    </MemoryRouter>
  )
}

beforeEach(() => {
  configConsoleFlag = false
})

describe('<SidePanel /> — Configuration menu gating', () => {
  it('flag OFF (default): the Configuration menu entry is absent', () => {
    configConsoleFlag = false
    renderSidePanel()
    expect(screen.queryByText('Configuration')).not.toBeInTheDocument()
  })

  it('flag ON: the Configuration menu entry renders in the Portal section', () => {
    configConsoleFlag = true
    renderSidePanel()
    expect(screen.getByText('Configuration')).toBeInTheDocument()
  })
})
