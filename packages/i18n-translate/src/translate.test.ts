import { describe, it, expect, vi } from 'vitest'
import { translateNamespace, type Translator, type FlatMessages } from './translate'
import { sourceHash, emptyMeta } from './hash'

/** Deterministic fake translator: prefixes the value, but keeps placeholders/brand. */
const fakeTranslate: Translator = vi.fn(async ({ source, targetCode }) => {
  // Naively "translate" by tagging, preserving {{...}}, ICU control, and brand terms.
  return `[${targetCode}] ${source}`
})

describe('translateNamespace — idempotency', () => {
  it('translates all keys on a cold run (no existing translations)', async () => {
    const source: FlatMessages = { 'nav.apps': 'Apps', 'nav.home': 'Home' }
    const result = await translateNamespace({
      source,
      existing: {},
      meta: emptyMeta(),
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate: fakeTranslate,
    })
    expect(result.translatedKeys.sort()).toEqual(['nav.apps', 'nav.home'])
    expect(result.skippedKeys).toEqual([])
    expect(result.messages['nav.apps']).toBe('[es] Apps')
  })

  it('skips unchanged keys on a warm run (same source hash) and never calls the LLM', async () => {
    const source: FlatMessages = { 'nav.apps': 'Apps' }
    const translate = vi.fn(fakeTranslate)
    const result = await translateNamespace({
      source,
      existing: { 'nav.apps': '[es] Apps' },
      meta: { hashes: { 'nav.apps': sourceHash('Apps') } },
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate,
    })
    expect(result.skippedKeys).toEqual(['nav.apps'])
    expect(result.translatedKeys).toEqual([])
    expect(translate).not.toHaveBeenCalled()
    // Output is byte-identical to existing.
    expect(result.messages['nav.apps']).toBe('[es] Apps')
  })

  it('re-translates a key whose English source changed', async () => {
    const translate = vi.fn(fakeTranslate)
    const result = await translateNamespace({
      source: { 'nav.apps': 'Applications' }, // changed from "Apps"
      existing: { 'nav.apps': '[es] Apps' },
      meta: { hashes: { 'nav.apps': sourceHash('Apps') } },
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate,
    })
    expect(result.translatedKeys).toEqual(['nav.apps'])
    expect(translate).toHaveBeenCalledOnce()
    expect(result.messages['nav.apps']).toBe('[es] Applications')
    expect(result.meta.hashes['nav.apps']).toBe(sourceHash('Applications'))
  })

  it('translates only the missing key when others are unchanged', async () => {
    const translate = vi.fn(fakeTranslate)
    const result = await translateNamespace({
      source: { a: 'A', b: 'B' },
      existing: { a: '[es] A' },
      meta: { hashes: { a: sourceHash('A') } },
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate,
    })
    expect(result.skippedKeys).toEqual(['a'])
    expect(result.translatedKeys).toEqual(['b'])
    expect(translate).toHaveBeenCalledOnce()
  })

  it('prunes keys that no longer exist in the English source', async () => {
    const result = await translateNamespace({
      source: { a: 'A' },
      existing: { a: '[es] A', removed: '[es] gone' },
      meta: { hashes: { a: sourceHash('A'), removed: sourceHash('gone') } },
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate: fakeTranslate,
    })
    expect(result.prunedKeys).toEqual(['removed'])
    expect(result.messages).not.toHaveProperty('removed')
    expect(result.meta.hashes).not.toHaveProperty('removed')
  })
})

describe('translateNamespace — validation', () => {
  it('accepts a translation that preserves an ICU plural control surface', async () => {
    const source: FlatMessages = {
      'apps.count':
        '{count, plural, =0 {No apps installed} one {# app installed} other {# apps installed}}',
    }
    const icuTranslate: Translator = async ({ source: s }) =>
      s
        .replace('No apps installed', 'Sin aplicaciones')
        .replace('# app installed', '# aplicación')
        .replace('# apps installed', '# aplicaciones')
    const result = await translateNamespace({
      source,
      existing: {},
      meta: emptyMeta(),
      targetCode: 'es',
      targetLanguageName: 'Spanish',
      translate: icuTranslate,
    })
    expect(result.translatedKeys).toEqual(['apps.count'])
    expect(result.messages['apps.count']).toContain('plural')
    expect(result.messages['apps.count']).toContain('Sin aplicaciones')
  })

  it('throws when a translation drops an interpolation placeholder', async () => {
    const badTranslate: Translator = async () => 'Bienvenido de nuevo.'
    await expect(
      translateNamespace({
        source: { 'greeting.welcome': 'Welcome back, {{name}}.' },
        existing: {},
        meta: emptyMeta(),
        targetCode: 'es',
        targetLanguageName: 'Spanish',
        translate: badTranslate,
      })
    ).rejects.toThrow(/Placeholder mismatch/)
  })

  it('throws when a translation mangles the ICU control surface', async () => {
    const badTranslate: Translator = async () =>
      '{contador, plural, one {# app} other {# apps}}' // arg name translated
    await expect(
      translateNamespace({
        source: { x: '{count, plural, one {# app} other {# apps}}' },
        existing: {},
        meta: emptyMeta(),
        targetCode: 'es',
        targetLanguageName: 'Spanish',
        translate: badTranslate,
      })
    ).rejects.toThrow(/Placeholder mismatch/)
  })

  it('throws when a glossary brand term is not preserved', async () => {
    const badTranslate: Translator = async () => 'Bienvenido a FrenteDeFusión'
    await expect(
      translateNamespace({
        source: { 'app.intro': 'Welcome to FuzeFront' },
        existing: {},
        meta: emptyMeta(),
        targetCode: 'es',
        targetLanguageName: 'Spanish',
        translate: badTranslate,
      })
    ).rejects.toThrow(/Glossary term not preserved/)
  })
})
