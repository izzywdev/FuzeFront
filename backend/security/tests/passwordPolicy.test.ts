/**
 * Unit tests for the signup password policy (services/passwordPolicy.ts).
 */
import {
  DEFAULT_PASSWORD_POLICY,
  describeUnmet,
  evaluatePassword,
  getPasswordPolicy,
} from '../src/services/passwordPolicy'

describe('password policy default', () => {
  it('is the documented 12+ / upper / lower / digit / symbol policy', () => {
    expect(getPasswordPolicy()).toEqual({
      minLength: 12,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSymbol: true,
    })
  })

  it('returns a copy — callers cannot mutate the shared default', () => {
    const p = getPasswordPolicy()
    p.minLength = 1
    expect(getPasswordPolicy().minLength).toBe(12)
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(12)
    expect(Object.isFrozen(DEFAULT_PASSWORD_POLICY)).toBe(true)
  })
})

describe('evaluatePassword', () => {
  it('accepts a compliant password', () => {
    expect(evaluatePassword('Correct-Horse-9')).toEqual({ ok: true, unmet: [] })
  })

  it('accepts exactly the minimum length', () => {
    expect(evaluatePassword('Abcdefghi1!x').ok).toBe(true) // 12 chars
    expect(evaluatePassword('Abcdefgh1!x').unmet).toEqual(['length']) // 11 chars
  })

  it.each([
    ['too short', 'Ab1!', ['length']],
    ['no uppercase', 'correct-horse-9', ['upper']],
    ['no lowercase', 'CORRECT-HORSE-9', ['lower']],
    ['no digit', 'Correct-Horse-x', ['digit']],
    ['no symbol', 'CorrectHorse99', ['symbol']],
    ['everything missing', 'a', ['length', 'upper', 'digit', 'symbol']],
  ])('rejects %s', (_label, pw, unmet) => {
    const r = evaluatePassword(pw)
    expect(r.ok).toBe(false)
    expect(r.unmet).toEqual(unmet)
  })

  it('non-string / empty input fails every rule (never throws)', () => {
    for (const bad of [undefined, null, 42, {}, '']) {
      const r = evaluatePassword(bad)
      expect(r.ok).toBe(false)
      expect(r.unmet).toEqual(['length', 'upper', 'lower', 'digit', 'symbol'])
    }
  })

  it('is Unicode-aware: Cyrillic upper/lower and non-ASCII digits count', () => {
    expect(evaluatePassword('Пароль-Пароль-٣').ok).toBe(true) // upper П, lower, Arabic-Indic digit, symbol
  })

  it('counts length in code points, not UTF-16 units', () => {
    // 11 astral emoji + ... would be 22 UTF-16 units but only 11 code points.
    const elevenEmoji = '😀'.repeat(11)
    expect(evaluatePassword(elevenEmoji + 'Aa1').unmet).not.toContain('length') // 14 code points
    expect(evaluatePassword('😀'.repeat(6) + 'Aa1!').unmet).toContain('length') // 10 code points (16 units)
  })

  it('whitespace is not a symbol', () => {
    expect(evaluatePassword('Correct Horse 9').unmet).toEqual(['symbol'])
  })

  it('honours a custom policy', () => {
    const lax = { minLength: 4, requireUpper: false, requireLower: false, requireDigit: false, requireSymbol: false }
    expect(evaluatePassword('abcd', lax).ok).toBe(true)
    expect(evaluatePassword('abc', lax).unmet).toEqual(['length'])
  })
})

describe('describeUnmet', () => {
  it('names the failed rules and never contains the password', () => {
    const msg = describeUnmet(['length', 'symbol'])
    expect(msg).toContain('at least 12 characters')
    expect(msg).toContain('a symbol')
    expect(msg).not.toContain('uppercase')
  })
})
