import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TenantSelector } from '../TenantSelector'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

const fixtures = vi.hoisted(() => {
  const ROOT = '00000000-0000-0000-0000-000000000010'
  return {
    ROOT_ID: ROOT,
    organizations: [
      { id: ROOT, name: 'FuzeFront', user_role: 'member', parentId: null },
      { id: 'org_northwind', name: 'Northwind', user_role: 'owner', parentId: ROOT },
    ],
    switcherState: { activeOrganizationId: ROOT as string | null },
    setActiveOrganization: vi.fn((id: string | null) => {
      fixtures.switcherState.activeOrganizationId = id
    }),
  }
})

let flagValue = true
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
  useAppContext: () => ({ state: { organizations: fixtures.organizations }, dispatch: vi.fn() }),
  ROOT_ORG_ID: fixtures.ROOT_ID,
}))

vi.mock('../PermissionGate', () => ({
  usePermissions: () => ({ hasPermission: vi.fn().mockResolvedValue(false) }),
}))

vi.mock('../../services/api', () => ({
  getOrganizations: vi.fn().mockResolvedValue(fixtures.organizations),
  createOrganization: vi.fn(),
  checkOrganizationSlugAvailable: vi.fn().mockResolvedValue({ available: true }),
}))

function renderTenantSelector() {
  return render(
    <MemoryRouter>
      <TenantSelector />
    </MemoryRouter>
  )
}

beforeEach(() => {
  flagValue = true
  fixtures.switcherState.activeOrganizationId = ROOT_ID
  fixtures.setActiveOrganization.mockClear()
})

describe('TenantSelector TopBar Component', () => {
  it('renders the active organization name in the top bar button', () => {
    renderTenantSelector()
    const button = screen.getByRole('button', { name: /FuzeFront/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('data-topbar-control', 'tenant-selector')
  })

  it('renders Personal when activeOrganizationId is null', () => {
    fixtures.switcherState.activeOrganizationId = null
    renderTenantSelector()
    const button = screen.getByRole('button', { name: /Personal/i })
    expect(button).toBeInTheDocument()
  })

  it('opens organization switcher dropdown when clicked', async () => {
    renderTenantSelector()
    const button = screen.getByRole('button', { name: /FuzeFront/i })
    fireEvent.click(button)

    const dropdown = screen.getByRole('button', { name: /FuzeFront/i }).closest('.tenant-selector')
      ?.querySelector('[data-topbar-panel="tenant-selector"]')
    expect(dropdown).toBeInTheDocument()

    // Context / Organization rows are displayed inside
    await waitFor(() => {
      expect(screen.getByText('Personal')).toBeInTheDocument()
      expect(screen.getByText('Northwind')).toBeInTheDocument()
    })
  })

  it('switches organization and closes dropdown when an organization row is clicked', async () => {
    renderTenantSelector()
    const button = screen.getByRole('button', { name: /FuzeFront/i })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())
    const northwindRow = screen.getByText('Northwind').closest('button')!
    fireEvent.click(northwindRow)

    expect(fixtures.setActiveOrganization).toHaveBeenCalledWith('org_northwind')
  })
})
