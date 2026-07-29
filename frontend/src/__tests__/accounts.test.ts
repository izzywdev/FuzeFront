/**
 * Unit tests for the multi-account vault (src/lib/accounts.ts).
 *
 * These assert the ISOLATION CONTRACT, not just the happy path — namespacing,
 * the cap, per-tab pinning, and the erase-completely guarantee. A regression in
 * any of them is a cross-account leak, which is why each has its own test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_SCOPED_KEYS,
  MAX_PARALLEL_ACCOUNTS,
  PROVISIONAL_ACCOUNT_ID,
  adoptProvisionalAccount,
  beginAddAccount,
  canAddAccount,
  cancelAddAccount,
  forgetAccount,
  forgetAllAccounts,
  getAccountValue,
  getActiveAccount,
  getActiveAccountId,
  getActiveAuthToken,
  isAddingAccount,
  listAccounts,
  markAccountExpired,
  rememberAccount,
  setAccountValue,
  setActiveAccountId,
  setActiveValue,
} from '../lib/accounts'

function identity(n: number) {
  return {
    id: `user-${n}`,
    email: `user${n}@test.local`,
    firstName: 'User',
    lastName: String(n),
  }
}

function addAccount(n: number) {
  return rememberAccount(identity(n), {
    token: `token-${n}`,
    sessionId: `session-${n}`,
  })
}

describe('account vault', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  describe('roster', () => {
    it('starts empty', () => {
      expect(listAccounts()).toEqual([])
      expect(getActiveAccountId()).toBeNull()
      expect(getActiveAuthToken()).toBeNull()
    })

    it('adds an account and makes it active', () => {
      expect(addAccount(1)).toBe(true)

      expect(listAccounts()).toHaveLength(1)
      expect(getActiveAccountId()).toBe('user-1')
      expect(getActiveAuthToken()).toBe('token-1')
      expect(getActiveAccount()?.displayName).toBe('User 1')
    })

    it('re-authenticating an existing account updates rather than duplicates', () => {
      addAccount(1)
      rememberAccount(identity(1), { token: 'token-1-refreshed' })

      expect(listAccounts()).toHaveLength(1)
      expect(getActiveAuthToken()).toBe('token-1-refreshed')
    })
  })

  describe('the cap', () => {
    it(`refuses a ${MAX_PARALLEL_ACCOUNTS + 1}th NEW account and writes nothing`, () => {
      for (let n = 1; n <= MAX_PARALLEL_ACCOUNTS; n++) {
        expect(addAccount(n)).toBe(true)
      }
      expect(canAddAccount()).toBe(false)

      const overflow = addAccount(MAX_PARALLEL_ACCOUNTS + 1)

      expect(overflow).toBe(false)
      expect(listAccounts()).toHaveLength(MAX_PARALLEL_ACCOUNTS)
      // Refusing must not have evicted anyone, nor parked the rejected token.
      expect(
        getAccountValue(`user-${MAX_PARALLEL_ACCOUNTS + 1}`, 'authToken')
      ).toBeNull()
      expect(getAccountValue('user-1', 'authToken')).toBe('token-1')
    })

    it('still allows re-authenticating an existing account at the cap', () => {
      for (let n = 1; n <= MAX_PARALLEL_ACCOUNTS; n++) addAccount(n)

      expect(rememberAccount(identity(2), { token: 'token-2-new' })).toBe(true)
      expect(listAccounts()).toHaveLength(MAX_PARALLEL_ACCOUNTS)
      expect(getAccountValue('user-2', 'authToken')).toBe('token-2-new')
    })
  })

  describe('isolation', () => {
    it('keeps each account’s credentials in its own namespace', () => {
      addAccount(1)
      addAccount(2)

      expect(getAccountValue('user-1', 'authToken')).toBe('token-1')
      expect(getAccountValue('user-2', 'authToken')).toBe('token-2')
      // The active resolver returns the ACTIVE account's token, never a merge.
      expect(getActiveAuthToken()).toBe('token-2')

      setActiveAccountId('user-1')
      expect(getActiveAuthToken()).toBe('token-1')
    })

    it('never writes an account value to a bare key', () => {
      addAccount(1)
      setActiveValue('activeOrganizationId', 'org-a')

      // The pre-multi-account key names must stay empty forever: anything still
      // reading them would otherwise see one account's data under another.
      expect(localStorage.getItem('authToken')).toBeNull()
      expect(localStorage.getItem('sessionId')).toBeNull()
      expect(localStorage.getItem('user')).toBeNull()
      expect(localStorage.getItem('ff.activeOrganizationId')).toBeNull()
      expect(getAccountValue('user-1', 'activeOrganizationId')).toBe('org-a')
    })

    it('does not let one account read another’s organization selection', () => {
      addAccount(1)
      setActiveValue('activeOrganizationId', 'org-one')

      addAccount(2)
      expect(getActiveAccountId()).toBe('user-2')
      // Account 2 has made no selection — it must see nothing, not account 1's.
      expect(getAccountValue('user-2', 'activeOrganizationId')).toBeNull()

      setActiveValue('activeOrganizationId', 'org-two')
      expect(getAccountValue('user-1', 'activeOrganizationId')).toBe('org-one')
      expect(getAccountValue('user-2', 'activeOrganizationId')).toBe('org-two')
    })

    it('roster entries carry no credentials', () => {
      addAccount(1)
      const serialized = localStorage.getItem('ff.accounts') ?? ''

      expect(serialized).not.toContain('token-1')
      expect(serialized).not.toContain('session-1')
    })
  })

  describe('per-tab pinning', () => {
    it('lets a tab act as a different account than the browser default', () => {
      addAccount(1)
      addAccount(2) // browser default is now user-2

      // A tab pinned to user-1 resolves user-1, regardless of the default.
      sessionStorage.setItem('ff.activeAccountId', 'user-1')
      expect(getActiveAccountId()).toBe('user-1')
      expect(getActiveAuthToken()).toBe('token-1')

      // A tab with no pin falls back to the browser default.
      sessionStorage.clear()
      expect(getActiveAccountId()).toBe('user-2')
    })

    it('ignores a pin to an account that is no longer in the roster', () => {
      addAccount(1)
      addAccount(2)
      sessionStorage.setItem('ff.activeAccountId', 'user-gone')

      expect(getActiveAccountId()).not.toBe('user-gone')
      expect(listAccounts().map(a => a.id)).toContain(getActiveAccountId())
    })
  })

  describe('sign-out', () => {
    it('erases every namespaced key for that account only', () => {
      addAccount(1)
      addAccount(2)
      for (const key of ACCOUNT_SCOPED_KEYS) {
        setAccountValue('user-1', key, `value-${key}`)
        setAccountValue('user-2', key, `value-${key}`)
      }

      forgetAccount('user-1')

      for (const key of ACCOUNT_SCOPED_KEYS) {
        expect(getAccountValue('user-1', key)).toBeNull()
        expect(getAccountValue('user-2', key)).toBe(`value-${key}`)
      }
      expect(listAccounts().map(a => a.id)).toEqual(['user-2'])
    })

    it('promotes a remaining account when the active one is removed', () => {
      addAccount(1)
      addAccount(2)
      setActiveAccountId('user-2')

      forgetAccount('user-2')

      expect(getActiveAccountId()).toBe('user-1')
      expect(getActiveAuthToken()).toBe('token-1')
    })

    it('leaves no active account when the last one is removed', () => {
      addAccount(1)
      forgetAccount('user-1')

      expect(listAccounts()).toEqual([])
      expect(getActiveAccountId()).toBeNull()
      expect(getActiveAuthToken()).toBeNull()
    })

    it('forgetAllAccounts leaves no residue', () => {
      addAccount(1)
      addAccount(2)

      forgetAllAccounts()

      expect(listAccounts()).toEqual([])
      const residue = Object.keys(localStorage).filter(k =>
        k.startsWith('ff.acct.')
      )
      expect(residue).toEqual([])
    })
  })

  describe('expired sessions', () => {
    it('flags a parked account rather than dropping it', () => {
      addAccount(1)
      addAccount(2)

      markAccountExpired('user-1')

      const user1 = listAccounts().find(a => a.id === 'user-1')
      expect(user1?.expired).toBe(true)
      // Still listed — the user is told what happened instead of the account
      // silently vanishing.
      expect(listAccounts()).toHaveLength(2)
    })

    it('clears the expired flag on re-authentication', () => {
      addAccount(1)
      markAccountExpired('user-1')

      rememberAccount(identity(1), { token: 'token-1-fresh' })

      expect(listAccounts().find(a => a.id === 'user-1')?.expired).toBe(false)
    })
  })

  describe('first sign-in on a fresh browser', () => {
    it('parks the session in the provisional namespace and keeps it readable', () => {
      // No roster yet — this is the very first login on this browser. The
      // token must still land somewhere the shell can read it back, or the
      // sign-in completes and immediately bounces to sign-in again.
      expect(getActiveAccountId()).toBeNull()

      setActiveValue('authToken', 'fresh-token')

      expect(getActiveAccountId()).toBe(PROVISIONAL_ACCOUNT_ID)
      expect(getActiveAuthToken()).toBe('fresh-token')
      // Still no visible account until /session names it.
      expect(listAccounts()).toEqual([])
    })

    it('promotes the parked session to a real account on adoption', () => {
      setActiveValue('authToken', 'fresh-token')
      setActiveValue('sessionId', 'fresh-session')

      expect(adoptProvisionalAccount(identity(1))).toBe(true)

      expect(listAccounts().map(a => a.id)).toEqual(['user-1'])
      expect(getActiveAccountId()).toBe('user-1')
      expect(getAccountValue('user-1', 'authToken')).toBe('fresh-token')
      expect(getAccountValue('user-1', 'sessionId')).toBe('fresh-session')
    })
  })

  describe('legacy migration', () => {
    it('moves a pre-multi-account session into the vault and clears bare keys', async () => {
      localStorage.setItem('authToken', 'legacy-token')
      localStorage.setItem('sessionId', 'legacy-session')
      localStorage.setItem('ff.activeOrganizationId', 'legacy-org')

      const { migrateLegacySession } = await import('../lib/accounts')
      migrateLegacySession()

      expect(localStorage.getItem('authToken')).toBeNull()
      expect(localStorage.getItem('sessionId')).toBeNull()
      expect(localStorage.getItem('ff.activeOrganizationId')).toBeNull()
      expect(getActiveAuthToken()).toBe('legacy-token')

      // And it adopts onto the real account once /session answers.
      adoptProvisionalAccount(identity(1))
      expect(getAccountValue('user-1', 'activeOrganizationId')).toBe('legacy-org')
      // No nameless placeholder row is left in the switcher.
      expect(listAccounts().map(a => a.id)).toEqual(['user-1'])
    })

    it('clears stray bare keys even when there is nothing to migrate', async () => {
      localStorage.setItem('user', '{"id":"stale"}')

      const { migrateLegacySession } = await import('../lib/accounts')
      migrateLegacySession()

      expect(localStorage.getItem('user')).toBeNull()
    })
  })

  describe('add-account mode', () => {
    it('boots unauthenticated in this tab without touching other accounts', () => {
      addAccount(1)

      beginAddAccount()

      expect(isAddingAccount()).toBe(true)
      expect(getActiveAccountId()).toBe(PROVISIONAL_ACCOUNT_ID)
      // No token in the provisional namespace -> the shell renders sign-in.
      expect(getActiveAuthToken()).toBeNull()
      // The existing account is entirely untouched.
      expect(getAccountValue('user-1', 'authToken')).toBe('token-1')
      expect(listAccounts()).toHaveLength(1)
    })

    it('adopts the new session onto its real account id', () => {
      addAccount(1)
      beginAddAccount()

      // The sign-in writes into the namespace the tab is acting as.
      setActiveValue('authToken', 'token-2')
      setActiveValue('sessionId', 'session-2')

      expect(adoptProvisionalAccount(identity(2))).toBe(true)

      expect(getActiveAccountId()).toBe('user-2')
      expect(getAccountValue('user-2', 'authToken')).toBe('token-2')
      expect(getAccountValue(PROVISIONAL_ACCOUNT_ID, 'authToken')).toBeNull()
      expect(listAccounts().map(a => a.id).sort()).toEqual(['user-1', 'user-2'])
    })

    it('refuses adoption of a NEW account at the cap, keeping the roster intact', () => {
      for (let n = 1; n <= MAX_PARALLEL_ACCOUNTS; n++) addAccount(n)
      beginAddAccount()
      setActiveValue('authToken', 'token-overflow')

      const adopted = adoptProvisionalAccount(identity(99))

      expect(adopted).toBe(false)
      expect(listAccounts()).toHaveLength(MAX_PARALLEL_ACCOUNTS)
      expect(getAccountValue('user-99', 'authToken')).toBeNull()
    })

    it('cancelling restores the tab to a real account and clears the staging area', () => {
      addAccount(1)
      beginAddAccount()
      setActiveValue('authToken', 'half-finished')

      cancelAddAccount()

      expect(isAddingAccount()).toBe(false)
      expect(getActiveAccountId()).toBe('user-1')
      expect(getActiveAuthToken()).toBe('token-1')
      expect(getAccountValue(PROVISIONAL_ACCOUNT_ID, 'authToken')).toBeNull()
    })
  })

  describe('storage unavailable', () => {
    it('degrades to no-ops rather than throwing', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })

      expect(() => rememberAccount(identity(1), { token: 't' })).not.toThrow()
      expect(() => getActiveAuthToken()).not.toThrow()

      spy.mockRestore()
    })
  })
})
