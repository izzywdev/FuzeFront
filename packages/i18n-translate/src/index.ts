/**
 * @fuzefront/i18n-translate — build-time AI translation for FuzeFront locales.
 *
 * Library entry point. The CLI (`fuzefront-i18n-translate`) is in `cli.ts`.
 */
export { run } from './runner'
export type { RunOptions, RunResult, NamespaceRun } from './runner'

export { translateNamespace } from './translate'
export type {
  FlatMessages,
  Translator,
  TranslateNamespaceArgs,
  TranslateNamespaceResult,
} from './translate'

export {
  translateOne,
  buildSystemPrompt,
  buildUserPrompt,
} from './llm'
export type { LlmConfig, FetchLike, TranslateOneArgs } from './llm'

export {
  extractPlaceholders,
  placeholdersPreserved,
  listPlaceholders,
} from './placeholders'

export {
  DEFAULT_GLOSSARY,
  glossaryTermsIn,
  glossaryPreserved,
} from './glossary'

export { sourceHash, META_SUFFIX, emptyMeta } from './hash'
export type { LocaleMeta } from './hash'

export {
  loadLanguagesConfig,
  resolveLlmEnv,
} from './config'
export type { LanguageEntry, LanguagesConfig, LlmEnv } from './config'
