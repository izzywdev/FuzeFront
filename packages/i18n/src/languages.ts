/**
 * Language registry for @fuzefront/i18n.
 *
 * This is the single source of truth at RUNTIME for which languages the shell
 * offers and which direction each uses. It mirrors the build-time
 * `i18n.languages.json` used by @fuzefront/i18n-translate; keep the two in sync
 * (the build pipeline reads the JSON, the runtime ships this typed copy).
 */

export type TextDirection = 'ltr' | 'rtl'

export interface LanguageDescriptor {
  /** BCP-47 language code, e.g. "en", "pt", "zh". */
  code: string
  /** English display name, e.g. "Spanish". */
  name: string
  /** Endonym shown in the selector, e.g. "Español". */
  nativeName: string
  /** Writing direction; drives <html dir> and logical-property mirroring. */
  dir: TextDirection
}

/**
 * Curated, AI-translated language set. English is the maintained source; the
 * rest are generated at build time. Adding a language here (and to
 * `i18n.languages.json`) plus a rebuild is all that is required to ship it.
 */
export const LANGUAGES: readonly LanguageDescriptor[] = Object.freeze([
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', dir: 'ltr' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl' },
])

export const DEFAULT_LANGUAGE = 'en'

/** All supported language codes, in registry order. */
export const SUPPORTED_LANGUAGE_CODES: readonly string[] = LANGUAGES.map(
  (l) => l.code
)

/** Look up a descriptor by code (case-insensitive, region-tolerant: "en-US" → "en"). */
export function getLanguage(code: string | undefined | null): LanguageDescriptor | undefined {
  if (!code) return undefined
  const lc = code.toLowerCase()
  return (
    LANGUAGES.find((l) => l.code === lc) ??
    LANGUAGES.find((l) => l.code === lc.split('-')[0])
  )
}

/** Resolve the writing direction for a code, defaulting to ltr for unknowns. */
export function getDirection(code: string | undefined | null): TextDirection {
  return getLanguage(code)?.dir ?? 'ltr'
}

/** True when the code is in the curated registry. */
export function isSupported(code: string | undefined | null): boolean {
  return getLanguage(code) !== undefined
}
