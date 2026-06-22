/**
 * @fuzefront/i18n — minimal runtime i18n + direction provider shared by
 * FuzeFront UI packages (e.g. @fuzefront/billing-ui).
 *
 * Mirrors the semantics of the host shell's LanguageContext (`language`,
 * `setLanguage`, `t`, plus `dir`), so a feature package and the container agree
 * on language + text direction. Feature packages register their own string
 * tables via `messages` so each ships its own translations without bloating a
 * central bundle.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Language = 'en' | 'he'
export type Direction = 'ltr' | 'rtl'

/** RTL languages. `he` (Hebrew) is the project's RTL reference locale. */
const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['he'])

export function directionFor(language: Language): Direction {
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
}

/** A per-language string table: { en: { key: 'text' }, he: { key: '...' } }. */
export type Messages = Partial<Record<Language, Record<string, string>>>

export interface I18nContextValue {
  language: Language
  dir: Direction
  setLanguage: (language: Language) => void
  /** Translate a key for the active language; falls back to en, then the key. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function interpolate(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`
  )
}

export interface I18nProviderProps {
  children: ReactNode
  /** Initial language (default 'en'). */
  language?: Language
  /** Merged string tables. Feature packages pass their own. */
  messages?: Messages
}

export function I18nProvider({
  children,
  language: initial = 'en',
  messages = {},
}: I18nProviderProps) {
  const [language, setLanguage] = useState<Language>(initial)

  const value = useMemo<I18nContextValue>(() => {
    const dir = directionFor(language)
    const t = (key: string, vars?: Record<string, string | number>): string => {
      const active = messages[language]?.[key]
      const fallback = messages.en?.[key]
      return interpolate(active ?? fallback ?? key, vars)
    }
    return { language, dir, setLanguage, t }
  }, [language, messages])

  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}

/** Convenience: just the translate function. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t
}
