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
  // Added when #1098 introduced org-context gating: SidePanel now calls
  // useOrganizations(), and a module mock that omits it makes vitest throw
  // rather than fall through to the real hook. A non-null activeOrganizationId
  // keeps isPersonalContext false, which is the context these tests were
  // written against -- they assert app listing, not org gating.
  useOrganizations: () => ({
    organizations: [],
    activeOrganizationId: 'org-test',
    activeOrganization: null,
    setActiveOrganization: () => {},
  }),
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
