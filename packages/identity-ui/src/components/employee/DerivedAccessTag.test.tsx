import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DerivedAccessTag } from './DerivedAccessTag'

describe('DerivedAccessTag', () => {
  it('renders the generic derived label by default, tagged data-access="derived"', () => {
    render(<DerivedAccessTag />)
    const tag = screen.getByText(/derived from root/i)
    expect(tag.closest('[data-access="derived"]')).toBeInTheDocument()
  })

  it('renders the root-specific label for the root variant', () => {
    render(<DerivedAccessTag variant="root" />)
    expect(screen.getByText(/org-admin · root/i)).toBeInTheDocument()
  })
})
