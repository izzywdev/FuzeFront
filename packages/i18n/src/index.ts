/**
 * @fuzefront/i18n — shared internationalization runtime for the FuzeFront shell
 * and its micro-frontends. Built on i18next + react-i18next (we adopt, not
 * reinvent). Locale JSON is generated at build time by @fuzefront/i18n-translate
 * and bundled by the frontend build; this package only consumes it at runtime.
 */

export { I18nProvider } from './I18nProvider'
export type { I18nProviderProps } from './I18nProvider'

export { LanguageSelector } from './LanguageSelector'
export type { LanguageSelectorProps } from './LanguageSelector'

export { useT } from './useT'

export {
  createI18n,
  setLanguage,
  resolveInitialLanguage,
} from './config'
export type { CreateI18nOptions } from './config'

export {
  useDir,
  applyDocumentDirection,
  attachDirectionManager,
} from './direction'

export {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  getLanguage,
  getDirection,
  isSupported,
} from './languages'
export type { LanguageDescriptor, TextDirection } from './languages'

export {
  LANGUAGE_STORAGE_KEY,
  getStoredLanguage,
  storeLanguage,
} from './storage'

// Re-export react-i18next's Trans for convenience (rich/interpolated markup).
export { Trans } from 'react-i18next'
