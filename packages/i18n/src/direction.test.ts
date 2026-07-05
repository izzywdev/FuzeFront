import { describe, it, expect, beforeEach } from 'vitest'
import i18next from 'i18next'
import {
  applyDocumentDirection,
  attachDirectionManager,
} from './direction'

function freshI18n(lng: string) {
  const inst = i18next.createInstance()
  // Sync init — no react binding needed for these tests.
  inst.init({ lng, resources: {}, fallbackLng: 'en' })
  return inst
}

describe('direction manager', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('sets <html dir/lang> for an LTR language', () => {
    applyDocumentDirection('en')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('sets dir=rtl for Arabic and Hebrew', () => {
    expect(applyDocumentDirection('ar')).toBe('rtl')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(applyDocumentDirection('he')).toBe('rtl')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
  })

  it('flips dir on languageChanged when attached, and detaches cleanly', () => {
    const i18n = freshI18n('en')
    const detach = attachDirectionManager(i18n)
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')

    i18n.changeLanguage('ar')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')

    i18n.changeLanguage('es')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')

    detach()
    i18n.changeLanguage('he')
    // After detach the manager no longer reacts.
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
  })
})
