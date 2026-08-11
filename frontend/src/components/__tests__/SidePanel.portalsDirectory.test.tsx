import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SidePanel from '../SidePanel'

// SidePanel pulls from several hooks; mock each to a minimal, deterministic
// shape so this test isolates the ONE thing it's for: the "Portals" menu
// entry is gated by fuzefront.platform.portals-directory (both states).
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

let flagValue = false
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (_key: string, _fallback: boolean) => flagValue,
}))

function renderSidePanel() {
  return render(
    <MemoryRouter>
      <SidePanel />
    </MemoryRouter>
  )
}

beforeEach(() => {
  flagValue = false
})

describe('<SidePanel /> — Portals Directory menu gating', () => {
  it('flag OFF (default): the Portals menu entry is absent', () => {
    flagValue = false
    renderSidePanel()
    expect(screen.queryByText('Portals')).not.toBeInTheDocument()
  })

  it('flag ON: the Portals menu entry renders in the Portal section', () => {
    flagValue = true
    renderSidePanel()
    expect(screen.getByText('Portals')).toBeInTheDocument()
  })
})
