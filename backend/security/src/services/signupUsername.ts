/**
 * Derive the identity-store (Authentik) USERNAME for a new signup.
 *
 * Authentik's enrollment prompt needs a `username`; the signup API has none
 * (email is the login identifier), so one is derived from the email.
 *
 * Previously: `email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '') || email`.
 * That strips every non-ASCII character, so a non-Latin local-part (`用户@例子.cn`,
 * `мария@пример.рф`, `josé@…` -> `jos`) was gutted: two different people could
 * collapse to the same username (collision -> a spurious "already exists"), or
 * to the empty string (-> falls back to the email anyway, inconsistently).
 *
 * Now:
 *   1. If the local-part is ALREADY composed solely of the safe ASCII set
 *      `[A-Za-z0-9_.-]`, keep it verbatim. This is byte-for-byte what the old
 *      code produced for those addresses, so existing accounts and any
 *      username-keyed state are unaffected.
 *   2. Otherwise use the WHOLE address, NFC-normalized and lowercased, as the
 *      username. An email is already unique per account and Authentik accepts
 *      `@` and Unicode in usernames; the Google-brokered path already creates
 *      users with `username: email`, so this keeps both paths consistent. This
 *      also fixes ASCII local-parts with a `+tag` or other punctuation, which
 *      were silently stripped (`a+b` -> `ab`) and could collide with `ab`.
 *   3. If that exceeds Authentik's 150-char username limit, or contains
 *      whitespace/control characters, fall back to a deterministic opaque
 *      `u_<sha256(email) prefix>` — unique per address, safe charset, no PII.
 *
 * The result is deterministic for a given email (NFC makes visually identical
 * precomposed/decomposed forms agree) and has no dependency on the locale.
 */
import { createHash } from 'crypto'

/** Authentik `User.username` max_length. */
export const AUTHENTIK_USERNAME_MAX_LENGTH = 150

const SAFE_LOCAL_PART = /^[A-Za-z0-9_.-]+$/
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f]/u

export function deriveSignupUsername(email: string): string {
  const normalized = String(email ?? '').normalize('NFC').trim()
  const at = normalized.lastIndexOf('@')
  const local = at > 0 ? normalized.slice(0, at) : ''

  if (local && local.length <= AUTHENTIK_USERNAME_MAX_LENGTH && SAFE_LOCAL_PART.test(local)) return local

  const full = normalized.toLowerCase()
  if (full && full.length <= AUTHENTIK_USERNAME_MAX_LENGTH && !UNSAFE_CHARS.test(full)) {
    return full
  }
  return `u_${createHash('sha256').update(full).digest('hex').slice(0, 32)}`
}
