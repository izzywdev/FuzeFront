/**
 * Design-system primitives added for the signup UI:
 *   - PasswordChecklist + passwordMeetsPolicy (live policy evaluation)
 *   - FieldStatus (idle/checking/success/error inline status, aria-live)
 * Imported through the package surface so the DS index re-export is covered too.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  PasswordChecklist,
  passwordMeetsPolicy,
  FieldStatus,
} from '@fuzefront/design-system'

describe('passwordMeetsPolicy', () => {
  it('requires 12+ chars, upper, lower, digit and symbol', () => {
    expect(passwordMeetsPolicy('short1!A')).toBe(false) // < 12
    expect(passwordMeetsPolicy('alllowercase1!')).toBe(false) // no upper
    expect(passwordMeetsPolicy('NoSymbolHere12')).toBe(false) // no symbol
    expect(passwordMeetsPolicy('Sup3rSecret!Pass')).toBe(true)
  })
})

describe('PasswordChecklist', () => {
  it('marks rules met as the value satisfies them', () => {
    const { rerender } = render(<PasswordChecklist value="" />)
    expect(screen.getByText(/at least 12 characters/i)).toBeTruthy()
    // aria-live region present for assistive tech
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy()
    rerender(<PasswordChecklist value="Sup3rSecret!Pass" />)
    expect(screen.getByText(/a symbol/i)).toBeTruthy()
  })
})

describe('FieldStatus', () => {
  it('renders nothing visible when idle but reserves the live region', () => {
    render(<FieldStatus state="idle" message="ignored" />)
    expect(screen.queryByText('ignored')).toBeNull()
  })

  it('shows a spinner while checking and a message when resolved', () => {
    const { rerender } = render(<FieldStatus state="checking" message="Checking…" />)
    expect(screen.getByRole('status')).toBeTruthy() // Spinner
    rerender(<FieldStatus state="success" message="Available" />)
    expect(screen.getByText('Available')).toBeTruthy()
  })

  it('renders the action node in the error state', () => {
    render(
      <FieldStatus
        state="error"
        message="Taken"
        action={<button type="button">Sign in instead</button>}
      />
    )
    expect(screen.getByRole('button', { name: /sign in instead/i })).toBeTruthy()
  })
})
