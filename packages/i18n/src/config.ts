import i18next, { type i18n as I18nInstance, type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, getLanguage } from './languages'
import { getStoredLanguage, storeLanguage } from './storage'
import { applyDocumentDirection } from './direction'

export interface CreateI18nOptions {
  /**
   * Bundled locale resources, shaped for i18next:
   *   { en: { common: {...} }, es: { common: {...} }, ... }
   * These are produced by the frontend build from `locales/<lng>/*.json`.
   */
  resources: Resource
  /** Override the initial language; otherwise restored-from-storage → browser → en. */
  lng?: string
  /** Default i18next namespace. */
  defaultNS?: string
  /** Persist language selection to localStorage. Default true. */
  persist?: boolean
  /** Reuse an existing i18next instance instead of the singleton (tests, isolation). */
  instance?: I18nInstance
}

/** Pick the initial language: explicit override → stored → browser → default, clamped to supported set. */
export function resolveInitialLanguage(explicit?: string): string {
  const candidates = [
    explicit,
    getStoredLanguage(),
    typeof navigator !== 'undefined' ? navigator.language : undefined,
  ]
  for (const c of candidates) {
    const match = getLanguage(c)
    if (match) return match.code
  }
  return DEFAULT_LANGUAGE
}

/**
 * Create and initialize an i18next instance bound to react-i18next.
 * Idempotent per instance: returns the same already-initialized instance.
 */
export async function createI18n(options: CreateI18nOptions): Promise<I18nInstance> {
  const {
    resources,
    lng,
    defaultNS = 'common',
    persist = true,
    instance,
  } = options

  const i18n = instance ?? i18next.createInstance()
  const initialLng = resolveInitialLanguage(lng)

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: initialLng,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
      defaultNS,
      ns: Object.keys(resources[initialLng] ?? resources[DEFAULT_LANGUAGE] ?? {}),
      interpolation: { escapeValue: false },
      returnNull: false,
    })
  }

  applyDocumentDirection(i18n.language)

  if (persist) {
    i18n.on('languageChanged', (l: string) => storeLanguage(l))
  }

  return i18n
}

/**
 * Change the active language on an instance and persist it. Returns the
 * resolved code (clamped to the supported set; falls back to default).
 */
export async function setLanguage(
  i18n: I18nInstance,
  code: string
): Promise<string> {
  const resolved = getLanguage(code)?.code ?? DEFAULT_LANGUAGE
  await i18n.changeLanguage(resolved)
  storeLanguage(resolved)
  return resolved
}
