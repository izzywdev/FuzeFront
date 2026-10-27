/**
 * authI18n.test.ts — the auth copy lives in three places that must not drift:
 * the `@fuzefront/auth-ui` English defaults, the key map in `pages/authI18n.ts`,
 * and `locales/{en,ar,he}/common.json`. These assertions pin all three together.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_AUTH_LABELS, DEFAULT_SIGNUP_LABELS } from '@fuzefront/auth-ui'
import en from '../../locales/en/common.json'
import ar from '../../locales/ar/common.json'
import he from '../../locales/he/common.json'
import {
  AUTH_ERROR_DEFAULTS,
  AUTH_LABEL_KEYS,
  REQ_LENGTH_KEY,
  SIGNUP_LABEL_KEYS,
  authError,
  buildAuthLabels,
  buildSignupLabels,
  type TFn,
} from '../pages/authI18n'

const LOCALES = { en, ar, he } as Record<string, Record<string, string>>

const allKeys = [
  ...Object.values(SIGNUP_LABEL_KEYS),
  REQ_LENGTH_KEY,
  ...Object.values(AUTH_LABEL_KEYS).filter((k): k is string => Boolean(k)),
  ...Object.keys(AUTH_ERROR_DEFAULTS).map(k => `auth.error.${k}`),
]

/** A `t` that behaves like i18next with `lng` loaded (flat dotted keys, {{var}} interpolation, defaultValue fallback). */
const makeT = (lng: string): TFn => (key, options = {}) => {
  const raw = LOCALES[lng][key] ?? (options.defaultValue as string | undefined) ?? key
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? ''))
}

describe('auth i18n keys', () => {
  it.each(['en', 'ar', 'he'])('%s has EVERY auth key the host references', lng => {
    const missing = allKeys.filter(k => typeof LOCALES[lng][k] !== 'string' || LOCALES[lng][k] === '')
    expect(missing).toEqual([])
  })

  it('the named keys from the spec exist in every locale', () => {
    for (const lng of ['en', 'ar', 'he']) {
      for (const k of [
        'auth.signup.fullName.label',
        'auth.signup.fullName.help',
        'auth.signup.password.strength',
        'auth.signup.password.req.length',
        'auth.signup.password.req.upper',
        'auth.signup.password.req.lower',
        'auth.signup.password.req.digit',
        'auth.signup.password.req.symbol',
      ]) {
        expect(LOCALES[lng][k], `${lng}:${k}`).toBeTruthy()
      }
    }
  })

  it('en matches the @fuzefront/auth-ui defaults exactly (one source of truth, no silent drift)', () => {
    const t = makeT('en')
    const noDefault: TFn = (key, o = {}) => t(key, { ...o, defaultValue: undefined })
    const built = buildSignupLabels(noDefault) as unknown as Record<string, unknown>
    const defaults = DEFAULT_SIGNUP_LABELS as unknown as Record<string, unknown>
    for (const prop of Object.keys(SIGNUP_LABEL_KEYS)) {
      expect(built[prop], prop).toBe(defaults[prop])
    }
    expect((built.reqLength as (n: number) => string)(12)).toBe(DEFAULT_SIGNUP_LABELS.reqLength(12))
    const auth = buildAuthLabels(noDefault) as Record<string, unknown>
    for (const [prop, key] of Object.entries(AUTH_LABEL_KEYS)) {
      expect(auth[prop], `${prop} <- ${key}`).toBe((DEFAULT_AUTH_LABELS as unknown as Record<string, unknown>)[prop])
    }
    for (const [name, text] of Object.entries(AUTH_ERROR_DEFAULTS)) {
      expect(en[`auth.error.${name}` as keyof typeof en], name).toBe(text)
    }
  })

  it('ar/he keep the {{min}} / {{error}} placeholders and are really translated', () => {
    for (const lng of ['ar', 'he']) {
      expect(LOCALES[lng][REQ_LENGTH_KEY]).toContain('{{min}}')
      expect(LOCALES[lng]['auth.error.callbackFailed']).toContain('{{error}}')
      expect(LOCALES[lng]['auth.signup.fullName.label']).not.toBe(en['auth.signup.fullName.label'])
      expect(LOCALES[lng]['auth.signup.submit']).not.toBe(en['auth.signup.submit'])
    }
  })

  it('RTL locales produce Arabic/Hebrew labels end to end', () => {
    const arLabels = buildSignupLabels(makeT('ar'))
    expect(arLabels.fullNameLabel).toBe('الاسم الكامل')
    expect(arLabels.reqLength(12)).toBe('12+ حرفًا')
    const heLabels = buildSignupLabels(makeT('he'))
    expect(heLabels.fullNameLabel).toBe('שם מלא')
    expect(heLabels.reqLength(12)).toBe('12+ תווים')
  })

  it('degrades to the English default when a key is missing (locale not yet translated)', () => {
    const t: TFn = (_key, o = {}) => (o.defaultValue as string) ?? _key
    expect(buildSignupLabels(t).submit).toBe(DEFAULT_SIGNUP_LABELS.submit)
    expect(authError(t, 'callbackFailed', { error: 'x' })).toBe('Authentication failed: x')
  })
})
