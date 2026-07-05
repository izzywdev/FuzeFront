import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title and message for an empty variant', () => {
    render(<EmptyState variant="empty-members" title="No members yet" message="Invite people" />)
    expect(screen.getByText('No members yet')).toBeInTheDocument()
    expect(screen.getByText('Invite people')).toBeInTheDocument()
  })

  it('renders an action button and fires onAction', () => {
    const onAction = vi.fn()
    render(<EmptyState variant="empty-members" title="t" actionLabel="Invite" onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('uses role="alert" for the error variant', () => {
    render(<EmptyState variant="error" message="boom" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('uses role="status" for the loading variant', () => {
    render(<EmptyState variant="loading" message="Loading…" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
