/**
 * accounts.ts — the multi-account vault.
 *
 * Up to MAX_PARALLEL_ACCOUNTS accounts stay signed in on one browser, with one
 * ACTIVE account per tab. This module is the single source of truth for which
 * account that is and what credentials belong to it.
 *
 * ── The isolation model ────────────────────────────────────────────────────
 *
 * localStorage is per-ORIGIN, so two accounts share a namespace by default —
 * that is exactly the leak this design exists to prevent. Three rules:
 *
 * 1. NAMESPACING. Every per-account value lives under `ff.acct.<id>.<key>`.
 *    Nothing account-specific is ever written to a bare key. `ff.accounts`
 *    (the roster) holds no credentials — only ids, emails and display names.
 *
 * 2. ONE RESOLVER. `getActiveAuthToken()` is the only way to obtain a token.
 *    The axios interceptor, the federated-app loader, the chat widget, the
 *    flags client and the account-security page all read through it, so a
 *    token can never be read for an account that is not the active one.
 *
 * 3. PER-TAB ACTIVE ACCOUNT. The active id is held in sessionStorage (per tab),
 *    falling back to the localStorage default when a tab has none. That is what
 *    makes the accounts genuinely parallel: account A in tab 1 and account B in
 *    tab 2, each tab pinned to its own identity.
 *
 * And switching accounts is a TEARDOWN, not a state update — `switchAccount()`
 * writes the new id and reloads the document. React state, the app-registry
 * cache, the flag cache, mounted Module-Federation remotes and any open stream
 * all die with the document. A soft in-place switch would leave every one of
 * those holding account A's data while account B's token is on the wire; the
 * reload is the feature, not laziness.
 *
 * ── What this does NOT claim ───────────────────────────────────────────────
 *
 * Same-origin isolation is a storage and lifecycle boundary, not a browser
 * security boundary. Anything with script execution on the origin can read
 * every namespace, exactly as it could read a single account's token today.
 * Real cross-account isolation at the browser level needs separate origins or
 * browser profiles. This bounds ACCIDENTAL leakage — stale caches, the wrong
 * token on a request, one account's org list rendering under another — which is
 * the actual failure mode.
 */

/** Hard ceiling on simultaneously signed-in accounts. */
export const MAX_PARALLEL_ACCOUNTS = 5

const ROSTER_KEY = 'ff.accounts'
const ACTIVE_KEY = 'ff.activeAccountId'
const NS_PREFIX = 'ff.acct.'

/**
 * The namespace a session is parked in before its account id is known — a
 * migrated legacy session, or the sign-in half of "add account".
 * `adoptProvisionalAccount` re-keys it onto the real id once `/session` answers.
 */
export const PROVISIONAL_ACCOUNT_ID = '__provisional__'

/** Per-account key suffixes. Everything account-scoped must be listed here so
 *  `forgetAccount` can erase an account completely — a key that is namespaced
 *  but not enumerated would survive a sign-out and leak into the next session
 *  that reuses the id. */
export const ACCOUNT_SCOPED_KEYS = [
  'authToken',
  'sessionId',
  'user',
  'activeOrganizationId',
] as const

export type AccountScopedKey = (typeof ACCOUNT_SCOPED_KEYS)[number]

/** The pre-multi-account keys. Migrated into the active namespace on first
 *  load, then deleted, so a stale global can never shadow a namespaced value. */
const LEGACY_KEYS: Record<string, AccountScopedKey> = {
  authToken: 'authToken',
  sessionId: 'sessionId',
  user: 'user',
  'ff.activeOrganizationId': 'activeOrganizationId',
}

export interface StoredAccount {
  id: string
  email: string
  displayName: string
  /** ISO timestamp. Ordering is by this, so the roster is stable across reloads. */
  addedAt: string
  /** Set when a request for this account came back 401 while it was parked.
   *  Selecting it routes to sign-in rather than borrowing another token. */
  expired?: boolean
}

// ── storage helpers (never throw; privacy mode / SSR degrade to no-op) ──────

function readLocal(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — the session simply won't persist */
  }
}

function readSession(key: string): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* no-op */
  }
}

function nsKey(accountId: string, key: AccountScopedKey): string {
  return `${NS_PREFIX}${accountId}.${key}`
}

// ── roster ─────────────────────────────────────────────────────────────────

