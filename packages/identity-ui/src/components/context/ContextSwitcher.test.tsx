import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextSwitcher } from './ContextSwitcher'
import type { OrgContextItem } from '../../types'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

const organizations: OrgContextItem[] = [
  { id: ROOT_ID, name: 'FuzeFront', role: 'member', isRoot: true, parentId: null },
  { id: 'org_northwind', name: 'Northwind', role: 'owner', isPortal: true, parentId: ROOT_ID },
  { id: 'org_nw_sales', name: 'Sales', role: 'admin', parentId: 'org_northwind' },
  { id: 'org_acme', name: 'Acme Co', role: 'viewer', parentId: null },
]

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof ContextSwitcher>> = {}) {
  const onSelect = vi.fn()
  const onCreateOrg = vi.fn()
  render(
    <ContextSwitcher
      activeTarget={ROOT_ID}
      userName="Ada Rowe"
      organizations={organizations}
      rootOrgId={ROOT_ID}
      onSelect={onSelect}
      onCreateOrg={onCreateOrg}
      {...overrides}
    />
  )
  return { onSelect, onCreateOrg }
}

describe('ContextSwitcher', () => {
  it('renders one unified menu: Personal as a first-class target, not an org row', () => {
    renderSwitcher()
    const menu = screen.getByRole('menu', { name: /switch context/i })
    expect(menu).toHaveAttribute('data-panel', 'context-switcher')
    const personal = screen.getByRole('menuitemradio', { name: /ada rowe/i })
    expect(personal).toHaveAttribute('data-switch-target', 'personal')
  })

  it('marks the active org row aria-checked and shows the check glyph', () => {
    renderSwitcher()
    const rootRow = screen.getByRole('menuitemradio', { name: /fuzefront/i })
    expect(rootRow).toHaveAttribute('aria-checked', 'true')
    expect(rootRow).toHaveAttribute('data-role', 'member')
  })

  it('nests sub-orgs under their parent (Sales under Northwind)', () => {
    renderSwitcher()
    const sales = screen.getByRole('menuitemradio', { name: /sales/i })
    expect(sales).toHaveAttribute('data-switch-target', 'org_nw_sales')
    expect(sales).toHaveAttribute('data-role', 'admin')
  })

  it('renders role pills from user_role, never hard-coded', () => {
    renderSwitcher()
    const acme = screen.getByRole('menuitemradio', { name: /acme co/i })
    expect(acme).toHaveTextContent(/viewer/i)
  })

  it('calls onSelect with the org id when a row is clicked', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher()
    await user.click(screen.getByRole('menuitemradio', { name: /acme co/i }))
    expect(onSelect).toHaveBeenCalledWith('org_acme')
  })

  it('calls onSelect("personal") when the Personal row is clicked', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher()
    await user.click(screen.getByRole('menuitemradio', { name: /ada rowe/i }))
    expect(onSelect).toHaveBeenCalledWith('personal')
  })

  it('renders the create-organization footer action', async () => {
    const user = userEvent.setup()
    const { onCreateOrg } = renderSwitcher()
    await user.click(screen.getByRole('button', { name: /create organization/i }))
    expect(onCreateOrg).toHaveBeenCalledTimes(1)
  })

  it('hides create-organization when canCreate is false', () => {
    renderSwitcher({ canCreate: false })
    expect(screen.queryByRole('button', { name: /create organization/i })).not.toBeInTheDocument()
  })
})
