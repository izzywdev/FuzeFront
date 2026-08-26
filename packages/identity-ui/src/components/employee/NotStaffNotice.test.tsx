import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotStaffNotice } from './NotStaffNotice'

describe('NotStaffNotice', () => {
  it('renders the fail-closed 403 markers', () => {
    render(<NotStaffNotice />)
    const el = document.querySelector('[data-state="forbidden"]')
    expect(el).toHaveAttribute('data-http', '403')
    expect(el).toHaveAttribute('data-error-code', 'FORBIDDEN')
  })

  it('states this is an authorization result, not a sign-out', () => {
    render(<NotStaffNotice />)
    expect(screen.getByText(/you are not platform staff/i)).toBeInTheDocument()
    expect(screen.getByText(/have not been signed out/i)).toBeInTheDocument()
  })

  it('is announced assertively as an alert', () => {
    render(<NotStaffNotice />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