export function listAccounts(): StoredAccount[] {
  const raw = readLocal(ROSTER_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (a: any): a is StoredAccount =>
          a && typeof a.id === 'string' && typeof a.email === 'string'
      )
      .map((a: any) => ({
        id: a.id,
        email: a.email,
        displayName:
          typeof a.displayName === 'string' && a.displayName
            ? a.displayName
            : a.email,
        addedAt: typeof a.addedAt === 'string' ? a.addedAt : '',
        expired: a.expired === true,
      }))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  } catch {
    return []
  }
}

function writeRoster(accounts: StoredAccount[]): void {
  writeLocal(ROSTER_KEY, JSON.stringify(accounts))
}

export function canAddAccount(): boolean {
  return listAccounts().length < MAX_PARALLEL_ACCOUNTS
}

// ── active account ─────────────────────────────────────────────────────────

/**
 * The account this TAB is acting as.
 *
 * sessionStorage first (per tab), then the localStorage default. A value
 * pointing at an account no longer in the roster is ignored — otherwise a
 * signed-out account's id would keep resolving to its (already erased)
 * namespace and every read would silently return null.
 *
 * The one id that resolves WITHOUT a roster entry is PROVISIONAL_ACCOUNT_ID:
 * it is the namespace a session is parked in before its identity is known —
 * either a migrated legacy session, or the sign-in half of "add account".
 */
export function getActiveAccountId(): string | null {
  const fromTab = readSession(ACTIVE_KEY)
  if (fromTab === PROVISIONAL_ACCOUNT_ID) return PROVISIONAL_ACCOUNT_ID

  const roster = listAccounts()
  if (roster.length === 0) {
    // A session can exist before ANY account is known: the very first sign-in
    // on this browser, or a migrated legacy session. Both land in the
    // provisional namespace and stay readable from here until
    // `adoptProvisionalAccount` names them. Without this the first login would
    // persist a token nowhere and the shell would boot straight back to
    // sign-in.
    return readLocal(nsKey(PROVISIONAL_ACCOUNT_ID, 'authToken')) !== null
      ? PROVISIONAL_ACCOUNT_ID
      : null
  }

  if (fromTab && roster.some(a => a.id === fromTab)) return fromTab

  const fromBrowser = readLocal(ACTIVE_KEY)
  if (fromBrowser && roster.some(a => a.id === fromBrowser)) return fromBrowser

  return roster[0].id
}

/**
 * Enter "add another account" mode IN THIS TAB ONLY.
 *
 * Pins the tab to the provisional namespace, which holds no token, so the shell
 * boots unauthenticated and renders the sign-in surface. Every other account —
 * and every other tab — keeps its session untouched: this is a per-tab identity
 * change, not a sign-out.
 */
export function beginAddAccount(): void {
  writeSession(ACTIVE_KEY, PROVISIONAL_ACCOUNT_ID)
  for (const key of ACCOUNT_SCOPED_KEYS) {
    writeLocal(nsKey(PROVISIONAL_ACCOUNT_ID, key), null)
  }
}

/** Is this tab midway through adding an account? */
export function isAddingAccount(): boolean {
  return readSession(ACTIVE_KEY) === PROVISIONAL_ACCOUNT_ID
}

/**
 * Abandon "add account" mode and return the tab to a real account. Used when
 * the user backs out of the sign-in surface with other accounts still signed in.
 */
export function cancelAddAccount(): void {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    writeLocal(nsKey(PROVISIONAL_ACCOUNT_ID, key), null)
  }
  writeSession(ACTIVE_KEY, null)
}

export function getActiveAccount(): StoredAccount | null {
  const id = getActiveAccountId()
  if (!id) return null
  return listAccounts().find(a => a.id === id) ?? null
}

/** Pin this tab (and the browser default) to an account WITHOUT reloading.
 *  Callers that are changing identity should use `switchAccount` instead. */
export function setActiveAccountId(accountId: string): void {
  writeSession(ACTIVE_KEY, accountId)
  writeLocal(ACTIVE_KEY, accountId)
}

// ── per-account values ─────────────────────────────────────────────────────

export function getAccountValue(
  accountId: string,
  key: AccountScopedKey
): string | null {
  return readLocal(nsKey(accountId, key))
}

