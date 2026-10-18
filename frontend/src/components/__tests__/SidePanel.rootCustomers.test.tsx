import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SidePanel from '../SidePanel'

// FFRNT-309: the root "Customers" nav entry is gated by
// fuzefront.identity.invite-v2 (both states) AND an employee/admin first-paint
// hint; /root/customers re-checks the real root-org owner role itself.
let roles: string[] = ['admin']
vi.mock('../../lib/shared', () => ({
  useCurrentUser: () => ({ user: { roles } }),
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

let inviteV2Flag = false
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (key: string, fallback: boolean) => (key === 'fuzefront.identity.invite-v2' ? inviteV2Flag : fallback),
}))

function renderSidePanel() {
  return render(
    <MemoryRouter>
      <SidePanel />
    </MemoryRouter>
  )
}

beforeEach(() => {
  inviteV2Flag = false
  roles = ['admin']
})

describe('<SidePanel /> — root Customers entry (fuzefront.identity.invite-v2)', () => {
  it('flag OFF (default): no Customers entry', () => {
    renderSidePanel()
    expect(screen.queryByText('Customers')).not.toBeInTheDocument()
  })

  it('flag ON + admin/employee: the Customers entry renders', () => {
    inviteV2Flag = true
    renderSidePanel()
    expect(screen.getByText('Customers')).toBeInTheDocument()
  })

  it('flag ON but a plain member: no Customers entry', () => {
    inviteV2Flag = true
    roles = ['user']
    renderSidePanel()
    expect(screen.queryByText('Customers')).not.toBeInTheDocument()
  })
})
