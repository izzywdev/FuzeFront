import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProvisioningGate } from './ProvisioningGate'

describe('ProvisioningGate', () => {
  it('renders an aria-busy skeleton while provisioning, never the children', () => {
    render(
      <ProvisioningGate provisioning>
        <div>real content</div>
      </ProvisioningGate>
    )
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'provisioning')
    expect(screen.queryByText('real content')).not.toBeInTheDocument()
  })

  it('renders children once provisioning resolves', () => {
    render(
      <ProvisioningGate provisioning={false}>
        <div>real content</div>
      </ProvisioningGate>
    )
    expect(screen.getByText('real content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