export function setAccountValue(
  accountId: string,
  key: AccountScopedKey,
  value: string | null
): void {
  writeLocal(nsKey(accountId, key), value)
}

/** Read a value for the ACTIVE account. Returns null when no account is active. */
export function getActiveValue(key: AccountScopedKey): string | null {
  const id = getActiveAccountId()
  return id ? getAccountValue(id, key) : null
}

/**
 * Write a value for the account this tab is acting as.
 *
 * With no active account — the first sign-in on this browser — the value goes
 * to the provisional namespace, which `adoptProvisionalAccount` re-keys onto
 * the real id once `/session` answers. Dropping the write instead would lose
 * the freshly issued token.
 */
export function setActiveValue(key: AccountScopedKey, value: string | null): void {
  setAccountValue(getActiveAccountId() ?? PROVISIONAL_ACCOUNT_ID, key, value)
}

/**
 * THE token resolver. Every outbound request must obtain its bearer token from
 * here — see the module header, rule 2.
 */
export function getActiveAuthToken(): string | null {
  return getActiveValue('authToken')
}

// ── mutations ──────────────────────────────────────────────────────────────

export interface AccountIdentity {
  id: string
  email: string
  firstName?: string
  lastName?: string
}

function displayNameOf(identity: AccountIdentity): string {
  const { firstName, lastName, email } = identity
  if (firstName && lastName) return `${firstName} ${lastName}`
  if (firstName) return firstName
  return email
}

/**
 * Record a freshly authenticated session against its account, add the account
 * to the roster if new, and make it this tab's active account.
 *
 * Returns `false` — writing nothing — when the roster is full and this is a NEW
 * account. Refusing is deliberate: silently evicting one of the user's other
 * signed-in accounts to make room would sign them out of something they never
 * asked to leave. Re-authenticating an account already in the roster always
 * succeeds, cap or not.
 */
export function rememberAccount(
  identity: AccountIdentity,
  credentials: { token?: string | null; sessionId?: string | null }
): boolean {
  const roster = listAccounts()
  const existing = roster.find(a => a.id === identity.id)

  if (!existing && roster.length >= MAX_PARALLEL_ACCOUNTS) {
    return false
  }

  const entry: StoredAccount = {
    id: identity.id,
    email: identity.email,
    displayName: displayNameOf(identity),
    addedAt: existing?.addedAt || new Date().toISOString(),
    expired: false,
  }

  writeRoster(
    existing
      ? roster.map(a => (a.id === entry.id ? entry : a))
      : [...roster, entry]
  )

  if (credentials.token !== undefined && credentials.token !== null) {
    setAccountValue(identity.id, 'authToken', credentials.token)
  }
  if (credentials.sessionId !== undefined && credentials.sessionId !== null) {
    setAccountValue(identity.id, 'sessionId', credentials.sessionId)
  }

  setActiveAccountId(identity.id)
  return true
}

/**
 * Erase an account: every namespaced key, plus its roster entry. If it was the
 * active account, the next remaining account becomes active (or none).
 *
 * Revoking the session server-side is the CALLER's job and must happen with
 * that account's token — see `signOutAccount` in AccountsContext.
 */
export function forgetAccount(accountId: string): void {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    writeLocal(nsKey(accountId, key), null)
  }

  const remaining = listAccounts().filter(a => a.id !== accountId)
  writeRoster(remaining)

  if (readSession(ACTIVE_KEY) === accountId) writeSession(ACTIVE_KEY, null)
  if (readLocal(ACTIVE_KEY) === accountId) writeLocal(ACTIVE_KEY, null)

  if (remaining.length > 0) {
    setActiveAccountId(remaining[0].id)
  }
}

/** Mark a parked account's session as dead so the menu can say so, instead of
 *  the account silently disappearing or appearing to work. */
export function markAccountExpired(accountId: string): void {
  const roster = listAccounts()
  if (!roster.some(a => a.id === accountId)) return
  writeRoster(
    roster.map(a => (a.id === accountId ? { ...a, expired: true } : a))
  )
}

/** Erase every account. Used by the "sign out everywhere" path. */
export function forgetAllAccounts(): void {
  for (const account of listAccounts()) {
    for (const key of ACCOUNT_SCOPED_KEYS) {
      writeLocal(nsKey(account.id, key), null)
    }
  }
  writeLocal(ROSTER_KEY, null)
  writeLocal(ACTIVE_KEY, null)
  writeSession(ACTIVE_KEY, null)
}

