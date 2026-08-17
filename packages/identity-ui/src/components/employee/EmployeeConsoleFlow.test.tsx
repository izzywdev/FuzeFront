import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmployeeConsoleFlow } from './EmployeeConsoleFlow'

const ORGS = [
  { id: 'root-id', name: 'FuzeFront', kind: 'root' as const },
  { id: 'org_acme', name: 'Acme Co', kind: 'org' as const },
]

describe('EmployeeConsoleFlow', () => {
  it('non-Employee: renders the fail-closed notice and never the explorer, regardless of view', () => {
    render(
      <EmployeeConsoleFlow
        isEmployee={false}
        view={{ kind: 'explorer' }}
        principalName="Random User"
        organizations={ORGS}
        onSelectOrg={vi.fn()}
      />
    )
    expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
    expect(document.querySelector('[data-list="reachable-orgs"]')).not.toBeInTheDocument()
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument()
  })

  it('Employee: renders the explorer for view.kind="explorer"', () => {
    render(
      <EmployeeConsoleFlow
        isEmployee
        view={{ kind: 'explorer' }}
        principalName="Jae Moon"
        organizations={ORGS}
        onSelectOrg={vi.fn()}
      />
    )
    expect(document.querySelector('[data-state="forbidden"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-list="reachable-orgs"]')).toBeInTheDocument()
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
  })

  it('Employee: renders the drilldown for view.kind="drilldown"', () => {
    render(
      <EmployeeConsoleFlow
        isEmployee
        view={{ kind: 'drilldown', orgId: 'org_acme', orgName: 'Acme Co' }}
        principalName="Jae Moon"
        organizations={ORGS}
        onSelectOrg={vi.fn()}
        directMembers={[{ id: 'u_1', name: 'Rae Park', role: 'owner' }]}
      />
    )
    expect(document.querySelector('[data-panel="inherited-access"]')).toBeInTheDocument()
    expect(document.querySelector('[data-panel="direct-members"]')).toBeInTheDocument()
  })
})
