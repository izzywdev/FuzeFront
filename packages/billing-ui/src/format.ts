import type { Language } from '@fuzefront/i18n'

const LOCALE: Record<Language, string> = { en: 'en-US', he: 'he-IL' }

/**
 * Formats a minor-unit amount (Stripe `unitAmount` in cents) as a localized
 * currency string. Uses Intl so it mirrors automatically for RTL locales.
 */
export function formatMoney(
  minorUnits: number,
  currency: string,
  language: Language = 'en'
): string {
  const major = minorUnits / 100
  try {
    return new Intl.NumberFormat(LOCALE[language] ?? 'en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
      // Whole-dollar plans show no cents; fractional amounts keep 2 dp.
      minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    }).format(major)
  } catch {
    // Unknown currency code — fall back to a plain number + raw code.
    return `${major} ${(currency || '').toUpperCase()}`
  }
}

/** Localized short date for renewal/cancel dates. Tolerates null. */
export function formatDate(iso: string | null, language: Language = 'en'): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE[language] ?? 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d)
}
