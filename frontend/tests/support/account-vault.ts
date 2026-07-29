/**
 * Browser-side helpers for the account vault (src/lib/accounts.ts).
 *
 * The shell no longer keeps a session at the bare `authToken` key. Every
 * per-account value lives under `ff.acct.<accountId>.<key>`, and which account
 * a tab is acting as is resolved from a per-tab sessionStorage pin, falling
 * back to a browser-wide default. A spec that reads `localStorage.authToken`
 * therefore reads nothing — which is the POINT of the vault, not a bug in it:
 * a bare key surviving would mean the isolation model had been bypassed.
 *
 * These helpers give the specs the same view the app has, so their assertions
 * keep meaning "there is a usable session" instead of "a particular key exists".
 *
 * IMPORTANT: every exported function here is passed to `page.evaluate()` /
 * `page.addInitScript()`, which serializes it with `Function.prototype.toString`
 * and runs it in the browser. They must therefore be entirely SELF-CONTAINED —
 * no imports, no closure over module scope, no TypeScript-only syntax that
 * survives into the emitted source. Keep them boring on purpose.
 */

/** Mirrors PROVISIONAL_ACCOUNT_ID in src/lib/accounts.ts. */
export const PROVISIONAL_ACCOUNT_ID = '__provisional__'

/**
 * The active account's auth token, resolved exactly as the app resolves it.
 * Returns null when no account is signed in.
 *
 * Pass directly: `await page.evaluate(readActiveAuthToken)`.
 */
export function readActiveAuthToken(): string | null {
  const PROVISIONAL = '__provisional__'
  const tokenKey = (id: string) => `ff.acct.${id}.authToken`

  const read = (store: Storage, key: string): string | null => {
    try {
      return store.getItem(key)
    } catch {
      return null
    }
  }

  // A tab pinned to the provisional namespace is mid-sign-in / mid-add-account.
  if (read(sessionStorage, 'ff.activeAccountId') === PROVISIONAL) {
    return read(localStorage, tokenKey(PROVISIONAL))
  }

  let roster: Array<{ id?: string }> = []
  try {
    const raw = read(localStorage, 'ff.accounts')
    if (raw) roster = JSON.parse(raw)
  } catch {
    roster = []
  }
  if (!Array.isArray(roster)) roster = []
  const ids = roster.map(a => a && a.id).filter(Boolean) as string[]

  // No roster yet: a first sign-in parks its session in the provisional
  // namespace until /session names the account.
  if (ids.length === 0) return read(localStorage, tokenKey(PROVISIONAL))

  const pinned = read(sessionStorage, 'ff.activeAccountId')
  if (pinned && ids.indexOf(pinned) !== -1) return read(localStorage, tokenKey(pinned))

  const preferred = read(localStorage, 'ff.activeAccountId')
  if (preferred && ids.indexOf(preferred) !== -1) {
    return read(localStorage, tokenKey(preferred))
  }

  return read(localStorage, tokenKey(ids[0]))
}

/** True when a usable session exists for the active account. */
export function hasActiveSession(): boolean {
  // Inlined rather than calling readActiveAuthToken: page.evaluate serializes
  // only the function it is handed, so a cross-function reference would be
  // undefined in the browser.
  const PROVISIONAL = '__provisional__'
  const tokenKey = (id: string) => `ff.acct.${id}.authToken`
  const read = (store: Storage, key: string): string | null => {
    try {
      return store.getItem(key)
    } catch {
      return null
    }
  }

  if (read(sessionStorage, 'ff.activeAccountId') === PROVISIONAL) {
    return Boolean(read(localStorage, tokenKey(PROVISIONAL)))
  }

  let roster: Array<{ id?: string }> = []
  try {
    const raw = read(localStorage, 'ff.accounts')
    if (raw) roster = JSON.parse(raw)
  } catch {
    roster = []
  }
  if (!Array.isArray(roster)) roster = []
  const ids = roster.map(a => a && a.id).filter(Boolean) as string[]

  if (ids.length === 0) return Boolean(read(localStorage, tokenKey(PROVISIONAL)))

  const pinned = read(sessionStorage, 'ff.activeAccountId')
  if (pinned && ids.indexOf(pinned) !== -1) {
    return Boolean(read(localStorage, tokenKey(pinned)))
  }
  const preferred = read(localStorage, 'ff.activeAccountId')
  if (preferred && ids.indexOf(preferred) !== -1) {
    return Boolean(read(localStorage, tokenKey(preferred)))
  }
  return Boolean(read(localStorage, tokenKey(ids[0])))
}

/**
 * Seed a session for a MOCKED spec, in the shape the app boots from.
 *
 * Writes to the provisional namespace — the same place a real first sign-in
 * parks its token before `/session` names the account — so the shell resolves
 * it without needing a roster entry the spec would have to invent.
 *
 * Use with `page.addInitScript(seedMockSession, 'my-token')`.
 */
export function seedMockSession(token: string): void {
  try {
    localStorage.setItem(`ff.acct.__provisional__.authToken`, token)
  } catch {
    /* storage blocked — the spec will fail on its own assertion, loudly */
  }
}