/**
 * Change identity. Pins the tab, then tears the document down and rebuilds it
 * under the new account — see the module header. Never call this expecting the
 * caller's code after it to run meaningfully.
 */
export function switchAccount(accountId: string): void {
  setActiveAccountId(accountId)
  if (typeof window !== 'undefined') {
    // Land on the shell root rather than the current route: the current route
    // may not exist for, or be permitted to, the account being switched to.
    window.location.href = '/'
  }
}

// ── legacy migration ───────────────────────────────────────────────────────

/**
 * One-time migration from the single-account keys.
 *
 * Called at boot BEFORE anything reads a token. A pre-existing session has a
 * bare `authToken` but no roster entry, because its account id is not known
 * until `/session` answers. So the token is parked under a provisional id and
 * `adoptProvisionalAccount` re-keys it once the identity is resolved.
 *
 * The bare keys are removed either way — rule 1 of the isolation model is that
 * nothing account-specific lives at a bare key, and a leftover `authToken`
 * would be read by any code that had not yet been migrated to the resolver.
 */
export function migrateLegacySession(): void {
  const legacyToken = readLocal('authToken')

  // Nothing to migrate, or already migrated.
  if (!legacyToken) {
    for (const legacyKey of Object.keys(LEGACY_KEYS)) writeLocal(legacyKey, null)
    return
  }

  const activeId = getActiveAccountId()
  const targetId = activeId ?? PROVISIONAL_ACCOUNT_ID

  for (const [legacyKey, scopedKey] of Object.entries(LEGACY_KEYS)) {
    const value = readLocal(legacyKey)
    if (value !== null && getAccountValue(targetId, scopedKey) === null) {
      setAccountValue(targetId, scopedKey, value)
    }
    writeLocal(legacyKey, null)
  }

  // No roster entry is written for the provisional session: an entry with no
  // email would render as a nameless row in the account switcher.
  // getActiveAccountId() resolves the provisional namespace from the parked
  // token itself, and adoptProvisionalAccount writes the real entry once
  // /session names the account.
}

/**
 * Re-key a provisional session onto its real account id, once `/session` has
 * told us who it belongs to. Covers both producers of a provisional namespace:
 * a migrated legacy session, and a completed "add account" sign-in.
 *
 * Returns `false` — leaving the provisional namespace intact for the caller to
 * clean up — when this is a NEW account and the roster is already full. The
 * caller surfaces that as the cap message rather than silently evicting one of
 * the user's other signed-in accounts.
 */
export function adoptProvisionalAccount(identity: AccountIdentity): boolean {
  const hasProvisionalData = ACCOUNT_SCOPED_KEYS.some(
    key => getAccountValue(PROVISIONAL_ACCOUNT_ID, key) !== null
  )
  const roster = listAccounts()
  const provisionalEntry = roster.find(a => a.id === PROVISIONAL_ACCOUNT_ID)

  if (!hasProvisionalData && !provisionalEntry) return true

  const withoutProvisional = roster.filter(a => a.id !== PROVISIONAL_ACCOUNT_ID)
  const alreadyPresent = withoutProvisional.find(a => a.id === identity.id)

  if (!alreadyPresent && withoutProvisional.length >= MAX_PARALLEL_ACCOUNTS) {
    return false
  }

  for (const key of ACCOUNT_SCOPED_KEYS) {
    const value = getAccountValue(PROVISIONAL_ACCOUNT_ID, key)
    // A re-authentication of an account already in the roster must OVERWRITE
    // its stale token, not be discarded in favour of it.
    if (value !== null) setAccountValue(identity.id, key, value)
    writeLocal(nsKey(PROVISIONAL_ACCOUNT_ID, key), null)
  }

  writeRoster(
    alreadyPresent
      ? withoutProvisional.map(a =>
          a.id === identity.id
            ? { ...a, displayName: displayNameOf(identity), expired: false }
            : a
        )
      : [
          ...withoutProvisional,
          {
            id: identity.id,
            email: identity.email,
            displayName: displayNameOf(identity),
            addedAt: provisionalEntry?.addedAt || new Date().toISOString(),
          },
        ]
  )

  setActiveAccountId(identity.id)
  return true
}
