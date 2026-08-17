import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CrossOrgExplorer } from './CrossOrgExplorer'
import type { EmployeeOrgNode } from '../../types'

const ROOT: EmployeeOrgNode = { id: 'root-id', name: 'FuzeFront', kind: 'root', memberCount: 2481 }
const NORTHWIND: EmployeeOrgNode = { id: 'org_northwind', name: 'Northwind', kind: 'portal', memberCount: 142 }
const ACME: EmployeeOrgNode = { id: 'org_acme', name: 'Acme Co', kind: 'org', memberCount: 7 }

describe('CrossOrgExplorer', () => {
  it('renders the loading state with aria-busy and no table', () => {
    render(<CrossOrgExplorer organizations={[]} loading onSelectOrg={vi.fn()} />)
    const loading = document.querySelector('[data-state="loading"]')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(document.querySelector('[data-list="reachable-orgs"]')).not.toBeInTheDocument()
  })

  it('renders the error state with a retry action and no table', () => {
    const onRetry = vi.fn()
    render(<CrossOrgExplorer organizations={[]} error="Network error" onRetry={onRetry} onSelectOrg={vi.fn()} />)
    expect(document.querySelector('[data-state="error"]')).toBeInTheDocument()
    expect(document.querySelector('[data-list="reachable-orgs"]')).not.toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('calling retry invokes onRetry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<CrossOrgExplorer organizations={[]} error="boom" onRetry={onRetry} onSelectOrg={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('real-empty: only root reachable renders root plus the empty notice, never fabricating rows', () => {
    render(<CrossOrgExplorer organizations={[ROOT]} onSelectOrg={vi.fn()} />)
    expect(document.querySelector('[data-state="empty"]')).toBeInTheDocument()
    expect(screen.getByText('FuzeFront')).toBeInTheDocument()
    expect(screen.getByText(/no customer orgs yet/i)).toBeInTheDocument()
  })

  it('populated: renders every reachable org row and calls onSelectOrg', async () => {
    const user = userEvent.setup()
    const onSelectOrg = vi.fn()
    render(<CrossOrgExplorer organizations={[ROOT, NORTHWIND, ACME]} onSelectOrg={onSelectOrg} />)
    const list = document.querySelector('[data-list="reachable-orgs"]')
    expect(list).toBeInTheDocument()
    expect(screen.getByText('Northwind')).toBeInTheDocument()
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
    expect(document.querySelector('[data-state="empty"]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /acme co/i }))
    expect(onSelectOrg).toHaveBeenCalledWith('org_acme')
  })

  it('carries the staff banner with data-role="employee"', () => {
    render(<CrossOrgExplorer organizations={[ROOT]} onSelectOrg={vi.fn()} />)
    expect(document.querySelector('[data-panel="staff-banner"][data-role="employee"]')).toBeInTheDocument()
  })
})
