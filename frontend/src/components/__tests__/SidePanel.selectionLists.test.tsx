import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SidePanel from '../SidePanel'

// Isolates the ONE thing this test is for: the "Selection Lists" menu entry is
// gated by release flag fuzefront.selection-lists.service (both states),
// independent of the sibling flags SidePanel also reads.
vi.mock('../../lib/shared', () => ({
  useCurrentUser: () => ({ user: { roles: ['admin'] } }),
  useAppContext: () => ({ state: { menuItems: [] } }),
  useOrganizations: () => ({
    organizations: [],
    activeOrganizationId: null,
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

let selectionListsFlag = false
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (key: string, fallback: boolean) =>
    key === 'fuzefront.selection-lists.service' ? selectionListsFlag : fallback,
}))

function renderSidePanel() {
  return render(
    <MemoryRouter>
      <SidePanel />
    </MemoryRouter>
  )
}

beforeEach(() => {
  selectionListsFlag = false
})

describe('<SidePanel /> — Selection Lists menu gating', () => {
  it('flag OFF (default): the Selection Lists menu entry is absent', () => {
    selectionListsFlag = false
    renderSidePanel()
    expect(screen.queryByText('Selection Lists')).not.toBeInTheDocument()
  })

  it('flag ON: the Selection Lists menu entry renders', () => {
    selectionListsFlag = true
    renderSidePanel()
    expect(screen.getByText('Selection Lists')).toBeInTheDocument()
  })
})
