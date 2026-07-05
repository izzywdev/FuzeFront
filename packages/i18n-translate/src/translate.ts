import { sourceHash, type LocaleMeta, emptyMeta } from './hash'
import { placeholdersPreserved } from './placeholders'
import { glossaryPreserved, DEFAULT_GLOSSARY } from './glossary'

export type FlatMessages = Record<string, string>

/** A function that translates one source string into a target language. */
export type Translator = (args: {
  source: string
  targetCode: string
  targetLanguageName: string
}) => Promise<string>

export interface TranslateNamespaceArgs {
  /** English source messages (flat key -> string). */
  source: FlatMessages
  /** Existing translations for the target language (flat key -> string). */
  existing: FlatMessages
  /** Existing per-key source hashes for the target language. */
  meta: LocaleMeta
  targetCode: string
  targetLanguageName: string
  translate: Translator
  glossary?: readonly string[]
  /** Throw if a translation drops a placeholder/glossary term. Default true. */
  validate?: boolean
}

export interface TranslateNamespaceResult {
  messages: FlatMessages
  meta: LocaleMeta
  /** Keys that were (re)translated this run. */
  translatedKeys: string[]
  /** Keys skipped because their source hash was unchanged. */
  skippedKeys: string[]
  /** Keys removed because they no longer exist in the English source. */
  prunedKeys: string[]
}

/**
 * Translate one namespace for one target language.
 *
 * Idempotency: a key is translated only when missing from `existing` OR when
 * its English source hash differs from the stored hash. Unchanged keys are
 * copied through untouched, so re-running with the same inputs is a no-op and
 * never calls the LLM. Keys absent from the English source are pruned.
 */
export async function translateNamespace(
  args: TranslateNamespaceArgs
): Promise<TranslateNamespaceResult> {
  const {
    source,
    existing,
    meta = emptyMeta(),
    targetCode,
    targetLanguageName,
    translate,
    glossary = DEFAULT_GLOSSARY,
    validate = true,
  } = args

  const outMessages: FlatMessages = {}
  const outMeta: LocaleMeta = { hashes: {} }
  const translatedKeys: string[] = []
  const skippedKeys: string[] = []

  for (const [key, srcValue] of Object.entries(source)) {
    const hash = sourceHash(srcValue)
    const priorHash = meta.hashes?.[key]
    const hasExisting = key in existing

    if (hasExisting && priorHash === hash) {
      // Unchanged source + existing translation → keep as-is.
      outMessages[key] = existing[key]
      outMeta.hashes[key] = hash
      skippedKeys.push(key)
      continue
    }

    const translated = await translate({
      source: srcValue,
      targetCode,
      targetLanguageName,
    })

    if (validate) {
      if (!placeholdersPreserved(srcValue, translated)) {
        throw new Error(
          `Placeholder mismatch translating "${key}" to ${targetCode}: ` +
            `source=${JSON.stringify(srcValue)} translated=${JSON.stringify(translated)}`
        )
      }
      if (!glossaryPreserved(srcValue, translated, glossary)) {
        throw new Error(
          `Glossary term not preserved translating "${key}" to ${targetCode}: ` +
            `translated=${JSON.stringify(translated)}`
        )
      }
    }

    outMessages[key] = translated
    outMeta.hashes[key] = hash
    translatedKeys.push(key)
  }

  // Keys in the prior translation that no longer exist in English are pruned.
  const prunedKeys = Object.keys(existing).filter((k) => !(k in source))

  return { messages: outMessages, meta: outMeta, translatedKeys, skippedKeys, prunedKeys }
}
