/**
 * Unit tests for deriveSignupUsername — the Authentik username derived from a
 * signup email. Regression guard for the old `[^a-zA-Z0-9_.-]` strip that gutted
 * non-Latin local-parts.
 */
import { createHash } from 'crypto'
import { AUTHENTIK_USERNAME_MAX_LENGTH, deriveSignupUsername } from '../src/services/signupUsername'

describe('deriveSignupUsername', () => {
  describe('ASCII-safe local-parts are unchanged (backward compatible)', () => {
    it.each([
      ['jane@example.com', 'jane'],
      ['jane.doe@example.com', 'jane.doe'],
      ['jane_doe-2@example.com', 'jane_doe-2'],
      ['Jane@example.com', 'Jane'], // case preserved exactly as before
    ])('%s -> %s', (email, expected) => {
      expect(deriveSignupUsername(email)).toBe(expected)
    })
  })

  describe('non-Latin / IDN local-parts are not stripped', () => {
    it.each([
      ['用户@例子.广告', '用户@例子.广告'],
      ['мария@пример.рф', 'мария@пример.рф'],
      ['χρήστης@παράδειγμα.ελ', 'χρήστης@παράδειγμα.ελ'],
      ['josé@example.com', 'josé@example.com'],
      ['محمد@مثال.إختبار', 'محمد@مثال.إختبار'],
    ])('%s -> full lowercased NFC address', (email, expected) => {
      const u = deriveSignupUsername(email)
      expect(u).toBe(expected)
      // The old implementation returned '' / a truncated stub for these.
      expect(u.length).toBeGreaterThan(0)
    })

    it('two different non-Latin local-parts never collapse to the same username', () => {
      expect(deriveSignupUsername('用户@例子.cn')).not.toBe(deriveSignupUsername('用户二@例子.cn'))
      // Old behaviour: both reduced to '' -> fell back inconsistently.
      expect(deriveSignupUsername('josé@example.com')).not.toBe(deriveSignupUsername('jos@example.com'))
    })

    it('precomposed and decomposed forms of the same address agree (NFC)', () => {
      const precomposed = 'josé@example.com'
      const decomposed = 'josé@example.com'
      expect(deriveSignupUsername(decomposed)).toBe(deriveSignupUsername(precomposed))
    })

    it('is case-insensitive for the full-address form', () => {
      expect(deriveSignupUsername('JOSÉ@Example.COM')).toBe('josé@example.com')
    })
  })

  describe('ASCII punctuation is no longer silently stripped', () => {
    it('plus-tag keeps the full address so it cannot collide with the bare local-part', () => {
      expect(deriveSignupUsername('a+b@example.com')).toBe('a+b@example.com')
      expect(deriveSignupUsername('a+b@example.com')).not.toBe(deriveSignupUsername('ab@example.com'))
    })
  })

  describe('fallback', () => {
    it('too long for the identity store -> deterministic opaque hash username', () => {
      const email = `${'é'.repeat(AUTHENTIK_USERNAME_MAX_LENGTH)}@example.com`
      const u = deriveSignupUsername(email)
      expect(u).toMatch(/^u_[0-9a-f]{32}$/)
      expect(u.length).toBeLessThanOrEqual(AUTHENTIK_USERNAME_MAX_LENGTH)
      expect(u).toBe(deriveSignupUsername(email)) // deterministic
      expect(u).toBe(`u_${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`)
    })

    it('whitespace / control characters -> opaque hash username', () => {
      expect(deriveSignupUsername('a b@example.com')).toMatch(/^u_[0-9a-f]{32}$/)
      expect(deriveSignupUsername('a\u0000b@example.com')).toMatch(/^u_[0-9a-f]{32}$/)
    })

    it('no @ at all still yields a non-empty, safe username', () => {
      expect(deriveSignupUsername('nodomain')).toBe('nodomain')
      expect(deriveSignupUsername('')).toMatch(/^u_[0-9a-f]{32}$/)
    })

    it('every result is within the identity-store length limit', () => {
      for (const e of ['a@b.c', '用户@例子.cn', `${'x'.repeat(400)}@example.com`, `${'用'.repeat(200)}@例子.cn`]) {
        const u = deriveSignupUsername(e)
        expect(u.length).toBeGreaterThan(0)
        expect(u.length).toBeLessThanOrEqual(AUTHENTIK_USERNAME_MAX_LENGTH)
      }
    })
  })
})
