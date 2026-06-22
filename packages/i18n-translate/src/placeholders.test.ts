import { describe, it, expect } from 'vitest'
import {
  extractPlaceholders,
  placeholdersPreserved,
  listPlaceholders,
} from './placeholders'

describe('placeholder extraction', () => {
  it('extracts i18next {{interpolation}} tokens', () => {
    const { interpolations } = extractPlaceholders('Welcome back, {{name}}.')
    expect(interpolations).toEqual(['{{name}}'])
  })

  it('extracts the ICU control surface (arg, keyword, selectors) not sub-messages', () => {
    const src =
      '{count, plural, =0 {No apps installed} one {# app installed} other {# apps installed}}'
    const { interpolations, icuControl, simpleIcu } = extractPlaceholders(src)
    expect(interpolations).toEqual([])
    expect(simpleIcu).toEqual([])
    expect(icuControl).toContain('arg:count')
    expect(icuControl).toContain('kw:plural')
    expect(icuControl).toContain('sel:=0')
    expect(icuControl).toContain('sel:one')
    expect(icuControl).toContain('sel:other')
    expect(icuControl).toContain('hash:#')
  })

  it('treats a lone single-brace arg (no ICU keyword) as a simple token', () => {
    const { simpleIcu } = extractPlaceholders('Hi {name}')
    expect(simpleIcu).toEqual(['{name}'])
  })

  it('lists every placeholder for prompt building', () => {
    expect(listPlaceholders('Hi {{user}}, you have {n} items')).toEqual([
      '{{user}}',
      '{n}',
    ])
  })
})

describe('placeholdersPreserved', () => {
  it('passes when interpolation is preserved across translation', () => {
    expect(
      placeholdersPreserved('Welcome back, {{name}}.', 'Bienvenido, {{name}}.')
    ).toBe(true)
  })

  it('fails when an interpolation variable is translated', () => {
    expect(
      placeholdersPreserved('Welcome back, {{name}}.', 'Bienvenido, {{nombre}}.')
    ).toBe(false)
  })

  it('fails when a placeholder is dropped', () => {
    expect(
      placeholdersPreserved('You have {{count}} items', 'Tienes elementos')
    ).toBe(false)
  })

  it('preserves ICU plural tokens (translated copy keeps the same braces set)', () => {
    const src =
      '{count, plural, =0 {No apps} one {# app} other {# apps}}'
    // Inner words translated, ICU structure kept.
    const translated =
      '{count, plural, =0 {Sin aplicaciones} one {# aplicación} other {# aplicaciones}}'
    expect(placeholdersPreserved(src, translated)).toBe(true)
  })
})
