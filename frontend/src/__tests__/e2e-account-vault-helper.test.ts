/**
 * Pins the e2e helper (tests/support/account-vault.ts) to the real vault
 * (src/lib/accounts.ts).
 *
 * WHY THIS EXISTS: the helper deliberately RE-IMPLEMENTS the vault's
 * active-account resolution, because Playwright serializes the function into
 * the browser with `Function.prototype.toString` and so it cannot import
 * anything. A duplicated rule silently drifts — and when it drifts the symptom
 * is a red end-to-end suite that takes ~7 minutes to reproduce and points at
 * the wrong thing (it looks like sign-in broke, not like a test helper aged).
 *
 * `frontend/tsconfig.json` includes only `src`, so the spec files are not even
 * type-checked; nothing else guards this seam at all. These tests run in
 * milliseconds and fail with an obvious message instead.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROVISIONAL_ACCOUNT_ID,
  hasActiveSession,
  readActiveAuthToken,
} from '../../tests/support/account-vault'
import {
  PROVISIONAL_ACCOUNT_ID as REAL_PROVISIONAL_ID,
  beginAddAccount,
  forgetAccount,
  getActiveAuthToken,
  rememberAccount,
  setActiveAccountId,
  setActiveValue,
} from '../lib/accounts'

function addAccount(n: number) {
  return rememberAccount(
    { id: `user-${n}`, email: `user${n}@test.local`, firstName: 'User', lastName: String(n) },
    { token: `token-${n}`, sessionId: `session-${n}` }
  )
}

/** The helper must agree with the app, whatever the vault state. */
function expectAgreement() {
  expect(readActiveAuthToken()).toBe(getActiveAuthToken())
  expect(hasActiveSession()).toBe(Boolean(getActiveAuthToken()))
}

describe('e2e account-vault helper', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('uses the same provisional id as the vault', () => {
    expect(PROVISIONAL_ACCOUNT_ID).toBe(REAL_PROVISIONAL_ID)
  })

  it('agrees when nothing is signed in', () => {
    expectAgreement()
    expect(readActiveAuthToken()).toBeNull()
    expect(hasActiveSession()).toBe(false)
  })

  it('agrees for a single signed-in account', () => {
    addAccount(1)
    expectAgreement()
    expect(readActiveAuthToken()).toBe('token-1')
  })

  it('agrees across several accounts, following the active one', () => {
    addAccount(1)
    addAccount(2)
    addAccount(3)
    expectAgreement()

    setActiveAccountId('user-1')
    expectAgreement()
    expect(readActiveAuthToken()).toBe('token-1')

    setActiveAccountId('user-3')
    expectAgreement()
    expect(readActiveAuthToken()).toBe('token-3')
  })

  it('agrees when a tab is pinned to a different account than the browser default', () => {
    addAccount(1)
    addAccount(2) // browser default = user-2
    sessionStorage.setItem('ff.activeAccountId', 'user-1')

    expectAgreement()
    expect(readActiveAuthToken()).toBe('token-1')
  })

  it('agrees on a first sign-in parked in the provisional namespace', () => {
    // No roster yet — the state every fresh e2e login passes through, and the
    // one the specs' assertions actually land on.
    setActiveValue('authToken', 'fresh-token')

    expectAgreement()
    expect(readActiveAuthToken()).toBe('fresh-token')
    expect(hasActiveSession()).toBe(true)
  })

  it('agrees in add-account mode (no token yet)', () => {
    addAccount(1)
    beginAddAccount()

    expectAgreement()
    expect(readActiveAuthToken()).toBeNull()
  })

  it('agrees after the last account signs out', () => {
    addAccount(1)
    forgetAccount('user-1')

    expectAgreement()
    expect(readActiveAuthToken()).toBeNull()
  })

  it('agrees when a stale pin names an account that is gone', () => {
    addAccount(1)
    addAccount(2)
    sessionStorage.setItem('ff.activeAccountId', 'user-deleted')

    expectAgreement()
  })

  it('tolerates a corrupt roster instead of throwing in the browser', () => {
    localStorage.setItem('ff.accounts', 'not json{')
    localStorage.setItem(`ff.acct.${PROVISIONAL_ACCOUNT_ID}.authToken`, 'salvaged')

    // A throw here would surface as an opaque Playwright evaluate failure.
    expect(() => readActiveAuthToken()).not.toThrow()
    expectAgreement()
  })

  it('is self-contained, so page.evaluate can serialize it', () => {
    // Playwright ships the function SOURCE to the browser. A reference to any
    // module-scope binding would be undefined there, and the failure would be a
    // confusing "x is not defined" inside the page rather than at build time.
    // Each helper must not CALL the other — only its own declaration may name
    // it, so strip the declaration line before checking for a call.
    const bodyOf = (fn: () => unknown) =>
      fn.toString().replace(/^function\s+\w+\s*\([^)]*\)\s*\{/, '')

    expect(bodyOf(readActiveAuthToken)).not.toMatch(/\bimport\b/)
    expect(bodyOf(readActiveAuthToken)).not.toMatch(/hasActiveSession\s*\(/)

    expect(bodyOf(hasActiveSession)).not.toMatch(/\bimport\b/)
    expect(bodyOf(hasActiveSession)).not.toMatch(/readActiveAuthToken\s*\(/)
  })
})
