import type { APIRequestContext } from '@playwright/test'

/**
 * Shared post-production synthetic authentication.
 *
 * Signs a synthetic account into the LIVE platform through the same Security
 * API surface the SPA uses (`POST /api/v1/security/session`), so a smoke that
 * relies on it still fails when real sign-in breaks. Extracted from
 * `live-smoke.spec.ts` test 7 so more than one post-prod spec can authenticate
 * without duplicating the self-provision / 409-race / credential-drift self-heal
 * logic.
 *
 * SELF-PROVISIONING: asks whether the account exists, creates it if not, signs
 * in if it does — so a rebuilt prod database heals on the next run instead of
 * going permanently red, and nothing is provisioned by hand.
 *
 * Credentials come from the caller (read from env by the spec). The password
 * has NO in-repo fallback on purpose: this repository is public, so a literal
 * would publish a working production login. A caller with no password must
 * skip LOUDLY as missing coverage rather than fall back to a guessable value.
 */

export interface SyntheticCreds {
  email: string
  /** Required; a caller with no password must skip rather than call this. */
  password: string
  /** Enables the credential-drift self-heal via /admin/reset-password. */
  internalSecret?: string
  /** Minimal profile used only when the account must be created. */
  firstName?: string
  lastName?: string
}

export interface LoginResult {
  token: string
  /** How the session was obtained — surfaced as a test annotation. */
  via: 'signup' | 'session' | 'signup-race-session' | 'self-heal'
}

interface SecurityLoginBody {
  status?: string
  token?: string
}

/**
 * Returns a valid session token for the synthetic, provisioning or self-healing
 * as needed. Throws (with a diagnostic message) on any genuinely broken
 * production surface — the caller asserts success so the smoke fails loudly.
 */
export async function loginSyntheticViaApi(
  request: APIRequestContext,
  creds: SyntheticCreds
): Promise<LoginResult> {
  const { email, password, internalSecret } = creds

  const availResp = await request.get('/api/v1/security/email-available', {
    params: { email },
  })
  if (availResp.status() !== 200) {
    throw new Error(
      `GET /api/v1/security/email-available -> ${availResp.status()} for ${email} ` +
        '(429 = per-IP rate limit, likely concurrent smoke runs; 5xx = backend error)'
    )
  }
  const { available } = (await availResp.json()) as { available: boolean }

  if (available) {
    const signupResp = await request.post('/api/v1/security/signup', {
      data: {
        email,
        password,
        firstName: creds.firstName ?? 'Post-prod',
        lastName: creds.lastName ?? 'Smoke',
      },
    })
    if (signupResp.status() === 409) {
      // Two runners raced between the availability check and signup; the loser
      // falls through to signing in.
      const raceLogin = await request.post('/api/v1/security/session', {
        data: { email, password },
      })
      if (raceLogin.status() !== 200) {
        throw new Error(
          `signup raced (409) and follow-up sign-in -> ${raceLogin.status()} — ` +
            'a 401 means the existing account has a DIFFERENT password than supplied'
        )
      }
      return { token: tokenFrom(await raceLogin.json(), email), via: 'signup-race-session' }
    }
    if (signupResp.status() !== 201) {
      throw new Error(
        `POST /api/v1/security/signup -> ${signupResp.status()} creating ${email} ` +
          '(400 = password rejected by policy; 503 = signup disabled or backend down)'
      )
    }
    // signup returns a LoginResponse — a fresh account is already signed in.
    return { token: tokenFrom(await signupResp.json(), email), via: 'signup' }
  }

  // Steady state: the account exists — the real sign-in path.
  const loginResp = await request.post('/api/v1/security/session', {
    data: { email, password },
  })

  if (loginResp.status() === 401 && internalSecret) {
    // Credential drift self-heal: the account exists but the supplied password
    // no longer matches (e.g. the secret was rotated). Reset via the security
    // service's tenant-aware admin endpoint, then retry.
    const resetResp = await request.post('/api/v1/security/admin/reset-password', {
      data: { email, newPassword: password },
      headers: { 'x-internal-secret': internalSecret },
    })
    if (resetResp.status() !== 200) {
      throw new Error(
        `self-heal POST /api/v1/security/admin/reset-password -> ${resetResp.status()} ` +
          '(401 = INTERNAL_PROVISION_SECRET mismatch; 404 = user not found; 400 = policy)'
      )
    }
    const retryResp = await request.post('/api/v1/security/session', {
      data: { email, password },
    })
    if (retryResp.status() !== 200) {
      throw new Error(
        `sign-in retry after self-heal -> ${retryResp.status()}: password was reset but sign-in still failed`
      )
    }
    return { token: tokenFrom(await retryResp.json(), email), via: 'self-heal' }
  }

  if (loginResp.status() !== 200) {
    throw new Error(
      `POST /api/v1/security/session -> ${loginResp.status()} — ${email} EXISTS but credentials ` +
        'were rejected (401 = wrong password / credential drift without INTERNAL_PROVISION_SECRET; 5xx = backend error)'
    )
  }
  return { token: tokenFrom(await loginResp.json(), email), via: 'session' }
}

function tokenFrom(body: SecurityLoginBody, email: string): string {
  if (body.status === 'mfa_required') {
    throw new Error(
      `synthetic ${email} requires MFA step-up — a break-glass synthetic must not, or it cannot sign in headless`
    )
  }
  if (!body.token) {
    throw new Error(`API login for ${email} returned no token`)
  }
  return body.token
}
