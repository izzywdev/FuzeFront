import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InheritedAccessPanel } from './InheritedAccessPanel'

describe('InheritedAccessPanel', () => {
  it('carries data-panel="inherited-access" and data-access="inherited"', () => {
    render(<InheritedAccessPanel principalName="Jae Moon" orgName="Acme Co" />)
    const panel = document.querySelector('[data-panel="inherited-access"]')
    expect(panel).toHaveAttribute('data-access', 'inherited')
  })

  it('states there is no membership row for this org, naming it', () => {
    render(<InheritedAccessPanel principalName="Jae Moon" orgName="Acme Co" />)
    expect(screen.getByText(/none — not a member of Acme Co/i)).toBeInTheDocument()
  })

  it('names the principal and the ReBAC derivation source', () => {
    render(<InheritedAccessPanel principalName="Jae Moon" orgName="Acme Co" />)
    expect(screen.getByText(/Jae Moon · Employee/i)).toBeInTheDocument()
    expect(screen.getByText(/ReBAC org-admin @ root/i)).toBeInTheDocument()
  })
})
