/**
 * Tests for the social-broker return-origin allowlist (FuzeFront#352).
 *
 * The claim under test is a security claim, not a convenience: this is an
 * EXACT-origin allowlist consulted before the brokered social sign-in
 * redirect carries a fresh single-use `?code=` back to the browser. An
 * over-broad match here is an open-redirect / auth-code-leak vector, so the
 * negative cases (prefix attack, subdomain, unlisted origin) matter at least
 * as much as the two positive ones from the issue.
 */
import { resolveAllowedReturnOrigin } from '../src/providers/authentik/socialReturnOrigins'

const ENV_KEY = 'SECURITY_SOCIAL_RETURN_ORIGINS'
const original = process.env[ENV_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
})

function reqWithHost(host: string | undefined) {
  return { headers: { host } }
}

describe('resolveAllowedReturnOrigin — unset/empty allowlist (default, every deployment today)', () => {
  it('returns undefined regardless of Host when the env var is unset', () => {
    delete process.env[ENV_KEY]
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com'))).toBeUndefined()
    expect(resolveAllowedReturnOrigin(reqWithHost('app.fuzefront.com'))).toBeUndefined()
  })

  it('returns undefined when the env var is an empty string', () => {
    process.env[ENV_KEY] = ''
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com'))).toBeUndefined()
  })
})

describe('resolveAllowedReturnOrigin — the two FuzeFront#352 origins', () => {
  beforeEach(() => {
    process.env[ENV_KEY] =
      'https://marketplace.mendysrobotics.com,https://live.mendysrobotics.com'
  })

  it('ACCEPTS marketplace.mendysrobotics.com, returning its exact configured origin', () => {
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com'))).toBe(
      'https://marketplace.mendysrobotics.com'
    )
  })

  it('ACCEPTS live.mendysrobotics.com, returning its exact configured origin', () => {
    expect(resolveAllowedReturnOrigin(reqWithHost('live.mendysrobotics.com'))).toBe(
      'https://live.mendysrobotics.com'
    )
  })

  it('matches case-insensitively and with an explicit :443 port, mirroring tenants.ts normaliseHost', () => {
    expect(resolveAllowedReturnOrigin(reqWithHost('Marketplace.MendysRobotics.com'))).toBe(
      'https://marketplace.mendysrobotics.com'
    )
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com:443'))).toBe(
      'https://marketplace.mendysrobotics.com'
    )
  })

  // ── REJECTIONS — the core security property ────────────────────────────
  it('REJECTS an origin not on the allowlist (falls back to undefined -> appBaseUrl())', () => {
    expect(resolveAllowedReturnOrigin(reqWithHost('evil.example.com'))).toBeUndefined()
    expect(resolveAllowedReturnOrigin(reqWithHost('app.fuzefront.com'))).toBeUndefined()
  })

  it('REJECTS a subdomain of an allowlisted host (no wildcard/subdomain matching)', () => {
    expect(
      resolveAllowedReturnOrigin(reqWithHost('evil.marketplace.mendysrobotics.com'))
    ).toBeUndefined()
    expect(
      resolveAllowedReturnOrigin(reqWithHost('attacker.live.mendysrobotics.com'))
    ).toBeUndefined()
  })

  it('REJECTS a prefix/suffix attack against an allowlisted host (no startsWith/substring matching)', () => {
    // Looks like the allowlisted host as a substring, but is a DIFFERENT host.
    expect(
      resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com.evil.com'))
    ).toBeUndefined()
    expect(
      resolveAllowedReturnOrigin(reqWithHost('notmarketplace.mendysrobotics.com'))
    ).toBeUndefined()
    expect(resolveAllowedReturnOrigin(reqWithHost('mendysrobotics.com'))).toBeUndefined()
  })

  it('REJECTS a missing/empty Host header', () => {
    expect(resolveAllowedReturnOrigin(reqWithHost(undefined))).toBeUndefined()
    expect(resolveAllowedReturnOrigin(reqWithHost(''))).toBeUndefined()
  })
})

describe('resolveAllowedReturnOrigin — malformed configuration is skipped, not fatal', () => {
  it('ignores an entry with a path/query/fragment rather than silently widening to its host', () => {
    process.env[ENV_KEY] = 'https://marketplace.mendysrobotics.com/some/path'
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com'))).toBeUndefined()
  })

  it('ignores an unparseable entry and still matches the valid ones alongside it', () => {
    process.env[ENV_KEY] = 'not-a-url, https://live.mendysrobotics.com'
    expect(resolveAllowedReturnOrigin(reqWithHost('live.mendysrobotics.com'))).toBe(
      'https://live.mendysrobotics.com'
    )
  })

  it('ignores a non-http(s) scheme', () => {
    process.env[ENV_KEY] = 'javascript://marketplace.mendysrobotics.com'
    expect(resolveAllowedReturnOrigin(reqWithHost('marketplace.mendysrobotics.com'))).toBeUndefined()
  })
})
