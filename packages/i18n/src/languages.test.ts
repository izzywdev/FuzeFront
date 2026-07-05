import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  getLanguage,
  getDirection,
  isSupported,
} from './languages'

describe('language registry', () => {
  it('ships the curated 11-language set with en as default', () => {
    expect(DEFAULT_LANGUAGE).toBe('en')
    expect(SUPPORTED_LANGUAGE_CODES).toEqual([
      'en',
      'es',
      'fr',
      'de',
      'pt',
      'ru',
      'zh',
      'ja',
      'hi',
      'ar',
      'he',
    ])
  })

  it('marks ar and he as RTL and everything else as LTR', () => {
    expect(getDirection('ar')).toBe('rtl')
    expect(getDirection('he')).toBe('rtl')
    for (const code of ['en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi']) {
      expect(getDirection(code)).toBe('ltr')
    }
  })

  it('exposes a native name (endonym) for every language', () => {
    for (const l of LANGUAGES) {
      expect(l.nativeName.length).toBeGreaterThan(0)
    }
    expect(getLanguage('es')?.nativeName).toBe('Español')
    expect(getLanguage('ar')?.nativeName).toBe('العربية')
  })

  it('resolves region-tagged and mixed-case codes', () => {
    expect(getLanguage('EN')?.code).toBe('en')
    expect(getLanguage('pt-BR')?.code).toBe('pt')
    expect(getDirection('AR-EG')).toBe('rtl')
  })

  it('treats unknown codes as unsupported and defaults their direction to ltr', () => {
    expect(getLanguage('xx')).toBeUndefined()
    expect(isSupported('xx')).toBe(false)
    expect(isSupported('zh')).toBe(true)
    expect(getDirection('xx')).toBe('ltr')
    expect(getDirection(undefined)).toBe('ltr')
  })
})
