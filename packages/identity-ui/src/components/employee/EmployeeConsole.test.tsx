import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmployeeConsole } from './EmployeeConsole'

describe('EmployeeConsole', () => {
  it('renders the explorer view by default', () => {
    render(
      <EmployeeConsole
        view={{ kind: 'explorer' }}
        principalName="Jae Moon"
        organizations={[{ id: 'root-id', name: 'FuzeFront', kind: 'root' }]}
        onSelectOrg={vi.fn()}
      />
    )
    expect(document.querySelector('[data-list="reachable-orgs"]')).toBeInTheDocument()
  })

  it('renders the drilldown view when view.kind is drilldown', () => {
    render(
      <EmployeeConsole
        view={{ kind: 'drilldown', orgId: 'org_acme', orgName: 'Acme Co' }}
        principalName="Jae Moon"
        organizations={[]}
        onSelectOrg={vi.fn()}
        directMembers={[{ id: 'u_1', name: 'Rae Park', role: 'owner' }]}
      />
    )
    expect(document.querySelector('[data-panel="direct-members"]')).toBeInTheDocument()
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
  })

  it('drilldown: renders a loading state (org header still resolving) instead of the panel', () => {
    render(
      <EmployeeConsole
        view={{ kind: 'drilldown', orgId: 'org_acme' }}
        principalName="Jae Moon"
        organizations={[]}
        onSelectOrg={vi.fn()}
        loading
      />
    )
    expect(document.querySelector('[data-state="loading"][aria-busy="true"]')).toBeInTheDocument()
    expect(document.querySelector('[data-panel="direct-members"]')).not.toBeInTheDocument()
  })

  it('drilldown: renders an error state with retry instead of the panel', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <EmployeeConsole
        view={{ kind: 'drilldown', orgId: 'org_acme' }}
        principalName="Jae Moon"
        organizations={[]}
        onSelectOrg={vi.fn()}
        error="Organization not found"
        onRetry={onRetry}
      />
    )
    expect(document.querySelector('[data-state="error"]')).toBeInTheDocument()
    expect(document.querySelector('[data-panel="direct-members"]')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })
})
