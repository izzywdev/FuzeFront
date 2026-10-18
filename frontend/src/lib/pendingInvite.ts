/**
 * Pending-invitation carry (FFRNT-309, org-invitations v2).
 *
 * The v1 accept page dropped the invitation token the moment a brand-new
 * invitee went through "Create an account" / "Sign in to accept" (the user
 * left for sign-up or a social provider and came back to the dashboard with no
 * trace of the invite). The v2 accept flow writes the OPAQUE invitation token
 * here before any navigation that leaves `/invitations/:token`, and the login
 * completion path (`LoginPage`) reads it back and returns the user to
 * `/invitations/:token`, where `InvitationAcceptFlow autoAccept` binds the
 * membership by the now-authenticated identity.
 *
 * Only the opaque lookup token is stored — never the single-use `bindToken`,
 * never an address or any profile data. The token is a lookup key, not a
 * capability: accept still enforces identity + standing server-side.
 *
 * `sessionStorage` (per-tab, cleared on tab close) with every access wrapped:
 * private windows / blocked storage must degrade to "no carry", never throw.
 */
const KEY = 'fuzefront:invite:pending'

/** Opaque tokens only: bounded length, URL-path-safe, no whitespace/slashes. */
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{1,512}$/

export function isSafeInviteToken(token: unknown): token is string {
  return typeof token === 'string' && SAFE_TOKEN.test(token)
}

/** The in-app path of the accept page for a token (never an absolute URL). */
export function invitePath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`
}

export function savePendingInvite(token: string): void {
  if (!isSafeInviteToken(token)) return
  try {
    window.sessionStorage.setItem(KEY, token)
  } catch {
    /* storage unavailable — fall back to no carry */
  }
}

export function readPendingInvite(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY)
    return isSafeInviteToken(value) ? value : null
  } catch {
    return null
  }
}

export function clearPendingInvite(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
