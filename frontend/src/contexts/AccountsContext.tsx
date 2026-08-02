import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import {
  MAX_PARALLEL_ACCOUNTS,
  StoredAccount,
  beginAddAccount,
  canAddAccount,
  forgetAccount,
  getAccountValue,
  getActiveAccountId,
  listAccounts,
  switchAccount,
} from '../lib/accounts'

/**
 * AccountsContext — the React surface over the account vault (lib/accounts.ts).
 *
 * The vault itself is deliberately plain functions over storage, not hooks: it
 * is read at module scope by the axios interceptor and the federated-app loader,
 * long before any component renders. This context exists only so the user menu
 * can render the roster and drive it, and re-render when it changes.
 */

interface AccountsContextValue {
  /** Every signed-in account on this browser, oldest first. */
  accounts: StoredAccount[]
  /** The account THIS TAB is acting as. */
  activeAccountId: string | null
  /** How many more accounts may be added before the cap. */
  maxAccounts: number
  canAdd: boolean
  /** Change identity — tears the document down and rebuilds under the target. */
  select: (accountId: string) => void
  /** Start signing in an additional account, in this tab only. */
  addAccount: () => void
  /**
   * Sign out ONE account. Revokes its session server-side using THAT account's
   * token, then erases its vault namespace. Other accounts keep working.
   */
  signOutAccount: (accountId: string) => Promise<void>
  /** Re-read the roster after a mutation made outside this context. */
  refresh: () => void
}

const AccountsContext = createContext<AccountsContextValue | undefined>(undefined)

/**
 * Revoke one account's session on the server.
 *
 * Deliberately a bare `fetch` with an EXPLICIT bearer token rather than the
 * shared axios client: that client always attaches the ACTIVE account's token,
 * which is precisely the wrong one when signing out a parked account. Getting
 * this wrong would revoke the session the user is currently using.
 */
async function revokeSession(token: string | null): Promise<void> {
  if (!token) return
  try {
    await fetch('/api/v1/security/session', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // Best-effort. The local erase below is what the user asked for; a failed
    // revoke leaves a server-side session that expires on its own.
  }
}

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(v => v + 1), [])

  // Recomputed on every `refresh` — the vault is the source of truth, this is
  // just a snapshot of it.
  const accounts = useMemo(() => listAccounts(), [version])
  const activeAccountId = useMemo(() => getActiveAccountId(), [version])

  const select = useCallback(
    (accountId: string) => {
      if (accountId === getActiveAccountId()) return
      switchAccount(accountId)
    },
    []
  )

  const addAccount = useCallback(() => {
    if (!canAddAccount()) return
    beginAddAccount()
    // Full navigation, not a router push: the tab is changing identity, so the
    // same teardown that makes a switch safe applies here.
    window.location.href = '/login'
  }, [])

  const signOutAccount = useCallback(
    async (accountId: string) => {
      const wasActive = getActiveAccountId() === accountId
      await revokeSession(getAccountValue(accountId, 'authToken'))
      forgetAccount(accountId)

      if (wasActive) {
        // The active identity is gone; rebuild the document under whichever
        // account is now active (or the sign-in surface when none remain).
        window.location.href = '/'
        return
      }
      refresh()
    },
    [refresh]
  )

  const value = useMemo<AccountsContextValue>(
    () => ({
      accounts,
      activeAccountId,
      maxAccounts: MAX_PARALLEL_ACCOUNTS,
      canAdd: accounts.length < MAX_PARALLEL_ACCOUNTS,
      select,
      addAccount,
      signOutAccount,
      refresh,
    }),
    [accounts, activeAccountId, select, addAccount, signOutAccount, refresh]
  )

  return (
    <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>
  )
}

export function useAccounts(): AccountsContextValue {
  const ctx = useContext(AccountsContext)
  if (!ctx) {
    throw new Error('useAccounts must be used within an AccountsProvider')
  }
  return ctx
}
