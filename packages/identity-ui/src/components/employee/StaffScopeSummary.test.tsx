import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaffScopeSummary } from './StaffScopeSummary'

describe('StaffScopeSummary', () => {
  it('explorer variant carries data-role="employee" and the derives-down-parent copy', () => {
    render(<StaffScopeSummary variant="explorer" />)
    const banner = document.querySelector('[data-panel="staff-banner"]')
    expect(banner).toHaveAttribute('data-role', 'employee')
    expect(screen.getByText(/platform staff \(Employee\)/i)).toBeInTheDocument()
    expect(screen.getByText(/derives down the parent tree/i)).toBeInTheDocument()
  })

  it('drilldown variant names the org and omits data-role', () => {
    render(<StaffScopeSummary variant="drilldown" orgName="Acme Co" />)
    const banner = document.querySelector('[data-panel="staff-banner"]')
    expect(banner).not.toHaveAttribute('data-role')
    expect(screen.getByText(/Viewing Acme Co as platform staff/i)).toBeInTheDocument()
    expect(screen.getByText(/not a member of Acme Co/i)).toBeInTheDocument()
  })
})
