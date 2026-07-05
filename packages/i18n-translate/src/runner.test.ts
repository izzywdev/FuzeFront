import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run } from './runner'
import type { LanguagesConfig } from './config'
import type { Translator } from './translate'

const languages: LanguagesConfig = {
  sourceLanguage: 'en',
  languages: [
    { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  ],
}

const fakeTranslate: Translator = async ({ source, targetCode }) =>
  `[${targetCode}] ${source}`

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'i18n-runner-'))
  mkdirSync(join(dir, 'en'), { recursive: true })
  writeFileSync(
    join(dir, 'en', 'common.json'),
    JSON.stringify({ 'nav.apps': 'Apps', 'app.title': 'FuzeFront' }, null, 2)
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('run', () => {
  it('translates the source into every non-source language and writes files', async () => {
    const result = await run({ localesDir: dir, languages, translate: fakeTranslate })
    expect(result.changed).toBe(true)

    const es = JSON.parse(readFileSync(join(dir, 'es', 'common.json'), 'utf8'))
    expect(es['nav.apps']).toBe('[es] Apps')
    const ar = JSON.parse(readFileSync(join(dir, 'ar', 'common.json'), 'utf8'))
    expect(ar['nav.apps']).toBe('[ar] Apps')

    // Per-language meta sidecar written.
    expect(existsSync(join(dir, 'es', 'common.meta.json'))).toBe(true)
  })

  it('is idempotent: a second run translates nothing and reports no change', async () => {
    await run({ localesDir: dir, languages, translate: fakeTranslate })

    const translate = vi.fn(fakeTranslate)
    const second = await run({ localesDir: dir, languages, translate })

    expect(translate).not.toHaveBeenCalled()
    expect(second.changed).toBe(false)
    expect(second.runs.every((r) => r.translated === 0)).toBe(true)
  })

  it('writes byte-identical output across runs (stable ordering + newline)', async () => {
    await run({ localesDir: dir, languages, translate: fakeTranslate })
    const first = readFileSync(join(dir, 'es', 'common.json'), 'utf8')
    await run({ localesDir: dir, languages, translate: fakeTranslate })
    const second = readFileSync(join(dir, 'es', 'common.json'), 'utf8')
    expect(second).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
  })

  it('only translates the changed/added key on an incremental run', async () => {
    await run({ localesDir: dir, languages, translate: fakeTranslate })

    // Add a new English key.
    writeFileSync(
      join(dir, 'en', 'common.json'),
      JSON.stringify(
        { 'nav.apps': 'Apps', 'app.title': 'FuzeFront', 'nav.new': 'New' },
        null,
        2
      )
    )

    const translate = vi.fn(fakeTranslate)
    const result = await run({ localesDir: dir, languages, translate })

    // One new key × two target languages = 2 calls.
    expect(translate).toHaveBeenCalledTimes(2)
    expect(result.changed).toBe(true)
    const es = JSON.parse(readFileSync(join(dir, 'es', 'common.json'), 'utf8'))
    expect(es['nav.new']).toBe('[es] New')
  })

  it('supports a dry run that does not write files', async () => {
    const result = await run({
      localesDir: dir,
      languages,
      translate: fakeTranslate,
      write: false,
    })
    expect(result.changed).toBe(true)
    expect(existsSync(join(dir, 'es', 'common.json'))).toBe(false)
  })
})
