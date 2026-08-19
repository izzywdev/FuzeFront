import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaffGuard } from './StaffGuard'

describe('StaffGuard', () => {
  it('renders children when isEmployee is true', () => {
    render(
      <StaffGuard isEmployee>
        <div data-testid="console-content">console</div>
      </StaffGuard>
    )
    expect(screen.getByTestId('console-content')).toBeInTheDocument()
    expect(document.querySelector('[data-state="forbidden"]')).not.toBeInTheDocument()
  })

  it('renders NotStaffNotice and never mounts children when isEmployee is false', () => {
    render(
      <StaffGuard isEmployee={false}>
        <div data-testid="console-content">console</div>
      </StaffGuard>
    )
    expect(screen.queryByTestId('console-content')).not.toBeInTheDocument()
    const forbidden = document.querySelector('[data-state="forbidden"]')
    expect(forbidden).toHaveAttribute('data-http', '403')
    expect(forbidden).toHaveAttribute('data-error-code', 'FORBIDDEN')
  })
})
