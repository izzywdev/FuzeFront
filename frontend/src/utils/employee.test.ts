import { describe, it, expect } from 'vitest'
import { isEmployeeUser } from './employee'

describe('isEmployeeUser', () => {
  it('is true for the explicit "employee" role marker', () => {
    expect(isEmployeeUser(['employee'])).toBe(true)
  })

  it('is true for the legacy implicit "admin" role marker (back-compat)', () => {
    expect(isEmployeeUser(['admin'])).toBe(true)
  })

  it('is false for an ordinary user with no staff role', () => {
    expect(isEmployeeUser(['user'])).toBe(false)
  })

  it('is false for an empty, null, or undefined roles array', () => {
    expect(isEmployeeUser([])).toBe(false)
    expect(isEmployeeUser(null)).toBe(false)
    expect(isEmployeeUser(undefined)).toBe(false)
  })
})
