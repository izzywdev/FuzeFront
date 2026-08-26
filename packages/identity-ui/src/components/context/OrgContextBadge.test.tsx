import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrgContextBadge } from './OrgContextBadge'

describe('OrgContextBadge', () => {
  it('renders the Personal badge with data-context-badge="personal"', () => {
    render(<OrgContextBadge context={{ type: 'personal' }} />)
    const badge = screen.getByText(/personal/i)
    expect(badge).toHaveAttribute('data-context-badge', 'personal')
  })

  it('renders MEMBER — never GUEST — for a real root membership', () => {
    render(<OrgContextBadge context={{ type: 'org', role: 'member' }} />)
    expect(screen.getByText(/member/i)).toHaveAttribute('data-context-badge', 'member')
    expect(screen.queryByText(/guest/i)).not.toBeInTheDocument()
  })

  it('renders a Guest fallback for a visible platform org with no membership row', () => {
    render(<OrgContextBadge context={{ type: 'org', role: null }} />)
    expect(screen.getByText(/guest/i)).toHaveAttribute('data-context-badge', 'guest')
  })
})
