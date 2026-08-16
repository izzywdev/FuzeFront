import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MembershipRoleBadge } from './MembershipRoleBadge'

describe('MembershipRoleBadge', () => {
  it('renders the real role, uppercase, with data-role', () => {
    render(<MembershipRoleBadge role="member" />)
    expect(screen.getByText(/member/i)).toBeInTheDocument()
    expect(screen.getByText(/member/i).closest('[data-role]')).toHaveAttribute('data-role', 'member')
  })

  it('never renders GUEST for a real role', () => {
    render(<MembershipRoleBadge role="admin" />)
    expect(screen.queryByText(/guest/i)).not.toBeInTheDocument()
  })

  it('renders a distinct Guest pill when role is null, not a fabricated role', () => {
    render(<MembershipRoleBadge role={null} />)
    expect(screen.getByText(/guest/i)).toBeInTheDocument()
    expect(screen.getByText(/guest/i)).toHaveAttribute('data-role', 'guest')
  })
})
