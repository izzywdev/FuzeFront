/**
 * OrganizationSwitcherSection — FF-EPIC-17-S4 BOTH-STATES cover for
 * fuzefront.identity.personal-context.
 *
 * Flag OFF: today's flat org list, completely unchanged (zero regression).
 * Flag ON: the reconciled switcher — Personal as a first-class target, root
 * shows its REAL user_role (never a fabricated MEMBER, never a hard-coded
 * GUEST), and direct sub-org memberships nest under their parent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OrganizationSwitcherSection } from '../UserMenu'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

const fixtures = vi.hoisted(() => {
  const ROOT = '00000000-0000-0000-0000-000000000010'
  return {
    ROOT_ID: ROOT,
    organizations: [
      { id: ROOT, name: 'FuzeFront', user_role: 'member', parentId: null },
      { id: 'org_northwind', name: 'Northwind', user_role: 'owner', parentId: ROOT },
      { id: 'org_nw_sales', name: 'Sales', user_role: 'admin', parentId: 'org_northwind' },
      // The legacy platform org (migration 025a): visible to everyone, no membership.
      { id: 'org_legacy_platform', name: 'Legacy Platform', type: 'platform', user_role: null, parentId: null },
      // The user's legacy type='personal' org row.
      { id: 'org_personal', name: 'Personal Workspace', type: 'personal', user_role: 'owner', parentId: null },
    ],
    switcherState: { activeOrganizationId: ROOT as string | null },
    setActiveOrganization: vi.fn((id: string | null) => {
      fixtures.switcherState.activeOrganizationId = id
    }),
  }
})

let flagValue = false
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (_key: string, _fallback: boolean) => flagValue,
}))

vi.mock('@fuzefront/i18n', () => ({
  useT: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
  LanguageSelector: () => null,
}))

vi.mock('../../lib/shared', () => ({
  useOrganizations: () => ({
    organizations: fixtures.organizations,
    activeOrganizationId: fixtures.switcherState.activeOrganizationId,
    setActiveOrganization: fixtures.setActiveOrganization,
  }),
  useAppContext: () => ({ state: { organizations: [] }, dispatch: vi.fn() }),
  // An employee, so the root org stays visible (non-employees cannot see it).
  useCurrentUser: () => ({ user: { roles: ['employee'] }, setUser: vi.fn() }),
  ROOT_ORG_ID: fixtures.ROOT_ID,
}))

vi.mock('../PermissionGate', () => ({
  usePermissions: () => ({ hasPermission: vi.fn().mockResolvedValue(false) }),
}))

vi.mock('../../services/api', () => ({
  getOrganizations: vi.fn().mockResolvedValue(fixtures.organizations),
  createOrganization: vi.fn(),
}))

function renderSection() {
  return render(
    <MemoryRouter>
      <OrganizationSwitcherSection open onNavigate={vi.fn()} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  flagValue = false
  fixtures.switcherState.activeOrganizationId = ROOT_ID
  fixtures.setActiveOrganization.mockClear()
})

describe('OrganizationSwitcherSection — fuzefront.identity.personal-context', () => {
  it('flag OFF: renders the flat org list exactly as before — no Personal row', async () => {
    flagValue = false
    renderSection()
    await waitFor(() => expect(screen.getByText('FuzeFront')).toBeInTheDocument())
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    expect(screen.getByText('Northwind')).toBeInTheDocument()
  })

  it('flag ON: renders a first-class Personal row', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText('Personal')).toBeInTheDocument())
    const personalRow = screen.getByText('Personal').closest('[data-switch-target="personal"]')
    expect(personalRow).toBeInTheDocument()
  })

  it('flag ON: root shows its real user_role, not a fabricated badge', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText('FuzeFront')).toBeInTheDocument())
    const rootRow = screen.getByText('FuzeFront').closest('[data-switch-target]')
    expect(rootRow).toHaveAttribute('data-role', 'member')
  })

  it('flag ON: nests Sales under Northwind (direct sub-org membership)', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText(/sales/i)).toBeInTheDocument())
    const salesRow = screen.getByText(/sales/i).closest('[data-switch-target="org_nw_sales"]')
    expect(salesRow).toHaveAttribute('data-role', 'admin')
  })

  it('flag ON: selecting Personal calls setActiveOrganization(null)', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText('Personal')).toBeInTheDocument())
    screen.getByText('Personal').closest('button')!.click()
    expect(fixtures.setActiveOrganization).toHaveBeenCalledWith(null)
  })

  it('flag OFF: legacy personal and visibility-only platform orgs still list (unchanged)', async () => {
    flagValue = false
    renderSection()
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())
    expect(screen.getByText('Personal Workspace')).toBeInTheDocument()
    expect(screen.getByText('Legacy Platform')).toBeInTheDocument()
  })

  it('flag ON: drops the type=personal org — Personal is the context row, not an org', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())
    expect(screen.queryByText('Personal Workspace')).not.toBeInTheDocument()
    expect(screen.getAllByText('Personal')).toHaveLength(1)
  })

  it('flag ON: drops platform orgs the caller only sees (GUEST, no membership)', async () => {
    flagValue = true
    renderSection()
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())
    expect(screen.queryByText('Legacy Platform')).not.toBeInTheDocument()
    // The root org the caller IS a member of stays.
    expect(screen.getByText('FuzeFront')).toBeInTheDocument()
  })
})
