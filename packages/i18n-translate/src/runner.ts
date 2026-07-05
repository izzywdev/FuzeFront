import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { emptyMeta, META_SUFFIX, type LocaleMeta } from './hash'
import {
  translateNamespace,
  type FlatMessages,
  type Translator,
} from './translate'
import type { LanguageEntry, LanguagesConfig } from './config'

export interface RunOptions {
  /** Directory holding `<lng>/<namespace>.json` (e.g. repo `locales`). */
  localesDir: string
  /** Parsed `i18n.languages.json`. */
  languages: LanguagesConfig
  /** Translator that calls the LLM (injected so tests stay offline). */
  translate: Translator
  /** Write files to disk. When false, only computes the plan (dry run). */
  write?: boolean
  /** Per-key logger. */
  log?: (msg: string) => void
}

export interface NamespaceRun {
  language: string
  namespace: string
  translated: number
  skipped: number
  pruned: number
}

export interface RunResult {
  runs: NamespaceRun[]
  /** True if any file content changed (drives "did the bot PR need opening"). */
  changed: boolean
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function listNamespaces(localesDir: string, sourceLanguage: string): string[] {
  const dir = join(localesDir, sourceLanguage)
  if (!existsSync(dir)) {
    throw new Error(`Source locale directory not found: ${dir}`)
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith(META_SUFFIX))
    .map((f) => basename(f, '.json'))
}

function writeJsonStable(path: string, value: unknown): void {
  // Stable key ordering + trailing newline → byte-identical output for
  // unchanged inputs (idempotent, clean diffs).
  writeFileSync(path, JSON.stringify(sortKeys(value), null, 2) + '\n', 'utf8')
}

function sortKeys(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

/**
 * Translate every namespace into every non-source language. Reads existing
 * translations + per-key hash sidecars, translates only missing/changed keys,
 * and (optionally) writes results back. Returns a summary and whether anything
 * changed.
 */
export async function run(options: RunOptions): Promise<RunResult> {
  const { localesDir, languages, translate, write = true, log = () => {} } = options
  const { sourceLanguage } = languages
  const namespaces = listNamespaces(localesDir, sourceLanguage)
  const runs: NamespaceRun[] = []
  let changed = false

  const targets = languages.languages.filter((l) => l.code !== sourceLanguage)

  for (const ns of namespaces) {
    const source = readJson<FlatMessages>(
      join(localesDir, sourceLanguage, `${ns}.json`),
      {}
    )

    for (const lang of targets) {
      const result = await translateOneNamespaceForLang({
        localesDir,
        namespace: ns,
        source,
        lang,
        translate,
      })

      const fileChanged =
        result.translatedKeys.length > 0 || result.prunedKeys.length > 0
      if (fileChanged) changed = true

      if (write) {
        const langDir = join(localesDir, lang.code)
        mkdirSync(langDir, { recursive: true })
        writeJsonStable(join(langDir, `${ns}.json`), result.messages)
        writeJsonStable(join(langDir, `${ns}${META_SUFFIX}`), result.meta)
      }

      log(
        `[${lang.code}/${ns}] translated=${result.translatedKeys.length} ` +
          `skipped=${result.skippedKeys.length} pruned=${result.prunedKeys.length}`
      )

      runs.push({
        language: lang.code,
        namespace: ns,
        translated: result.translatedKeys.length,
        skipped: result.skippedKeys.length,
        pruned: result.prunedKeys.length,
      })
    }
  }

  return { runs, changed }
}

async function translateOneNamespaceForLang(args: {
  localesDir: string
  namespace: string
  source: FlatMessages
  lang: LanguageEntry
  translate: Translator
}) {
  const { localesDir, namespace, source, lang, translate } = args
  const langDir = join(localesDir, lang.code)
  const existing = readJson<FlatMessages>(
    join(langDir, `${namespace}.json`),
    {}
  )
  const meta = readJson<LocaleMeta>(
    join(langDir, `${namespace}${META_SUFFIX}`),
    emptyMeta()
  )

  return translateNamespace({
    source,
    existing,
    meta,
    targetCode: lang.code,
    targetLanguageName: lang.name,
    translate,
  })
}
