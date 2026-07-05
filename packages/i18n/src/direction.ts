import { useEffect, useState } from 'react'
import type { i18n as I18nInstance } from 'i18next'
import { getDirection, type TextDirection } from './languages'

/**
 * Centralized RTL/LTR direction management.
 *
 * The single rule for the whole platform: the document's writing direction is
 * derived from the active language via the registry, and applied to
 * `<html dir>` + `<html lang>`. Design-system components should style with CSS
 * *logical* properties (margin-inline, padding-inline, inset-inline, text-align:
 * start/end) so they mirror automatically when `dir` flips — no per-component
 * RTL branching required.
 */

/** Apply the document direction + lang for a given language code. No-op on server. */
export function applyDocumentDirection(code: string): TextDirection {
  const dir = getDirection(code)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('dir', dir)
    document.documentElement.setAttribute('lang', code)
  }
  return dir
}

/**
 * Wire a `dir` manager to an i18next instance: applies direction now and on
 * every `languageChanged`. Returns a disposer that detaches the listener.
 */
export function attachDirectionManager(i18n: I18nInstance): () => void {
  const handler = (lng: string) => applyDocumentDirection(lng)
  handler(i18n.language)
  i18n.on('languageChanged', handler)
  return () => i18n.off('languageChanged', handler)
}

/**
 * React hook returning the current writing direction, kept in sync with the
 * supplied i18next instance. Useful for components that must branch on
 * direction beyond what CSS logical properties cover (e.g. directional icons).
 */
export function useDir(i18n: I18nInstance): TextDirection {
  const [dir, setDir] = useState<TextDirection>(() => getDirection(i18n.language))
  useEffect(() => {
    const handler = (lng: string) => setDir(getDirection(lng))
    handler(i18n.language)
    i18n.on('languageChanged', handler)
    return () => i18n.off('languageChanged', handler)
  }, [i18n])
  return dir
}
