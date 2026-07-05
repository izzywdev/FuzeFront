/** Relative/absolute date helpers shared across identity views. */

const DAY_MS = 24 * 60 * 60 * 1000

/** Days from now until `iso`. Negative if in the past. null if no date. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((t - now) / DAY_MS)
}

/** True when `iso` is within `thresholdDays` in the future (and not already past). */
export function expiresSoon(
  iso: string | null | undefined,
  thresholdDays = 14,
  now: number = Date.now()
): boolean {
  const d = daysUntil(iso, now)
  if (d === null) return false
  return d >= 0 && d <= thresholdDays
}

/** True when `iso` is strictly in the past. */
export function isExpired(iso: string | null | undefined, now: number = Date.now()): boolean {
  const d = daysUntil(iso, now)
  return d !== null && d < 0
}

/** Short locale date string, or null when no date. */
export function formatDate(iso: string | null | undefined, locale = 'en'): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}
