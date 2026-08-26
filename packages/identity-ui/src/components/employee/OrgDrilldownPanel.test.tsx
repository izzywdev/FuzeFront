import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrgDrilldownPanel } from './OrgDrilldownPanel'

const MEMBERS = [
  { id: 'u_9001', name: 'Rae Park', role: 'owner' },
  { id: 'u_9002', name: 'Dev Lang', role: 'member' },
]

describe('OrgDrilldownPanel', () => {
  it('renders the org direct-members list, keyed by data-user, and the Employee is absent', () => {
    render(<OrgDrilldownPanel orgId="org_acme" orgName="Acme Co" principalName="Jae Moon" directMembers={MEMBERS} />)
    expect(document.querySelector('[data-panel="direct-members"]')).toBeInTheDocument()
    expect(document.querySelector('[data-list="direct-members"]')).toBeInTheDocument()
    expect(document.querySelector('[data-user="u_9001"]')).toBeInTheDocument()
    expect(screen.getByText('Rae Park')).toBeInTheDocument()
    expect(screen.queryByText('Jae Moon')).not.toBeInTheDocument()
    expect(screen.getByText(/absent from this list — by design/i)).toBeInTheDocument()
  })

  it('renders the inherited-access panel as a structurally separate section', () => {
    render(<OrgDrilldownPanel orgId="org_acme" orgName="Acme Co" principalName="Jae Moon" directMembers={MEMBERS} />)
    const inherited = document.querySelector('[data-panel="inherited-access"]')
    const direct = document.querySelector('[data-panel="direct-members"]')
    expect(inherited).toBeInTheDocument()
    expect(direct).toBeInTheDocument()
    expect(inherited).not.toBe(direct)
    expect(inherited?.contains(direct!)).toBe(false)
    expect(direct?.contains(inherited!)).toBe(false)
  })

  it('renders the members loading state with aria-busy', () => {
    render(<OrgDrilldownPanel orgId="org_acme" orgName="Acme Co" principalName="Jae Moon" directMembers={[]} membersLoading />)
    expect(document.querySelector('[data-panel="direct-members"] [data-state="loading"][aria-busy="true"]')).toBeInTheDocument()
  })

  it('renders a members error with retry, without silently falling back to empty', async () => {
    const user = userEvent.setup()
    const onRetryMembers = vi.fn()
    render(
      <OrgDrilldownPanel
        orgId="org_acme"
        orgName="Acme Co"
        principalName="Jae Moon"
        directMembers={[]}
        membersError="Could not reach the members service"
        onRetryMembers={onRetryMembers}
      />
    )
    expect(document.querySelector('[data-panel="direct-members"] [data-state="error"]')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetryMembers).toHaveBeenCalled()
  })

  it('renders a real empty direct-members state', () => {
    render(<OrgDrilldownPanel orgId="org_acme" orgName="Acme Co" principalName="Jae Moon" directMembers={[]} />)
    expect(document.querySelector('[data-panel="direct-members"] [data-state="empty"]')).toBeInTheDocument()
  })
})
