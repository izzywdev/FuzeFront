import { useT } from '@fuzefront/i18n'
import type { AccountSecurityLocale } from '@fuzefront/account-security-ui'

/**
 * Map the active i18next language to a locale the account-security package
 * ships ('en' | 'he'). Region-tagged codes ('he-IL') resolve to their base;
 * anything unsupported (or an uninitialised i18n instance) falls back to 'en'.
 */
export function toAccountSecurityLocale(language: string | undefined | null): AccountSecurityLocale {
  const base = (language ?? '').toLowerCase().split(/[-_]/)[0]
  return base === 'he' ? 'he' : 'en'
}

/** The package `locale` prop for the host's active language (drives LTR/RTL). */
export function useAccountSecurityLocale(): AccountSecurityLocale {
  const { i18n } = useT()
  return toAccountSecurityLocale(i18n?.resolvedLanguage ?? i18n?.language)
}
