/**
 * Persisted-language helper. Reading/writing localStorage is wrapped so the
 * package degrades gracefully in non-browser / privacy-mode environments
 * (SSR, tests, blocked storage) without throwing.
 */

export const LANGUAGE_STORAGE_KEY = 'fuzefront.language'

export function getStoredLanguage(
  key: string = LANGUAGE_STORAGE_KEY
): string | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export function storeLanguage(
  code: string,
  key: string = LANGUAGE_STORAGE_KEY
): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, code)
  } catch {
    /* storage unavailable — language simply won't persist this session */
  }
}
