import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonalContextHome } from './PersonalContextHome'

describe('PersonalContextHome', () => {
  it('renders the personal panel with the Personal context badge', () => {
    render(<PersonalContextHome userFirstName="Ada" apps={[]} />)
    expect(screen.getByText(/welcome back, ada/i)).toBeInTheDocument()
    const panel = screen.getByText('Your apps').closest('[data-panel="personal-home"]')
    expect(panel).toBeInTheDocument()
    expect(screen.getByText('◎ Personal')).toHaveAttribute('data-context-badge', 'personal')
  })

  it('renders personal-scope apps regardless of any active org', () => {
    render(
      <PersonalContextHome
        userFirstName="Ada"
        apps={[
          { id: 'notes', name: 'Notes', active: true },
          { id: 'tasks', name: 'Tasks', active: true },
        ]}
      />
    )
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
  })

  it('renders an empty state when there are no personal apps', () => {
    render(<PersonalContextHome apps={[]} />)
    expect(screen.getByText(/no personal apps yet/i)).toBeInTheDocument()
  })

  it('renders the loading skeleton while apps are loading', () => {
    render(<PersonalContextHome apps={[]} loading />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
